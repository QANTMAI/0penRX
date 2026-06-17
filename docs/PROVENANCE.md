# 0penRX — Data provenance

0penRX is a **cash-pay** prescription price-transparency tool. This document records where each class of data comes from and its verification status, so every figure on the site is auditable. Guiding rule: **no fabricated values.** Where a value can't be verified to a credible source, the UI says so ("None available at this time") rather than inventing one.

## 1. Live data (fetched at runtime, authoritative)

These are pulled live in the browser from public government/FDA APIs on every drug detail view — not stored, never stale:

| Field | Source | Endpoint |
|---|---|---|
| Drug identity / RxCUI | NLM RxNorm | `rxnav.nlm.nih.gov/REST` |
| Search autocomplete | NLM RxTerms | `clinicaltables.nlm.nih.gov/api/rxterms` |
| NDC / labeler / dosage form / ingredients | openFDA Drug NDC | `api.fda.gov/drug/ndc.json` |
| Label interactions | openFDA Label | `api.fda.gov/drug/label.json` |
| Shortages | openFDA | `api.fda.gov/drug/shortages.json` |
| Recalls | openFDA Enforcement | `api.fda.gov/drug/enforcement.json` |
| Adverse-event reports | openFDA FAERS | `api.fda.gov/drug/event.json` |
| Generic acquisition cost (NADAC) | CMS Medicaid NADAC | `data.medicaid.gov` datastore |

All are HTTPS, CORS-open, and require no key. NADAC is the authoritative per-unit acquisition cost; it is the basis for the "fair price" reference.

## 2. Coupon / pharmacy-card data (curated — cash-pay only)

**Only one pharmacy card is presented as a cash-pay coupon: the universal GoodRx-network discount card.** Research (primary sources below) established that the manufacturer programs we previously listed are **not** usable by cash-paying / uninsured patients, so they are routed to their official program page instead of shown as a copyable cash coupon.

| BIN | Program | Cash-pay usable? | Disposition | Source |
|---|---|---|---|---|
| **015995** | GoodRx universal discount network (PCN GDC · Group MAHA · Member RXFINDER) | ✅ Yes — universal published codes, no insurance needed | Shown as the cash coupon card | goodrx.com discount-card / coupon pages |
| **600426** | AbbVie "At Your Service" (Alphagan P, Combigan) | ❌ No | Routed → savewithays.com | savewithays.com T&C #3: *"This offer is not valid for cash-paying patients"* (also excludes Medicare/Medicaid) |
| **601341** | Humira Complete Savings Card | ❌ No (commercial insurance only) | Routed → myAbbVie Assist (the uninsured patient-assistance program) | humira.com/humira-complete/cost-and-copay: *"Available to patients with commercial insurance…"*; abbvie.com patient-assistance for the uninsured route |
| **610020** | EMD Serono fertility (Gonal-F, Cetrotide, Ovidrel) | Self-pay program, but per-patient enrollment (no universal copyable card) | Routed → fertilityinstantsavings.com | EMD Serono "Fertility Instant Savings" — for out-of-pocket/self-pay patients |

Single source of truth: `assets/app.js` `BIN_INFO` and `data/build_coupons.py` `BIN_MAP` — kept in lockstep and enforced in CI by `data/tests/test_cross_language_consistency.py`, which fails the build if the two drift or if a real code ever appears where the authoritative side has none.

Routing URLs (`PARTNER_URL` in both files) were each verified to resolve (HTTP 200 / loaded in a real browser).

## 3. Curated brand / reference prices

The 86-drug catalog (`assets/catalog.js`) carries **reference** cash-pay prices and WAC list prices. These are hand-curated snapshots, labeled throughout the UI as *"reference — verify before use,"* not a live retail quote. WAC list is the manufacturer wholesale price (savings-% baseline only, not a consumer price).

Each catalog entry carries integrity metadata, validated at page load by `assets/catalog-validator.js`:

| Field | Values | Meaning |
|---|---|---|
| `status` | `active` · `limited` · `archived` | `limited` = program closing / shortage / restricted access; `archived` = effectively off-market. Rendered as a badge in the detail card. |
| `eligibility` | `cash-pay` · `insured-only` · `medicare-only` · `mixed` · `income-qualified` | Anything other than `cash-pay` shows a warning that the listed price is **not** redeemable by an uninsured cash payer. |
| `priceNote` | string · null | Dose-tier or expiry caveat (e.g. *"starting dose; up to $449/mo"*, *"introductory price — verify availability"*). |
| `verified` | `YYYY-MM-DD` | Date the entry was last manually audited. The 12-hour sentinel and the validator flag any entry older than 90 days. |

The validator fails loud (console errors) on: missing required fields, `price > retail`, a `savings` value that disagrees with `round((retail−price)/retail×100)` by more than 2 points, an unknown `status`/`eligibility`, or a stale `verified` date.

**Last full audit: 2026-06-17** — a 5-agent web-research pass over all 86 drugs corrected 42 entries (discontinuations, INN suffixes, program-name fixes, dose-tier price notes, eligibility flags). See git history for the itemized changelog.

**Verification spot-checks** (read live from GoodRx in a real browser during audit; matched our catalog exactly):

- Premarin Vaginal Cream — **$236.65** ✓
- Wegovy (semaglutide tablet) — **$149** ✓
- Xeljanz — **$1,518** ✓

GoodRx product pages were also confirmed to resolve for every catalog slug (including dosage-form variants and redirects, e.g. `alphagan` → `alphagan-p`).

## 4. AWP benchmark — compendia landscape (reference context)

