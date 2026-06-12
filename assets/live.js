// ============================================================
// 0penRX live data layer — REAL public APIs, fetched client-side.
// All three endpoints send Access-Control-Allow-Origin: * so they
// work directly from the static site (no backend required).
//
//   RxNorm  (NLM)  — drug identity / RxCUI
//   openFDA (FDA)  — NDC, manufacturer (labeler), dosage form, route
//   NADAC   (CMS)  — real per-unit acquisition cost + effective date
//
// Optional: set window.OPENRX_API (or ?api=<base>) to route NADAC
// lookups through the repo's FastAPI /prices endpoint instead of CMS.
// ============================================================

const RXNORM = 'https://rxnav.nlm.nih.gov/REST';
const OPENFDA = 'https://api.fda.gov/drug/ndc.json';
const NADAC_DIST = 'fbb83258-11c7-47f5-8b18-5f8e79f7e704'; // CMS NADAC 2026 distribution
const NADAC_BASE = `https://data.medicaid.gov/api/1/datastore/query/${NADAC_DIST}/0`;

// Optional backend base (connects the FastAPI /prices endpoint when hosted).
export const API_BASE = (() => {
  try {
    const q = new URLSearchParams(location.search).get('api');
    return q || window.OPENRX_API || null;
  } catch { return null; }
})();

const TIMEOUT = 9000;
const cache = new Map();

async function fetchJSON(url, { timeout = TIMEOUT } = {}) {
  if (cache.has(url)) return cache.get(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cache.set(url, data);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// Active moiety used to match NADAC's generic descriptions, e.g.
// "sitagliptin/metformin HCl" -> "SITAGLIPTIN", "atorvastatin calcium" -> "ATORVASTATIN".
export function searchToken(generic) {
  if (!generic) return '';
  return generic.split(/[\/,\s]+/)[0].replace(/[^a-z-]/gi, '').toUpperCase();
}

// ---- RxNorm: drug identity --------------------------------------------------
export async function getRxNorm(name) {
  const url = `${RXNORM}/rxcui.json?name=${encodeURIComponent(name)}&search=2`;
  const data = await fetchJSON(url);
  const ids = data?.idGroup?.rxnormId;
  if (!ids || !ids.length) return null;
  const rxcui = ids[0];
  return {
    rxcui,
    name: data.idGroup.name || name,
    sourceUrl: `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${rxcui}`,
  };
}

// Bare ingredient/brand token for openFDA (its generic_name is the bare moiety,
// e.g. "atorvastatin" not "atorvastatin calcium"; brand "Ozempic® Pen" -> "ozempic").
function fdaToken(s) {
  if (!s) return '';
  return s.replace(/[®™]/g, '').split(/[\/,\s]+/)[0].replace(/[^a-z0-9-]/gi, '').toLowerCase();
}

// ---- openFDA: NDC + manufacturer (labeler) + dosage ------------------------
export async function getOpenFda(generic, brand) {
  const g = fdaToken(generic), b = fdaToken(brand);
  const tries = [];
  if (g) tries.push(`search=generic_name:${g}&limit=1`);
  if (b) tries.push(`search=brand_name:${b}&limit=1`);
  for (const q of tries) {
    try {
      const data = await fetchJSON(`${OPENFDA}?${q}`);
      const r = data?.results?.[0];
      if (!r) continue;
      return {
        brand: r.brand_name || null,
        generic: r.generic_name || null,
        labeler: r.labeler_name || null,
        dosageForm: r.dosage_form || null,
        route: Array.isArray(r.route) ? r.route.join(', ') : (r.route || null),
        productNdc: r.product_ndc || null,
        productType: r.product_type || null,
        activeIngredients: (r.active_ingredients || [])
          .map(a => `${a.name} ${a.strength || ''}`.trim()).slice(0, 4),
        sourceUrl: `https://api.fda.gov/drug/ndc.json?${q.replace('&limit=1', '')}`,
      };
    } catch { /* try next */ }
  }
  return null;
}

// ---- NADAC: real per-unit acquisition cost ---------------------------------
function normalizeNadacRows(rows) {
  const valid = rows
    .map(r => ({
      description: r.ndc_description,
      perUnit: parseFloat(r.nadac_per_unit),
      unit: r.pricing_unit,
      ndc: r.ndc,
      effectiveDate: r.effective_date,
      otc: r.otc,
    }))
    .filter(r => Number.isFinite(r.perUnit) && r.description);
  if (!valid.length) return null;
  // Most recent effective_date, then the lowest per-unit NDC within it.
  valid.sort((a, b) =>
    (b.effectiveDate || '').localeCompare(a.effectiveDate || '') || a.perUnit - b.perUnit);
  const top = valid[0];
  return {
    ...top,
    matches: valid.length,
    sourceUrl: 'https://data.medicaid.gov/dataset?keyword=nadac',
  };
}

export async function getNadac(generic) {
  const token = searchToken(generic);
  if (!token) return null;

  // Route through the FastAPI backend when configured.
  if (API_BASE) {
    try {
      const data = await fetchJSON(`${API_BASE.replace(/\/$/, '')}/prices?drug=${encodeURIComponent(token)}&limit=50`);
      const rows = (data?.results || []).map(r => ({
        ndc_description: r.drug_name, nadac_per_unit: r.price_usd,
        pricing_unit: r.unit, ndc: r.ndc, effective_date: r.effective_date,
      }));
      const out = normalizeNadacRows(rows);
      if (out) out.via = 'backend';
      return out;
    } catch { /* fall through to CMS direct */ }
  }

  const params = new URLSearchParams();
  params.append('conditions[0][property]', 'ndc_description');
  params.append('conditions[0][operator]', 'like');
  params.append('conditions[0][value]', `${token}%`);
  params.append('limit', '60');
  const data = await fetchJSON(`${NADAC_BASE}?${params.toString()}`, { timeout: 12000 });
  const out = normalizeNadacRows(data?.results || []);
  if (out) out.via = 'cms';
  return out;
}

// Cost Plus Drugs-style estimate from a REAL NADAC per-unit cost:
// acquisition × quantity × 1.15 markup + $3 dispensing.  (Estimate, labeled as such.)
export function nadacEstimate(perUnit, qty = 30) {
  if (!Number.isFinite(perUnit)) return null;
  return Math.round((perUnit * qty * 1.15 + 3) * 100) / 100;
}

// ---- Source liveness (for the Data Sources page) ---------------------------
// Only probes the three free APIs we actually call; others keep documented status.
// Uses representative queries and one retry so transient throttling (openFDA rate-
// limits unkeyed bursts) doesn't show a false "down".
const PROBES = {
  rxnorm: `${RXNORM}/version.json`,
  openfda: `${OPENFDA}?search=generic_name:ibuprofen&limit=1`,
  nadac: `${NADAC_BASE}?limit=1`,
};
export async function checkSource(key) {
  const url = PROBES[key];
  if (!url) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await fetchJSON(url, { timeout: 10000 });
      return true;
    } catch {
      if (attempt === 0) await new Promise(r => setTimeout(r, 800));
    }
  }
  return false;
}
