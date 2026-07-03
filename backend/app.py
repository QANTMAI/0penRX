"""0penRX coupon lookup API.

Serves curated coupon / patient-assistance records (and an optional GoodRx
Partner API proxy). Records are loaded from data/coupons.jsonl, generated from
the catalog by data/build_coupons.py.

Live prescription pricing (CMS NADAC) is fetched client-side directly from
data.medicaid.gov by assets/live.js — it does NOT flow through this backend.
"""

from __future__ import annotations

import base64
import hashlib
import hmac as _hmac
import json
import os
import re
import time
from collections import defaultdict, deque
from datetime import date
from urllib.parse import urlencode

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="0penRX API", version="0.1.0")

# The static frontend (0penrx.org, GitHub Pages, or local preview) calls this
# API cross-origin, so CORS must be open for GET. Override the allowed origins
# with the OPENRX_CORS_ORIGINS env var (comma-separated).
# Default is the production origin — never open to * in production.
_origins = [
    o.strip()
    for o in os.environ.get("OPENRX_CORS_ORIGINS", "https://0penrx.org").split(",")
    if o.strip()
]
# Guard: an empty env var (OPENRX_CORS_ORIGINS=) produces an empty list, which
# silently blocks all cross-origin requests with no server-side error. Fall back
# to the production origin so a misconfigured Render env var can't kill the site.
if not _origins:
    _origins = ["https://0penrx.org"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["GET"],
    allow_headers=["Accept", "Content-Type"],
)


# Security response headers. Unlike the GitHub Pages frontend (which can only use
# a <meta> CSP), this backend serves real HTTP headers, so we set the OWASP-
# recommended baseline on every JSON response. This is a read-only, no-cookie,
# no-embed API, so the strict cross-origin values are safe.
_SECURITY_HEADERS = {
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=(), payment=(), usb=()",
    "Cache-Control": "no-store",
}


# ---- Per-IP rate limiting -------------------------------------------------
# A read-only API on a single free-tier instance, so a lightweight in-memory
# sliding-window limiter is appropriate (no external store needed). Blocks
# scraping/DoS bursts while leaving normal use (a few requests per drug view)
# untouched. Tunable via env; /health is exempt so uptime probes never throttle.
_RATE_MAX = int(os.environ.get("RATE_LIMIT_MAX", "120"))  # requests per window
_RATE_WINDOW = int(os.environ.get("RATE_LIMIT_WINDOW", "60"))  # seconds
_rate_hits: dict[str, deque] = defaultdict(deque)


def _client_ip(request) -> str:
    # Render terminates TLS at a proxy, so the real client is in X-Forwarded-For.
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _rate_retry_after(request) -> int | None:
    """Seconds to wait if the client is over the limit, else None (and record it)."""
    now = time.monotonic()
    dq = _rate_hits[_client_ip(request)]
    cutoff = now - _RATE_WINDOW
    while dq and dq[0] < cutoff:
        dq.popleft()
    if len(dq) >= _RATE_MAX:
        return int(_RATE_WINDOW - (now - dq[0])) + 1
    dq.append(now)
    # Bound memory: drop idle IPs if the table grows large.
    if len(_rate_hits) > 50000:
        for ip in [k for k, v in _rate_hits.items() if not v]:
            del _rate_hits[ip]
    return None


@app.middleware("http")
async def security_headers(request, call_next):
    retry = None if request.url.path == "/health" else _rate_retry_after(request)
    if retry is not None:
        response = JSONResponse({"detail": "rate limit exceeded"}, status_code=429)
        response.headers["Retry-After"] = str(retry)
    else:
        response = await call_next(request)
    for k, v in _SECURITY_HEADERS.items():
        response.headers.setdefault(k, v)
    # Reduce fingerprinting: don't advertise the server stack.
    response.headers["Server"] = "0penrx"
    return response


COUPONS_DATA_PATH = os.environ.get("COUPONS_DATA", "data/coupons.jsonl")


def _load_jsonl(path: str) -> tuple[list[dict], bool]:
    """Load records from a JSONL file; returns (records, loaded).

    loaded=False means the file was absent — callers return empty results
    rather than fabricated data, so bench-day collections stay clean.
    """
    if not path or not os.path.exists(path):
        return [], False
    records: list[dict] = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records, bool(records)


