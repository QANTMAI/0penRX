# 0penRX

**Prescription Price Transparency — Zero middlemen. Open prices. Your Rx.**

0penRX is a free, public tool for finding real cash-pay prescription prices without going through a pharmacy benefit manager. Users enter no personal data, create no account, and pay nothing.

Live at [0penrx.org](https://0penrx.org).

---

## What it is

- **86 curated brand and generic medications** with cash-pay prices, manufacturer programs, and GoodRx coupon codes.
- **Live drug data** — identity, NDC, active ingredients, shortage alerts, and recalls via RxNorm, openFDA, and CMS NADAC, fetched at runtime.
- **GoodRx BIN 015995** (PCN GDC / Group MAHA / Member RXFINDER) is the only cash coupon shown directly — verified as a true cash-pay card usable by any uninsured patient at 70,000+ pharmacies. All manufacturer copay/assistance programs (which require commercial insurance or per-patient enrollment) route to their official program pages.
- Prices are **reference values** — always verify at the pharmacy before use.

## Architecture

```
index.html          Static frontend — GitHub Pages (0penrx.org)
assets/
  app.js            Main app: drug cards, detail panel, live data display
  catalog.js        Curated drug catalog (single source of truth for prices/programs)
  live.js           Live data fetchers: RxNorm, openFDA, CMS NADAC
  styles.css        Design system
  config.js         Runtime config (API_BASE — not committed; set per deployment)
backend/
  app.py            FastAPI backend — /coupons, /prices, /health
data/
  build_coupons.py  Derives coupons.jsonl from catalog.js (CI-rebuilt monthly)
  ingest_nadac.py   CMS NADAC ingestion pipeline
  coupons.jsonl     Committed coupon dataset (88 records)
docs/               Platform rules, schema, provenance, deploy guide
.github/workflows/  CI, NADAC ingest, coupon rebuild, CodeQL, pre-commit
sw.js               Service worker — PWA shell cache (never caches API responses)
```

## Data sources

| Source | What it provides | Access |
|---|---|---|
| NLM RxNorm | Drug identity, RxCUI, synonyms | Free, no key |
| openFDA Drug NDC | NDC codes, ingredients, labeler | Free, no key |
| CMS NADAC | Weekly acquisition cost (base for Cost Plus formula) | Free, no key |
| GoodRx (BIN 015995) | Cash coupon at 70K+ pharmacies | BIN in catalog |
| Manufacturer programs | 15+ copay/assistance programs | Links to official pages |

## Running locally

```bash
# Frontend — no build step needed
python -m http.server 8080
# open http://localhost:8080

# Backend
pip install -r backend/requirements.txt
uvicorn app:app --reload --app-dir backend

# Tests
pytest -q
ruff check .
```

## CI

Every push runs: ruff lint, Python compilation check, cross-language consistency test (BIN_INFO JS ↔ BIN_MAP Python), coupon record validation, backend unit tests, and gitleaks secret scan. Pre-commit hooks SHA-pinned.

## Platform rules

See [docs/PLATFORM_RULES.md](docs/PLATFORM_RULES.md). Key invariants: no fabricated data, secrets in host env vars only, BIN 015995 is the only cash coupon, service worker never caches API responses.

## License

See [LICENSE](LICENSE).
