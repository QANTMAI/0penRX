# 0penRX Platform Rules

These rules are non-negotiable. Every commit, PR, and AI-assisted change must satisfy all of them. They exist because the site serves patients making real financial and health decisions.

---

## 1. No fabricated data

**The single most important rule.**

- Never invent, estimate, or approximate a BIN, PCN, Group ID, or Member ID. Publish `"None available at this time"` if the authoritative source cannot be confirmed.
- Never show a coupon as "cash-pay" unless it is verified usable by a cash-paying / uninsured patient (see §6 for what that means).
- Never approximate a drug price and present it as a live retail price. Curated reference prices are labeled "reference — verify before use." Live NADAC acquisition cost is labeled "acquisition cost, not a retail price."
- Never fabricate a program URL. All `PARTNER_URL` / `BRAND_URL` entries must resolve (HTTP 200 or final redirect) and be verified in a real browser before committing.

**Enforcement:** `data/tests/test_cross_language_consistency.py` fails CI if BIN codes in `assets/app.js` and `data/build_coupons.py` drift or if a fabricated code appears where the authoritative side has none.

---

## 2. Secret handling

- **Secrets never enter the repository.** `OPENFDA_KEY`, GoodRx partner credentials, and any future API keys go in host environment variables only (Render dashboard, GitHub repo secrets). Never paste secrets in code, comments, commit messages, or chat.
- `window.OPENFDA_KEY` and `window.OPENRX_API` are the only acceptable mechanisms for injecting runtime config client-side — set them in `assets/config.js` which is `.gitignore`'d in production overrides or served by the backend. Never set them via URL query parameters (exposes values in browser history, referrer headers, and server logs).
- gitleaks runs in CI (`pre-commit.yml`) and as a pre-commit hook. Never skip it (`--no-verify`).

---

## 3. Cash-pay accuracy

A drug program is only shown as a **cash coupon** when ALL of the following hold:
1. The adjudication codes (BIN/PCN/Group/Member) are universal and publicly published by the program operator.
2. The program's terms explicitly allow use by uninsured / self-pay patients.
3. The codes are a single static set — not per-patient enrollment.

Programs that require commercial insurance or per-patient enrollment are **not cash coupons**. They are routed to their official program page via `ExternalLinkRouting`. See `docs/PROVENANCE.md` §2 for primary-source citations.

Currently only BIN 015995 (GoodRx universal network) qualifies. This may change if a verified new program is added with primary-source evidence.

---

## 4. Single source of truth

Every piece of data that appears in more than one place must have a designated authoritative copy and a CI guard that fails if copies drift.

| Data | Authoritative copy | Mirror | Guard |
|---|---|---|---|
| BIN/PCN/Group/Member codes | `assets/app.js` `BIN_INFO` | `data/build_coupons.py` `BIN_MAP` | `test_cross_language_consistency.py` |
| Partner program URLs | `assets/app.js` `PARTNER_URL` | `data/build_coupons.py` `PARTNER_URL` | same test |
| NADAC distribution ID | `assets/live.js` `NADAC_DIST` | _(single copy — frontend only)_ | manual review at year rollover |

---

## 5. API accuracy and live-data safety

- The service worker (`sw.js`) must **never** cache cross-origin API responses. All medical and price data must always be fetched live to guarantee freshness. Only the app shell (HTML/CSS/JS/fonts/icons) is cached.
- Never add an API that requires a key to the client-side fetch path without routing it through the FastAPI backend, so the key stays server-side.
- Never add fake/mock API responses to the frontend. If a data source is unavailable, the UI must say so honestly (spinner → error or "None available at this time").

---

## 6. CORS and origin lockdown

- The FastAPI backend's `OPENRX_CORS_ORIGINS` env var must be `https://0penrx.org` on Render. It can be `*` only for local development with an explicit comment explaining why.
- Never add a wildcard origin to the production Render config without a documented reason and a rollback plan.
- `allow_methods` stays `["GET"]`. The backend is read-only by design — no mutations.
- `allow_headers` is `["Accept", "Content-Type"]`. No credential headers, no wildcards.

---

## 7. Content Security Policy

The `<meta http-equiv="Content-Security-Policy">` in `index.html` is the only CSP mechanism available on GitHub Pages. Every external origin added to the JS fetch path must also be added to `connect-src`. The current allowlist is:

```
https://rxnav.nlm.nih.gov
https://api.fda.gov
https://data.medicaid.gov
https://clinicaltables.nlm.nih.gov
https://openrx-api.onrender.com
```

Adding a new external API call without updating `connect-src` breaks the CSP. Adding a CDN for scripts breaks `script-src 'self'`. **This is intentional.** The CSP is defense-in-depth against XSS — keep it strict.

