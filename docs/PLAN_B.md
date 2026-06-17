# Plan B — Coupon & Assistance Aggregator (MVP Roadmap)

This document is the honest plan of record for the 0penRX coupon / patient-
assistance aggregator. It describes why the aggregator must be server-backed,
what is actually shipped in this MVP, and which later phases are real but
**blocked** on access, licensing, or legal review. Nothing below is aspirational
marketing: shipped means shipped, blocked means blocked.

## Why this cannot be client-side

The static 0penRX frontend (GitHub Pages) cannot be the aggregator on its own:

- **No CORS-enabled coupon sources.** Manufacturer portals, GoodRx, NeedyMeds,
  and the Partnership for Prescription Assistance (PPA) do not expose
  browser-callable, CORS-permissive JSON APIs. A page served from `0penrx.org`
  cannot `fetch()` them directly — the browser blocks the cross-origin read.
- **Secrets cannot live in the browser.** The GoodRx Partner API requires an
  HMAC-signed request using a private key. A static site has nowhere to keep
  that key; embedding it would leak it. Signing must happen server-side.
- **Caching / display terms are contractual.** Partner feeds carry terms about
  how long results may be cached and how they must be displayed. Enforcing those
  terms requires a controlled server tier, not arbitrary client code.

Therefore the **deployed FastAPI backend is a hard prerequisite**. The frontend
reads `API_BASE` from `config.js` (set server-side): when an API base is
configured, the detail view fetches sourced data at runtime; when it is unset,
the coupon features **degrade to nothing** (the site still renders the curated
reference catalog, but surfaces no live coupon data). There is no client-only
fallback that calls third-party APIs directly, by design.

## Phased rollout

### Phase 0 — Deploy the backend (prerequisite)

Stand up `backend/app.py` (FastAPI) at a stable origin and set `API_BASE` in
`config.js`. Until this is live, every later phase is inert,
because the frontend has nothing to call. This is infrastructure, not a feature.

### Phase 1 — Catalog-derived coupons + `/coupons` API + gated frontend — **DONE**

Shipped in this MVP:

- `data/build_coupons.py` deterministically derives one coupon record per
  eligible catalog drug from `assets/catalog.js` and writes `data/coupons.jsonl`.
- `backend/app.py` serves `GET /coupons` from that committed dataset.
- The frontend consumes it through `API_BASE` (from `config.js`) and degrades
  gracefully when no API base is configured.
- Compliance defaults are baked into every record: `medicare_medicaid_excluded`
  is `true`, brand-with-generic drugs carry `["MA","CA"]` state restrictions, and
  `eligibility` is left `null` (we surface programs, we do not adjudicate them).

This is a **reference** dataset derived from the curated catalog — not a live
pull from manufacturers. Every record is labeled accordingly; see the compliance
section.

### Phase 1.5 — The timed sentinel — **DONE**

`.github/workflows/coupons.yml` keeps the dataset honest over time. See the
timed-sentinel rationale below. Shipped and valid.

### Later phases (GATED — real but blocked)

These are sequenced by value and unblock-ability, not yet built:

1. **GoodRx Partner API v2** — *blocked: key pending.*
   Server-side only. Requests are HMAC-signed with a private key inside the
   FastAPI tier (a `/coupons/goodrx` proxy). The key is **never** shipped to the
   browser. Caching and display must honor the partner contract. Blocked until
   partner credentials are issued.

2. **NeedyMeds CCRM + PAP directory** — *blocked: license required.*
   Verified 2026-06-17: ~4,768 coupon/rebate/savings-card offers covering
   ~4,613 drugs (CCRM), plus 9,000+ PAPs covering ~4,700 medications (separate
   directory). No public API exists (`/api` returns 404). No bulk download.
   ToS explicitly prohibits commercial use and screen-scraping. The only
   legitimate commercial integration path is a negotiated data license —
   contact **licensing@needymeds.org**. Cost and format (CSV/XML/JSON) are not
   published; every arrangement appears bespoke. The frontend already deep-links
   users directly to the CCRM drug search (`coupons.taf?_function=name_list&gname=`)
   as a zero-cost interim measure.

