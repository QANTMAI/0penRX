"""Build the 0penRX coupon dataset from the curated catalog.

The frontend catalog (assets/catalog.js) is the single source of truth for the
brand/program metadata 0penRX surfaces. This script extracts the embedded
``CATALOG`` array, maps each drug to one coupon record, and writes the result as
JSONL to data/coupons.jsonl (committed alongside the repo, not under
data/processed/).

Drugs that carry neither a copay-card BIN nor a manufacturer partner have no
coupon data to publish and are skipped.

Usage:
    python data/build_coupons.py
    python data/build_coupons.py --out data/coupons.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone

# Resolve paths relative to the repo root (this file lives in data/).
_DATA_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_DATA_DIR)
CATALOG_PATH = os.path.join(_REPO_ROOT, "assets", "catalog.js")

# Matches the JSON array literal in `const CATALOG = [ ... ];` (also handles the
# `export const` form). Non-greedy up to the closing `];` so trailing module
# code is never captured.
_CATALOG_RE = re.compile(r"CATALOG\s*=\s*(\[.*?\]);", re.S)

# BIN -> (pcn, group, member_id) for the copay-card networks 0penRX routes to.
# Any BIN not listed resolves to all-None. Authoritative copy: the frontend
# BIN_INFO in assets/app.js must mirror this, enforced in CI by
# data/tests/test_cross_language_consistency.py.
BIN_MAP: dict[str, tuple[str | None, str | None, str | None]] = {
    # The universal GoodRx cash-discount network is the only pharmacy card a
    # cash-paying / uninsured person can use as-is. Manufacturer copay/assistance
    # programs are commercial-insurance or per-patient enrollment, so they are
    # routed to their program page (ExternalLinkRouting) rather than shown as a
    # cash coupon. Keep this in lockstep with assets/app.js BIN_INFO.
    "015995": ("GDC", "MAHA", "RXFINDER"),
}

# Verified manufacturer-program landing pages keyed by partner name.
# MUST stay byte-for-byte identical to PARTNER_URL in assets/app.js — enforced in
# CI by data/tests/test_cross_language_consistency.py::test_partner_urls_match_backend.
# Includes the post-audit program names plus legacy aliases (so older catalog
# `partner` values still resolve to a real URL rather than None).
PARTNER_URL: dict[str, str] = {
    # AstraZeneca
    "AZ&Me": "https://www.azandmeapp.com",
    "AstraZeneca Direct": "https://www.azpatientdirect.com",
    # Sanofi
    "Sanofi Patient Connection": "https://www.sanofipatientconnection.com",
    # GSK
    "GSK For You": "https://www.gskforyou.com",
    # Johnson & Johnson
    "J&J withMe Savings Program": "https://www.jnjwithme.com",
    "J&J Direct": "https://www.jnjwithme.com",  # legacy alias
    # Bristol Myers Squibb
    "BMS Patient Connect": "https://www.bmspatientconnect.com",
    "Bristol Myers Squibb": "https://www.bmsaccesssupport.com",  # legacy alias
    # Boehringer Ingelheim
    "BI Savings Card": "https://www.boehringer-ingelheim.com/us/patient-support",
    "Boehringer Ingelheim Cares": "https://www.bicares.com",  # legacy alias (free PAP)
    # Eli Lilly
    "LillyDirect®": "https://lillydirect.com",
    "LillyDirect": "https://lillydirect.com",
    # Pfizer
    "Pfizer RxPathways": "https://www.pfizerrxpathways.com",
    # Amgen
    "Amgen SupportPlus": "https://www.amgensupportplus.com",
    "AmgenNow": "https://www.amgennow.com",
    "Amgen Assist360": "https://www.amgenassist360.com",  # legacy alias
    # Novo Nordisk
    "Novo Nordisk Savings Program": "https://www.novocare.com",
    # Novartis
    "Alongside MAYZENT": "https://www.mayzent.com/support",
    "Novartis Patient Assistance Foundation": "https://pap.novartis.com",
    "Novartis Direct": "https://www.us.novartis.com",  # legacy alias
    # AbbVie
    "Synthroid Delivers Program": "https://www.synthroid.com/synthroid-delivers-program",
    "AbbVie Synthroid Savings": "https://www.synthroid.com",  # legacy alias
    "AbbVie At Your Service": "https://www.savewithays.com",
    "myAbbVie Assist": "https://www.abbvie.com/patients/patient-support/patient-assistance.html",
    # Merck
    "MerckHelps": "https://www.merckhelps.com",
    "Merck Cash-Pay Gateway": "https://www.merckcashpaygateway.com",
    "TrumpRx": "https://trumprx.gov",
    "Merck Patient Assistance": "https://www.merckhelps.com",  # legacy alias
    # EMD Serono
    "Fertility Instant Savings Program": "https://www.fertilityinstantsavings.com",
    "EMD Serono Fertility Savings": "https://www.fertilityinstantsavings.com",  # legacy alias
    # Genentech
    "Genentech Direct-to-Patient": "https://www.gene.com/patients",
    "Genentech Patient Foundation": "https://www.gene.com/patients/patient-foundation",  # legacy
    # Pfizer (additional programs)
    "Amgen Assist360 / Pfizer": "https://www.amgenassist360.com",
}


def load_catalog(path: str) -> list[dict]:
    """Extract and parse the CATALOG array from the catalog.js source."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    match = _CATALOG_RE.search(text)
    if not match:
        raise ValueError(f"Could not locate CATALOG array in {path}")
    return json.loads(match.group(1))


