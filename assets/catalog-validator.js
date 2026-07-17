// Runs at module load — logs warnings for data integrity issues.
// Import and call validate(CATALOG) at startup to catch bad data early.

const VALID_STATUSES    = new Set(['active', 'limited', 'archived']);
const VALID_ELIGIBILITY = new Set(['cash-pay', 'insured-only', 'medicare-only', 'income-qualified', 'mixed']);
const VALID_FLAGS       = new Set(['program-closed', 'shortage', 'intro-price', 'discontinued', 'income-qualified']);
// A catch-all category is how 39% of the catalog once ended up in "Other Brand":
// unfilterable, and a claim about the drug that no source backs. Every category
// is derived from the drug's FDA Established Pharmacologic Class — see
// docs/THERAPEUTIC_CLASSES.md. Guard the invariant rather than pin an exact list,
// which would go stale every time the catalog grows a therapeutic area.
const CATCH_ALL_CATEGORIES = new Set(['other brand', 'other', 'misc', 'miscellaneous', 'uncategorized', 'unknown', 'n/a']);
// Where a `price` came from. A URL is the manufacturer/program page that
// publishes the figure; the sentinels cover the non-URL sources. Added by the
// July 2026 price audit after 39 entries were found carrying a price no route
// could be traced to (docs/PROVENANCE.md).
const PRICE_SOURCE_SENTINELS = new Set(['goodrx-network', 'nadac-estimate', 'manufacturer-direct']);
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

    // Status / eligibility / flag enum
    if (d.status      && !VALID_STATUSES.has(d.status))      errors.push(`${tag}: unknown status "${d.status}"`);
    if (d.eligibility && !VALID_ELIGIBILITY.has(d.eligibility)) errors.push(`${tag}: unknown eligibility "${d.eligibility}"`);
    if (d.flag        && !VALID_FLAGS.has(d.flag))           errors.push(`${tag}: unknown flag "${d.flag}"`);

    // A flag badges the card; priceNote is the only place the reason is spelled
    // out. A flag without one is a caveat the reader can never resolve.
    if (d.flag && !d.priceNote) warnings.push(`${tag}: flag "${d.flag}" set but no priceNote explains it`);

    // Category integrity
    if (d.category && CATCH_ALL_CATEGORIES.has(d.category.trim().toLowerCase())) {
      errors.push(`${tag}: category "${d.category}" is a catch-all — assign the therapeutic area implied by the drug's FDA class (docs/THERAPEUTIC_CLASSES.md)`);
    }
    if (!d.pharmClass) {
      warnings.push(`${tag}: no pharmClass recorded — its category is not traceable to an FDA class`);
    }

    // Price provenance: every price must be traceable to a route a patient can take.
    // A malformed source is an error; a missing one is a warning until the backfill
    // completes (see docs/PROVENANCE.md), after which this should become an error.
    if (d.priceSource == null || d.priceSource === '') {
      // Backfilled to 100% by the July 2026 price audit, so this is now an error:
      // no price ships without a traceable source.
      errors.push(`${tag}: no priceSource — price ${d.price} is not traceable to a published figure`);
    } else if (!PRICE_SOURCE_SENTINELS.has(d.priceSource) && !/^https:\/\/\S+$/.test(d.priceSource)) {
      errors.push(`${tag}: priceSource "${d.priceSource}" must be an https URL or one of ${[...PRICE_SOURCE_SENTINELS].join(', ')}`);
    }

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
