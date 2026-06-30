// Unit tests for the pure functions in assets/live.js — the client-side data
// path that fetches and normalizes CMS NADAC pricing, openFDA tokens, and the
// Cost Plus-style estimate. These never touch the (separately tested) backend,
// so a bug here would ship a wrong price straight to a patient.
//
// Run: node --test   (no dependencies; uses the built-in node:test runner)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchToken,
  fdaToken,
  normalizeNadacRows,
  nadacEstimate,
} from '../assets/live.js';

test('searchToken: first moiety, uppercased, punctuation stripped', () => {
  assert.equal(searchToken('sitagliptin/metformin HCl'), 'SITAGLIPTIN');
  assert.equal(searchToken('atorvastatin calcium'), 'ATORVASTATIN');
  assert.equal(searchToken('insulin glargine'), 'INSULIN');
  assert.equal(searchToken(''), '');
  assert.equal(searchToken(null), '');
});

test('searchToken: keeps internal digits, trims stray hyphens', () => {
  // "5-aminosalicylic" must keep its digit and not yield a leading-hyphen token
  assert.equal(searchToken('5-aminosalicylic acid'), '5-AMINOSALICYLIC');
});

test('fdaToken: bare lowercase ingredient/brand, ®/™ removed', () => {
  assert.equal(fdaToken('Ozempic® Pen'), 'ozempic');
  assert.equal(fdaToken('atorvastatin calcium'), 'atorvastatin');
  assert.equal(fdaToken('Humira™'), 'humira');
  assert.equal(fdaToken(''), '');
  assert.equal(fdaToken(null), '');
});

test('normalizeNadacRows: returns null when no valid rows', () => {
  assert.equal(normalizeNadacRows([]), null);
  // non-numeric per-unit and missing description are both filtered out
  assert.equal(
    normalizeNadacRows([
      { nadac_per_unit: 'n/a', ndc_description: 'X' },
      { nadac_per_unit: '1.00', ndc_description: '' },
    ]),
    null,
  );
});

test('normalizeNadacRows: picks most recent effective_date', () => {
  const out = normalizeNadacRows([
    { ndc_description: 'OLD', nadac_per_unit: '0.01', effective_date: '2025-01-01' },
    { ndc_description: 'NEW', nadac_per_unit: '0.99', effective_date: '2025-12-17' },
  ]);
  assert.equal(out.description, 'NEW'); // newer date wins even though it costs more
  assert.equal(out.effectiveDate, '2025-12-17');
  assert.equal(out.matches, 2);
  assert.match(out.sourceUrl, /data\.medicaid\.gov/);
});

test('normalizeNadacRows: within same date, lowest per-unit wins', () => {
  const out = normalizeNadacRows([
    { ndc_description: 'PRICEY', nadac_per_unit: '0.50', effective_date: '2025-12-17' },
    { ndc_description: 'CHEAP', nadac_per_unit: '0.02', effective_date: '2025-12-17' },
  ]);
  assert.equal(out.description, 'CHEAP');
  assert.equal(out.perUnit, 0.02);
});

test('nadacEstimate: NADAC x qty x 1.15 + $3, rounded to cents', () => {
  // 0.02546 * 30 * 1.15 + 3 = 3.87837 -> 3.88
  assert.equal(nadacEstimate(0.02546, 30), 3.88);
  // default quantity is 30
  assert.equal(nadacEstimate(0.02546), 3.88);
  assert.equal(nadacEstimate(1, 30), Math.round((1 * 30 * 1.15 + 3) * 100) / 100);
});

test('nadacEstimate: null for non-finite input', () => {
  assert.equal(nadacEstimate(NaN), null);
  assert.equal(nadacEstimate(undefined), null);
  assert.equal(nadacEstimate('x'), null);
});