# Alias so existing tests that call _load_coupons still work.
_load_coupons = _load_jsonl

# Loaded once at startup; restart the process to pick up new data.
_COUPONS, _COUPONS_LOADED = _load_jsonl(COUPONS_DATA_PATH)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "coupons_loaded": _COUPONS_LOADED,
        "goodrx_enabled": _GOODRX_ENABLED,
    }


def _word_match(needle: str, hay: str) -> bool:
    """True when `needle` appears in `hay` bounded by non-alphanumeric edges,
    so 'metformin' matches 'metformin HCl' but not 'metforminish'."""
    return re.search(rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])", hay) is not None


def _coupon_matches(needle: str, r: dict) -> bool:
    """Match a coupon to a query on identity, not on a sub-ingredient.

    A plain ingredient search (e.g. 'metformin') must NOT surface a combination
    product whose name merely contains that ingredient (Invokamet =
    canagliflozin/metformin, Xigduo = dapagliflozin/metformin). We match the
    drug_slug exactly (incl. dosage-form variants like ozempic -> ozempic-pill),
    a word-boundary hit in the brand, or a word-boundary hit in drug_name — but
    for a combination product (ingredients joined by '/' or '+') only when the
    needle is the *primary* (first) ingredient or the full combined name.
    """
    slug = (r.get("drug_slug") or "").lower()
    if needle == slug or slug.startswith(f"{needle}-"):
        return True
    brand = (r.get("brand") or "").lower()
    if brand and _word_match(needle, brand):
        return True
    name = (r.get("drug_name") or "").lower()
    if name and _word_match(needle, name):
        ingredients = [p.strip() for p in re.split(r"[/+]", name) if p.strip()]
        if len(ingredients) > 1:
            return needle == name or _word_match(needle, ingredients[0])
        return True
    return False


@app.get("/coupons")
def coupons(
    drug: str = Query(
        ..., description="Drug name/brand/slug to match (identity, not sub-ingredient)"
    ),
    type: str | None = Query(
        None, description="Exact program_type filter (copay-card|manufacturer-direct)"
    ),
    limit: int = Query(25, ge=1, le=200, description="Max results to return"),
):
    """Return matching coupon records, excluding any that have expired.

    Returns count=0 and an empty results list when no data file is loaded.
    """
    if not _COUPONS_LOADED:
        return {"drug": drug, "count": 0, "results": [], "loaded": False}
    needle = drug.lower().strip()
    # ISO dates sort lexically, so a string compare is correct for expiry.
    today = date.today().isoformat()

    results = []
    for r in _COUPONS:
        if not _coupon_matches(needle, r):
            continue
        if type is not None and r.get("program_type") != type:
            continue
        if r.get("status") == "expired":
            continue
        expiry = r.get("expiration_date")
        if expiry and expiry < today:
            continue
        results.append(r)

    return {"drug": drug, "count": len(results), "results": results[:limit]}


# ---- GoodRx Partner API v2 proxy -------------------------------------------
# Set GOODRX_API_KEY and GOODRX_PRIVATE_KEY in the host environment (Render
# dashboard) to activate. When unset the endpoint returns {"enabled": false}
# and the frontend skips the GoodRx panel silently.
#
# API key:     GOODRX_API_KEY     — included as a query parameter in every request
# Private key: GOODRX_PRIVATE_KEY — HMAC secret, never sent over the wire
# Base URL:    GOODRX_API_BASE    — default https://api.goodrx.com (override for sandbox)
#
# GoodRx signing spec (verified from Partner API v2 docs):
#   1. Build a sorted URL-encoded query string of all params including api_key.
#   2. For POST requests, append the raw POST body directly (no separator).
#   3. HMAC-SHA256 the combined string with the private key.
#   4. Base64-encode and replace both '/' and '+' with '_' (GoodRx-specific —
#      not standard URL-safe base64, which uses '-' for '+').
#   5. Append sig=<result> to the request.
#
# Response field names below are inferred from verified v2 doc descriptions.
# Confirm against real responses once the key is active and adjust as needed.

_GOODRX_API_KEY = os.environ.get("GOODRX_API_KEY", "")
_GOODRX_PRIVATE_KEY = os.environ.get("GOODRX_PRIVATE_KEY", "")
_GOODRX_API_BASE = os.environ.get("GOODRX_API_BASE", "https://api.goodrx.com")
_GOODRX_ENABLED = bool(_GOODRX_API_KEY and _GOODRX_PRIVATE_KEY)


