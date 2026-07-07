# Implementation Plan — Data-Driven Generic Fallback Module

Status: PLANNED (v1 shipped 2026-07-06 in PR #100 as a hardcoded 10-name array in
`assets/app.js` — that array is the migration baseline this plan replaces).
Owner: Tabitha Rudd, Qantm AI.

## 0. Current state (what exists today)

- `renderGrid()` in `assets/app.js` has a `COMMON_GENERICS` array (10 names). A
  catalog-miss search matching the list renders a tailored empty state; all other
  misses render a general program panel. Links are verified roots only
  (Walmart $4/$10 list page, Cost Plus, GoodRx, Amazon Pharmacy) + the guide.
- Repo idioms this plan reuses (do NOT invent new machinery):
  - Hand-edited source → generated runtime artifact with a `--check` drift gate
    (`data/build_coupons.py` → `data/coupons.jsonl`; `data/build_static_seo.py`).
  - Data validated by pytest in the existing CI `backend` job
    (`data/tests/test_catalog_validator.py` pattern) — no new workflow needed.
  - Frontend is vanilla ES modules under CSP `script-src 'self'` — runtime data
    ships as a generated JS module (the `assets/catalog.js` pattern), NOT a
    runtime `fetch()` of JSON (avoids an extra request, SW-cache races, and
    import-assertion compatibility questions).

## 1. Source of truth: `data/generic-fallbacks.json`

Hand-edited JSON. A tiny generator emits the runtime module with a
**precomputed alias index** so app.js does zero index-building work.

### Schema (per entry)

```json
{
  "name": "lisinopril",
  "displayName": "Lisinopril",
  "aliases": ["prinivil", "zestril", "lisinopril-hctz"],
  "drugClass": "ACE inhibitor — blood pressure",
  "rank": 4,
  "rankSource": "ClinCalc DrugStats 2023 dataset (published 2025)",
  "ctas": [
    { "type": "walmart-list", "label": "$4 starting price (30-day)" },
    { "type": "costplus",     "label": "Low-markup mail order" },
    { "type": "goodrx",       "label": "Coupon price varies" },
    { "type": "live-lookup",  "label": "Live FDA data" }
  ],
  "caveat": "Availability and price vary by state and pharmacy.",
  "lastReviewed": "2026-07-06"
}
```

Top-level file shape:

```json
{
  "version": 1,
  "updated": "2026-07-06",
  "ctaTypes": {
    "walmart-list": { "url": "https://www.walmart.com/cp/4-prescriptions/1078664" },
    "costplus":     { "url": "https://www.costplusdrugs.com" },
    "goodrx":       { "url": "https://www.goodrx.com" },
    "amazon":       { "url": "https://pharmacy.amazon.com" },
    "guide":        { "url": "/uninsured-guide/#meds-only" },
    "live-lookup":  { "url": null }
  },
  "entries": [ ... ]
}
```

Design decisions baked into the schema:
- **URLs live once in `ctaTypes`**, not per entry — one place to review monthly,
  impossible for two entries to drift to different Walmart URLs.
- **`label` is a display label, never a price promise** ("$4 starting price",
  "Coupon price varies") — enforced by the validator (§3). No SKU-level pricing.
- **`type: "live-lookup"`** renders the in-app search CTA (no external URL) so
  the site's own strength stays the primary action.
- `rank`/`rankSource` make the "top 20" claim auditable and refreshable.

## 2. Build step: `data/build_generic_fallbacks.py`

- Reads `data/generic-fallbacks.json`, emits `assets/generic-fallbacks.js`:
  `export const GENERIC_FALLBACKS = {...}` with a **precomputed
  `aliasIndex`** (`{"zestril": "lisinopril", ...}` — lowercase key → entry name)
  so the runtime lookup is a single object access.
- `--check` mode (mirrors `build_coupons.py --check`): exits 1 if the committed
  module drifted from a fresh build. Wire into CI by adding the generated file
  check to the existing pytest suite (§3) — zero workflow changes.
- Generated module is added to `sw.js` SHELL precache + CACHE version bump.

## 3. Validator: `data/tests/test_generic_fallbacks.py` (runs in existing CI)

Required checks (each is one small test):
1. Required fields present per entry (`name`, `displayName`, `aliases[]`,
   `drugClass`, `rank`, `rankSource`, `ctas[]`, `caveat`, `lastReviewed`).
