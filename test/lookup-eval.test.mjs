// Golden-set evaluation for the live-lookup entity-resolution pipeline.
//
// This applies the *ground-truth + evaluation* methodology from the data-
// labeling discipline (golden datasets, label accuracy, per-field metrics) to a
// deterministic pipeline: for each human/API-verified label in
// data/eval/lookup-goldens.jsonl, we run the pure functions in assets/live.js
// and check they reproduce the label. See data/eval/README.md for the schema,
// provenance rules, and how labels were verified.
//
// ANTI-CIRCULARITY: the `goodRxSlug` label is the slug that the REAL GoodRx page
// resolves to (HTTP-verified), NOT the output of the function under test — so a
// wrong algorithm fails against reality, not against itself. `fdaEstablishedName`
// is captured from openFDA, independent of any 0penRX code.
//
// Run: node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  splitIngredients,
  parseIngredients,
  goodRxComboSlug,
  goodRxMonoSlug,
  sameIngredientSet,
  descriptionHasAll,
  isOralOnlyDescription,
  isPillDescription,
  nonOralFormHint,
  oralPillFormHint,
} from '../assets/live.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDENS = readFileSync(join(HERE, '../data/eval/lookup-goldens.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((line, i) => {
    try { return JSON.parse(line); } catch (e) { throw new Error(`golden line ${i + 1}: ${e.message}`); }
  });

const NON_ORAL = new Set(['inhalation', 'injection', 'ophthalmic', 'nasal', 'otic', 'topical']);
const metrics = {};
const tally = (cat, ok) => {
  metrics[cat] ??= { pass: 0, total: 0 };
  metrics[cat].total++; if (ok) metrics[cat].pass++;
  return ok;
};

test('golden set loads and is non-trivial', () => {
  assert.ok(GOLDENS.length >= 10, `expected >=10 goldens, got ${GOLDENS.length}`);
});

// Label quality (the guide's "manual auditing / benchmark"): no label ships
// without provenance — a verification date and at least one source.
test('label quality — every golden carries provenance', () => {
  for (const g of GOLDENS) {
    const ok = !!g.provenance?.verifiedOn && Array.isArray(g.provenance?.sources) && g.provenance.sources.length > 0;
    tally('label-provenance', ok);
    assert.ok(ok, `${g.id}: missing provenance.verifiedOn/sources`);
  }
});

test('ingredient set — splitIngredients reproduces the labeled moieties', () => {
  for (const g of GOLDENS) {
    const got = splitIngredients(g.clean);
    const ok = got.length === g.ingredients.length && g.ingredients.every(x => got.includes(x));
    tally('ingredient-set', ok);
    assert.deepEqual(got, g.ingredients, `${g.id}: splitIngredients(${g.clean}) = ${JSON.stringify(got)}`);
  }
});

test('form class — non-oral vs oral-pill hints match the labeled route', () => {
  for (const g of GOLDENS) {
    const nonOral = nonOralFormHint(g.query);
    const okNonOral = nonOral === NON_ORAL.has(g.formClass);
    tally('form-class', okNonOral);
    assert.equal(nonOral, NON_ORAL.has(g.formClass), `${g.id}: nonOralFormHint(${g.query})=${nonOral}, formClass=${g.formClass}`);
    if (g.formClass === 'oral') {
      const okPill = oralPillFormHint(g.query) === true;
      tally('form-class', okPill);
      assert.ok(okPill, `${g.id}: oralPillFormHint(${g.query}) should be true`);
    }
  }
});

