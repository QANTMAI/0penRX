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
    .replace(/\(.*?\)/g, ' ')      // drop "(generic for x)" remnants
    .replace(/[^a-z0-9/]+/g, ' ')  // keep the combination slash
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

// A query matches a row when the normalised names are equal, or when one is a
// whole-token prefix of the other ("metformin" should find "metformin hcl").
// Substring matching is deliberately NOT used: "amlodipine" must not match
// "amlodipine/olmesartan", which is a different medicine at a different price.
function namesMatch(query, candidate) {
  if (!query || !candidate) return false;
  if (query === candidate) return true;
  const q = query.split(' ');
  const c = candidate.split(' ');
  const shorter = q.length < c.length ? q : c;
  const longer = shorter === q ? c : q;
  if (shorter.length === 0) return false;
  // Combination drugs must match on the full set, never on one component.
  if (query.includes('/') !== candidate.includes('/')) return false;
  return shorter.every((tok, i) => longer[i] === tok);
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
