"""0penRX price lookup API.

Serves normalized prescription prices. Records are loaded from a JSONL file
produced by data/ingest_nadac.py (one normalized record per line). When no
data file is present, a small in-memory sample is used so the API and tests
still work out of the box.

Set the NADAC_DATA env var to point at a JSONL file, otherwise the default
path data/processed/nadac.jsonl is used.
"""

from __future__ import annotations

import json
import os
import re
from datetime import date

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="0penRX API", version="0.1.0")

# The static frontend (0penrx.org, GitHub Pages, or local preview) calls this
# API cross-origin, so CORS must be open for GET. Override the allowed origins
# with the OPENRX_CORS_ORIGINS env var (comma-separated) to lock it down.
_origins = [
    o.strip()
    for o in os.environ.get("OPENRX_CORS_ORIGINS", "*").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins or ["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

DEFAULT_DATA_PATH = os.environ.get("NADAC_DATA", "data/processed/nadac.jsonl")
COUPONS_DATA_PATH = os.environ.get("COUPONS_DATA", "data/coupons.jsonl")

# In-memory fallback used when no ingested data file is available.
_SAMPLE = [
    {
        "drug_name": "atorvastatin",
        "dose": "10 mg tablet",
        "quantity": 30,
        "price_usd": 8.42,
        "unit": "EA",
        "pharmacy_name": "Example Pharmacy",
        "zip": "06095",
        "source": "NADAC",
    },
]


def _load_records(path: str) -> list[dict]:
    """Load normalized price records from a JSONL file, or the sample."""
    if not path or not os.path.exists(path):
        return list(_SAMPLE)
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
    return records or list(_SAMPLE)


# In-memory fallback used when no coupon dataset file is available.
_COUPON_SAMPLE = [
    {
        "program_name": "Amgen Assist360",
        "manufacturer": "Amgen",
        "drug_name": "erenumab-aooe",
        "drug_slug": "aimovig",
        "brand": "Aimovig®",
        "program_type": "copay-card",
        "bin": "015995",
        "pcn": "GDC",
        "group": "MAHA",
        "member_id": "RXFINDER",
        "eligibility": None,
        "medicare_medicaid_excluded": True,
        "url": "https://www.amgenassist360.com",
        "source": "catalog",
        "source_url": "https://0penrx.org",
        "effective_date": "2026-01-01",
        "expiration_date": "2026-12-31",
        "state_restrictions": ["MA", "CA"],
        "status": "active",
        "ingested_at": "2026-01-01T00:00:00+00:00",
    },
]


def _load_coupons(path: str) -> list[dict]:
    """Load coupon records from a JSONL file, or the in-memory sample."""
    if not path or not os.path.exists(path):
        return list(_COUPON_SAMPLE)
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
    return records or list(_COUPON_SAMPLE)


# Loaded once at startup; restart the process to pick up new data.
_RECORDS = _load_records(DEFAULT_DATA_PATH)
_COUPONS = _load_coupons(COUPONS_DATA_PATH)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/prices")
def prices(
    drug: str = Query(..., description="Drug name substring to match"),
    zip: str | None = Query(None, description="5-digit ZIP filter"),
    limit: int = Query(25, ge=1, le=200, description="Max results to return"),
):
    """Return matching price records, ranked cheapest first."""
    needle = drug.lower()
    results = [
        r
        for r in _RECORDS
        if r.get("drug_name")
        and needle in r["drug_name"].lower()
        and r.get("price_usd") is not None
    ]
    if zip:
        results = [r for r in results if r.get("zip") == zip]
    results.sort(key=lambda r: r["price_usd"])
    return {"drug": drug, "count": len(results), "results": results[:limit]}


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
    """Return matching coupon records, excluding any that have expired."""
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
