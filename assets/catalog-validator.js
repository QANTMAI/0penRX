// Runs at module load — logs warnings for data integrity issues.
// Import and call validate(CATALOG) at startup to catch bad data early.

const VALID_STATUSES    = new Set(['active', 'limited', 'archived']);
const VALID_ELIGIBILITY = new Set(['cash-pay', 'insured-only', 'medicare-only', 'income-qualified', 'mixed']);
const REQUIRED_FIELDS   = ['slug', 'name', 'price', 'retail', 'savings', 'company', 'generic', 'category'];
const STALE_DAYS        = 90; // flag entries not re-verified in 90 days

export function validateCatalog(catalog) {
  const errors   = [];
  const warnings = [];
  const now      = Date.now();

  for (const d of catalog) {
    const tag = d.slug || '(unknown)';

    // Required fields
    for (const f of REQUIRED_FIELDS) {
      if (d[f] == null || d[f] === '') errors.push(`${tag}: missing required field "${f}"`);
    }

    // Price sanity
    if (d.price <= 0)          errors.push(`${tag}: price must be > 0`);
    if (d.retail <= 0)         errors.push(`${tag}: retail must be > 0`);
    if (d.price > d.retail)    warnings.push(`${tag}: price > retail (${d.price} > ${d.retail})`);

    // Savings math: allow ±2 percentage points for rounding
    const expected = Math.round((d.retail - d.price) / d.retail * 100);
    if (Math.abs(expected - d.savings) > 2) {
      errors.push(`${tag}: savings ${d.savings}% doesn't match math ${expected}% (price=${d.price}, retail=${d.retail})`);
    }

    // Status / eligibility enum
    if (d.status      && !VALID_STATUSES.has(d.status))      errors.push(`${tag}: unknown status "${d.status}"`);
    if (d.eligibility && !VALID_ELIGIBILITY.has(d.eligibility)) errors.push(`${tag}: unknown eligibility "${d.eligibility}"`);

    // Staleness
    if (d.verified) {
      const age = (now - new Date(d.verified).getTime()) / 86400000;
      if (age > STALE_DAYS) warnings.push(`${tag}: not re-verified in ${Math.round(age)} days (last: ${d.verified})`);
    } else {
      warnings.push(`${tag}: no verified date set`);
    }
  }

  if (errors.length)   console.error('[0penRX catalog] ERRORS:\n' + errors.join('\n'));
  if (warnings.length) console.warn('[0penRX catalog] WARNINGS:\n' + warnings.join('\n'));
  if (!errors.length && !warnings.length) console.log('[0penRX catalog] validation passed.');

  return { errors, warnings };
}
