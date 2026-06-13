"""Tests for the 0penRX price lookup API."""

import os
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import app

client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_prices_returns_match():
    resp = client.get("/prices", params={"drug": "atorvastatin"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["drug"] == "atorvastatin"
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
