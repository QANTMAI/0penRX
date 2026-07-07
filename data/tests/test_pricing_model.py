"""CI guardrails for docs/PRICING_MODEL.md — the price-class rules.

These enforce the invariants that keep 0penRX from re-conflating manufacturer
copay cards (insurance-required) with universal cash-discount cards, and from
presenting a non-cash price (e.g. an IRA Medicare-negotiated price) as a
cash-pay headline. Each test names the bug it would have caught.
See docs/PRICING_MODEL.md.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "data"))

from build_coupons import load_catalog  # noqa: E402

CATALOG = load_catalog(str(REPO / "assets" / "catalog.js"))

VALID_PRICE_BASIS = {"medicare-negotiated"}


def test_hero_type_bin_consistency():
    """Rule 1 / §4: GenericCashCoupon drugs use the GoodRx card (BIN 015995);
    manufacturer-direct (ExternalLinkRouting) drugs carry no BIN. Prevents
    pairing a GoodRx BIN with a price the GoodRx card does not produce — the
    Ozempic/Wegovy bug ($199 NovoCare price shown as a GoodRx coupon)."""
    bad = []
    for d in CATALOG:
        ht, bin_ = d.get("heroType"), d.get("bin")
        if ht == "GenericCashCoupon" and bin_ != "015995":
            bad.append((d["slug"], f"GenericCashCoupon but bin={bin_!r}"))
        if ht == "ExternalLinkRouting" and bin_ not in (None, ""):
            bad.append((d["slug"], f"ExternalLinkRouting but bin={bin_!r}"))
    assert not bad, f"heroType/bin mismatch (see docs/PRICING_MODEL.md §4): {bad}"


def test_price_basis_enum():
    bad = [
        (d["slug"], d.get("priceBasis"))
        for d in CATALOG
        if "priceBasis" in d and d["priceBasis"] not in VALID_PRICE_BASIS
    ]
    assert not bad, f"unknown priceBasis (allowed: {VALID_PRICE_BASIS}): {bad}"


def test_medicare_price_not_labeled_cash_pay():
    """Rule 4: an IRA Medicare-negotiated price is NOT a cash price, so it must
    not carry cash-pay eligibility — the Xarelto bug ($197 Part D price shown as
    a cash-pay reference)."""
    bad = [
        (d["slug"], d.get("eligibility"))
        for d in CATALOG
        if d.get("priceBasis") == "medicare-negotiated"
        and d.get("eligibility") == "cash-pay"
    ]
    assert not bad, f"Medicare-negotiated price marked cash-pay: {bad}"
