# 0penRX

**Prescription Price Transparency — Zero middlemen. Open prices. Your Rx.**

0penRX is an open platform for surfacing real, comparable prescription drug prices across pharmacies — without the opaque PBM (Pharmacy Benefit Manager) layers that hide the true cost of medication. The goal is simple: let anyone look up what a drug actually costs, where, and why.

---

## Why

Drug pricing in the US is intentionally opaque. The same prescription can vary 10x in price across pharmacies in the same ZIP code, and the spread is driven by middlemen (PBMs, rebates, spread pricing) rather than the cost of the drug itself. 0penRX aggregates open and public pricing data into a single, transparent, queryable source.

## Goals

- **Transparent pricing** — normalized cash prices by drug, dose, and pharmacy.
- **No middlemen** — surface direct/cash prices, not PBM-negotiated noise.
- **Open data** — pricing schema and sources are public and reproducible.
- **Fast lookup** — search by drug name + ZIP, get ranked results.

## Architecture (proposed)

```
0penRX/
  backend/      # Price aggregation + normalization API (FastAPI)
  frontend/     # Drug price lookup UI (React)
  data/         # Ingestion scripts + normalization to common schema
  docs/         # Architecture, data sources, API contracts
  .github/      # CI workflows, issue templates
```

### Data flow

```
Public sources  ->  Ingestion (data/)  ->  Normalized store  ->  API (backend/)  ->  UI (frontend/)
```

## Data sources (candidate)

- NADAC (National Average Drug Acquisition Cost) — CMS public dataset
- State Medicaid pharmacy reimbursement rates
- NPI Registry (pharmacy identity/location)
- Public cash-price disclosures

## Roadmap

- [ ] Define normalized pricing schema (drug, NDC, dose, pharmacy, price, source, date)
- [ ] Ingest NADAC dataset into normalized store
- [ ] Build price lookup API (search by drug + location)
- [ ] Build minimal search UI
- [ ] Add pharmacy geolocation + ranking
- [ ] Add CI + tests

## Status

Early scaffolding. Contributions and issue reports welcome — see CONTRIBUTING.md.

## License

See LICENSE.