def _clean_manufacturer(company: str) -> str:
    """Strip trademark glyphs and surrounding whitespace from a company name."""
    return company.replace("®", "").replace("™", "").strip()


def build_record(drug: dict, now: datetime) -> dict | None:
    """Map one catalog drug to a coupon record, or None when it has no coupon.

    Drugs with neither a BIN nor a partner carry no coupon data and are skipped
    (the caller drops the None).
    """
    bin_value = drug.get("bin") or ""
    partner = drug.get("partner") or ""
    if not bin_value and not partner:
        return None

    manufacturer = _clean_manufacturer(drug.get("company", ""))

    if bin_value:
        program_type = "copay-card"
        pcn, group, member_id = BIN_MAP.get(bin_value, (None, None, None))
        program_name = partner if partner else f"{manufacturer} Savings Card"
        bin_out: str | None = bin_value
    else:
        program_type = "manufacturer-direct"
        bin_out = pcn = group = member_id = None
        program_name = partner

    return {
        "program_name": program_name,
        "manufacturer": manufacturer,
        "drug_name": drug["generic"],
        "drug_slug": drug["slug"],
        "brand": drug["name"],
        "program_type": program_type,
        "bin": bin_out,
        "pcn": pcn,
        "group": group,
        "member_id": member_id,
        "eligibility": None,
        "medicare_medicaid_excluded": True,
        "url": PARTNER_URL.get(partner),
        "source": "catalog",
        "source_url": "https://0penrx.org",
        # Manufacturer copay-card BINs and assistance programs are open-ended —
        # there is no published per-program calendar expiry. A synthetic year-end
        # date would read as a verified "Expires" in the UI and (via the backend
        # expiry filter) silently drop every coupon on Jan 1, so leave these null.
        "effective_date": None,
        "expiration_date": None,
        # MA/CA restrict pharmacy copay-card programs (anti-coupon state laws).
        # They do NOT apply to manufacturer-direct assistance programs (no BIN).
        "state_restrictions": ["MA", "CA"]
        if (bin_value and not drug.get("isGeneric"))
        else [],
        "status": "active",
        "ingested_at": now.isoformat(),
    }


def build_records(catalog: list[dict], now: datetime | None = None) -> list[dict]:
    """Build coupon records for every catalog drug that has coupon data."""
    now = now or datetime.now(timezone.utc)
    records = []
    for drug in catalog:
        record = build_record(drug, now)
        if record is not None:
            records.append(record)
    return records


def _comparable(records: list[dict]) -> list[dict]:
    """Drop the only non-deterministic field (ingested_at, a wall-clock stamp)
    so a fresh build can be compared against the committed file for drift."""
    return [{k: v for k, v in r.items() if k != "ingested_at"} for r in records]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build the coupon dataset from the curated catalog."
    )
    parser.add_argument(
        "--out",
        default=os.path.join("data", "coupons.jsonl"),
        help="Output JSONL path (default: data/coupons.jsonl)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit 1 if the committed --out file has drifted from a fresh build "
        "(ignoring the ingested_at timestamp). Writes nothing.",
    )
    args = parser.parse_args()

    catalog = load_catalog(CATALOG_PATH)
    records = build_records(catalog)

    if args.check:
        if not os.path.exists(args.out):
            print(f"--check: {args.out} does not exist — run without --check first.")
            sys.exit(1)
        with open(args.out, encoding="utf-8") as f:
            committed = [json.loads(line) for line in f if line.strip()]
        fresh_cmp, committed_cmp = _comparable(records), _comparable(committed)
        if fresh_cmp == committed_cmp:
            print(f"{args.out} in sync ({len(records)} coupon records).")
            sys.exit(0)
        # Report the first drifting record for a precise failure.
        detail = ""
        if len(fresh_cmp) != len(committed_cmp):
            detail = f" (fresh has {len(fresh_cmp)} records, committed has {len(committed_cmp)})"
        else:
            for fresh_rec, committed_rec in zip(fresh_cmp, committed_cmp):
                if fresh_rec != committed_rec:
                    detail = (
                        f" (first drift at drug_slug={fresh_rec.get('drug_slug')!r})"
                    )
                    break
        print(
            f"{args.out} is STALE — rebuild with: python data/build_coupons.py{detail}"
        )
        sys.exit(1)

    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    # Write to a temp file and atomically rename on success, so a mid-stream
    # failure never leaves a truncated/empty file in place of good data.
    tmp = f"{args.out}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            for record in records:
                f.write(json.dumps(record) + "\n")
        os.replace(tmp, args.out)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise

    print(f"Wrote {len(records)} records to {args.out}")


if __name__ == "__main__":
    main()
