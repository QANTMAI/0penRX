# Plan — Data Sources Page Redesign (from the 4-critic hyper-critical review)

Status: PLANNED (review run 2026-07-07; 4 independent critics — UX, content-truth,
site-consistency, consumer — 52 evidence-cited problems, 32 recommendations,
all findings verified against file:line, nothing assumed).
Owner: Tabitha Rudd, Qantm AI.

## The verdicts (verbatim, condensed)

- **UX:** "an engineering changelog wearing a consumer page's clothes … internal
  roadmap strings like 'Backend proxy (key pending)' ship to uninsured patients
  … on phones the page is effectively unreachable."
- **Content:** "its headline sentence is a lie about its own UI: 'Badges show
  live reachability' when the badges show access models and only 3 of 10 cards
  get a probe … the APIs the site actually hits on every keystroke have no card
  at all."
- **Consistency:** "the least-refined room in an otherwise carefully tightened
  house … a fourth badge dialect no other page uses … the refinement pass
  started here — it just stopped halfway."
- **Consumer:** "~20 distinct technical terms … the one thing the page must say
  ('prices come from government data and official program pages, hand-checked
  on <date> — confirm at the pharmacy') never appears in plain English
  anywhere … the tiny footer line answers the freshness question strictly
  better than the dedicated sources page."

## Design principles for the fix

1. **The page has one job**: make a stressed uninsured reader trust (or fairly
   distrust) the prices in under 10 seconds. Everything else is appendix.
2. **Honesty about what's actually used**: sources the site calls at runtime
   are a different class from documented-but-unused pricing sources. Never
   blur them.
3. **One badge vocabulary, one ordering rule** (group + alphabetical), dates on
   everything — the standards the rest of the site already meets.
4. **Developer detail lives in docs/**, linked, not inline.

## Phased work plan

### P0 — Truth fixes (ship first; each is XS/S)
| # | Change | Evidence |
|---|---|---|
| 0.1 | Rewrite the subtitle (index.html:287): "Green dots show which government databases are answering right now; colored badges show each source's access model. Always confirm the final price at the pharmacy." | All 4 critics: "Badges show live reachability" is false for 7/10 cards |
| 0.2 | GoodRx card: dead developer-portal URL → live URL; drop "API" framing (state plainly: consumer prices + discount card; no API integration) | content: dead link + implied integration |
| 0.3 | Amazon card: drop "PillPack/Amazon Health pricing API" (nothing calls it; PillPack is legacy branding) → "Outbound link — no API integration" or delete the card | content: unverifiable claim |
| 0.4 | AZ&Me card: append "closed to new patients May 2026" (the same file's priceNotes already say so) | content: self-contradiction |
| 0.5 | NADAC card: "Base for Cost Plus Drugs pricing formula" → "Base for our Cost-Plus-style estimate (NADAC×1.15+$3)" | content: misattribution |
| 0.6 | Methodology table: WAC/AWP claim → "WAC (FDB exited AWP publishing in 2011)" per docs/SOURCES.md:29 | consistency: register contradiction |
| 0.7 | CoverMyMeds link → covermymeds.health; "verify at checkout" → "verify at the pharmacy" (2×) | content/ux: dead domain, wrong idiom |
| 0.8 | RxNorm card: move "Powers the search autocomplete" to a new RxTerms card (it's RxTerms/clinicaltables that powers it) | content: misattribution |

### P1 — The one-job fix (consumer trust story)
| # | Change | Effort |
|---|---|---|
| 1.1 | Plain-language lead box under the h1: "Where these prices come from: U.S. government drug databases (FDA, CMS, NIH), official manufacturer program pages, and the GoodRx discount card — hand-checked (last full audit 2026-06-17; ongoing re-verification dated per entry). Always confirm the final price at the pharmacy." Dates sourced from PROVENANCE. | S |
| 1.2 | Add the missing runtime-source cards: **NLM RxTerms** (autocomplete) and **0penRX backend** (coupons/assistance) — the two things the site actually calls that have no card | S |
| 1.3 | PROVENANCE dead-end: render the provenance story as a short on-page section or an HTML page; stop linking a raw .md as the main trust artifact | M |
| 1.4 | Put verification dates on the view (audit date + per-source verified dates where they exist) | S |

### P2 — Card system rework
| # | Change | Effort |
|---|---|---|
| 2.1 | Two labeled groups: **"Powers this site (probed live)"** — RxTerms, RxNorm, openFDA, NADAC, 0penRX backend, Curated Reference Prices — then **"Documented pricing sources"** (rest). Alphabetical within groups. | S |
| 2.2 | Promote/lead with Curated Reference Prices; rewrite without unexplained "MFN … now offline" alarm ("originally seeded from a federal price portal that has since shut down; every price re-verified by hand since — see audit dates") | S |
| 2.3 | Kill the brand-hex dots (collide with status-dot vocabulary; invisible in dark mode) — neutral monogram or nothing; dots reserved for live/unreachable | XS |
| 2.4 | Unify badges to the site vocabulary + one-line legend; give `.src-live.down` an error treatment distinct from the `.a` badge accent | S |
| 2.5 | Re-probe on every sources-view entry (drop the probe half of the `sourcesInit` gate); key probes off a stable `id` field, not display names; hostname link text instead of raw URLs | S |
| 2.6 | De-jargon remaining card copy (drop RxCUI/adjudication/GraphQL/MCP phrasing; openFDA card lists the four extra endpoints actually fetched — label/shortages/enforcement/FAERS — in plain words) | S |

### P3 — Tables & blocks
| # | Change | Effort |
|---|---|---|
| 3.1 | Add the missing methodology row: "0penRX estimate — NADAC × 1.15 + $3 dispensing — ballpark for any generic — estimate only, labeled in-UI" | XS |
| 3.2 | Fix mis-columned Cost Plus cells; rename "Limits" → "Coverage & limits" | XS |
| 3.3 | `<td><strong>` row leads → `<th scope="row">` in both tables (match compare/guide) | XS |
| 3.4 | Move the manufacturer landscape table (internal integration TODO) to docs/SOURCES.md; replace with one consumer sentence + link. Reconcile the two registers while moving (they contradict). | S |
| 3.5 | BIN block → the existing cfields + copy-button component (same as Coupon Guide); real h3 heading; kill inline styles/negative-margin hack | S |
| 3.6 | Anti-kickback/state-restriction note → the standard `.disclaimer-box` treatment | XS |

### P4 — Site-wide items this review surfaced
| # | Change | Effort |
|---|---|---|
| 4.1 | **Mobile nav**: `.nav` is `display:none` below 600px with no replacement — the sources page (and compare/guide tabs) are unreachable on phones except via the footer. Fix: horizontally scrollable nav strip below 600px (the site already has the filterstrip pattern to reuse). | M |
| 4.2 | `document.title` updates on SPA view switch (sources/coupons views keep the home title) | XS |
| 4.3 | No-JS fallback sentence for the sources grid (catalog has one; sources view is empty without JS) | S |

## Acceptance criteria
1. **Truth**: no card claims an integration the code doesn't have; the subtitle
   describes what the UI actually shows; zero contradictions with docs/SOURCES.md
   or catalog.js priceNotes (assert programmatically).
2. **Consumer 5-second test**: plain-language trust summary + audit date visible
   above the fold of the view; jargon census in card copy reduced ≥50% (count
   before/after).
3. **Consistency**: one badge vocabulary + legend; group-and-alphabetical card
   order; `th scope="row"` everywhere; no inline styles; dates present.
4. **Mobile/a11y**: nav reachable at 375px; dark-mode contrast for all
   dots/badges ≥3:1; probes announce via the existing polite region.
5. **Gates**: full test suite; fact-preservation net over every claim moved or
   reworded; browser verification light+dark, 1280+375.

## Sequencing note
P0 is pure truth repair and can ship same-day. P1+P2 change the page's
structure and should ship together (one PR) to avoid a half-converted state.
P3 rides along or follows. P4.1 (mobile nav) is site-wide — separate PR with
its own browser matrix.
