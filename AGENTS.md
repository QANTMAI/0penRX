# AGENTS.md — 0penRX

This file is read by AI coding assistants before touching this codebase. Follow all rules in `docs/PLATFORM_RULES.md`. What follows is a compressed working-memory guide.

## What this repo is

A prescription drug price-transparency static site (`https://0penrx.org`, GitHub Pages) backed by an optional FastAPI service (`https://openrx-api.onrender.com`, Render free tier). Cash-pay patients use it to find real prices and valid coupons. Getting the data wrong can cost them money at the pharmacy counter.

## Non-negotiable rules (read before any change)

1. **No fabricated data.** If you cannot verify a BIN, price, URL, or program claim against a named primary source, say so and leave the field as `"None available at this time"`. Never fill it in.

2. **No secrets in code.** API keys (openFDA, GoodRx) go in host env vars only. `window.OPENFDA_KEY` and `window.OPENRX_API` are set in `assets/config.js` (runtime-injected), never in committed code and never via URL query params.

3. **Cash-pay accuracy.** Only BIN 015995 (GoodRx universal network) is a confirmed cash-pay coupon. Manufacturer copay cards are `ExternalLinkRouting` (link to program page only). Do not add a new BIN without primary-source evidence that cash/uninsured patients can use it.

4. **Single source of truth.** `BIN_INFO` in `assets/app.js` and `BIN_MAP` in `data/build_coupons.py` must always match. The CI test `data/tests/test_cross_language_consistency.py` enforces this — never bypass it.

5. **Service worker never caches API responses.** Only the app shell (HTML/CSS/JS/fonts) is cached. Live medical/price data must always be fetched fresh.

6. **CSP is the boundary.** Every new external origin used in `fetch()` must also appear in the `connect-src` directive in `index.html`. Do not add CDN script tags — `script-src 'self'` is intentional.

7. **All API-supplied values going into `innerHTML` pass through `esc()`.** No exceptions.

## Architecture in 30 seconds

```
index.html          ← shell, CSP meta, JSON-LD, preloads
assets/config.js    ← window.OPENRX_API (loaded before app.js)
assets/app.js       ← rendering, state, event wiring (ES module)
assets/catalog.js   ← CATALOG[92] + API_SOURCES (ES module)
assets/live.js      ← fetchJSON cache, RxNorm, openFDA, NADAC, coupons
assets/styles.css   ← design tokens, components
sw.js               ← PWA shell cache (never caches cross-origin)
manifest.webmanifest
backend/app.py      ← FastAPI: /health /coupons /coupons/goodrx
data/build_coupons.py     ← builds data/coupons.jsonl from CATALOG
data/tests/test_cross_language_consistency.py  ← BIN/URL drift guard
```

## Key constants (both copies must stay in lockstep)

| Constant | JS (`assets/app.js`) | Python (`data/build_coupons.py`) |
|---|---|---|
| BIN map | `BIN_INFO` | `BIN_MAP` |
| Partner URLs | `PARTNER_URL` | `PARTNER_URL` |
| Unavailable placeholder | `UNAVAILABLE` const | matched via `_extract_unavailable()` in CI test |

## CI checklist before pushing

```bash
cd /Users/tabitharudd/0penRX
ruff check .
python -m compileall backend data
pytest -q
```

All three must be green. The GitHub Actions workflows (`ci.yml`, `pre-commit.yml`) enforce the same checks on every PR.

## Docs to read before changing data

- `docs/PROVENANCE.md` — where every class of data comes from and its verification status
- `docs/PLATFORM_RULES.md` — full rule set with rationale
- `docs/DEPLOY.md` — Render deployment and env var instructions

## What NOT to do

- Do not add `?api=` or `?openfda_key=` URL overrides — they were deliberately removed as a security fix (keys in URLs appear in browser history and referrer headers).
- Do not remove the `UNAVAILABLE = 'None available at this time'` constant — it is the honest fallback enforced in CI.
- Do not widen the CSP `connect-src` beyond the documented API allowlist without updating this file and `docs/PLATFORM_RULES.md`.
- Do not add `allow_headers=["*"]` back to the backend CORS config.
- Do not create stub endpoints, mock data, or placeholder prices. The rules forbid fake data.
