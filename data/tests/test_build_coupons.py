"""Unit tests for the catalog -> coupon record transform."""

import importlib.util
import os
from datetime import datetime, timezone

# Load the sibling module without requiring a package install.
_MODULE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build_coupons.py"
)
_spec = importlib.util.spec_from_file_location("build_coupons", _MODULE_PATH)
build_coupons = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build_coupons)

_NOW = datetime(2026, 6, 12, tzinfo=timezone.utc)

COPAY_DRUG = {
    "slug": "aimovig",
    "name": "Aimovig®",
    "company": "Amgen®",
    "generic": "erenumab-aooe",
    "bin": "015995",
    "partner": "Amgen Assist360",
    "isGeneric": False,
}

DIRECT_DRUG = {
    "slug": "admelog",
    "name": "Admelog®",
    "company": "Sanofi",
    "generic": "insulin lispro",
    "bin": "",
    "partner": "Sanofi Patient Connection",
    "isGeneric": False,
}

SKIP_DRUG = {
    "slug": "januvia",
    "name": "Januvia®",
    "company": "Merck",
    "generic": "sitagliptin",
    "bin": "",
    "partner": "",
    "isGeneric": False,
}


def test_copay_card_record():
    record = build_coupons.build_record(COPAY_DRUG, _NOW)
    assert record is not None
    assert record["program_type"] == "copay-card"
    assert record["bin"] == "015995"
    assert record["pcn"] == "GDC"
    assert record["group"] == "MAHA"
    assert record["member_id"] == "RXFINDER"
    assert record["program_name"] == "Amgen Assist360"
    assert record["manufacturer"] == "Amgen"
    assert record["drug_name"] == "erenumab-aooe"
    assert record["drug_slug"] == "aimovig"
    assert record["brand"] == "Aimovig®"
    assert record["medicare_medicaid_excluded"] is True
    assert record["eligibility"] is None
    assert record["state_restrictions"] == ["MA", "CA"]
    assert record["url"] == "https://www.amgenassist360.com"
    assert record["effective_date"] == "2026-01-01"
    assert record["expiration_date"] == "2026-12-31"
    assert record["status"] == "active"
    assert record["source"] == "catalog"
    assert record["source_url"] == "https://0penrx.org"
    assert record["ingested_at"] == _NOW.isoformat()


def test_manufacturer_direct_record():
    record = build_coupons.build_record(DIRECT_DRUG, _NOW)
    assert record is not None
    assert record["program_type"] == "manufacturer-direct"
    assert record["bin"] is None
    assert record["pcn"] is None
    assert record["group"] is None
    assert record["member_id"] is None
    assert record["program_name"] == "Sanofi Patient Connection"
    assert record["url"] == "https://www.sanofipatientconnection.com"
    assert record["medicare_medicaid_excluded"] is True
    assert record["state_restrictions"] == ["MA", "CA"]


def test_skip_drug_without_coupon_data():
    assert build_coupons.build_record(SKIP_DRUG, _NOW) is None


def test_build_records_drops_skips():
    records = build_coupons.build_records(
        [COPAY_DRUG, DIRECT_DRUG, SKIP_DRUG], now=_NOW
    )
    slugs = {r["drug_slug"] for r in records}
    assert slugs == {"aimovig", "admelog"}
    assert len(records) == 2


def test_state_restrictions_empty_for_generic():
    generic_drug = dict(COPAY_DRUG, slug="generic", isGeneric=True)
    record = build_coupons.build_record(generic_drug, _NOW)
    assert record["state_restrictions"] == []


def test_savings_card_fallback_name():
    # Copay BIN with no partner falls back to "<manufacturer> Savings Card".
    drug = dict(COPAY_DRUG, partner="", bin="600426")
    record = build_coupons.build_record(drug, _NOW)
    assert record["program_name"] == "Amgen Savings Card"
    assert record["pcn"] is None
    assert record["group"] is None
    assert record["member_id"] is None
