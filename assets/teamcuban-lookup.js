// Matching a user's drug query against the Team Cuban Card list.
//
// Kept as pure functions in their own module so the matching rules are unit
// tested (test/teamcuban.test.mjs) rather than only exercised through the DOM.

// Their names and ours disagree on punctuation and spacing for combinations:
// the site shows "Abacavir / Lamivudine" while our lookups produce
// "abacavir/lamivudine". Normalising both sides prevents a miss that would
// silently hide a real price from someone who needs it.
export function normalizeDrugName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')       // drop "(generic for x)" remnants
    // The vendor separates combination ingredients with EITHER "/" or "-"
    // ("Amlodipine-Olmesartan", "Amlodipine Besylate/Atorvastatin"), while our
    // own lookups use "/". Canonicalise both to "/" so ingredient COUNT is
    // comparable; getting this wrong is how "amlodipine" matched
    // "Amlodipine-Olmesartan" (verified against the real Sep 2026 list).
    .replace(/[-\u2010-\u2015]/g, '/')
    .replace(/[^a-z0-9/]+/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

// Ingredients of a normalised name. "amlodipine besylate" is ONE ingredient
// (besylate is a salt, not a second drug); "amlodipine/olmesartan" is two.
function ingredients(normalised) {
  return normalised.split('/').map(t => t.trim()).filter(Boolean);
}

// Whole-token prefix comparison for a single ingredient, so "metformin" finds
// "metformin hcl" but never a different molecule.
function ingredientMatches(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const x = a.split(' ');
  const y = b.split(' ');
  const shorter = x.length < y.length ? x : y;
  const longer = shorter === x ? y : x;
  return shorter.length > 0 && shorter.every((tok, i) => longer[i] === tok);
}

function namesMatch(query, candidate) {
  if (!query || !candidate) return false;
  const q = ingredients(query);
  const c = ingredients(candidate);
  // A single ingredient must never match a combination product, and vice versa.
  // Different medicine, different price -- quoting the wrong one at a pharmacy
  // counter is a real harm, not a cosmetic bug.
  if (q.length !== c.length) return false;
  return q.every((tok, i) => ingredientMatches(tok, c[i]));
}

/**
 * Rows from the Team Cuban list matching a generic name or a brand it is
 * generic for, cheapest first.
 */
export function matchTeamCuban(query, rows) {
  const q = normalizeDrugName(query);
  if (!q || !Array.isArray(rows)) return [];
  return rows
    .filter(r => namesMatch(q, normalizeDrugName(r.n)) ||
                 namesMatch(q, normalizeDrugName(r.gf)))
    .slice()
    .sort((a, b) => (a.p ?? Infinity) - (b.p ?? Infinity));
}

/** "$42.34" — plain, no rounding games. */
export function formatPrice(p) {
  return typeof p === 'number' && isFinite(p)
    ? '$' + p.toFixed(2)
    : '—';
}
