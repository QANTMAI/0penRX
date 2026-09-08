import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// sw.js says "Bump CACHE on any shell-asset change so old caches are evicted on
// activate." That instruction is easy to miss in review, and missing it means
// returning visitors keep a stale app.js for a visit. Worse, an asset that
// app.js imports but sw.js never precaches is unavailable offline. Both of
// those happened when assets/teamcuban.js was added, so they are gated here.

const APP = readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
const SW = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

// Both static `import x from './y.js'` and dynamic `import('./y.js')`.
function importedLocalModules(src) {
  const found = new Set();
  const patterns = [
    /from\s+['"]\.\/([A-Za-z0-9._-]+\.js)['"]/g,
    /import\(\s*['"]\.\/([A-Za-z0-9._-]+\.js)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) found.add(m[1]);
  }
  return [...found].sort();
}

test('every module app.js imports is precached by the service worker', () => {
  const modules = importedLocalModules(APP);
  assert.ok(modules.length > 0, 'expected app.js to import local modules');
  const missing = modules.filter(m => !SW.includes(`/assets/${m}`));
  assert.deepEqual(
    missing, [],
    `these modules are imported by app.js but absent from sw.js's precache list: ${missing.join(', ')}. ` +
    `Add them to ASSETS in sw.js and bump CACHE.`,
  );
});

test('the service worker cache version is a bumpable integer', () => {
  const m = SW.match(/const CACHE = 'openrx-shell-v(\d+)';/);
  assert.ok(m, "sw.js must declare CACHE as 'openrx-shell-v<N>'");
  assert.ok(Number(m[1]) > 0);
});
