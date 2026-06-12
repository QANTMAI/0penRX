# Normalized Pricing Schema

All ingested pricing data is normalized to a single record shape so prices from
different sources are directly comparable.

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
