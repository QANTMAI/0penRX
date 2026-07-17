# Normalized Pricing Schema

All ingested pricing data is normalized to a single record shape so prices from
different sources are directly comparable.

## Catalog entry (`assets/catalog.js`)

The curated catalog is the single source of truth for displayed brand/reference
prices. Each entry is validated at page load by `assets/catalog-validator.js`.

| Field | Type | Description |
|-------|------|-------------|
| slug | string | URL-safe primary key, joins to coupons and detail routing |
| name | string | Brand name as displayed, e.g. "Farxiga®" |
| generic | string | Non-proprietary (INN) name; biologics carry the FDA 4-letter suffix, e.g. "somatrogon-ghla" |
| company | string | Manufacturer as displayed |
| category | string | Therapeutic category (drives the filter chips) |
| price | number | Reference cash-pay / program price in USD. Must correspond to a route an uninsured patient can actually take (a published program price, a discount-card price, or a documented cash price) and be backed by `priceSource`. |
| retail | number | WAC list price in USD (savings-% baseline only, not a consumer quote) |
| savings | number | Integer % off retail; must equal `round((retail−price)/retail×100)` ±2 |
| heroType | string | `GenericCashCoupon` (BIN-routed card) or `ExternalLinkRouting` (partner portal) |
| bin | string | GoodRx network BIN for coupon cards; empty string for manufacturer-direct |
| partner | string | Assistance-program name; resolves to a URL via `PARTNER_URL` in `app.js` |
| isGeneric | boolean | True if a generic equivalent is the dispensed product (adds Cost Plus / Amazon tags) |
| **status** | string | `active` · `limited` · `archived`. `limited` = program closing, shortage, or restricted; `archived` = effectively off-market. Drives the detail-card badge. |
| **eligibility** | string | `cash-pay` · `insured-only` · `medicare-only` · `mixed` · `income-qualified`. Anything but `cash-pay` renders a warning that an uninsured payer cannot redeem the listed price. |
| **priceNote** | string \| null | Dose-tier or expiry caveat, e.g. *"starting dose; up to $449/mo"*. Null when the price is unconditional. |
| **verified** | string | ISO date (`YYYY-MM-DD`) of last manual audit. Validator + 12-hour sentinel flag entries older than 90 days. |
| **priceReviewBy** | string \| null | ISO date (`YYYY-MM-DD`) the `price` is known to expire — set it whenever a `priceNote` says a figure is good only "through <date>" (e.g. the NovoCare Ozempic/Wegovy $199 intro, good through 2026-12-31). Optional; omit for prices with no known expiry. Format is validated here; the scheduled **Price freshness** workflow (`data/check_price_freshness.py`) opens a `price-review` issue assigned to the repo owner ~60 days before the date, and auto-closes it once the price is updated. |
| **priceSource** | string \| null | Where `price` came from. Either an `https://` URL of the page that publishes the figure, or one of the sentinels `goodrx-network` (BIN 015995 discount-card price), `nadac-estimate` (computed from the CMS NADAC baseline), or `manufacturer-direct` (a manufacturer self-pay/PAP page — pair with a `priceNote` that states the figure). A missing `priceSource` means the price is unsourced; the July 2026 price audit added this field precisely because 39 entries carried a `price` no route could be traced to. |

### Validation rules (`catalog-validator.js`)

Fails loud (console error) on any of: missing required field; `price ≤ 0` or
`retail ≤ 0`; `price > retail`; `savings` disagreeing with the computed
percentage by more than 2 points; an unknown `status`, `eligibility`, or `flag`
value; a catch-all `category`; a **missing `priceSource`**, or one that is
neither a known sentinel nor an `https://` URL (backfilled to 100% by the July
2026 audit, so a missing source is now an error — no price ships untraceable).
Warns (console warn) on: a `verified` date older than 90 days or missing; a
missing `pharmClass`. Run automatically at module load via
`validateCatalog(CATALOG)` and enforced in CI by `scripts/validate-catalog.mjs`.

## Price record

| Field | Type | Description |
|-------|------|-------------|
| drug_name | string | Generic or brand name as displayed to users |
| ndc | string | National Drug Code (11-digit, normalized) |
| dose | string | Strength + form, e.g. "10 mg tablet" |
| quantity | number | Units the price refers to (e.g. 30) |
| price_usd | number | Cash/list price in USD for the given quantity |
| unit | string | Pricing unit, e.g. "EA", "ML", "GM"
| pharmacy_name | string | Pharmacy or program name |
| pharmacy_npi | string | NPI of the pharmacy, when known |
| zip | string | 5-digit ZIP for the price point, when location-specific |
| source | string | Source identifier, e.g. "NADAC", "medicaid_ct" |
| source_url | string | Link to the source dataset/record |
| effective_date | string | ISO 8601 date the price is effective |
| ingested_at | string | ISO 8601 timestamp of ingestion |

