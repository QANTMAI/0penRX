"""Ingest the NADAC dataset into the normalized 0penRX pricing schema.

NADAC (National Average Drug Acquisition Cost) is published by CMS as a public
CSV dataset. This script downloads it and maps rows to the normalized record
defined in docs/SCHEMA.md.

This is a scaffold: the actual CMS endpoint and column mapping must be filled
in before use. Run:

    python data/ingest_nadac.py --out data/processed/nadac.jsonl
"""
import argparse
import json
from datetime import datetime, timezone

# CMS NADAC public dataset (update to the current resource URL).
NADAC_CSV_URL = "https://data.medicaid.gov/api/1/datastore/query/<resource-id>"


def normalize_row(row: dict) -> dict:
    """Map one raw NADAC row to the normalized price record."""
    return {
        "drug_name": row.get("NDC Description"),
        "ndc": row.get("NDC"),
        "dose": None,
        "quantity": 1,
        "price_usd": row.get("NADAC Per Unit"),
        "pharmacy_name": None,
        "pharmacy_npi": None,
        "zip": None,
        "source": "NADAC",
        "source_url": NADAC_CSV_URL,
        "effective_date": row.get("Effective Date"),
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest NADAC into normalized JSONL.")
    parser.add_argument("--out", required=True, help="Output JSONL path")
    args = parser.parse_args()

    # TODO: download NADAC_CSV_URL and iterate real rows.
    rows: list[dict] = []

    with open(args.out, "w") as f:
        for row in rows:
            f.write(json.dumps(normalize_row(row)) + "\n")

    print(f"Wrote {len(rows)} records to {args.out}")


if __name__ == "__main__":
    main()
