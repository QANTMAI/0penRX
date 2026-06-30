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
   Count reconciliation across sources (different dates, different units):

   | Source | Date | Figure |
   |--------|------|--------|
   | Triage Cancer (citing NeedyMeds) | 2024 | 5,000+ programs, 13,000+ clinics, 1,000 discount coupons |
   | NeedyMeds PR Toolkit | 2025 | 7,000+ programs, 15,000+ clinics, 1,500 discount coupons |
   | Point-in-time CCRM scrape | 2026-06 | ~4,768 drug-coupon pairs across ~4,613 drugs |

   The "1,000–1,500 drug discount coupons" figure refers specifically to the
   NeedyMeds-issued Drug Discount Card program entries. The ~4,768 scrape count
   reflects individual drug-level coupon pairings including third-party manufacturer
   coupons indexed in their broader database — a different unit of measure. Both are
   correct for different scopes. Do not cite the 4,768 as an authoritative published
   figure; use the PR-toolkit numbers. No public API. No bulk download. ToS prohibits
   commercial use and screen-scraping. The only legitimate commercial integration path
   is a negotiated data license — contact **licensing@needymeds.org** (or
   info@needymeds.org for general inquiries). Cost and format are not published; every
   arrangement is bespoke. The frontend already deep-links users to the CCRM drug
   search (`coupons.taf?_function=name_list&gname=`) as a zero-cost interim measure.

3. **RxAssist PAP directory** — *blocked: ToS / written permission required.*
   Operated by RxVantage (for-profit; est. 1999 with Robert Wood Johnson Foundation
   funding). **RxAssist publishes zero quantitative database statistics on any
   public-facing page.** The About page (rxassist.org/about) contains only a brief
   mission statement — no program counts, no aggregate numbers whatsoever. All
   figures that have circulated ("375+ PAPs", "875–900 programs") originate from
   secondary sources, historical scrapes, or internal RxVantage data — none are
   traceable to a published RxAssist or RxVantage document. The true current count
   is unknown without direct contact (info@rxassist.org) or database access. The
   search interface covers manufacturer PAP programs (including RxOutreach and
   Xubex) and Generics Retail Programs. ToS explicitly prohibits commercial use,
   redistribution, and derivative products — written permission from RxVantage
   required before any programmatic ingestion. No API, no bulk export. The frontend
   deep-links users to the PAP directory as a zero-cost interim measure.

4. **PPA / Partnership for Prescription Assistance** — *defunct: do not target.*
   PhRMA shut down the consumer-facing PPA database approximately 2019. The
   original domain `pparx.org` has been repurposed as an unrelated generic health
   content site ("Professional Prescription Assistance") with no connection to the
   former program. `helpingpatients.org` returns HTTP 200 but carries a
   `last-modified: 09 Mar 2018` header — it is a frozen 8-year-old snapshot, not a
   maintained database. All historical program counts ("475+", "265") refer to a
   program that no longer operates. **Do not deep-link to pparx.org or
   helpingpatients.org** — users will land on stale or repurposed content. No code
   in this repo references either domain.

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
analogue of the annual `NADAC_DIST` refresh in `assets/live.js` (see
PLATFORM_RULES §11).

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
| RxAssist data license (count unknown; no public stats published) | Blocked — written permission from RxVantage |
| PPA / helpingpatients.org / pparx.org | **Defunct** — PhRMA shut down ~2019; do not link |
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

## Drug pricing benchmark hierarchy

For reference and future data-source decisions. Statutory citations where available.

| Benchmark | Definition | Publisher | Notes |
|-----------|-----------|-----------|-------|
| **WAC** (Wholesale Acquisition Cost) | Manufacturer's list price to wholesalers, excluding discounts/rebates | Manufacturer-reported | Statutory definition: 42 U.S.C. § 1395w-3a |
| **AWP** (Average Wholesale Price) | Historical reference benchmark for insurance reimbursement | Medi-Span (Wolters Kluwer), Micromedex RED BOOK (Merative) | FDB stopped publishing post-2011 settlement; no longer a statutory benchmark |
| **AMP** (Average Manufacturer Price) | Price wholesalers actually pay manufacturers | CMS (not public) | Used for Medicaid rebate calculations |
| **NADAC** (National Average Drug Acquisition Cost) | CMS weekly survey of actual pharmacy acquisition costs | CMS / data.medicaid.gov | Most accurate public cash-pay benchmark; what 0penRX uses |
| **MFP** (Maximum Fair Price) | IRA-negotiated Medicare prices for selected high-cost drugs | CMS / cms.gov/inflation-reduction-act | Public since March 1, 2025; 10 drugs initially |

Source: Minnesota Department of Commerce 2024 state government drug pricing primer; NIH PMC 2024 peer-reviewed study (PMC11953851) confirming hospital price transparency data is not usable for drug price comparison; Commonwealth Fund 2023.

**Why NADAC + Cost Plus formula is the right benchmark for 0penRX:** A 2024 NIH PMC peer-reviewed study found that federally mandated Hospital Price Transparency data (required since 2021) is unusable for drug price comparison because hospitals are not required to report units of measurement (CMS added this requirement starting January 2025). NADAC is the most accurate publicly available benchmark for actual pharmacy acquisition costs. The Cost Plus formula (acquisition × quantity × 1.15 markup + $3 dispensing) mirrors the Mark Cuban Cost Plus model. This is the correct approach.

## Net new sources (verified 2026-06-17)

Sources confirmed in the expanded research pass that are not yet integrated:

**PAN Foundation** (`panfoundation.org`) — copay grant funds for *insured* patients
with high cost-sharing (copays, premiums, deductibles). This is a categorically
different program type from PAPs, which serve uninsured patients. PAN covers
disease-specific fund areas; apply via their portal or 1-866-316-7263. Partners
with SSA Extra Help / Low-Income Subsidy for Medicare patients. **Already wired as
an outbound deep-link in the drug detail panel.**

**ASHP Drug Shortage Database** (`ashp.org/drug-shortages`) — University of Utah
Drug Information Service maintains the authoritative drug shortage tracker; 223
active shortages as of mid-2025 (down from all-time high of 323). ASHP is the
primary source that feeds FDA shortage awareness. Shortages directly affect NADAC
pricing (shortage drugs spike dramatically). **Already wired as an outbound link
in the drug detail shortage panel** alongside the openFDA shortage API results.

**CMS IRA Negotiated Prices** (`cms.gov/inflation-reduction-act`) — government-
published Maximum Fair Price (MFP) for the first 10 IRA-negotiated drugs, public
since March 1, 2025 per statutory requirement. A new category of
government-published benchmark price. Worth a dedicated section in the Data
Sources page when the catalog grows to include any of the 10 negotiated drugs.

**CMS Drug Price Verification Survey** (proposed rule) — CMS has proposed requiring
manufacturers of high-cost drugs to submit detailed pricing data annually, with
non-proprietary elements published publicly on Medicaid.gov. If finalized, this
becomes a new primary source for manufacturer-reported prices. Monitor for
finalization.
