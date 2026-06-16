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

2. **NeedyMeds** — *blocked: licensed feed.*
   Comprehensive PAP/coupon coverage, but there is no free public API; access is
   a **licensed data feed**. Requires a signed license before ingest. No
   scraping of NeedyMeds as a substitute for licensing.

3. **PPA / helpingpatients.org** — *blocked: needs a verified parser.*
   The Partnership for Prescription Assistance publishes program data as an HTML
   list that is **likely JS-rendered**. Before any ingest we must (a) capture and
   record the site's terms of use, and (b) build and verify a parser against the
   real rendered DOM. No ingest until the parser is proven correct.

4. **Per-portal manufacturer scraping** — *blocked: ToS / legal review, last
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
| NeedyMeds licensed feed | Blocked — license required |
| PPA / helpingpatients.org | Blocked — verified parser + ToS capture |
| Per-portal manufacturer scraping | Blocked — ToS / legal review (last resort) |
