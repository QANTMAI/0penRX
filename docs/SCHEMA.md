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
