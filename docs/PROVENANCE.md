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

The 88-drug catalog (`assets/catalog.js`) carries **reference** cash-pay prices and WAC list prices. These are hand-curated snapshots, labeled throughout the UI as *"reference — verify before use,"* not a live retail quote. WAC list is the manufacturer wholesale price (savings-% baseline only, not a consumer price).

**Verification spot-checks** (read live from GoodRx in a real browser during audit; matched our catalog exactly):

- Premarin Vaginal Cream — **$236.65** ✓
- Wegovy (semaglutide tablet) — **$149** ✓
- Xeljanz — **$1,518** ✓

GoodRx product pages were also confirmed to resolve for every catalog slug (including dosage-form variants and redirects, e.g. `alphagan` → `alphagan-p`).

## 4. Known limitation (honest)

There is **no free, legal, real-time retail-price API** (GoodRx requires a partner key; Mark Cuban Cost Plus has no public API). Until a licensed live-price feed is wired in, retail prices remain curated reference snapshots and the live, authoritative figures are the NADAC acquisition cost and the FDA identity/safety data in §1. No price is fabricated to fill that gap.
