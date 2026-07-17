#!/usr/bin/env node
// Run the catalog data validator as a real check.
//
// assets/catalog-validator.js has always encoded the rules that matter — savings
// maths, price sanity, status/eligibility/flag enums, no catch-all category — but
// it only ever console.logged them in the browser, where nobody reads them. A
// rule nobody runs is a comment. This makes it exit non-zero, so CI enforces it.
//
//   node scripts/validate-catalog.mjs
//
// Errors fail the build. Warnings (a stale `verified` date, a biologic with no
// FDA class) are reported and pass — they need a human, not a red build.
import { CATALOG } from '../assets/catalog.js';
import { validateCatalog } from '../assets/catalog-validator.js';

// The validator logs as it goes; keep that out of the check's own output.
const quiet = { error() {}, warn() {}, log() {} };
const real = { error: console.error, warn: console.warn, log: console.log };
Object.assign(console, quiet);
const { errors, warnings } = validateCatalog(CATALOG);
Object.assign(console, real);

console.log(`catalog: ${CATALOG.length} entries, ${new Set(CATALOG.map((d) => d.category)).size} categories`);

for (const w of warnings) console.log(`  warn  ${w}`);
for (const e of errors) console.error(`  ERROR ${e}`);

// A count typed into prose or JSON-LD drifts the moment a drug is added or removed —
// index.html claimed "reference prices for 92 medications" for two drugs after the
// catalog dropped to 90, in structured data that crawlers read. Assert instead.
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const stale = [...html.matchAll(/\b(\d{2,3})\s+(?:medications|drugs|featured drugs|cash-pay medications)\b/g)]
  .map((m) => Number(m[1]))
  .filter((n) => n !== CATALOG.length);
if (stale.length) {
  console.error(`  ERROR index.html states ${[...new Set(stale)].join(', ')} where the catalog holds ${CATALOG.length}`);
  errors.push('hardcoded catalog count in index.html is stale');
}

if (errors.length) {
  console.error(`\n::error::catalog validation failed with ${errors.length} error(s).`);
  process.exit(1);
}
console.log(`\nOK — 0 errors, ${warnings.length} warning(s).`);
