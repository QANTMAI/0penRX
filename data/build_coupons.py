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
# Any BIN not listed resolves to all-None.
BIN_MAP: dict[str, tuple[str | None, str | None, str | None]] = {
    "015995": ("GDC", "MAHA", "RXFINDER"),
    "601341": ("OHCP", "OH9013621", None),
    "610020": ("PDMI", "99996218", None),
    "600426": (None, None, None),
}

# Verified manufacturer-program landing pages keyed by partner name.
PARTNER_URL: dict[str, str] = {
    "Pfizer RxPathways": "https://www.pfizerrxpathways.com",
    "Sanofi Patient Connection": "https://www.sanofipatientconnection.com",
    "AstraZeneca Direct": "https://www.azandmeapp.com",
    "Amgen Assist360": "https://www.amgenassist360.com",
    "Novo Nordisk Savings Program": "https://www.novocare.com",
    "GSK For You": "https://www.gskforyou.com",
    "J&J Direct": "https://www.jnjwithme.com",
    "Boehringer Ingelheim Cares": "https://www.bicares.com",
    "Bristol Myers Squibb": "https://www.bmsaccesssupport.com",
    "LillyDirect®": "https://lillydirect.com",
    "Eli Lilly Direct": "https://lillydirect.com",
    "EMD Serono Direct": "https://www.emdserono.com",
    "Novartis Direct": "https://www.us.novartis.com",
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

    year = now.year
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
        "effective_date": f"{year}-01-01",
        "expiration_date": f"{year}-12-31",
        "state_restrictions": [] if drug.get("isGeneric") else ["MA", "CA"],
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


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build the coupon dataset from the curated catalog."
    )
    parser.add_argument(
        "--out",
        default=os.path.join("data", "coupons.jsonl"),
        help="Output JSONL path (default: data/coupons.jsonl)",
    )
    args = parser.parse_args()

    catalog = load_catalog(CATALOG_PATH)
    records = build_records(catalog)

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