def _goodrx_sign(query_params: dict[str, str], post_body: str = "") -> str:
    """Return the HMAC-SHA256 signature for a GoodRx API request.

    query_params must include api_key. post_body is the raw URL-encoded POST
    body for POST requests (empty string for GET). The signed string is the
    sorted query string concatenated directly with the POST body (no separator).
    """
    query = urlencode(sorted(query_params.items()))
    message = (query + post_body).encode()
    raw = _hmac.new(_GOODRX_PRIVATE_KEY.encode(), message, hashlib.sha256).digest()
    return base64.b64encode(raw).decode().replace("/", "_").replace("+", "_")


@app.get("/coupons/goodrx")
async def coupons_goodrx(
    drug: str = Query(..., description="Generic drug name to look up"),
    quantity: int = Query(30, ge=1, le=360, description="Fill quantity for pricing"),
):
    """Proxy to GoodRx Partner API v2: price compare then coupon adjudication.

    Two-step call:
      1. GET /v2/price/compare — finds the cheapest GoodRx offer for the drug.
      2. POST /v2/coupon       — retrieves BIN/PCN/Group/Member ID for POS use.

    Returns {"enabled": false, "results": []} when credentials are not set so
    the frontend skips the GoodRx section without an error state.
    The result is shaped like a catalog coupon record so couponCardHTML()
    renders it without modification.
    """
    if not _GOODRX_ENABLED:
        return {"drug": drug, "enabled": False, "results": []}

    # Step 1: price compare — cheapest GoodRx offer for this drug + quantity.
    compare_params: dict[str, str] = {
        "name": drug,
        "quantity": str(quantity),
        "api_key": _GOODRX_API_KEY,
    }
    compare_params["sig"] = _goodrx_sign(compare_params)

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
            r1 = await client.get(
                f"{_GOODRX_API_BASE}/v2/price/compare",
                params=compare_params,
            )
            if r1.status_code != 200:
                raise HTTPException(
                    502, f"GoodRx price-compare returned {r1.status_code}"
                )

            prices = r1.json().get("data", {}).get("prices", [])
            if not prices:
                return {"drug": drug, "enabled": True, "results": []}

            best = min(prices, key=lambda o: o.get("display", {}).get("price", 9999))
            pharmacy = best.get("pharmacy", {})

            # Step 2: coupon — adjudication codes (BIN/PCN/Group/Member) for the best offer.
            body_fields: dict[str, str] = {
                "ndc": str(best.get("ndc", "")),
                "quantity": str(quantity),
                "pharmacy_id": str(pharmacy.get("id", "")),
            }
            post_body = urlencode(sorted(body_fields.items()))
            # POST signing: only api_key in query string, full body appended, no separator.
            coupon_query: dict[str, str] = {"api_key": _GOODRX_API_KEY}
            coupon_query["sig"] = _goodrx_sign(coupon_query, post_body)

            r2 = await client.post(
                f"{_GOODRX_API_BASE}/v2/coupon",
                params=coupon_query,
                content=post_body,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if r2.status_code != 200:
                raise HTTPException(502, f"GoodRx coupon returned {r2.status_code}")

    except HTTPException:
        raise
    except httpx.TimeoutException:
        # Never interpolate the exception into the response — for the signed
        # request it can stringify a URL that carries the GoodRx api_key.
        raise HTTPException(502, "GoodRx request timed out")
    except httpx.HTTPError:
        raise HTTPException(502, "GoodRx upstream error")

    c = r2.json().get("data", {})
    result = {
        "program_name": "GoodRx",
        "program_type": "copay-card",
        "drug_name": drug,
        "manufacturer": None,
        "bin": c.get("bin"),
        "pcn": c.get("pcn"),
        "group": c.get("group"),
        "member_id": c.get("memberId") or c.get("member_id"),
        "price_usd": best.get("display", {}).get("price"),
        "pharmacy_name": pharmacy.get("name"),
        "url": c.get("url"),
        "medicare_medicaid_excluded": True,
        "source": "goodrx",
    }
    return {"drug": drug, "enabled": True, "results": [result]}
