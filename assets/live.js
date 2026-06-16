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
// CMS NADAC 2026 distribution. MAINTENANCE: CMS publishes a new yearly
// distribution id each year — update this (and data/ingest_nadac.py's
// NADAC_DISTRIBUTIONS map) at the year rollover or NADAC lookups go stale.
const NADAC_DIST = 'fbb83258-11c7-47f5-8b18-5f8e79f7e704';
const NADAC_BASE = `https://data.medicaid.gov/api/1/datastore/query/${NADAC_DIST}/0`;

// Optional backend base (connects the FastAPI /prices endpoint when hosted).
// Set window.OPENRX_API in assets/config.js — never override via URL param
// (that would let a crafted link point the site at an attacker-controlled host).
export const API_BASE = (() => {
  try { return window.OPENRX_API || null; } catch { return null; }
})();

// Optional openFDA API key for the elevated rate limit (240 req/min, 120k/day).
// openFDA returns 100% real data WITHOUT a key (lower daily cap); a key only
// raises limits. Set window.OPENFDA_KEY in assets/config.js so it stays out of
// browser history and referrer headers. Never set it via a URL parameter.
export const OPENFDA_KEY = (() => {
  try { return window.OPENFDA_KEY || null; } catch { return null; }
})();
function fdaUrl(qs) {
  return `${OPENFDA}?${qs}${OPENFDA_KEY ? `&api_key=${encodeURIComponent(OPENFDA_KEY)}` : ''}`;
}

const TIMEOUT = 9000;
const cache = new Map(); // url -> Promise<data> (the in-flight or settled request)

function fetchJSON(url, { timeout = TIMEOUT } = {}) {
  const hit = cache.get(url);
  if (hit) return hit;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const p = fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .finally(() => clearTimeout(timer));
  // Cache the PROMISE so concurrent identical requests share one network call;
  // drop it on failure so a transient error doesn't poison later lookups.
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

// Active moiety used to match NADAC's generic descriptions, e.g.
// "sitagliptin/metformin HCl" -> "SITAGLIPTIN", "atorvastatin calcium" -> "ATORVASTATIN".
export function searchToken(generic) {
  if (!generic) return '';
  // Keep digits (e.g. "5-aminosalicylic"), strip leading/trailing hyphens so a
  // numeric-prefixed moiety doesn't yield a "-AMINOSALICYLIC" token that misses.
  return generic.split(/[\/,\s]+/)[0]
    .replace(/[^a-z0-9-]/gi, '').replace(/^-+|-+$/g, '').toUpperCase();
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

// ---- RxTerms: drug-name autocomplete (any marketed drug) -------------------
// NLM Clinical Table Search Service. Returns clean display names like
// "metFORMIN (Oral Pill)". CORS-enabled. Used to search beyond the curated 88.
const RXTERMS = 'https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search';
export async function rxTermsSearch(query, max = 6) {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  const url = `${RXTERMS}?terms=${encodeURIComponent(q)}&maxList=${max}`;
  try {
    const data = await fetchJSON(url, { timeout: 6000 });
    const rows = Array.isArray(data) && Array.isArray(data[3]) ? data[3] : [];
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      const display = Array.isArray(r) ? r[0] : String(r);
      if (!display) continue;
      // Strip the trailing "(Oral Pill)"-style form qualifier for lookups.
      const clean = display.replace(/\s*\([^)]*\)\s*$/, '').trim();
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ display, clean });
    }
    return out;
  } catch {
    return [];
  }
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
      const data = await fetchJSON(fdaUrl(q));
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
    sourceUrl: 'https://data.medicaid.gov/datasets?keyword=nadac',
  };
}

export async function getNadac(generic) {
  const token = searchToken(generic);
  if (!token) return null;

  // Start the optional backend lookup concurrently and capture its result
  // off the critical path — we never await it directly, so a cold/empty
  // free-tier backend can't delay the authoritative CMS result below.
  let backendResult = null;
  if (API_BASE) {
    fetchJSON(`${API_BASE.replace(/\/$/, '')}/prices?drug=${encodeURIComponent(token)}&limit=50`)
      .then(data => {
        const rows = (data?.results || []).map(r => ({
          ndc_description: r.drug_name, nadac_per_unit: r.price_usd,
          pricing_unit: r.unit, ndc: r.ndc, effective_date: r.effective_date,
        }));
        const out = normalizeNadacRows(rows);
        if (out) { out.via = 'backend'; backendResult = out; }
      })
      .catch(() => { /* backend optional; CMS is authoritative */ });
  }

  // CMS NADAC is the authoritative, CORS-open source; query it directly.
  let cmsResult = null;
  const params = new URLSearchParams();
  params.append('conditions[0][property]', 'ndc_description');
  params.append('conditions[0][operator]', 'like');
  params.append('conditions[0][value]', `${token}%`);
  params.append('limit', '60');
  try {
    const data = await fetchJSON(`${NADAC_BASE}?${params.toString()}`, { timeout: 12000 });
    cmsResult = normalizeNadacRows(data?.results || []);
    if (cmsResult) cmsResult.via = 'cms';
  } catch {
    // Network/timeout/5xx — fail soft so the caller shows "unavailable",
    // never an unhandled rejection or a spinner that hangs forever.
  }

  // Prefer the backend only if it already returned data by the time CMS
  // settled (i.e. it was warm and useful — zero added latency either way).
  return backendResult || cmsResult;
}

