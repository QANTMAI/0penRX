"""0penRX price lookup API.

Serves normalized prescription prices. Records are loaded from a JSONL file
produced by data/ingest_nadac.py (one normalized record per line). When no
data file is present, a small in-memory sample is used so the API and tests
still work out of the box.

Set the NADAC_DATA env var to point at a JSONL file, otherwise the default
path data/processed/nadac.jsonl is used.
"""

from __future__ import annotations

import json
import os

from fastapi import FastAPI, Query

app = FastAPI(title="0penRX API", version="0.1.0")

DEFAULT_DATA_PATH = os.environ.get("NADAC_DATA", "data/processed/nadac.jsonl")

# In-memory fallback used when no ingested data file is available.
_SAMPLE = [
    {
        "drug_name": "atorvastatin",
        "dose": "10 mg tablet",
        "quantity": 30,
        "price_usd": 8.42,
        "unit": "EA",
        "pharmacy_name": "Example Pharmacy",
        "zip": "06095",
        "source": "NADAC",
    },
]


def _load_records(path: str) -> list[dict]:
    """Load normalized price records from a JSONL file, or the sample."""
    if not path or not os.path.exists(path):
        return list(_SAMPLE)
    records: list[dict] = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records or list(_SAMPLE)


# Loaded once at startup; restart the process to pick up new data.
_RECORDS = _load_records(DEFAULT_DATA_PATH)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/prices")
def prices(
    drug: str = Query(..., description="Drug name substring to match"),
    zip: str | None = Query(None, description="5-digit ZIP filter"),
    limit: int = Query(25, ge=1, le=200, description="Max results to return"),
):
    """Return matching price records, ranked cheapest first."""
    needle = drug.lower()
    results = [
        r
        for r in _RECORDS
        if r.get("drug_name")
        and needle in r["drug_name"].lower()
        and r.get("price_usd") is not None
    ]
    if zip:
        results = [r for r in results if r.get("zip") == zip]
    results.sort(key=lambda r: r["price_usd"])
    return {"drug": drug, "count": len(results), "results": results[:limit]}
