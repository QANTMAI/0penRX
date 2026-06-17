# Coupon & PAP Source Register

A register of every coupon / patient-assistance-program (PAP) data source the
0penRX aggregator considers, with its access reality, license/redistribution
status, and integration tier. This is the source-of-truth for *what we are
allowed to do* with each source. See `docs/PLAN_B.md` for the rollout plan and
`docs/SCHEMA.md` for the normalized record shape.

## Integration tiers

- **Tier 1 — Shipped.** Live in this MVP.
- **Tier 2 — Gated, ready to build.** Path is clear; blocked only on a key,
  license, or parser.
- **Tier 3 — Gated, legal/ToS review required.** Access is technically possible
  but must clear legal review first.

## Sources

| Source | What it provides | License / redistribution | CORS / access reality | Tier |
|--------|------------------|--------------------------|-----------------------|------|
| **Catalog-derived** (`assets/catalog.js` → `data/build_coupons.py`) | One reference coupon/assistance record per eligible catalog drug (BIN/PCN/group for copay cards, partner portal for manufacturer-direct) | Owned by 0penRX; freely redistributable. Reference values — verify before use | Built at rest, served from our own backend (`GET /coupons`). No third-party call | **1 — Shipped** |
| **PPA / helpingpatients.org** (Partnership for Prescription Assistance) | Directory of manufacturer PAPs and eligibility programs | Site Terms of Use must be captured and reviewed before any ingest; redistribution terms unconfirmed | HTML list, likely JS-rendered; no public JSON API, not CORS-callable. Needs a verified parser against the rendered DOM | **2 — Gated** |
| **NeedyMeds** | Comprehensive PAP, copay-card, and free/low-cost clinic data | Licensed data feed; **no free public API**. Requires a signed license to ingest or redistribute | No browser-callable API. Access is contractual, not technical | **2 — Gated** |
| **GoodRx Partner API v2** | Negotiated coupon prices across 70K+ pharmacies (BIN 015995 adjudication) | Partner contract governs caching duration and display; key pending | Server-side only — requests are HMAC-signed with a private key; **never** client-side. CORS not relevant (proxied via FastAPI) | **2 — Gated** |
| **RxAssist** | Directory of manufacturer PAPs and application forms | Free directory; redistribution/attribution terms must be confirmed before ingest | Web pages, no public API; not CORS-callable. Would require a parser | **3 — Gated** |
| **Manufacturer portals** (Pfizer RxPathways, Sanofi Patient Connection, AstraZeneca Direct, Amgen Assist360, NovoCare, GSK For You, J&J, BI Cares, BMS, LillyDirect, EMD Serono, Novartis) | Authoritative per-program savings cards, direct-pay pricing, eligibility | Each portal's ToS governs automated access and redistribution individually | Per-portal HTML, no CORS; direct scraping is the **last resort** and needs per-target ToS / legal review | **3 — Gated** |
| **BPGLookup** (BIN/PCN/Group lookup) | Validation/enrichment of card routing fields (BIN → network/PCN/group) | Reference lookup; redistribution terms must be confirmed | No public CORS API; used as enrichment, not a primary feed | **3 — Gated** |
| **CMS IRA Negotiated Prices (MFP)** | Government-negotiated Maximum Fair Price for the IRA-selected Medicare drugs (first 10 effective Jan 1 2026; 15 more Jan 1 2027) | Public-domain U.S. government data; freely redistributable with attribution | Published as downloadable files on cms.gov (no JSON API); Medicare Part D price only — **not** a cash-pay benchmark | **2 — Gated** |
| **AWP compendia** (Wolters Kluwer Medi-Span · Merative RED BOOK · Elsevier Gold Standard) | Average Wholesale Price + WAC benchmarks | **Proprietary, licensed** — no free redistribution; manufacturer-reported, not transaction-averaged. FDB MedKnowledge no longer publishes AWP (exited 2011) | No public API; contractual license only. Referenced for context, **never** redistributed | **3 — Gated** |

## Attribution & ToS obligations

- **PPA / helpingpatients.org** — capture and archive the site's Terms of Use
  *before* any ingest; confirm redistribution is permitted, and honor any
  required attribution.
- **GoodRx Partner API** — the partner contract dictates **caching duration** and
  **display requirements**; the server tier must enforce both. Keep the HMAC key
  server-side only.
- **NeedyMeds** — ingest only under a signed data **license**; do not scrape as a
  substitute for licensing.
- **RxAssist / manufacturer portals / BPGLookup** — confirm each source's ToS and
  attribution terms before automated access; any scraping path requires legal
  review (Tier 3) and is the last resort.
- **CMS IRA negotiated prices** — public-domain; attribute to CMS and cite
  42 U.S.C. § 1320f-4. These are Medicare Part D Maximum Fair Prices, **not**
  cash-pay prices; never present an MFP as a cash/retail figure without that label.
- **AWP compendia (Medi-Span / RED BOOK / Gold Standard)** — proprietary licensed
  data; **do not redistribute AWP values**. The compendia landscape is documented
  in `docs/PROVENANCE.md` §4 for terminology accuracy only. Note FDB MedKnowledge
  exited AWP publishing in 2011 and now publishes WAC only.