## Notes

- `ndc` is the primary key for joining across sources; normalize to 11 digits.
- `price_usd` is always cash/list price, never PBM-negotiated.
- One row = one (ndc, pharmacy, source, effective_date) observation.
- Missing optional fields are null, never empty strings.

## Example (JSON)

```json
{
  "drug_name": "atorvastatin",
  "ndc": "00071015523",
  "dose": "10 mg tablet",
  "quantity": 30,
  "price_usd": 8.42,
  "pharmacy_name": "Example Pharmacy",
  "pharmacy_npi": "1234567890",
  "zip": "06095",
  "source": "NADAC",
  "source_url": "https://data.medicaid.gov/...",
  "effective_date": "2026-05-01",
  "ingested_at": "2026-06-11T20:00:00Z"
}
```

## Coupon / assistance record

Manufacturer copay cards and patient-assistance programs are normalized to a
single record shape so every saving offer is described the same way. One row =
one program for one catalog drug. The dataset lives at `data/coupons.jsonl`.

| Field | Type | Description |
|-------|------|-------------|
| program_name | string | Program as displayed, e.g. "Pfizer RxPathways" or "Amgen Savings Card" |
| manufacturer | string | Manufacturer name, trademark glyphs stripped, e.g. "Pfizer" |
| drug_name | string | Generic (non-proprietary) name |
| drug_slug | string | URL-safe catalog slug, joins to the price catalog |
| brand | string | Brand name as displayed, e.g. "Enbrel®" |
| program_type | string | "copay-card" (BIN-routed) or "manufacturer-direct" (partner portal) |
| bin | string \| null | Card BIN for copay-card programs; null for manufacturer-direct |
| pcn | string \| null | Card PCN, when the BIN network defines one |
| group | string \| null | Card group ID, when defined |
| member_id | string \| null | Card member ID, when defined |
| eligibility | null | Eligibility rules are not asserted by 0penRX — always null |
| medicare_medicaid_excluded | boolean | Always true — federal beneficiaries are barred (anti-kickback) |
| url | string \| null | Manufacturer program landing page, when known |
| source | string | Always "catalog" — derived from the curated catalog |
| source_url | string | Link to the deriving source |
| effective_date | string | ISO 8601 date, `YYYY-01-01` of the build year |
| expiration_date | string | ISO 8601 date, `YYYY-12-31` of the build year — never null |
| state_restrictions | string[] | States where the offer is restricted, e.g. `["MA","CA"]` |
| status | string | "active" or "expired" |
| ingested_at | string | ISO 8601 timestamp the record was built |

### Notes

- `medicare_medicaid_excluded` defaults to `true`: manufacturer copay assistance
  cannot be combined with Medicare or Medicaid coverage under federal
  anti-kickback law. This is a hard default, not a per-drug assertion.
- `state_restrictions` defaults to `["MA","CA"]` for brand drugs that have a
  generic equivalent (Massachusetts and California restrict copay coupons in
  that case). Generic drugs carry an empty list `[]`.
- `expiration_date` is **never null**: it is always filled to Dec 31 of the
  effective year, because every manufacturer offer is time-boxed to the
  calendar year (and many cap after ~12 fills).
- `eligibility` is always `null` — 0penRX surfaces programs as a reference and
  does not assert who qualifies. Verify eligibility with the program directly.
- `bin`/`pcn`/`group`/`member_id` are populated only for `copay-card` programs;
  `manufacturer-direct` programs route through a partner portal (`url`) instead.
- The dataset is regenerated deterministically by `data/build_coupons.py` and
  kept current by `.github/workflows/coupons.yml` (monthly + Jan-1 refresh).

### Example (JSON)

```json
{
  "program_name": "Amgen Assist360",
  "manufacturer": "Amgen",
  "drug_name": "etanercept",
  "drug_slug": "enbrel",
  "brand": "Enbrel®",
  "program_type": "copay-card",
  "bin": "015995",
  "pcn": "GDC",
  "group": "MAHA",
  "member_id": "RXFINDER",
  "eligibility": null,
  "medicare_medicaid_excluded": true,
  "url": "https://www.amgenassist360.com",
  "source": "catalog",
  "source_url": "https://0penrx.org",
  "effective_date": "2026-01-01",
  "expiration_date": "2026-12-31",
  "state_restrictions": ["MA", "CA"],
  "status": "active",
  "ingested_at": "2026-06-12T09:00:00Z"
}
```
