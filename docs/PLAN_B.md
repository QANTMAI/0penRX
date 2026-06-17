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
   Per NeedyMeds' own published PR toolkit: **7,000+ assistance programs** (PAPs,
   disease-specific, state/local), **15,000+ free/low-cost/sliding-scale clinics**,
   and **1,500 drug discount coupons** (the NeedyMeds-issued Drug Discount Card
   program, distinct from PAPs). An earlier point-in-time enumeration of their
   CCRM drug-level search page returned ~4,768 entries — this likely counts
   individual drug-level coupon records including third-party manufacturer coupons
   indexed in their database, not NeedyMeds-issued cards alone. Both figures are
   defensible depending on what is being counted; precision requires asking
   NeedyMeds directly. No public API (`/api` returns 404). No bulk download. ToS
   prohibits commercial use and screen-scraping. The only legitimate commercial
   integration path is a negotiated data license — contact
   **licensing@needymeds.org**. Cost and format (CSV/XML/JSON) are not published;
   every arrangement is bespoke. The frontend already deep-links users to the CCRM
   drug search (`coupons.taf?_function=name_list&gname=`) as a zero-cost interim
   measure.

3. **RxAssist PAP directory** — *blocked: ToS / written permission required.*
   Operated by RxVantage (for-profit; acquired from Volunteers in Health Care,
   est. 1999 with Robert Wood Johnson Foundation funding). The site no longer
   publishes aggregate program counts on any public-facing page — the "375+ PAPs"
   figure circulating in secondary sources reflects pre-2015 documentation and
   cannot be confirmed today. The "875–900 programs" figure from an earlier scrape
   pass is similarly unverifiable from public pages; true current count requires
   direct database access. The search interface covers two databases: manufacturer
   PAP programs (including RxOutreach and Xubex) and Generics Retail Programs. ToS
   explicitly prohibits commercial use, redistribution, and derivative products —
   written permission from RxVantage required before any programmatic ingestion. No
   API, no bulk export. The frontend deep-links users to the PAP directory as a
   zero-cost interim measure.

4. **PPA / helpingpatients.org** — *blocked: scraping prohibited; no CSV.*
   Operated by PhRMA. The "475+" program count still appears in syndicated
   government and nonprofit references (including a Nebraska state resource page)
   but reflects an older claim, likely accurate when originally set (~2010–2015).
   Live enumeration of the current site returns **~265 active programs** across
   ~161 sponsors — the gap reflects programs that have expired or been folded into
   other platforms since that figure was established. No CSV download exists; the
   claim is unverified and no download link appears on the current site. ToS
   explicitly prohibits scraping and commercial use. Do not ingest without a signed
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
| NeedyMeds licensed data feed (7,000+ programs; 1,500 discount cards) | Blocked — contact licensing@needymeds.org |
| RxAssist data license (count unconfirmed from public pages) | Blocked — written permission from RxVantage |
| PPA / helpingpatients.org | Blocked — ToS prohibits; no CSV exists (verified) |
| Per-portal manufacturer scraping | Blocked — ToS / legal review (last resort) |

## Commercial layer — verified ground truth (2026-06-17)

Reference notes on sources that appear in developer documentation but have been
verified against primary sources. Corrections here override any secondary-source
claims in the codebase or prior notes.

**FDB (First Databank) and AWP.** FDB stopped publishing AWP-based prices in
September 2011 following a class action settlement (Judge Patti B. Saris, U.S.
District Court of Massachusetts) in which FDB and Medi-Span agreed to reduce AWPs
to 120% of WAC and subsequently cease AWP publication entirely. Any documentation
claiming FDB "exposes AWP" is factually incorrect post-2011. FDB now publishes
WAC, NADAC, and clinical decision support data. Current commercial AWP publishers
are **Medi-Span (Wolters Kluwer)**, **Micromedex RED BOOK (Merative)**, and
**Gold Standard Drug Database**.

**CoverMyMeds developer portal.** The original `developer.covermymeds.com` URL is
dead. CoverMyMeds was acquired by McKesson in 2017 and its developer
infrastructure has been consolidated into McKesson/RelayHealth. A standalone
public API portal equivalent to the pre-acquisition product no longer exists. The
current developer support entry point is
`https://covermymeds.com/main/support/developers/` — requires a formal partnership
application; not self-serve.

**RxHope.** Privacy Policy prohibits commercial exploitation of content. The
database is frozen at 2009–2011 vintage. At directory-tier browsing, only program
names are accessible — no eligibility criteria, income thresholds, or application
data. Scraping for commercial reuse carries meaningful legal risk. Use as a
reference only: confirm a program exists, then route users to the manufacturer
directly. Not a data extraction target.