2. `ctas[].type` ∈ the `ctaTypes` enum; every `ctaTypes` URL is `https://…`
   (or site-relative `/…`, or `null` for `live-lookup` only) — regex format
   check, not a network call (CI stays hermetic; live link checking is the
   monthly review's job, §6).
3. No duplicate names/aliases across ALL entries (a search string must resolve
   to exactly one entry), and no alias collides with a curated `catalog.js`
   slug/name/generic (catalog always wins; collision = validator failure).
4. `lastReviewed` is valid ISO `YYYY-MM-DD`, not in the future, and not older
   than 90 days (soft-fails to a warning list printed by the test; hard-fails
   at 180 days — keeps the monthly review honest without CI flakiness).
5. **No-exact-price-promise lint**: `label` must not match `\$\d+\.\d{2}`
   (no cents = no SKU-level claims) and must not contain "guaranteed"; allowed
   shapes: "$4 starting price", "from $10", "Coupon price varies", plain text.
6. Entry count ≤ 25 (lightweight by construction) and every entry's `rank` ≤ 30.

## 4. Runtime injection (app.js changes — small)

1. `import { GENERIC_FALLBACKS } from './generic-fallbacks.js';`
2. Replace the hardcoded `COMMON_GENERICS` array + `isCommonGeneric` check with
   `aliasIndex[qNorm]` lookup (also try first word of multi-word queries, the
   current behavior).
3. Render the tailored panel from the entry: displayName, drugClass line,
   CTA buttons from `ctas` (labels + `ctaTypes` URLs; `live-lookup` focuses the
   search box suggestion flow), the entry `caveat`, and the standing
   pharmacy/location sentence.
4. Keep the general (non-listed) miss panel exactly as shipped.
5. Mobile: CTA row is `flex-wrap` chips; panel inherits `.state` centering —
   verify at 375px (acceptance criterion #2).

## 5. Populating the top 20 (efficient + auditable)

- Source: **ClinCalc DrugStats** (public dataset derived from the Medical
  Expenditure Panel Survey) — the standard "most prescribed drugs in the US"
  ranking; updates roughly annually.
- Process: take the top ~30 by prescription count → drop drugs already in the
  curated catalog (validator §3.3 enforces this) → keep the top 20 remaining →
  record `rank` + `rankSource` verbatim.
- Refresh cadence: ranks annually (when ClinCalc publishes); links/labels
  monthly (§6). The 10 names shipped in v1 are all inside any plausible top-20,
  so v1→v2 migration is additive.

## 6. Monthly review (choose one; both scaffolds are cheap)

- **Issue template** (`.github/ISSUE_TEMPLATE/generic-fallback-review.md`):
  checklist — every `ctaTypes` URL loads; Walmart tiers still $4/$10; labels
  still honest; bump every `lastReviewed`; run the validator.
- **Recommended addition**: a 12-line scheduled workflow (1st of month, like
  `coupons.yml`) with `permissions: issues: write` that opens that issue
  automatically via `gh issue create`. Set-and-forget; the 90-day validator
  warning (§3.4) is the backstop if the issue is ignored.

## 7. Expandable later (explicitly out of scope now)

A second file (`data/walmart-list-ingest.json`) for a broader Walmart-list
import, feeding the SAME generated module and alias index. The runtime contract
(`aliasIndex` lookup → entry → CTAs) doesn't change — only the data grows. Do
not build until the top-20 module proves itself in real usage.

## 8. GitHub project board tasks (execution order)

| # | Task | Size |
|---|------|------|
| 1 | Author `data/generic-fallbacks.json` — migrate the 10 shipped names, add 10 from ClinCalc top-30 (dedupe vs catalog), labels + caveats | M |
| 2 | `data/build_generic_fallbacks.py` + `--check`; commit generated `assets/generic-fallbacks.js` | S |
| 3 | `data/tests/test_generic_fallbacks.py` — the 6 validator checks (§3) | M |
| 4 | app.js: import module, swap hardcoded array for `aliasIndex`, render CTAs from data | M |
| 5 | `sw.js`: add generated module to SHELL precache, bump CACHE | XS |
| 6 | CSS: CTA chip row for the panel (reuse `.btn`/`.stat-chip` idioms), verify 375px | S |
| 7 | Issue template + (optional) monthly scheduled issue workflow | S |
| 8 | Docs: update AGENTS.md data-flow notes; add this file's status → SHIPPED | XS |

## 9. PR checklist — 5 acceptance criteria

- [ ] **1. Data integrity gate green**: `python data/build_generic_fallbacks.py --check`
      passes and all validator tests pass in CI (schema, enum, dup-alias,
      ISO dates, no-exact-price lint).
- [ ] **2. Mobile responsiveness**: fallback panel verified at 375×812 (and
      1280 desktop) — no horizontal scroll, CTA chips wrap, tap targets ≥24px
      (WCAG 2.5.8), screenshots attached to the PR.
- [ ] **3. CTA link validation**: every `ctaTypes` URL returns HTTP 200 when
      manually checked at review time (recorded in the PR description with
      date); `live-lookup` CTA focuses the search suggestion flow; internal
      guide anchor resolves.
- [ ] **4. Search behavior matrix verified in-browser**: (a) each of the 20
      names AND at least 3 aliases → tailored panel; (b) unknown string →
      general panel; (c) every curated catalog drug still renders its cards
      (zero fallback shadowing — automated by validator §3.3).
- [ ] **5. No-regression gate**: full suite green (pytest incl. new validator,
      ruff, node --test, `node --check` on generated JS, all three existing
      generator `--check` gates), SW cache bumped, and a11y intact (panel text
      contrast ≥4.5:1, `#emptyMsg` remains inside the existing polite-status
      empty-state region).

## Non-negotiables carried into this feature

100% real data only: no price without a fetched source; labels are starting-
price/varies language, never guarantees; anything unverifiable is omitted, not
approximated. All claims about Walmart program specifics (tiers, state caveats,
Walmart+ Rx for Less) remain gated on the fact-verification workstream before
they appear in labels or captions.
