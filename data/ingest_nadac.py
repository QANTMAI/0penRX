"""Ingest the CMS NADAC dataset into the normalized 0penRX pricing schema.

NADAC (National Average Drug Acquisition Cost) is published weekly by CMS on
data.medicaid.gov. This script pages through the DKAN datastore query API and
maps each row to the normalized record defined in docs/SCHEMA.md.

Usage:
    python data/ingest_nadac.py --out data/processed/nadac.jsonl
    python data/ingest_nadac.py --out out.jsonl --year 2025 --limit 5000

The default resource is the NADAC 2026 distribution. Pass --distribution to
override with a different DKAN distribution id (see data.medicaid.gov).
"""
from __future__ import annotations

import argparse
import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# CMS NADAC distribution ids on data.medicaid.gov (DKAN datastore).
# Update yearly; see https://data.medicaid.gov/datasets?keyword=nadac
NADAC_DISTRIBUTIONS = {
    2025: "f38d0706-1239-442c-a3cc-40ef1b686ac0",
    2026: "fbb83258-11c7-47f5-8b18-5f8e79f7e704",
}

DATASTORE_QUERY = "https://data.medicaid.gov/api/1/datastore/query/{dist}/0"

# CMS may return memory errors for large limits; keep pages modest.
PAGE_SIZE = 5000


def fetch_page(dist: str, limit: int, offset: int) -> list[dict]:
    """Fetch a single page of rows from the DKAN datastore query API."""
    params = urllib.parse.urlencode({"limit": limit, "offset": offset})
    url = f"{DATASTORE_QUERY.format(dist=dist)}?{params}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return payload.get("results", [])


def iter_rows(dist: str, max_rows: int | None = None):
    """Yield raw NADAC rows, paging until the dataset is exhausted."""
    offset = 0
    fetched = 0
    while True:
        page = fetch_page(dist, PAGE_SIZE, offset)
        if not page:
            break
        for row in page:
            yield row
            fetched += 1
            if max_rows is not None and fetched >= max_rows:
                return
        offset += PAGE_SIZE


def _num(value):
    """Coerce a price-like string to float, or None when not parseable."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_row(row: dict, source_url: str) -> dict:
    """Map one raw NADAC row to the normalized 0penRX price record."""
    return {
        "drug_name": row.get("ndc_description"),
        "ndc": row.get("ndc"),
        "dose": None,
        "quantity": 1,
        "price_usd": _num(row.get("nadac_per_unit")),
        "unit": row.get("pricing_unit"),
        "pharmacy_name": None,
        "pharmacy_npi": None,
        "zip": None,
        "source": "NADAC",
        "source_url": source_url,
        "effective_date": row.get("effective_date"),
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest NADAC into normalized JSONL.")
    parser.add_argument("--out", required=True, help="Output JSONL path")
    parser.add_argument("--year", type=int, default=2026, help="NADAC dataset year")
    parser.add_argument("--distribution", help="Override DKAN distribution id")
    parser.add_argument("--limit", type=int, default=None, help="Max rows to ingest")
    args = parser.parse_args()

    dist = args.distribution or NADAC_DISTRIBUTIONS.get(args.year)
    if not dist:
        raise SystemExit(f"No known NADAC distribution for year {args.year}; pass --distribution.")

    source_url = DATASTORE_QUERY.format(dist=dist)
    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    count = 0
    with open(args.out, "w") as f:
        for row in iter_rows(dist, args.limit):
            f.write(json.dumps(normalize_row(row, source_url)) + "\n")
            count += 1

    print(f"Wrote {count} records to {args.out}")


if __name__ == "__main__":
    main()
