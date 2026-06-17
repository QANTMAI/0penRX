"""Unit tests for the catalog -> coupon record transform."""

import importlib.util
import json
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
    "slug": "zz-nonexistent-test-drug",
    "name": "TestDrug®",
    "company": "Test Pharma",
    "generic": "testdrug",
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
    # Manufacturer-direct programs are not pharmacy copay cards; MA/CA anti-coupon
    # state laws do not apply, so state_restrictions must be empty.
    assert record["state_restrictions"] == []


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
    # Uses a BIN intentionally absent from BIN_MAP so the all-None
    # adjudication-code fallback is exercised independently of any real BIN.
    drug = dict(COPAY_DRUG, partner="", bin="999999")
    record = build_coupons.build_record(drug, _NOW)
    assert record["program_name"] == "Amgen Savings Card"
    assert record["pcn"] is None
    assert record["group"] is None
    assert record["member_id"] is None


def test_catalog_to_jsonl_round_trip():
    """Every catalog drug that has a BIN or partner must appear in coupons.jsonl,
    and every record in coupons.jsonl must correspond to a catalog drug.

    This is the highest-value bench-day invariant: it catches any drift between
    the catalog source of truth and the committed coupon dataset (e.g. a drug
    added/removed from catalog.js without rebuilding, or a build script bug that
    silently drops records)."""
    repo_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    catalog_path = os.path.join(repo_root, "assets", "catalog.js")
    jsonl_path = os.path.join(repo_root, "data", "coupons.jsonl")

    assert os.path.exists(jsonl_path), (
        "data/coupons.jsonl is missing — run: python data/build_coupons.py --out data/coupons.jsonl"
    )

    catalog = build_coupons.load_catalog(catalog_path)

    # Catalog slugs that should have coupon records (have bin or partner).
    expected_slugs = {d["slug"] for d in catalog if (d.get("bin") or d.get("partner"))}

    # Slugs present in coupons.jsonl.
    jsonl_slugs: set[str] = set()
    with open(jsonl_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            jsonl_slugs.add(record["drug_slug"])

    missing = expected_slugs - jsonl_slugs
    extra = jsonl_slugs - expected_slugs

    assert not missing, (
        f"Catalog drugs with coupon data missing from coupons.jsonl "
        f"(rebuild with build_coupons.py): {sorted(missing)}"
    )
    assert not extra, (
        f"coupons.jsonl contains slugs not in catalog "
        f"(stale records — rebuild with build_coupons.py): {sorted(extra)}"
    )