0penRX does **not** redistribute licensed Average Wholesale Price (AWP) data — AWP is a proprietary, manufacturer-reported benchmark, not a public feed. We document the landscape here so the term is used accurately anywhere it appears on the site.

As of 2025–2026 there are four recognized U.S. drug-pricing compendia. **Three publish AWP; one (FDB) does not:**

| Compendia | Owner | Publishes AWP? |
|---|---|---|
| **Medi-Span (Price Rx)** | Wolters Kluwer | ✅ Yes — dominant for PBMs/payers |
| **Micromedex RED BOOK** | Merative (Francisco Partners) | ✅ Yes — dominant for PBMs/payers |
| **Gold Standard Drug Database** | Elsevier | ✅ Yes — less used in payer contracts |
| **FDB MedKnowledge** | Hearst Health | ❌ No — WAC & clinical data only |

**First DataBank permanently ceased publishing AWP on September 26, 2011**, following the *New England Carpenters Health Benefit Fund v. First DataBank, Inc. & McKesson Corp.* settlement (the suit alleged FDB/McKesson inflated the WAC→AWP markup from 1.20× to 1.25× on 400+ branded drugs; FDB settled for $2.7M, McKesson for $350M). Any source describing FDB as a current AWP publisher — including a 2025 *JMCP* primer that still lists it — predates or overlooks this exit; rely on the settlement record and the HHS OIG 2011 report instead. AWP, where published, is a **manufacturer-reported** figure, not an average of actual wholesale transactions.

Sources:
- HHS OIG (2011), *Replacing Average Wholesale Price in Medicaid* — https://oig.hhs.gov/reports/all/2011/replacing-average-wholesale-price-medicaid-drug-payment-policy/
- Mesoblast/Ryoncil compendia listing, GlobeNewswire (Mar 13, 2025) — names all four current major compendia
- Wolters Kluwer Medi-Span · Merative RED BOOK · Elsevier Gold Standard product pages (2024–2025)

## 5. IRA Medicare-negotiated prices (Maximum Fair Price)

The Inflation Reduction Act of 2022 (P.L. 117-169) created the Medicare Drug Price Negotiation Program. CMS negotiates a **Maximum Fair Price (MFP)** directly with manufacturers for high-spend Medicare drugs. This is a **new category of government-published price**, distinct from AWP/WAC/ASP: it is a federally negotiated ceiling, not a market-reported or manufacturer-set benchmark.

Statutory publication duties (**42 U.S.C. § 1320f-4**):
- **§ 1320f-4(a)(1)** — publish the MFP by Nov 30, two years before the price-applicability year. *(For IPAY 2026: CMS published Aug 15, 2024, ahead of the Nov 30, 2024 deadline.)*
- **§ 1320f-4(a)(2)** — publish an explanation for each MFP by **March 1** of the prior year. *(For IPAY 2026: the March 1, 2025 deadline — CMS met it.)*

**First 10 negotiated drugs — MFP effective January 1, 2026** (per 30-day equivalent):

| Drug | Generic | MFP (2026) | In 0penRX catalog |
|---|---|---|---|
| Eliquis | apixaban | $231 | — |
| Jardiance | empagliflozin | $197 | — |
| **Xarelto** | rivaroxaban | $197 | ✅ (flagged `mixed` / Medicare price) |
| **Januvia** | sitagliptin | $113 | ✅ |
| **Farxiga** | dapagliflozin | $178 | ✅ (flagged `limited`) |
| Entresto | sacubitril/valsartan | $295 | — |
| **Enbrel** | etanercept | $2,355 | ✅ |
| Imbruvica | ibrutinib | $9,319 | — |
| Stelara | ustekinumab | $4,695 | — |
| Fiasp/NovoLog | insulin aspart | $119 | — |

The MFP is a **Medicare Part D price only** — it is not a cash-pay or commercial price, and 0penRX labels any catalog entry whose listed figure derives from an IRA-negotiated price accordingly (see Xarelto's `eligibility: mixed` note). The authoritative dataset is published by CMS at:
`https://www.cms.gov/initiatives/medicare-prescription-drug-affordability/overview/medicare-drug-price-negotiation-program/selected-drugs-negotiated-prices`

Legal status (June 2026): all manufacturer challenges have failed; the Supreme Court declined certiorari on May 18, 2026. Round 2 (15 drugs, incl. Ozempic/Wegovy) was announced Nov 25, 2025, effective Jan 1, 2027.

Sources:
- 42 U.S.C. § 1320f-4 — https://www.law.cornell.edu/uscode/text/42/1320f-4
- CMS Fact Sheet, IPAY 2026 Negotiated Prices — https://www.cms.gov/newsroom/fact-sheets/medicare-drug-price-negotiation-program-negotiated-prices-initial-price-applicability-year-2026
- KFF FAQ on the IRA Drug Price Negotiation Program — https://www.kff.org/medicare/faqs-about-the-inflation-reduction-acts-medicare-drug-price-negotiation-program/

> **Note:** The March 1, 2025 deadline is sometimes attributed to a Commonwealth Fund (2023) article. The underlying fact is correct, but cite the **statute (§ 1320f-4(a)(2)) and CMS fact sheets** directly — the specific Commonwealth Fund article could not be independently verified.

## 6. Known limitation (honest)

There is **no free, legal, real-time retail-price API** (GoodRx requires a partner key; Mark Cuban Cost Plus has no public API). Until a licensed live-price feed is wired in, retail prices remain curated reference snapshots and the live, authoritative figures are the NADAC acquisition cost and the FDA identity/safety data in §1. No price is fabricated to fill that gap.
