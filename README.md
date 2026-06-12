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

## Architecture

```
0penRX/
  index.html    # Drug price lookup UI — single-file static page, no build step
  backend/      # Price lookup + normalization API (FastAPI)
  data/         # NADAC ingestion + normalization to the common schema
  docs/         # Schema and data-source documentation
  frontend/     # Frontend notes (the UI itself is index.html at the repo root)
  .github/      # CI + ingestion workflows, issue templates
```

The user-facing UI is the static [`index.html`](index.html) at the repo root,
deployed via GitHub Pages to [`0penrx.org`](https://0penrx.org). The `backend/`
API and the static UI are **not yet wired together** — see the roadmap below.

### Data flow

```
Public sources  ->  Ingestion (data/)  ->  Normalized JSONL  ->  API (backend/)  ->  UI (index.html)
```

## Requirements

- **Python 3.12+** for the backend and ingestion scripts (CI runs on 3.12).
- The frontend needs no toolchain — open `index.html` in any browser, or serve
  the repo root with any static file server.

## Data sources

Implemented:

- **NADAC** (National Average Drug Acquisition Cost) — CMS public dataset,
  ingested by [`data/ingest_nadac.py`](data/ingest_nadac.py).

Candidate / planned:

- State Medicaid pharmacy reimbursement rates
- NPI Registry (pharmacy identity/location)
- Public cash-price disclosures

## Roadmap

- [x] Define normalized pricing schema (drug, NDC, dose, pharmacy, price, source, date)
- [x] Add CI + tests
- [ ] Ingest NADAC dataset into a committed/normalized store (script exists; output not yet published)
- [ ] Build price lookup API (search by drug + location) — initial `/prices` endpoint exists
- [ ] Wire the search UI to the `/prices` API (currently uses a static in-page dataset)
- [ ] Add pharmacy geolocation + ranking

## Status

Active scaffolding: schema, ingestion, a `/prices` API, CI, and a deployed
static UI exist; the UI and API are not yet connected. Contributions and issue
reports welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Security and
data-integrity reports: see [SECURITY.md](SECURITY.md).

## License

See LICENSE.
