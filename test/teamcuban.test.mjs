import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchTeamCuban, normalizeDrugName, formatPrice } from '../assets/teamcuban-lookup.js';

// Shaped exactly like build_teamcuban.py output.
const ROWS = [
  { n: 'Abacavir / Lamivudine', gf: 'Epzicom', s: '600-300 MG', f: 'Tablet', q: '30 Tablets', p: 42.34 },
  { n: 'Metformin Hcl', s: '500 MG', f: 'Tablet', q: '30 Tablets', p: 4.20 },
  { n: 'Metformin Hcl', s: '1000 MG', f: 'Tablet', q: '30 Tablets', p: 6.10 },
  { n: 'Amlodipine Besylate', gf: 'Norvasc', s: '5 MG', f: 'Tablet', q: '30 Tablets', p: 3.15 },
  { n: 'Amlodipine / Olmesartan', gf: 'Azor', s: '5-20 MG', f: 'Tablet', q: '30 Tablets', p: 28.40 },
];

// Names copied verbatim from the real Sep 3 2026 vendor export, which separates
// combination ingredients with HYPHENS and carries no price column. An earlier
// version of this suite only used slashes; the code passed those tests and still
// matched "amlodipine" to "Amlodipine-Olmesartan" against the real file.
const REAL_ROWS = [
  { n: 'Amlodipine Besylate', s: '10 MG', f: 'Tablet' },
  { n: 'Amlodipine Besylate-Benazepril Hcl', s: '5-10 MG', f: 'Capsule' },
  { n: 'Amlodipine Besylate-Valsartan', s: '5-160 MG', f: 'Tablet' },
  { n: 'Amlodipine-Olmesartan', s: '5-20 MG', f: 'Tablet' },
  { n: 'Amlodipine-Valsartan-Hydrochlorothiazide', s: '5-160-12.5 MG', f: 'Tablet' },
  { n: 'Olmesartan-Amlodipine-Hctz', s: '20-5-12.5 MG', f: 'Tablet' },
  { n: 'Metformin Hcl', s: '500 MG', f: 'Tablet' },
];

test('matches a plain generic name', () => {
  const hits = matchTeamCuban('metformin hcl', ROWS);
  assert.equal(hits.length, 2);
});

test('token-prefix match finds the fuller vendor name', () => {
  // Our lookups say "metformin"; their list says "Metformin Hcl".
  assert.equal(matchTeamCuban('metformin', ROWS).length, 2);
});

test('results are cheapest first', () => {
  const hits = matchTeamCuban('metformin', ROWS);
  assert.deepEqual(hits.map(h => h.p), [4.20, 6.10]);
});

test('matches on the brand it is generic for', () => {
  assert.equal(matchTeamCuban('Norvasc', ROWS)[0].n, 'Amlodipine Besylate');
});

test('punctuation and spacing differences still match', () => {
  // Their "Abacavir / Lamivudine" vs our "abacavir/lamivudine".
  assert.equal(matchTeamCuban('abacavir/lamivudine', ROWS).length, 1);
  assert.equal(matchTeamCuban('Abacavir / Lamivudine', ROWS).length, 1);
});

test('a single ingredient never matches a combination product', () => {
  // The safety case: amlodipine alone must NOT return the amlodipine/olmesartan
  // price. They are different medicines and quoting the wrong one at a counter
  // is a real harm, not a cosmetic bug.
  const hits = matchTeamCuban('amlodipine', ROWS);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].n, 'Amlodipine Besylate');
});

test('a combination never collapses to one component', () => {
  const hits = matchTeamCuban('amlodipine/olmesartan', ROWS);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].gf, 'Azor');
});

test('unknown drug returns nothing rather than a near miss', () => {
  assert.deepEqual(matchTeamCuban('atorvastatin', ROWS), []);
});

test('empty or missing input is handled', () => {
  assert.deepEqual(matchTeamCuban('', ROWS), []);
  assert.deepEqual(matchTeamCuban('metformin', []), []);
  assert.deepEqual(matchTeamCuban('metformin', null), []);
});

test('normalizeDrugName strips parenthetical noise', () => {
  assert.equal(normalizeDrugName('Acid Reducer (Generic For Pepcid Ac)'), 'acid reducer');
});

test('formatPrice renders money, not guesses', () => {
  assert.equal(formatPrice(4.2), '$4.20');
  assert.equal(formatPrice(undefined), '—');
  assert.equal(formatPrice(NaN), '—');
});

// ── Regression: real vendor data uses HYPHENS for combinations ───────────────
test('hyphenated combinations never match a single ingredient', () => {
  const hits = matchTeamCuban('amlodipine', REAL_ROWS);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].n, 'Amlodipine Besylate');
});

test('a two-ingredient query does not match a three-ingredient product', () => {
  assert.deepEqual(matchTeamCuban('amlodipine-valsartan', REAL_ROWS).map(h => h.n),
                   ['Amlodipine Besylate-Valsartan']);
});

test('slash and hyphen spellings of the same combination both resolve', () => {
  assert.equal(matchTeamCuban('amlodipine/olmesartan', REAL_ROWS)[0].n, 'Amlodipine-Olmesartan');
  assert.equal(matchTeamCuban('amlodipine-olmesartan', REAL_ROWS)[0].n, 'Amlodipine-Olmesartan');
});

test('ingredient order matters — a reordered combination is a different row', () => {
  // "Olmesartan-Amlodipine-Hctz" must not be returned for an amlodipine-first query.
  const hits = matchTeamCuban('amlodipine-olmesartan-hctz', REAL_ROWS);
  assert.deepEqual(hits.map(h => h.n), []);
});

test('salt suffixes are not treated as a second ingredient', () => {
  assert.equal(matchTeamCuban('metformin', REAL_ROWS)[0].n, 'Metformin Hcl');
});

test('rows without a price are still returned (coverage list has no prices)', () => {
  const hits = matchTeamCuban('metformin', REAL_ROWS);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].p, undefined);
});
