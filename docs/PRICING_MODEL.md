# 0penRX pricing model — the source of truth for prices, savings, and coupons

0penRX exists for **uninsured and cash-paying patients**. Every price we show
must be one such a patient can *actually obtain*. The single most common way to
get this wrong is to conflate a **manufacturer copay card** (needs commercial
insurance) with a **universal cash-discount card** (anyone can use it). This
document is the canonical reference so that mistake — and the drift it causes —
does not recur.

Non-negotiables: **100% real & true. No assumptions. Every figure traces to a
fetched or first-hand-verified source; reference prices are labeled "verify
before use."**

---

## 1. The price classes (know which one you're showing)

Two completely different things get called "savings." Keep them separate.

| Class | Who can use it | Needs insurance? | Examples |
|-------|----------------|------------------|----------|
| **Universal cash-discount card** | Anyone, incl. uninsured | No | GoodRx free card, SingleCare, ScriptSave WellRx, Optum Perks, America's Pharmacy |
| **Discount-card membership** | Anyone (pays a subscription) | No | GoodRx Gold ($9.99/mo indiv, $19.99 family), GoodRx Companion ($14.99/mo) |
| **Transparent cash pharmacy** | Anyone | No | Cost Plus Drugs, Amazon Pharmacy (cash price) |
| **Manufacturer direct self-pay** | Anyone | No | NovoCare ($199 Ozempic/Wegovy), LillyDirect |
| **Patient assistance program (PAP)** | Low-income uninsured (income-qualified) | No | manufacturer PAPs, NeedyMeds, RxAssist |
| **Manufacturer copay card** | **Commercially INSURED only** | **YES** — excludes cash-pay AND Medicare/Medicaid | AbbVie "At Your Service", myAbbVie Assist, most brand "$X/month" copay cards |
| **Medicare-negotiated (IRA)** | Medicare Part D beneficiaries only | N/A — **not a cash price** | Xarelto $197, Eliquis Part D price |

The bottom two rows are **not** cash-pay options and must never be presented as
the headline cash price for the uninsured.

---

## 2. Entity reference (verified — do not paraphrase from memory)

- **GoodRx free card** — universal cash coupon, no signup, ~any drug at 70,000+
  pharmacies. The uninsured baseline. On the site as BIN 015995 / PCN GDC /
  Group MAHA / Member RXFINDER.
- **GoodRx Gold** — paid membership ($9.99/mo individual, $19.99/mo family);
  deeper discounts than the free card.
- **GoodRx Care** — telehealth **visits** (pay an online clinician who can
  prescribe). *Not* a discount card.
- **GoodRx Companion** — membership **bundle** ($14.99/mo): medication
  discounts/free generics + cheaper Care visits + dental/vision/lab/imaging
  discounts (Discount Plan Organization: New Benefits, Ltd. — "NOT insurance").
- **Amazon Pharmacy** — the actual mail-order **pharmacy** (fills & ships; shows
  cash and insurance pricing; can apply Prime Rx savings).
- **RxPass** — a $5/mo Prime add-on subscription for a **limited list** of common
  generics *inside* Amazon Pharmacy. Not the whole pharmacy.
- **Cost Plus Drugs** (Mark Cuban Cost Plus Drug Company) — transparent
  mail-order pharmacy: manufacturer cost **+ 15% + a $5 pharmacy fee +
  shipping**, ~2,200 generics, bypasses PBMs. Anyone, no insurance.
- **Manufacturer copay card** (e.g. AbbVie "At Your Service") — lowers the copay
  for patients who **already have commercial insurance**; explicitly excludes
  cash-pay patients and anyone on Medicare/Medicaid.

Care ≠ Companion. Amazon Pharmacy ≠ RxPass. Discount card ≠ copay card. Do not
merge these in copy, data, or SEO.

---

## 3. Rules (enforce on every catalog / copy change)

1. **Cash-obtainable price only.** The headline `price` for a `cash-pay` drug
   must be a price an uninsured patient can actually get (a cash-discount-card
   price, a transparent-pharmacy price, or a manufacturer *direct self-pay*
   price). If the *only* manufacturer offer is an insurance-required copay card,
   price the drug at its **cash-discount-card (generic) price** instead and
   mention the copay card as an insured-only footnote in `priceNote`.
2. **Never say "not available to cash-pay patients"** for a drug that has a
   GoodRx / generic cash route (almost all do). Restrict that wording to the
   specific *copay card*, not the drug.
3. **`eligibility` marks who can get the shown price**: `cash-pay` (default),
   `insured-only`, `medicare-only`, `income-qualified`, or `mixed`. A non-cash
   value must be surfaced in the UI (browse-grid chip + detail eligibility
   warning), never hidden.
4. **`priceBasis: 'medicare-negotiated'`** = the price is an IRA Part D
   negotiated price, **not** a cash price. Such a price is labeled "not a cash
   price," its "% savings vs WAC" badge is suppressed, and its meta/OG/schema
   description says "Medicare Part D negotiated price," never "cash-pay
   reference price."
5. **Discount cards are not copay cards.** GoodRx/SingleCare/etc. are universal
   cash coupons (`program_type` must reflect that); manufacturer copay cards are
   a separate, insurance-required class.
6. **Savings math is cash-honest.** Dashboard averages/top and highest-savings
   sort exclude archived drugs and Medicare-negotiated prices. `status:
   'archived'` drugs show an "Archived" badge, never a stale "% off," and sort
   last.
7. **Starting/introductory prices are labeled.** If `priceNote` signals a
   starting/intro/first-fills price, the card shows a "starting dose — higher
   doses cost more" qualifier so the low headline isn't read as the ongoing
   price.
8. **Our estimate is ours.** The NADAC-based estimate (NADAC × 1.15 + $3) is
   0penRX's own assumption; the $3 dispensing figure is deliberately lower than
   Cost Plus's actual $5 pharmacy fee and must be described as our assumption,
   not as Cost Plus's model.
9. **Provenance or it doesn't ship.** Every published figure traces to a fetched
   API value, a vendor page, or a dated first-hand verification. Bot-walled
   vendors (GoodRx/Walmart/Costco) are verified via the live search UI, the
   Wayback Machine, or a user-supplied screenshot — never assumed.

---

## 4. Field conventions (assets/catalog.js)

- `heroType`: `GenericCashCoupon` → shown with the GoodRx cash-discount card
  (`bin: "015995"`). `ExternalLinkRouting` → manufacturer-direct self-pay
  (routes to `partner` via PARTNER_URL). Never pair a GoodRx BIN with a price
  the GoodRx card doesn't produce.
- `bin`: `"015995"` for GoodRx-card drugs, `""` for manufacturer-direct.
- `eligibility` / `priceBasis`: per Rules 3–4.
- `verified`: the YYYY-MM-DD the price was last checked; the footer shows the
  span of these dates.

When any of the above changes, keep the generators and their `--check` gates in
sync (`data/build_drug_pages.py`, `data/build_coupons.py`,
`data/build_static_seo.py`) and update `llms.txt` so AI assistants read the same
model. See also `docs/SOURCES.md` and `docs/PROVENANCE.md`.