---

## 8. HTML output and XSS prevention

All user-supplied or API-supplied values inserted into `innerHTML` must pass through `esc()` (defined in `assets/app.js`). No raw string concatenation of external data into HTML templates. No `document.write`, no `eval`, no `new Function(string)`.

URLs derived from API responses that appear in `href` attributes must come from `live.js`-constructed templates (base URL hardcoded, token sanitized via `fdaToken()` / `searchToken()`), never from raw API string values.

---

## 9. CI requirements

Every PR must pass:
- `ruff check .` — zero lint errors
- `python -m compileall backend data` — no syntax errors
- `pytest -q` — all tests green

GitHub Actions are SHA-pinned (immutable commit hashes, not mutable version tags). Pre-commit hooks are also SHA-pinned. Never update a pin to a mutable tag — run `pre-commit autoupdate --freeze` to get the commit SHA, then commit that.

---

## 10. Honest limitations

The UI and docs must acknowledge what the platform cannot do:
- No free live retail-price API exists. NADAC is acquisition cost, not retail price.
- Manufacturer copay cards cannot be used with Medicare, Medicaid, TRICARE, VA, or any government health plan.
- Massachusetts and California restrict coupons for brand drugs with a generic equivalent.
- The site is a **reference tool** — always verify before use.

These disclosures must appear in the UI (Coupon Guide disclaimer, detail panel coupon cards, Data Sources page) and in `docs/PROVENANCE.md`. Never remove them.

---

## 11. Year-rollover maintenance (annual)

By January 1 of each year:
1. Update `NADAC_DIST` in `assets/live.js` to the new CMS distribution ID (the single source — pricing is fetched client-side from CMS).
2. The coupon rebuild workflow (`coupons.yml`) re-stamps effective/expiration dates automatically at 06:00 UTC on Jan 1 — verify the commit landed.

Failing to do step 1 causes NADAC lookups to go stale (CMS retires old distribution IDs).

---

## 12. Provenance for every catalog entry

Any drug price, coupon code, or program claim added to `assets/catalog.js` must have a verifiable primary source. Document it in `docs/PROVENANCE.md` or in the PR description before merging. "I saw it somewhere" is not a source.

---

## 13. Catalog integrity and re-verification

Every catalog entry carries integrity metadata that must stay truthful:

- `status` — `active` · `limited` · `archived`. Mark `limited` when a program is closing to new patients, the drug is in shortage, or access is otherwise restricted; mark `archived` when the drug is effectively off-market. Never leave a discontinued or restricted drug as `active`.
- `eligibility` — `cash-pay` · `insured-only` · `medicare-only` · `mixed` · `income-qualified`. A price that is **not** redeemable by an uninsured cash payer (a commercial-insurance copay card, an IRA Medicare-negotiated price, etc.) must NOT be labeled `cash-pay`. This is rule §3 applied to the price figure itself.
- `priceNote` — required whenever the displayed price is conditional (starting-dose-only, time-limited introductory offer, shipping fee included). State the condition plainly.
- `verified` — the ISO date of last manual audit. Re-stamp it only when the entry is actually re-checked against a primary source.

**Enforcement (two layers):**
1. `assets/catalog-validator.js` runs at page load via `validateCatalog(CATALOG)` and fails loud on missing fields, `price > retail`, savings-math mismatch (>2 pts), unknown enum values, or a `verified` date older than 90 days.
2. A scheduled **sentinel** (`openrx-catalog-sentinel`, every 12 hours) re-audits the catalog against live web sources — checking `limited`/`archived` entries for status changes, expired price notes, and stale `verified` dates — and emails findings to `info@qantm.ai`. Do not disable it without a replacement check.

---

## 14. Benchmark-term accuracy (AWP / WAC / MFP)

When any pricing benchmark is named in the UI, docs, or comments, it must be used correctly (see `docs/PROVENANCE.md` §4–§5):

- **AWP** is a proprietary, manufacturer-reported compendia benchmark — not a transaction average and not a public feed. The current AWP publishers are **Medi-Span, Micromedex RED BOOK, and Elsevier Gold Standard**. Do **not** cite First DataBank as an AWP source — FDB exited AWP publishing in 2011 (it still publishes WAC). 0penRX does not redistribute licensed AWP values.
- **MFP** (the IRA Medicare-negotiated Maximum Fair Price) is a **Medicare Part D price only**. Never present an MFP as a cash-pay or commercial price; if a catalog figure derives from one, flag it via `eligibility` (`medicare-only` / `mixed`) and a `priceNote`. Cite the statute (42 U.S.C. § 1320f-4) and CMS, not secondary summaries.
