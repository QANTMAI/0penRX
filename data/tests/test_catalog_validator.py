"""CI gate mirroring assets/catalog-validator.js.

The browser-side ``validateCatalog()`` only ``console.error``s — it cannot fail a
build, so a bad price, a broken savings number, or an out-of-enum status would
ship to production unnoticed. This test re-implements the validator's *error*
invariants in Python and runs them over the real ``assets/catalog.js`` so the
same bad data fails CI before it ever deploys.

Keep the ERROR rules here in lockstep with the ``errors.push(...)`` branches in
assets/catalog-validator.js. (The JS ``warnings`` — price>retail and 90-day
staleness — are intentionally NOT hard failures: staleness is the sentinel's
job, and a reference price above retail is implausible but not corrupting.)
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "data"))

from build_coupons import load_catalog  # noqa: E402

CATALOG = load_catalog(str(REPO / "assets" / "catalog.js"))

REQUIRED_FIELDS = [
    "slug",
    "name",
    "price",
    "retail",
    "savings",
    "company",
    "generic",
    "category",
]
VALID_STATUSES = {"active", "limited", "archived"}
VALID_ELIGIBILITY = {
    "cash-pay",
    "insured-only",
    "medicare-only",
    "income-qualified",
    "mixed",
}


def test_catalog_not_empty():
    assert CATALOG, "catalog.js parsed to an empty CATALOG array"


def test_required_fields_present():
    missing = [
        (d.get("slug", "?"), f)
        for d in CATALOG
        for f in REQUIRED_FIELDS
        if d.get(f) in (None, "")
    ]
    assert not missing, f"Catalog entries missing required fields: {missing}"


def test_prices_positive():
    bad = [
        (d["slug"], d.get("price"), d.get("retail"))
        for d in CATALOG
        if not (isinstance(d.get("price"), (int, float)) and d["price"] > 0)
        or not (isinstance(d.get("retail"), (int, float)) and d["retail"] > 0)
    ]
    assert not bad, f"Entries with non-positive price/retail: {bad}"


def test_savings_math():
    """savings must equal round((retail-price)/retail*100) within 2 points."""
    drift = []
    for d in CATALOG:
        expected = round((d["retail"] - d["price"]) / d["retail"] * 100)
        if abs(expected - d["savings"]) > 2:
            drift.append(
                (d["slug"], f"listed {d['savings']}% vs computed {expected}%")
            )
    assert not drift, f"savings% disagrees with price/retail math: {drift}"


def test_status_enum():
    bad = [
        (d["slug"], d.get("status"))
        for d in CATALOG
        if "status" in d and d["status"] not in VALID_STATUSES
    ]
    assert not bad, f"Entries with unknown status: {bad}"


def test_eligibility_enum():
    bad = [
        (d["slug"], d.get("eligibility"))
        for d in CATALOG
        if "eligibility" in d and d["eligibility"] not in VALID_ELIGIBILITY
    ]
    assert not bad, f"Entries with unknown eligibility: {bad}"


def test_verified_date_format():
    """Every entry carries an ISO YYYY-MM-DD verified date (the field the
    validator and the 12-hour sentinel use for staleness)."""
    import re

    bad = [
        (d["slug"], d.get("verified"))
        for d in CATALOG
        if "verified" in d
        and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(d.get("verified", "")))
    ]
    assert not bad, f"Entries with malformed verified date: {bad}"
