# Test Plan — Search & Generic-Fallback Module

Goal: prevent search regressions as the generic catalog scales (92 curated drugs
today; fallback list growing to a top-20 data module per
`docs/PLAN_GENERIC_FALLBACKS.md`).
Framework: the repo's existing stack, nothing new — built-in **`node:test`**
(`test/*.test.mjs`, style of `test/live.test.mjs`), run by `node --test` in the
CI `frontend` job; browser integration via the documented preview-console
protocol. Zero npm dependencies is a hard constraint (no jsdom/Playwright), so
the split is: **pure logic → unit tests; DOM/vision → scripted browser
protocol**.

## Prerequisite refactor (30 min): make the logic importable

`assets/app.js` executes DOM code on import, so Node can't load it (this is
exactly why `live.js` exists as a pure module). Extract the search/fallback
decisions into **`assets/search-logic.js`** (no DOM, no state — same precedent
as `live.js`):

```js
// assets/search-logic.js
export function matchCatalog(q, catalog) { /* the filteredList() name/generic/
  category matching, parameterized: (q, catalog) -> matching entries */ }

export function classifyMiss(q, genericNames /* or aliasIndex later */) {
  // -> 'common-generic' | 'general'
}

export function emptyStateContent(q, kind, catalogCount, esc) {
  // -> { title, html } — the exact strings renderGrid injects
}
```

`app.js` imports these three and keeps only DOM wiring. `sw.js` SHELL gains
`/assets/search-logic.js` (+ CACHE bump). When the data module lands,
`classifyMiss` switches from an array to the precomputed `aliasIndex` without
its tests changing shape.

## The 5 essential test cases

### T1 (unit) — miss classification & the metformin edge cases
File: `test/search-logic.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCatalog, classifyMiss } from '../assets/search-logic.js';
import { CATALOG } from '../assets/catalog.js';

const GENERICS = ['metformin','lisinopril','atorvastatin','amlodipine','omeprazole',
  'losartan','albuterol','levothyroxine','sertraline','gabapentin'];

test('metformin NEVER reaches the fallback — catalog always wins', () => {
  // metformin is both a curated drug and a listed common generic; the curated
  // card must shadow the fallback.
  assert.ok(matchCatalog('metformin', CATALOG).length > 0);
});

test('metformin variants: case, whitespace, suffixed forms', () => {
  for (const q of ['Metformin', ' METFORMIN ', 'metformin hcl', 'metformin er'])
    assert.ok(matchCatalog(q.trim(), CATALOG).length > 0 ||
              classifyMiss(q.trim().toLowerCase(), GENERICS) === 'common-generic');
});

test('SCALING GUARD: no fallback name is shadow-broken by catalog growth', () => {
  // For every fallback generic: it either matches the catalog (fine — curated
  // card renders) or classifies as common-generic. It must never fall through
  // to the generic "isn't in the catalog" path. Run against the LIVE catalog
  // so adding drug #93 can never silently break a fallback.
  for (const g of GENERICS) {
    const inCatalog = matchCatalog(g, CATALOG).length > 0;
    const kind = classifyMiss(g, GENERICS);
    assert.ok(inCatalog || kind === 'common-generic', `dead end for: ${g}`);
  }
});

test('unknown strings classify general; prefixes match, substrings do not', () => {
  assert.equal(classifyMiss('xyzzyfake', GENERICS), 'general');
  assert.equal(classifyMiss('gabapentin 300mg', GENERICS), 'common-generic'); // "g + space"
  assert.equal(classifyMiss('pregabapentinoid', GENERICS), 'general');        // no substring hits
});
```

### T2 (unit) — empty-state content: links, safety lint, XSS escape
Same file.

```js
test('common-generic panel: 4 program links + guide anchor + location sentence', () => {
  const { title, html } = emptyStateContent('gabapentin', 'common-generic', 92, esc);
  assert.match(title, /common low-cost generic/);
  for (const href of ['walmart.com/cp/4-prescriptions/1078664', 'costplusdrugs.com',
                      'goodrx.com', 'pharmacy.amazon.com', '/uninsured-guide/#meds-only'])
    assert.ok(html.includes(href), href);
  assert.match(html, /Prices vary by pharmacy and location/);
});

test('claims lint: no SKU prices, no guarantees, hedges intact', () => {
  for (const kind of ['common-generic', 'general']) {
    const { html } = emptyStateContent('losartan', kind, 92, esc);
    assert.doesNotMatch(html, /\$\d+\.\d{2}/);        // no exact-cent promises
    assert.doesNotMatch(html, /guarantee|lowest price/i);
  }
});

test('XSS: query is escaped in the general panel', () => {
  const { html } = emptyStateContent('<img src=x onerror=alert(1)>', 'general', 92, esc);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
});
```

