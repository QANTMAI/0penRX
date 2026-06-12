"""0penRX price lookup API (stub).

Minimal FastAPI service that will serve normalized prescription prices.
This is scaffolding; the data layer is not yet wired up.
"""
from fastapi import FastAPI, Query

app = FastAPI(title="0penRX API", version="0.1.0")

# In-memory placeholder until the normalized store is wired up.
_SAMPLE = [
    {"drug_name": "atorvastatin", "dose": "10 mg tablet", "quantity": 30,
     "price_usd": 8.42, "pharmacy_name": "Example Pharmacy", "zip": "06095",
     "source": "NADAC"},
]

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/prices")
def prices(drug: str = Query(...), zip: str | None = None):
    """Return matching price records, ranked cheapest first."""
    results = [r for r in _SAMPLE if drug.lower() in r["drug_name"].lower()]
    if zip:
        results = [r for r in results if r.get("zip") == zip]
    results.sort(key=lambda r: r["price_usd"])
    return {"drug": drug, "count": len(results), "results": results}