// ---- Coupons / patient-assistance programs (backend only) ------------------
// Static GitHub Pages deploy has no backend (API_BASE is null), so this fails
// soft to null and the feature renders nothing. Only active when API_BASE is set.
export async function getCoupons(query) {
  if (!API_BASE) return null;                 // static deploy: feature off
  // Query by the catalog slug (unique, no ® so it substring-matches the backend's
  // drug_slug); off-catalog drugs pass a generic and simply match nothing.
  const q = (query || '').replace(/[®™]/g, '').trim();
  if (!q) return null;
  try {
    // 35s timeout tolerates a free-tier backend cold start (it can sleep after
    // idle and take ~30s to wake) so the first visitor still gets coupons.
    const data = await fetchJSON(`${API_BASE.replace(/\/$/, '')}/coupons?drug=${encodeURIComponent(q)}&limit=25`, { timeout: 35000 });
    return data?.results || [];
  } catch { return null; }                     // fail soft like getNadac
}

// Cost Plus Drugs-style estimate from a REAL NADAC per-unit cost:
// acquisition × quantity × 1.15 markup + $3 dispensing.  (Estimate, labeled as such.)
export function nadacEstimate(perUnit, qty = 30) {
  if (!Number.isFinite(perUnit)) return null;
  return Math.round((perUnit * qty * 1.15 + 3) * 100) / 100;
}

// ---- openFDA drug shortages (FDA shortage database) ------------------------
const OPENFDA_SHORTAGES = 'https://api.fda.gov/drug/shortages.json';
export async function getDrugShortages(generic) {
  const token = fdaToken(generic);
  if (!token) return { records: [] };
  try {
    const url = `${OPENFDA_SHORTAGES}?search=generic_name:${token}&limit=10${OPENFDA_KEY ? `&api_key=${encodeURIComponent(OPENFDA_KEY)}` : ''}`;
    const data = await fetchJSON(url);
    const records = (data?.results || []).map(r => ({
      name: r.generic_name || r.proprietary_name || token,
      status: r.status || '—',
      updated: r.update_date || r.initial_posting_date || null,
    }));
    return { records, total: data?.meta?.results?.total || records.length,
      sourceUrl: `${OPENFDA_SHORTAGES}?search=generic_name:${token}` };
  } catch {
    return { records: [] }; // openFDA returns 404 when there are no matches
  }
}

// ---- openFDA recalls / enforcement -----------------------------------------
const OPENFDA_ENFORCE = 'https://api.fda.gov/drug/enforcement.json';
export async function getDrugRecalls(generic) {
  const token = fdaToken(generic);
  if (!token) return { records: [] };
  try {
    const url = `${OPENFDA_ENFORCE}?search=product_description:${token}&sort=recall_initiation_date:desc&limit=5${OPENFDA_KEY ? `&api_key=${encodeURIComponent(OPENFDA_KEY)}` : ''}`;
    const data = await fetchJSON(url);
    const records = (data?.results || []).map(r => ({
      classification: r.classification || '—',
      status: r.status || '—',
      reason: r.reason_for_recall || '',
      firm: r.recalling_firm || '',
      date: r.recall_initiation_date || null,
    }));
    return { records, total: data?.meta?.results?.total || records.length,
      sourceUrl: `${OPENFDA_ENFORCE}?search=product_description:${token}&sort=recall_initiation_date:desc` };
  } catch {
    return { records: [] };
  }
}

// ---- openFDA FAERS adverse events (top reported reactions) -----------------
// IMPORTANT: FAERS is spontaneous, unverified reports. Counts reflect REPORTING
// VOLUME, not incidence and not causation. The UI must label it as such.
const OPENFDA_EVENT = 'https://api.fda.gov/drug/event.json';
export async function getAdverseEvents(generic) {
  const token = fdaToken(generic);
  if (!token) return { events: [] };
  try {
    const url = `${OPENFDA_EVENT}?search=patient.drug.openfda.generic_name:${token}&count=patient.reaction.reactionmeddrapt.exact${OPENFDA_KEY ? `&api_key=${encodeURIComponent(OPENFDA_KEY)}` : ''}`;
    const data = await fetchJSON(url);
    const events = (data?.results || []).slice(0, 6).map(r => ({ term: r.term, count: r.count }));
    return { events, sourceUrl: `${OPENFDA_EVENT}?search=patient.drug.openfda.generic_name:${token}` };
  } catch {
    return { events: [] }; // openFDA 404s when there are no matches
  }
}

// ---- openFDA label drug_interactions (narrative, NOT a pairwise checker) ----
export async function getLabelInteractions(generic, brand) {
  const g = fdaToken(generic), b = fdaToken(brand);
  const tries = [
    g && `search=openfda.generic_name:${g}&limit=1`,
    b && `search=openfda.brand_name:${b}&limit=1`,
  ].filter(Boolean);
  for (const q of tries) {
    try {
      const data = await fetchJSON(`https://api.fda.gov/drug/label.json?${q}${OPENFDA_KEY ? `&api_key=${encodeURIComponent(OPENFDA_KEY)}` : ''}`);
      const di = data?.results?.[0]?.drug_interactions;
      if (di && di.length) {
        const text = (Array.isArray(di) ? di.join(' ') : String(di)).replace(/\s+/g, ' ').trim();
        return { text, sourceUrl: `https://api.fda.gov/drug/label.json?${q.replace('&limit=1', '')}` };
      }
    } catch { /* try next */ }
  }
  return null;
}

// ---- Source liveness (for the Data Sources page) ---------------------------
// Only probes the three free APIs we actually call; others keep documented status.
// Uses representative queries and one retry so transient throttling (openFDA rate-
// limits unkeyed bursts) doesn't show a false "down".
const PROBES = {
  rxnorm: `${RXNORM}/version.json`,
  openfda: fdaUrl('search=generic_name:ibuprofen&limit=1'),
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