### T3 (integration/browser) — fallback panel injection when no results
Protocol: preview server + console script (paste in devtools or run via the
preview harness). PASS criteria are the returned booleans.

```js
// after load, privacy notice pre-acked:
const type = async q => { const i = document.getElementById('search');
  i.value = q; i.dispatchEvent(new Event('input', {bubbles: true}));
  await new Promise(r => setTimeout(r, 250)); };
await type('gabapentin');
({ tailored: /common low-cost generic/.test(emptyTitle.textContent),
   emptyVisible: !document.getElementById('empty').hidden });
await type('xyzzyfake');   // -> general title, panel still injected
await type('metformin');   // -> cards rendered, empty.hidden === true
await type('');            // -> full grid restored, count says "90 medications"
```
Also assert the results count (`#count`, `aria-live=polite`) updates on every
step — that's the screen-reader regression guard.

### T4 (integration/browser) — CTA navigation verification
For each of the 5 CTAs in the injected panel:
- `href` exactly matches the canonical URL table (unit-locked in T2);
- external links carry `target="_blank"` + `rel="noopener noreferrer"` + the
  auto-injected `(opens in new tab)` sr-only span;
- the internal guide link resolves and `#meds-only` exists on the target page;
- HTTP reachability is a **manual, dated check at PR review** (per
  PLAN_GENERIC_FALLBACKS acceptance criterion #3) — automated 403s from
  Cost Plus/GoodRx WAFs are expected and are NOT failures.

```js
[...document.querySelectorAll('#emptyMsg .empty-programs a')].map(a => ({
  href: a.getAttribute('href'),
  newTab: a.target === '_blank' ? a.rel.includes('noopener') && !!a.querySelector('.sr-only') : 'internal',
}));
```

### T5 (integration/browser) — mobile responsiveness rendering @ 375×812
With the viewport at 375×812 (preview resize or devtools device mode), after
`type('gabapentin')`:

```js
({ noHorizScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
   panelInViewport: document.getElementById('empty').getBoundingClientRect().width <= 375,
   linksWrap: (() => { const links = [...document.querySelectorAll('.empty-programs a')];
     return new Set(links.map(l => Math.round(l.getBoundingClientRect().top))).size >= 1; })(),
   tapTargets24px: [...document.querySelectorAll('.empty-programs a')]
     .every(a => a.getBoundingClientRect().height >= 24 ||
                 parseFloat(getComputedStyle(a).lineHeight) >= 24) });
```
Plus one screenshot at 375px and one at 1280px attached to the PR (matches the
repo's existing verification style). Repeat once in dark theme — the panel uses
`--text-2`/`--primary`, both contrast-verified tokens.

## Structure & CI wiring

```
test/
  live.test.mjs            (existing)
  search-logic.test.mjs    (T1 + T2 — new, ~12 asserts)
docs/
  TEST_PLAN_SEARCH_FALLBACK.md   (this file; T3–T5 protocol lives here)
```

- `node --test` auto-discovers `test/*.test.mjs` — **T1/T2 run in CI with zero
  workflow changes** the moment the file exists.
- T3–T5 are release-gate manual protocol (no DOM runner in a zero-dependency
  repo); each PR touching search/fallback pastes the three snippets' outputs
  into its description.
- When the `generic-fallbacks.json` module lands: T1's `GENERICS` import swaps
  to the generated `aliasIndex`, and one test is added asserting every alias in
  the index classifies `common-generic` — the scaling guard then covers data
  growth automatically.

## Why these five (regression coverage map)

| Case | Regression it blocks |
|---|---|
| T1 | Catalog growth shadow-breaking fallbacks; alias/prefix drift (metformin dual-status is the canary) |
| T2 | Unsafe claims creeping into copy; broken/renamed CTA URLs; XSS via search box |
| T3 | The injection wiring itself (state → DOM) breaking silently |
| T4 | Link-rot and lost accessibility attributes on CTAs |
| T5 | Mobile layout regressions as panel content grows with the top-20 |