test('slug derivation — combo + mono slugs equal the REAL GoodRx page', () => {
  for (const g of GOLDENS) {
    if (g.isCombo) {
      const got = goodRxComboSlug(g.fdaEstablishedName);
      const ok = got === g.goodRxSlug;
      tally('slug-derivation', ok);
      assert.equal(got, g.goodRxSlug, `${g.id}: goodRxComboSlug("${g.fdaEstablishedName}")=${got}, real page=${g.goodRxSlug}`);
    } else {
      const gotMono = goodRxMonoSlug(g.clean);
      const okMono = gotMono === g.goodRxSlug;
      tally('slug-derivation', okMono);
      assert.equal(gotMono, g.goodRxSlug, `${g.id}: goodRxMonoSlug("${g.clean}")=${gotMono}, real page=${g.goodRxSlug}`);
      // A mono drug must NOT be treated as a combo (no false upgrade).
      const okNull = goodRxComboSlug(g.fdaEstablishedName) === null;
      tally('slug-derivation', okNull);
      assert.equal(goodRxComboSlug(g.fdaEstablishedName), null, `${g.id}: mono must not derive a combo slug`);
    }
  }
});

test('entity resolution — established name matches the query set; combo-trap rejected', () => {
  for (const g of GOLDENS) {
    if (g.brandResolved) {
      // Brands resolve via openFDA brand_name (getOpenFda brand try is
      // non-strict), so ingredient-set matching does NOT apply — the brand
      // token is mono and the brand match is trusted as-is.
      const ok = splitIngredients(g.clean).length === 1;
      tally('entity-resolution', ok);
      assert.ok(ok, `${g.id}: brand query should be a single token`);
      continue;
    }
    const ok = sameIngredientSet(g.fdaEstablishedName, g.clean) === true;
    tally('entity-resolution', ok);
    assert.ok(ok, `${g.id}: sameIngredientSet("${g.fdaEstablishedName}","${g.clean}") should be true`);
    if (g.comboTrap) {
      const okTrap = sameIngredientSet(g.comboTrap, g.clean) === false;
      tally('entity-resolution', okTrap);
      assert.ok(okTrap, `${g.id}: combo-trap "${g.comboTrap}" must be rejected for mono "${g.clean}"`);
    }
  }
});

test('NADAC matching — correct rows pass, wrong-drug/wrong-form rows are rejected', () => {
  for (const g of GOLDENS) {
    const prefixes = parseIngredients(g.clean);
    if (g.nadacCorrect) {
      const ok = descriptionHasAll(g.nadacCorrect, prefixes) === true;
      tally('nadac-matching', ok);
      assert.ok(ok, `${g.id}: correct NADAC "${g.nadacCorrect}" should contain all ingredients`);
    }
    if (g.nadacWrong) {
      // Rejected either by ingredient set (combo) or by wrong form (oral vs non-oral).
      const rejectedByIngredients = g.isCombo && descriptionHasAll(g.nadacWrong, prefixes) === false;
      const rejectedByForm = NON_ORAL.has(g.formClass) && isOralOnlyDescription(g.nadacWrong) === true;
      const ok = rejectedByIngredients || rejectedByForm;
      tally('nadac-matching', ok);
      assert.ok(ok, `${g.id}: wrong NADAC "${g.nadacWrong}" should be rejected`);
    }
    if (g.nadacPill) {
      const ok = isPillDescription(g.nadacPill) === true;
      tally('nadac-matching', ok);
      assert.ok(ok, `${g.id}: pill NADAC "${g.nadacPill}" should be a solid oral form`);
    }
  }
});

// Not a pass/fail gate — prints the evaluation report (label accuracy per field).
test('METRICS — label-accuracy report', () => {
  const rows = Object.entries(metrics).sort();
  const totalPass = rows.reduce((s, [, m]) => s + m.pass, 0);
  const totalAll = rows.reduce((s, [, m]) => s + m.total, 0);
  const lines = [
    '',
    `  ┌─ 0penRX lookup golden-set eval — ${GOLDENS.length} goldens, ${totalAll} labeled assertions`,
    ...rows.map(([cat, m]) =>
      `  │  ${cat.padEnd(20)} ${String(m.pass).padStart(3)}/${String(m.total).padEnd(3)} = ${(100 * m.pass / m.total).toFixed(1)}%`),
    `  └─ overall label accuracy: ${totalPass}/${totalAll} = ${(100 * totalPass / totalAll).toFixed(1)}%`,
    '',
  ];
  console.log(lines.join('\n'));
  assert.equal(totalPass, totalAll, 'every labeled assertion must pass');
});
