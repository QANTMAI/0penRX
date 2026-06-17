"""Tests for the 0penRX price lookup API."""

import base64
import hashlib
import hmac as _hmac_lib
import json
import os
import sys
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import urlencode

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import app
import app as _app_module

client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert isinstance(body["prices_loaded"], bool)
    assert isinstance(body["coupons_loaded"], bool)
    assert isinstance(body["goodrx_enabled"], bool)


def test_prices_returns_match():
    from app import _PRICES_LOADED

    resp = client.get("/prices", params={"drug": "atorvastatin"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["drug"] == "atorvastatin"
    if not _PRICES_LOADED:
        # NADAC data file absent (gitignored) — API must return empty, not sample
        assert body["count"] == 0
        assert body["results"] == []
        assert body.get("loaded") is False
    else:
        assert body["count"] >= 1
        assert body["results"][0]["price_usd"] > 0


def test_prices_no_match():
    resp = client.get("/prices", params={"drug": "nonexistent-drug"})
    assert resp.status_code == 200
    assert resp.json()["count"] == 0


def test_prices_requires_drug():
    resp = client.get("/prices")
    assert resp.status_code == 422


def test_coupons_returns_match():
    resp = client.get("/coupons", params={"drug": "aimovig"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["drug"] == "aimovig"
    assert body["count"] >= 1
    record = body["results"][0]
    for field in (
        "program_name",
        "manufacturer",
        "drug_name",
        "drug_slug",
        "brand",
        "program_type",
        "medicare_medicaid_excluded",
        "status",
    ):
        assert field in record
    assert record["medicare_medicaid_excluded"] is True


def test_coupons_type_filter():
    resp = client.get(
        "/coupons", params={"drug": "aimovig", "type": "manufacturer-direct"}
    )
    assert resp.status_code == 200
    assert resp.json()["count"] == 0

    resp = client.get("/coupons", params={"drug": "aimovig", "type": "copay-card"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] >= 1
    assert all(r["program_type"] == "copay-card" for r in body["results"])


def test_coupons_requires_drug():
    resp = client.get("/coupons")
    assert resp.status_code == 422


def test_coupons_excludes_expired():
    from app import _COUPONS

    expired = {
        "program_name": "Expired Program",
        "manufacturer": "Test Pharma",
        "drug_name": "expireddrug",
        "drug_slug": "expireddrug",
        "brand": "ExpiredDrug®",
        "program_type": "copay-card",
        "expiration_date": "2000-12-31",
        "status": "active",
        "medicare_medicaid_excluded": True,
    }
    _COUPONS.append(expired)
    try:
        resp = client.get("/coupons", params={"drug": "expireddrug"})
        assert resp.status_code == 200
        assert resp.json()["count"] == 0
    finally:
        _COUPONS.remove(expired)


def test_goodrx_disabled_when_no_key():
    """Without GOODRX_API_KEY / GOODRX_PRIVATE_KEY the endpoint returns
    {enabled: false} with an empty results list and a 200 status — the frontend
    skips the panel silently, no error state."""
    resp = client.get("/coupons/goodrx", params={"drug": "atorvastatin"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is False
    assert body["results"] == []


def _coupon_fixture(**over):
    base = {
        "program_name": "Test Program",
        "manufacturer": "Test Pharma",
        "program_type": "manufacturer-direct",
        "status": "active",
        "medicare_medicaid_excluded": True,
    }
    base.update(over)
    return base


def test_coupons_ingredient_does_not_match_combination_product():
    """A plain-ingredient search must not surface a combination product whose
    name merely contains that ingredient as a secondary component (Invokamet =
    canagliflozin/metformin, Xigduo = dapagliflozin/metformin)."""
    from app import _COUPONS

    combo = _coupon_fixture(
        drug_name="canagliflozin/metformin HCl",
        drug_slug="invokamet",
        brand="Invokamet®",
    )
    _COUPONS.append(combo)
    try:
        resp = client.get("/coupons", params={"drug": "metformin"})
        assert resp.status_code == 200
        slugs = {r["drug_slug"] for r in resp.json()["results"]}
        assert "invokamet" not in slugs
    finally:
        _COUPONS.remove(combo)


def test_coupons_primary_and_sole_ingredient_still_match():
    """The fix must not drop legitimate lookups: a drug's sole ingredient and a
    combination's *primary* ingredient still match, while the secondary one
    (metformin) does not."""
    from app import _COUPONS

    combo = _coupon_fixture(
        drug_name="canagliflozin/metformin HCl",
        drug_slug="invokamet",
        brand="Invokamet®",
    )
    mono = _coupon_fixture(
        drug_name="canagliflozin", drug_slug="invokana", brand="Invokana®"
    )
    _COUPONS.extend([combo, mono])
    try:
        slugs = {
            r["drug_slug"]
            for r in client.get("/coupons", params={"drug": "canagliflozin"}).json()[
                "results"
            ]
        }
        assert "invokana" in slugs  # sole ingredient
        assert "invokamet" in slugs  # primary ingredient of the combination
        secondary = {
            r["drug_slug"]
            for r in client.get("/coupons", params={"drug": "metformin"}).json()[
                "results"
            ]
        }
        assert "invokamet" not in secondary  # secondary ingredient excluded
    finally:
        _COUPONS.remove(combo)
        _COUPONS.remove(mono)


def test_coupons_query_with_regex_special_chars():
    """Queries containing regex metacharacters must return 200, not 500.

    _word_match uses re.escape(needle) so these are safe, but this test locks
    that invariant — a future edit that removes re.escape would break this."""
    for q in (
        "metformin+xr",
        "drug/combo",
        "drug.name",
        "name[1]",
        "drug*",
        r"back\slash",
    ):
        resp = client.get("/coupons", params={"drug": q})
        assert resp.status_code == 200, f"status {resp.status_code} for drug={q!r}"
        assert "count" in resp.json()


def test_load_records_skips_malformed_lines():
    """Malformed JSON lines in the price JSONL are silently skipped; valid lines load."""
    good = json.dumps({"ndc": "12345", "price_usd": 9.99, "drug_name": "testdrug"})
    with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
        f.write(good + "\n")
        f.write("NOT JSON AT ALL\n")
        f.write("\n")  # blank line
        f.write("{truncated\n")
        name = f.name
    try:
        records, loaded = _app_module._load_records(name)
        assert loaded is True
        assert len(records) == 1
        assert records[0]["ndc"] == "12345"
    finally:
        os.unlink(name)


def test_load_coupons_skips_malformed_lines():
    """Malformed JSON lines in the coupon JSONL are silently skipped; valid lines load."""
    good = json.dumps(
        {"drug_slug": "testdrug", "program_name": "Test", "status": "active"}
    )
    with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
        f.write("GARBAGE\n")
        f.write(good + "\n")
        f.write("{bad: json}\n")
        name = f.name
    try:
        records, loaded = _app_module._load_coupons(name)
        assert loaded is True
        assert len(records) == 1
        assert records[0]["drug_slug"] == "testdrug"
    finally:
        os.unlink(name)


def test_goodrx_sign_known_vector():
    """_goodrx_sign produces the correct HMAC-SHA256 signature.

    This test independently computes the expected value so it catches any drift
    in sort order, separator choice, or base64 substitution rules.
    GoodRx-specific: both '/' AND '+' → '_' (not standard URL-safe base64)."""
    orig = _app_module._GOODRX_PRIVATE_KEY
    _app_module._GOODRX_PRIVATE_KEY = "testsecret"
    try:
        params = {"api_key": "testkey", "name": "atorvastatin", "quantity": "30"}
        sig = _app_module._goodrx_sign(params)

        # Compute independently: sorted QS, no post_body, HMAC-SHA256, GoodRx base64
        qs = urlencode(sorted(params.items()))
        raw = _hmac_lib.new(b"testsecret", qs.encode(), hashlib.sha256).digest()
        expected = base64.b64encode(raw).decode().replace("/", "_").replace("+", "_")

        assert sig == expected
        assert "/" not in sig, "forward-slash must be replaced"
        assert "+" not in sig, "plus must be replaced"

        # POST signing: post_body appended directly (no separator)
        post_body = "ndc=12345&pharmacy_id=P1&quantity=30"
        sig_post = _app_module._goodrx_sign({"api_key": "testkey"}, post_body)
        qs2 = urlencode(sorted({"api_key": "testkey"}.items()))
        raw2 = _hmac_lib.new(
            b"testsecret", (qs2 + post_body).encode(), hashlib.sha256
        ).digest()
        expected_post = (
            base64.b64encode(raw2).decode().replace("/", "_").replace("+", "_")
        )
        assert sig_post == expected_post
    finally:
        _app_module._GOODRX_PRIVATE_KEY = orig


def test_goodrx_enabled_happy_path():
    """With credentials set, the endpoint returns a shaped coupon result.

    httpx is mocked so no real network call is made. The response fields must
    match what couponCardHTML() expects: source='goodrx',
    medicare_medicaid_excluded=True, bin/pcn/group/member_id from the coupon step."""
    orig_key = _app_module._GOODRX_API_KEY
    orig_priv = _app_module._GOODRX_PRIVATE_KEY
    orig_enabled = _app_module._GOODRX_ENABLED
    _app_module._GOODRX_API_KEY = "testkey"
    _app_module._GOODRX_PRIVATE_KEY = "testsecret"
    _app_module._GOODRX_ENABLED = True

    r1_payload = {
        "data": {
            "prices": [
                {
                    "ndc": "00071015523",
                    "display": {"price": 14.75},
                    "pharmacy": {"id": "CVS001", "name": "CVS Pharmacy"},
                }
            ]
        }
    }
    r2_payload = {
        "data": {
            "bin": "015995",
            "pcn": "GDC",
            "group": "MAHA",
            "memberId": "RXFINDER",
            "url": "https://www.goodrx.com/coupon",
        }
    }

    mock_r1 = MagicMock()
    mock_r1.status_code = 200
    mock_r1.json.return_value = r1_payload

    mock_r2 = MagicMock()
    mock_r2.status_code = 200
    mock_r2.json.return_value = r2_payload

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_r1)
    mock_client.post = AsyncMock(return_value=mock_r2)

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_client)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    try:
        with patch("app.httpx.AsyncClient", return_value=mock_cm):
            resp = client.get("/coupons/goodrx", params={"drug": "atorvastatin"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["enabled"] is True
        assert body["drug"] == "atorvastatin"
        results = body["results"]
        assert len(results) == 1
        r = results[0]
        assert r["source"] == "goodrx"
        assert r["program_type"] == "copay-card"
        assert r["medicare_medicaid_excluded"] is True
        assert r["bin"] == "015995"
        assert r["pcn"] == "GDC"
        assert r["group"] == "MAHA"
        assert r["member_id"] == "RXFINDER"
        assert r["price_usd"] == 14.75
        assert r["pharmacy_name"] == "CVS Pharmacy"
    finally:
        _app_module._GOODRX_API_KEY = orig_key
        _app_module._GOODRX_PRIVATE_KEY = orig_priv
        _app_module._GOODRX_ENABLED = orig_enabled


def test_goodrx_no_prices_returns_empty():
    """When GoodRx price-compare returns an empty prices list, the endpoint
    returns {enabled: true, results: []} without attempting the coupon step."""
    orig_key = _app_module._GOODRX_API_KEY
    orig_priv = _app_module._GOODRX_PRIVATE_KEY
    orig_enabled = _app_module._GOODRX_ENABLED
    _app_module._GOODRX_API_KEY = "testkey"
    _app_module._GOODRX_PRIVATE_KEY = "testsecret"
    _app_module._GOODRX_ENABLED = True

    mock_r1 = MagicMock()
    mock_r1.status_code = 200
    mock_r1.json.return_value = {"data": {"prices": []}}

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_r1)
    mock_client.post = AsyncMock()  # must NOT be called

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_client)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    try:
        with patch("app.httpx.AsyncClient", return_value=mock_cm):
            resp = client.get("/coupons/goodrx", params={"drug": "obscuredrug"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["enabled"] is True
        assert body["results"] == []
        mock_client.post.assert_not_called()
    finally:
        _app_module._GOODRX_API_KEY = orig_key
        _app_module._GOODRX_PRIVATE_KEY = orig_priv
        _app_module._GOODRX_ENABLED = orig_enabled
