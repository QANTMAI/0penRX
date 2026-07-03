# 0penRX

**Prescription Price Transparency — Zero middlemen. Open prices. Your Rx.**

0penRX is a free, public tool for finding real cash-pay prescription prices without going through a pharmacy benefit manager. Users enter no personal data, create no account, and pay nothing.

Live at [0penrx.org](https://0penrx.org).

---

## What it is

- **86 curated brand-name and biosimilar medications** with cash-pay prices, manufacturer programs, and GoodRx coupon codes.
- **Live drug data** — identity, NDC, active ingredients, shortage alerts, and recalls via RxNorm, openFDA, and CMS NADAC, fetched at runtime.
- **GoodRx BIN 015995** (PCN GDC / Group MAHA / Member RXFINDER) is the only cash coupon shown directly — verified as a true cash-pay card usable by any uninsured patient at 70,000+ pharmacies. All manufacturer copay/assistance programs (which require commercial insurance or per-patient enrollment) route to their official program pages.
- Prices are **reference values** — always verify at the pharmacy before use.

## Architecture

```
index.html             Static frontend — GitHub Pages (0penrx.org)
assets/
  app.js               Main app: drug cards, detail panel, live data display
  catalog.js           Curated drug catalog (single source of truth for prices/programs)
  catalog-validator.js Load-time integrity checks (price math, enums, staleness)
  live.js              Live data fetchers: RxNorm, openFDA, CMS NADAC
  styles.css           Design system
  config.js            Runtime config (API_BASE — not committed; set per deployment)
backend/
  app.py               FastAPI backend — /coupons, /coupons/goodrx, /health
data/
  build_coupons.py     Derives coupons.jsonl from catalog.js (CI-rebuilt monthly)
  coupons.jsonl        Committed coupon dataset
docs/                  Platform rules, schema, provenance, deploy guide
.github/workflows/     CI, coupon rebuild, CodeQL, pre-commit
sw.js                  Service worker — PWA shell cache (never caches API responses)
```

Each catalog entry carries integrity metadata — `status` (`active`/`limited`/`archived`), `eligibility` (e.g. `cash-pay`/`insured-only`/`medicare-only`), an optional `priceNote`, and a `verified` audit date. Two enforcement layers keep this honest: `catalog-validator.js` checks every entry at page load (savings math, enum validity, 90-day staleness), and `data/tests/test_catalog_validator.py` runs the same hard invariants in CI so bad data fails the build. The coupon dataset is rebuilt on a schedule (`.github/workflows/coupons.yml`, monthly + Jan-1) so expired offers aren't served as live. See [docs/SCHEMA.md](docs/SCHEMA.md) and [docs/PROVENANCE.md](docs/PROVENANCE.md).

```
```

## Data sources

| Source | What it provides | Access |
|---|---|---|
| NLM RxNorm | Drug identity, RxCUI, synonyms | Free, no key |
| openFDA Drug NDC | NDC codes, ingredients, labeler | Free, no key |
| CMS NADAC | Weekly acquisition cost (base for Cost Plus formula) | Free, no key |
| GoodRx (BIN 015995) | Cash coupon at 70K+ pharmacies | BIN in catalog |
| Manufacturer programs | 15+ copay/assistance programs | Links to official pages |
| CMS IRA negotiated prices (MFP) | Medicare Part D Maximum Fair Price (reference context, not cash-pay) | Public, cms.gov |

> **Benchmark terms** are used precisely (see [docs/PROVENANCE.md](docs/PROVENANCE.md)): *AWP* is a proprietary compendia benchmark (Medi-Span, RED BOOK, Gold Standard — **not** First DataBank, which exited AWP in 2011); *MFP* is the IRA Medicare-negotiated price and is never presented as a cash-pay figure. 0penRX redistributes neither — both are documented for accuracy only.

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

**Proprietary — all rights reserved. Not open source.** Any use of this software
requires a separate signed, paid, royalty-bearing license from QANTM AI. Viewing
the public repository does not grant a right to run, deploy, modify, or
redistribute it. To license it, contact **info@qantm.ai**. See [LICENSE](LICENSE).

**No AI scraping or training on this repository.** Scraping, cloning, or ingesting
this repo's **source code or data files** to train, fine-tune, ground, embed, or
evaluate any AI/ML model is strictly forbidden without a signed, paid license
([LICENSE](LICENSE) §7A). This applies to the **code**, not the public website:
the live site at [0penrx.org](https://0penrx.org) is intentionally crawlable and
may be cited by search engines and AI assistants per its `robots.txt`.