3. **RxAssist PAP directory** — *blocked: ToS / written permission required.*
   Verified 2026-06-17: ~875–900 individual program entries across ~300+
   manufacturers (not 375 as previously noted). Operated by RxVantage (for-profit).
   HTML is server-rendered (no headless browser needed); robots.txt blocks nothing.
   ToS explicitly prohibits commercial use, redistribution, and building derivative
   products — written permission from RxVantage required before any programmatic
   ingestion. No API, no bulk export. Data quality is mixed (some records have
   corrupt/blank fields, one date field shows Unix epoch 0). The frontend
   deep-links users to the PAP directory as a zero-cost interim measure.

4. **PPA / helpingpatients.org** — *blocked: scraping prohibited; no CSV.*
   Verified 2026-06-17: Operated by PhRMA. The claimed "downloadable CSV of 475
   programs" **does not exist** — no CSV, no data file, no download link of any
   kind on the site. The program list page (server-rendered Drupal) contains 265
   programs across 161 sponsors; the site's own "475+" claim appears to be stale
   marketing copy. ToS explicitly prohibits scraping and commercial use. PHP 7.4
   (EOL) on LiteSpeed/Cloudflare. Database last updated September 15, 2025.
   robots.txt is completely open, but ToS governs. Do not ingest without a signed
   agreement with PhRMA.

5. **Per-portal manufacturer scraping** — *blocked: ToS / legal review, last
   resort.* Direct scraping of individual manufacturer portals is the fallback of
   last resort. Each target's Terms of Service must pass legal review before any
   automated access. Not a default path.

## Timed-sentinel rationale

Manufacturer coupons are time-boxed: they expire at the end of the calendar year
and many cap out after ~12 fills. `data/build_coupons.py` stamps each record with
`effective_date = Jan 1` and `expiration_date = Dec 31` of the **current** year.
A static dataset that is never rebuilt would therefore keep serving last year's
expired offers as if they were live.

`.github/workflows/coupons.yml` prevents that:

- a **monthly** job (`0 9 1 * *`) rebuilds the dataset so any clone/redeploy
  reflects the current catalog, and
- a **Jan-1** job (`0 6 1 1 *`) re-stamps every record at the year boundary, the
  moment coupons would otherwise lapse.

The job commits the regenerated `data/coupons.jsonl` only when it actually
changes, running as the `github-actions[bot]` identity. This is the coupon
analogue of the NADAC year-rollover maintenance in `ingest.yml`.

## Compliance

- **Medicare / Medicaid ban.** Manufacturer copay assistance cannot be combined
  with Medicare or Medicaid under federal anti-kickback law. Every record sets
  `medicare_medicaid_excluded = true`, and the UI must not present coupons as
  usable by federal beneficiaries.
- **MA / CA restrictions.** Massachusetts and California restrict copay coupons
  for brand drugs that have a generic equivalent. Such records carry
  `state_restrictions = ["MA","CA"]`; the UI must honor them.
- **"Reference — verify."** Phase 1 data is derived from the curated catalog, not
  pulled live from manufacturers. It is a reference and must be labeled as such:
  users (and any downstream caller) should verify program terms, eligibility,
  and current availability with the program directly before relying on them.

## Status summary

| Item | Status |
|------|--------|
| Backend deployed (`API_BASE` wired) | Prerequisite — Phase 0 |
| Catalog-derived coupons + `/coupons` + gated frontend | **Shipped** (Phase 1) |
| Timed sentinel (`coupons.yml`) | **Shipped** (Phase 1.5) |
| GoodRx Partner API v2 (server-side HMAC proxy) | Blocked — key pending |
| NeedyMeds CCRM deep-link (outbound, no license needed) | **Shipped** |
| RxAssist PAP deep-link (outbound, no license needed) | **Shipped** |
| NeedyMeds licensed data feed (~4,768 offers) | Blocked — contact licensing@needymeds.org |
| RxAssist data license (~875 PAPs) | Blocked — written permission from RxVantage |
| PPA / helpingpatients.org | Blocked — ToS prohibits; no CSV exists (verified) |
| Per-portal manufacturer scraping | Blocked — ToS / legal review (last resort) |
