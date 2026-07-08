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
  parseIngredients,
  descriptionHasAll,
  isOralOnlyDescription,
  nonOralFormHint,
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

test('parseIngredients: combos split into 6-char uppercase prefixes', () => {
  // The reported bug: a combo must yield BOTH ingredients, not just the first.
  assert.deepEqual(parseIngredients('Albuterol/Ipratropium (Inhalant)'), ['ALBUTE', 'IPRATR']);
  assert.deepEqual(parseIngredients('brimonidine/timolol'), ['BRIMON', 'TIMOLO']);
  assert.deepEqual(parseIngredients('sitagliptin/metformin HCl'), ['SITAGL', 'METFOR']);
  // single ingredient → single prefix (mono path)
  assert.deepEqual(parseIngredients('metformin'), ['METFOR']);
  assert.deepEqual(parseIngredients(''), []);
  assert.deepEqual(parseIngredients(null), []);
});

test('descriptionHasAll: every ingredient prefix must be present', () => {
  const combo = ['ALBUTE', 'IPRATR'];
  assert.equal(descriptionHasAll('IPRATROPIUM-ALBUTEROL 0.5-3(2.5) MG/3 ML', combo), true);
  // a mono component of the combo must be rejected (this was the wrong match)
  assert.equal(descriptionHasAll('ALBUTEROL SULF 2 MG/5 ML SYRUP', combo), false);
  assert.equal(descriptionHasAll('ALBUTEROL HFA 90 MCG INHALER', combo), false);
  assert.equal(descriptionHasAll('anything', []), false);
});

test('isOralOnlyDescription: flags oral forms, not inhalation/injection', () => {
  assert.equal(isOralOnlyDescription('ALBUTEROL SULF 2 MG/5 ML SYRUP'), true);
  assert.equal(isOralOnlyDescription('METFORMIN 500 MG TABLET'), true);
  assert.equal(isOralOnlyDescription('AMOXICILLIN 250 MG CAP'), true);
  assert.equal(isOralOnlyDescription('IPRATROPIUM-ALBUTEROL 0.5-3(2.5) MG/3 ML'), false);
  assert.equal(isOralOnlyDescription('ALBUTEROL HFA 90 MCG INHALER'), false);
});

test('nonOralFormHint: true for non-oral routes only', () => {
  assert.equal(nonOralFormHint('Albuterol/Ipratropium (Inhalant)'), true);
  assert.equal(nonOralFormHint('Latanoprost (Ophthalmic)'), true);
  assert.equal(nonOralFormHint('Enoxaparin (Injectable)'), true);
  assert.equal(nonOralFormHint('Metformin (Oral Pill)'), false);
  assert.equal(nonOralFormHint('Metformin'), false);   // no form qualifier
  assert.equal(nonOralFormHint(''), false);
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
