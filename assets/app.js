// ============================================================
// 0penRX app — rendering, interactions, and live-data wiring.
// ============================================================
import { CATALOG, API_SOURCES } from './catalog.js';
import * as live from './live.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Number(n).toFixed(2);

const state = { q: '', cat: 'all', sort: 'savings', view: 'browse', sourcesInit: false };

// ---- Filter chips (distinct categories, by frequency) ----------------------
function renderFilters() {
  const counts = {};
  CATALOG.forEach(d => { counts[d.category] = (counts[d.category] || 0) + 1; });
  const cats = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const bar = $('#filterbar');
  bar.querySelectorAll('.chip').forEach(c => c.remove());
  const mk = (cat, label) => {
    const b = document.createElement('button');
    b.className = 'chip' + (state.cat === cat ? ' on' : '');
    b.dataset.cat = cat; b.textContent = label;
    b.addEventListener('click', () => { state.cat = cat; renderFilters(); renderGrid(); });
    bar.appendChild(b);
  };
  mk('all', 'All');
  cats.forEach(c => mk(c, c));
}

// ---- Reference links (the old federal rxgov.hhs.gov portal is offline) ------
// Per-drug authoritative reference: FDA DailyMed label search (verified live).
// Combination/verbose generics ("albuterol/budesonide", "levothyroxine sodium
// tablets") return zero DailyMed results; the bare brand name always resolves to
// the drug's own label — a single match 302-redirects straight to it, and a
// multi-match shows a results page scoped to the brand. We query the first brand
// token (strip ®/™ and any form/strength suffix). Verified ≥1 result for all 88.
const dailyMedQuery = d => d.name.replace(/[®™]/g, '').trim().split(/[\s(]/)[0];
const dailyMed = d =>
  `https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=${encodeURIComponent(dailyMedQuery(d))}`;

// GoodRx slug override → GoodRx uses bare drug slugs, so a few of our dosage-form
// slugs 404 there. Map only the slugs whose verified GoodRx page differs from ours
// (most dosage-form slugs, e.g. anoro-ellipta / invokamet-xr / premarin-vaginal-cream,
// DO exist on GoodRx and need no entry). Sources verified via web search, 2026-06.
const GOODRX_SLUG = {
  'humira-pen': 'humira',                  // goodrx.com/humira
  'humira-syringe': 'humira',              // goodrx.com/humira
  'orencia-sc': 'orencia',                 // goodrx.com/orencia
  'ozempic-pill': 'rybelsus',              // oral semaglutide → goodrx.com/rybelsus
  'premarin-vc': 'premarin-vaginal-cream', // goodrx.com/premarin-vaginal-cream
  'wegovy-pill': 'wegovy',                 // oral semaglutide (Wegovy) → goodrx.com/wegovy
  'zepbound-kwikpen': 'zepbound',          // goodrx.com/zepbound
};
const goodRxUrl = d => `https://www.goodrx.com/${GOODRX_SLUG[d.slug] || d.slug}`;
// Cost Plus Drugs has no URL-param search and no derivable per-product slug
// (products live at package-specific paths like /medications/<drug>-<strength>-
// <pack>-NN/). A `?search=` query is silently ignored — verified in-browser
// 2026-06 — so we link to the working medications search page rather than a
// param the site drops on the floor.
const COSTPLUS_URL = 'https://www.costplusdrugs.com/medications/';

// Manufacturer routing → each medication's OWN official manufacturer site, keyed
// by slug. Every URL below was verified to resolve (HTTP 200, except a few real
// brand domains that bot-block curl but serve in browsers: lillydirect.com,
// striverdi.com). This is the correct-manufacturer-for-the-correct-medication map.
const BRAND_URL = {
  // AstraZeneca
  airsupra: 'https://www.airsupra.com', bevespi: 'https://www.bevespi.com',
  farxiga: 'https://www.farxiga.com', xigduo: 'https://www.xigduo.com',
  // GSK (Ellipta)
  'anoro-ellipta': 'https://www.anoro.com', 'arnuity-ellipta': 'https://www.arnuity.com',
  'incruse-ellipta': 'https://www.incruse.com',
  // Eli Lilly (brand sites; LillyDirect for products without a consumer brand site)
  emgality: 'https://www.emgality.com', mounjaro: 'https://www.mounjaro.com',
  trulicity: 'https://www.trulicity.com', zepbound: 'https://www.zepbound.com',
  'zepbound-kwikpen': 'https://www.zepbound.com',
  foundayo: 'https://lillydirect.com', 'insulin-lispro': 'https://lillydirect.com',
  // Johnson & Johnson
  invokana: 'https://www.invokana.com', invokamet: 'https://www.invokamet.com',
  'invokamet-xr': 'https://www.invokamet.com', xarelto: 'https://www.xarelto-us.com',
  // Bristol Myers Squibb
  'orencia-sc': 'https://www.orencia.com', sotyktu: 'https://www.sotyktu.com',
  zeposia: 'https://www.zeposia.com',
  // Novartis
  mayzent: 'https://www.mayzent.com', rydapt: 'https://www.rydapt.com',
  tabrecta: 'https://www.tabrecta.com',
  // Sanofi
  admelog: 'https://www.admelog.com', apidra: 'https://www.apidra.com',
  lantus: 'https://www.lantus.com', toujeo: 'https://www.toujeo.com',
  'insulin-glargine': 'https://www.toujeo.com', merilog: 'https://www.merilog.com',
  // Boehringer Ingelheim
  'striverdi-respimat': 'https://www.striverdi.com',
  // AbbVie
  synthroid: 'https://www.synthroid.com',
};
// Verified manufacturer-program fallback (only if a slug is ever unmapped),
// then DailyMed as a last resort — never a government site or a web search.
// Keep in lockstep with data/build_coupons.py PARTNER_URL so the static site
// and the generated coupon dataset resolve a partner to the same destination
// (enforced in CI by data/tests/test_cross_language_consistency.py).
const PARTNER_URL = {
  'AstraZeneca Direct': 'https://www.azandmeapp.com',
  'Sanofi Patient Connection': 'https://www.sanofipatientconnection.com',
  'GSK For You': 'https://www.gskforyou.com',
  'J&J Direct': 'https://www.jnjwithme.com',
  'Bristol Myers Squibb': 'https://www.bmsaccesssupport.com',
  'Boehringer Ingelheim Cares': 'https://www.bicares.com',
  'LillyDirect®': 'https://lillydirect.com', 'Eli Lilly Direct': 'https://lillydirect.com',
  'Pfizer RxPathways': 'https://www.pfizerrxpathways.com',
  'Amgen Assist360': 'https://www.amgenassist360.com',
  'Novo Nordisk Savings Program': 'https://www.novocare.com',
  'Novartis Direct': 'https://www.us.novartis.com',
  'AbbVie Synthroid Savings': 'https://www.synthroid.com',
  'Merck Patient Assistance': 'https://www.merckhelps.com',
  'Genentech Patient Foundation': 'https://www.gene.com/patients/patient-foundation',
  // Manufacturer programs for drugs whose cards are NOT cash-pay coupons (see BIN_INFO).
  'AbbVie At Your Service': 'https://www.savewithays.com',
  'myAbbVie Assist': 'https://www.abbvie.com/patients/patient-support/patient-assistance.html',
  'EMD Serono Fertility Savings': 'https://www.fertilityinstantsavings.com',
};
const manufacturerUrl = d => BRAND_URL[d.slug] || PARTNER_URL[d.partner] || dailyMed(d);

// ---- Browse grid -----------------------------------------------------------
const savClass = s => s >= 70 ? 'hi' : s >= 40 ? 'md' : 'lo';
// Compute savings % from price and retail at render time so the badge stays
// accurate even if price is updated without manually recomputing the catalog field.
const savPct = d => d.retail > d.price ? Math.round((1 - d.price / d.retail) * 100) : 0;

function tagsFor(d) {
  const t = [];
  if (d.bin && binInfo(d.bin).tag) t.push(['grx', binInfo(d.bin).tag]);
  if (d.heroType === 'ExternalLinkRouting' && d.partner) t.push(['mfr', d.partner]);
  if (d.isGeneric) { t.push(['cpd', 'Cost Plus']); t.push(['amz', 'Amazon Rx']); }
  return t.map(([c, l]) => `<span class="tag ${c}">${esc(l)}</span>`).join('');
}

function cardHTML(d) {
  const pct = savPct(d);
  return `<article class="card" role="listitem" tabindex="0" data-slug="${esc(d.slug)}"
      aria-label="${esc(d.name)}, ${money(d.price)}, ${pct}% off">
    <div class="card-top">
      <div>
        <div class="card-name">${esc(d.name)}</div>
        <div class="card-gen">${esc(d.generic)}</div>
        <div class="card-co">${esc(d.company)}</div>
      </div>
      ${pct > 0 ? `<span class="badge ${savClass(pct)}">${pct}% off</span>` : ''}
    </div>
    <div>
      <div class="price-row"><span class="price">${money(d.price)}</span>${d.retail > d.price ? `<span class="price-was">${money(d.retail)}</span>` : ''}</div>
      <div class="price-lbl">${d.isGeneric ? 'est. cash-pay' : d.heroType === 'ExternalLinkRouting' ? 'manufacturer program' : 'GoodRx cash'} · reference</div>
    </div>
    <div class="tags">${tagsFor(d)}</div>
    <div class="card-foot">
      <button class="btn btn-pri" data-open="${esc(d.slug)}">View details</button>
      <a class="btn btn-sec" href="${esc(dailyMed(d))}" target="_blank" rel="noopener noreferrer">FDA label ↗</a>
    </div>
  </article>`;
}

function filteredList() {
  const q = state.q.toLowerCase();
  let list = CATALOG.filter(d => {
    const okCat = state.cat === 'all' || d.category === state.cat;
    const okQ = !q || d.name.toLowerCase().includes(q) || d.generic.toLowerCase().includes(q) ||
      d.company.toLowerCase().includes(q) || d.slug.includes(q);
    return okCat && okQ;
  });
  const s = state.sort;
  if (s === 'savings') list.sort((a, b) => b.savings - a.savings);
  else if (s === 'plo') list.sort((a, b) => a.price - b.price);
  else if (s === 'phi') list.sort((a, b) => b.price - a.price);
  else list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function renderGrid() {
  const list = filteredList();
  $('#count').textContent = `${list.length} medication${list.length !== 1 ? 's' : ''}`;
  const grid = $('#grid'), empty = $('#empty');
  if (!list.length) {
    grid.innerHTML = '';
    if (state.q) {
      $('#emptyTitle').textContent = `“${state.q}” isn't in the cash-price catalog`;
      $('#emptyMsg').innerHTML = `Only our ${CATALOG.length} featured drugs carry curated cash prices — but <strong>${esc(state.q)}</strong> is still searchable. Pick it under <em>“Any drug · live lookup”</em> in the search box above for live FDA data (NDC, real cost, shortages, recalls).`;
    } else {
      $('#emptyTitle').textContent = 'No results';
      $('#emptyMsg').textContent = 'Try a different filter.';
    }
    empty.hidden = false; return;
  }
  empty.hidden = true;
  grid.innerHTML = list.map(cardHTML).join('');
}

// ---- Autocomplete ----------------------------------------------------------
let liveSeq = 0, liveTimer = null;

function catalogMatches(q) {
  return CATALOG.filter(d =>
    d.name.toLowerCase().includes(q) || d.generic.toLowerCase().includes(q)).slice(0, 6);
}
function suggestCatalog(d) {
  return `<div class="si" role="option" data-pick="${esc(d.slug)}">
      <div class="si-main"><div class="si-name">${esc(d.name)}</div><div class="si-sub">${esc(d.generic)} · ${esc(d.company)}</div></div>
      <span class="si-price">${money(d.price)}</span></div>`;
}
function suggestLive(x) {
  return `<div class="si" role="option" data-live="${esc(x.display)}" data-clean="${esc(x.clean)}">
      <div class="si-main"><div class="si-name">${esc(x.display)}</div><div class="si-sub">Live lookup · RxNorm / openFDA / NADAC</div></div>
      <span class="sbadge gen">live</span></div>`;
}
function renderSuggestBox(cat, liveList) {
  const box = $('#sugg'), input = $('#search');
  let html = '';
  if (cat.length) html += `<div class="sugg-head">In catalog</div>` + cat.map(suggestCatalog).join('');
  if (liveList.length) html += `<div class="sugg-head">Any drug · live lookup</div>` + liveList.map(suggestLive).join('');
  if (!html) { box.classList.remove('vis'); input.setAttribute('aria-expanded', 'false'); return; }
  box.innerHTML = html; box.classList.add('vis'); input.setAttribute('aria-expanded', 'true');
}
function renderSuggest() {
  const q = state.q.toLowerCase();
  if (q.length < 2) {
    $('#sugg').classList.remove('vis'); $('#search').setAttribute('aria-expanded', 'false');
    clearTimeout(liveTimer); return;
  }
  renderSuggestBox(catalogMatches(q), []);  // instant catalog results
  clearTimeout(liveTimer);
  const seq = ++liveSeq;
  liveTimer = setTimeout(async () => {
    const results = await live.rxTermsSearch(state.q, 6);
    if (seq !== liveSeq) return;            // a newer keystroke superseded this
    const cat = catalogMatches(state.q.toLowerCase());
    const catKeys = new Set(cat.flatMap(d =>
      [d.name.toLowerCase(), d.generic.toLowerCase().split(/[\/,\s]+/)[0]]));
    const fresh = results.filter(x => !catKeys.has(x.clean.toLowerCase())).slice(0, 6);
    renderSuggestBox(cat, fresh);
  }, 280);
}

// ---- Detail panel ----------------------------------------------------------
// The ONLY pharmacy card we present as a cash-pay coupon: the universal GoodRx
// discount network, which any cash-paying / uninsured person can use with the
// same published BIN/PCN/Group/Member. Manufacturer programs (AbbVie "At Your
// Service" and Humira Complete are commercial-INSURANCE copay cards that
// exclude cash-payers; EMD Serono fertility is self-pay but per-patient) are
// NOT cash coupons — those drugs route to their official program page instead.
// Stays in lockstep with data/build_coupons.py BIN_MAP, enforced in CI by
// data/tests/test_cross_language_consistency.py. couponBlock, tagsFor and the
// Coupon Guide all derive from here.
// UNAVAILABLE is the honest fallback shown wherever a field has no verified value.
const UNAVAILABLE = 'None available at this time';
const BIN_INFO = {
  '015995': { pcn: 'GDC', group: 'MAHA', member: 'RXFINDER', tag: 'GoodRx' },
};
const binInfo = bin => BIN_INFO[bin] || { pcn: UNAVAILABLE, group: UNAVAILABLE, member: UNAVAILABLE, tag: '' };

// One coupon BIN/PCN/Group/Member grid renderer for all three call sites; an
// unavailable value is styled (and never reads as a real code).
const cfieldsHTML = pairs => `<div class="cfields">${pairs.map(([l, v]) =>
  `<div class="cf"><div class="cf-l">${l}</div><div class="cf-v${v === UNAVAILABLE ? ' na' : ''}">${esc(v)}</div></div>`).join('')}</div>`;

// Backend-sourced coupon / patient-assistance card (live data; backend only).
function couponCardHTML(c) {
  const hasCard = !!c.bin;
  const pcn = c.pcn || UNAVAILABLE, grp = c.group || UNAVAILABLE, mem = c.member_id || UNAVAILABLE;
  return `<div class="coupon" style="margin-top:0">
    <div class="coupon-t"><strong>${esc(c.program_name)}</strong>${c.program_type ? ` <span class="row-tag mfr">${esc(c.program_type)}</span>` : ''}</div>
    ${c.manufacturer ? `<p style="font-size:var(--t-sm);color:var(--text-2);margin-bottom:.6rem">${esc(c.manufacturer)}</p>` : ''}
    ${hasCard ? `${cfieldsHTML([['BIN', c.bin], ['PCN', pcn], ['Group', grp], ['Member', mem]])}
      <button class="copy-btn" data-copy="${esc(c.bin)}|${esc(pcn)}|${esc(grp)}|${esc(mem)}">📋 Copy coupon</button>` : ''}
    ${c.url ? `<a class="btn btn-sec" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Program site ↗</a>` : ''}
    ${c.state_restrictions?.length ? `<div class="live-note">Restricted in: ${esc(c.state_restrictions.join(', '))}</div>` : ''}
    ${c.expiration_date ? `<div class="row-note" style="margin-top:.4rem">Expires ${esc(c.expiration_date)}</div>` : ''}
  </div>`;
}

function couponBlock(d) {
  const ext = d.heroType === 'ExternalLinkRouting';
  if (!ext && d.bin) {
    const { pcn, group, member } = binInfo(d.bin);
    return `<div class="coupon">
      <div class="coupon-t">Pharmacy coupon — cash-pay only, verify before use</div>
      ${cfieldsHTML([['BIN', d.bin], ['PCN', pcn], ['Group', group], ['Member', member]])}
      <button class="copy-btn" data-copy="${esc(d.bin)}|${esc(pcn)}|${esc(group)}|${esc(member)}">📋 Copy coupon</button>
    </div>`;
  }
  if (ext && d.partner) {
    return `<div class="coupon">
      <div class="coupon-t">Manufacturer direct program</div>
      <p style="font-size:var(--t-sm);color:var(--text-2);margin-bottom:.6rem">${esc(d.partner)} manages this medication directly — eligibility and checkout on their site.</p>
      <a href="${esc(manufacturerUrl(d))}" target="_blank" rel="noopener noreferrer" class="copy-btn" style="display:block;text-align:center;text-decoration:none">Continue to ${esc(d.partner)} →</a>
    </div>`;
  }
  return '';
}

// Incremented on every panel open so enrichLive callbacks spawned for a
// previous drug no-op when they resolve after a new drug's panel is open.
let _panelGen = 0;
function openDetail(slug) {
  const d = CATALOG.find(x => x.slug === slug);
  if (!d) return;
  const ext = d.heroType === 'ExternalLinkRouting';
  const token = live.searchToken(d.generic) || live.searchToken(d.name);

  $('#panelBody').innerHTML = `
    <button class="panel-close" data-close aria-label="Close">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
    <div class="p-name">${esc(d.name)}</div>
    <div class="p-sub">${esc(d.generic)} · ${esc(d.company)} · ${esc(d.category)}</div>
    <div class="p-hero">
      <div><div class="p-big">${money(d.price)}</div><div class="p-hero-sub">${ext ? 'manufacturer direct' : 'federal program / cash-pay'} · reference</div></div>
      ${d.retail > d.price ? `<div><div class="p-hero-vs" style="color:var(--good);font-weight:700">${savPct(d)}% savings</div><div class="p-hero-vs">vs ${money(d.retail)} WAC list</div></div>` : ''}
    </div>

    ${((!ext && d.bin === '015995') || d.isGeneric) ? `<div class="label">Where to fill</div>` : ''}
    ${(!ext && d.bin === '015995') ? `<div class="row"><div class="row-l"><span class="row-tag grx">RX</span><div><div class="row-name">GoodRx cash-discount network</div><div class="row-note">cash coupon · BIN 015995</div></div></div><span class="row-price">${money(d.price)}</span></div>` : ''}
    ${d.isGeneric ? `
      <div class="row"><div class="row-l"><span class="row-tag cpd">CPD</span><div><div class="row-name">Cost Plus Drugs</div><div class="row-note">NADAC × 1.15 + $3</div></div></div><span class="row-price">${money(d.price)}</span></div>
      <a class="row" href="https://pharmacy.amazon.com" target="_blank" rel="noopener noreferrer"><div class="row-l"><span class="row-tag amz">AMZ</span><div><div class="row-name">Amazon Pharmacy</div><div class="row-note">Prime Rx benefit — verify</div></div></div><span class="row-price" style="color:var(--text-2)">Check ↗</span></a>` : ''}

    ${couponBlock(d)}

    ${live.API_BASE ? `<div class="label">Coupons &amp; assistance <span class="live-badge">programs</span></div><div class="live-box" id="liveCoupons"><span class="spinner"></span> <span style="color:var(--text-2)">Loading assistance programs… <span style="opacity:.7">(a few seconds if the server was idle)</span></span></div>` : ''}

    <div class="label">Live drug data <span class="live-badge">live</span></div>
    <div class="live-box" id="liveIdentity"><span class="spinner"></span> <span style="color:var(--text-2)">Looking up <strong>${esc(token || d.generic)}</strong> in RxNorm &amp; openFDA…</span></div>
    <div class="live-box" id="liveNadac"><span class="spinner"></span> <span style="color:var(--text-2)">Fetching CMS NADAC acquisition cost…</span></div>

    <div class="label">Safety &amp; supply <span class="live-badge">FDA</span></div>
    <div class="live-box" id="liveSafety"><span class="spinner"></span> <span style="color:var(--text-2)">Checking FDA shortages &amp; recalls…</span></div>

    <div class="label">Reported reactions <span class="live-badge">FAERS</span></div>
    <div class="live-box" id="liveFaers"><span class="spinner"></span> <span style="color:var(--text-2)">Querying FDA adverse-event reports…</span></div>

    <div class="label">Interactions <span class="live-badge">FDA label</span></div>
    <div class="live-box" id="liveInteractions"><span class="spinner"></span> <span style="color:var(--text-2)">Reading FDA label interactions…</span></div>

    <div class="p-acts">
      <a href="${esc(dailyMed(d))}" target="_blank" rel="noopener noreferrer" class="btn btn-pri">FDA label ↗</a>
      <a href="${esc(goodRxUrl(d))}" target="_blank" rel="noopener noreferrer" class="btn btn-sec">GoodRx ↗</a>
      <a href="${COSTPLUS_URL}" target="_blank" rel="noopener noreferrer" class="btn btn-sec" title="Search Cost Plus Drugs for ${esc(d.generic)}">Cost Plus ↗</a>
    </div>
    <div class="disclaimer-box">Cash-pay only. Reference prices and coupon codes — verify with the pharmacy before use. Do not combine with Medicare, Medicaid, or any government health program.</div>`;

  const ov = $('#overlay');
  ov.classList.add('open');
  $('#panel').scrollTop = 0;
  $('#panelBody [data-close]').focus();

  enrichLive(d, token, ++_panelGen);
}

// Fetch + inject the real RxNorm / openFDA / NADAC data.
// Intent prefetch: on press/focus of a card, warm the exact live calls the
// detail panel will make so opening it feels instant. Fire-and-forget — these
// live.* helpers fail soft (never reject) and fetchJSON dedups the in-flight
// promises, so the click handler reuses them at zero extra network cost.
const prefetched = new Set();
function prefetchDrug(slug) {
  if (prefetched.has(slug)) return;
  const d = CATALOG.find(x => x.slug === slug);
  if (!d) return;
  prefetched.add(slug);
  live.getRxNorm(d.generic);
  live.getOpenFda(d.generic, d.name);
  live.getNadac(d.generic);
  live.getDrugShortages(d.generic);
  live.getDrugRecalls(d.generic);
  live.getAdverseEvents(d.generic);
  live.getLabelInteractions(d.generic, d.name);
  live.getCoupons(d.slug || d.generic);
}

function enrichLive(d, token, gen) {
  // Abort if a newer panel has opened since this call was dispatched.
  const alive = () => _panelGen === gen;

  // Identity: RxNorm + openFDA in parallel.
  Promise.allSettled([live.getRxNorm(d.generic), live.getOpenFda(d.generic, d.name)])
    .then(([rx, fda]) => {
      if (!alive()) return;
      const el = $('#liveIdentity'); if (!el) return;
      const rxv = rx.status === 'fulfilled' ? rx.value : null;
      const fv = fda.status === 'fulfilled' ? fda.value : null;
      if (!rxv && !fv) {
        el.innerHTML = `<div class="live-err">No public RxNorm/openFDA record found for “${esc(token)}”.</div>`;
        return;
      }
      const rows = [];
      if (rxv) rows.push(['RxCUI', `${esc(rxv.rxcui)}`]);
      if (fv) {
        if (fv.labeler) rows.push(['Labeler', esc(fv.labeler)]);
        if (fv.dosageForm) rows.push(['Dosage form', esc(fv.dosageForm)]);
        if (fv.route) rows.push(['Route', esc(fv.route)]);
        if (fv.productNdc) rows.push(['Product NDC', `<span class="mono">${esc(fv.productNdc)}</span>`]);
        if (fv.activeIngredients?.length) rows.push(['Active', esc(fv.activeIngredients.join('; '))]);
      }
      const src = fv?.sourceUrl || rxv?.sourceUrl;
      el.innerHTML =
        `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
         <a class="src-link" href="${esc(src)}" target="_blank" rel="noopener noreferrer">Source: ${fv ? 'openFDA NDC' : 'RxNorm'} ↗</a>`;
    })
    .catch(() => { if (!alive()) return; const el = $('#liveIdentity'); if (el) el.innerHTML = `<div class="live-err">Identity lookup unavailable.</div>`; });

  // NADAC: real acquisition cost + estimated cash price.
  live.getNadac(d.generic).then(n => {
    if (!alive()) return;
    const el = $('#liveNadac'); if (!el) return;
    if (!n) {
      el.innerHTML = `<div class="live-err">No CMS NADAC record found for “${esc(token)}” (often the case for brand-only biologics).</div>`;
      return;
    }
    const est = live.nadacEstimate(n.perUnit, 30);
    el.innerHTML = `
      <div class="label" style="margin:0 0 .55rem">Generic acquisition cost (CMS NADAC)</div>
      <dl class="kv">
        <dt>Description</dt><dd>${esc(n.description)}</dd>
        <dt>NADAC / unit</dt><dd><strong>${money(n.perUnit)}</strong> per ${esc(n.unit || 'unit')}</dd>
        ${est != null ? `<dt>Est. 30-unit cash</dt><dd><strong>${money(est)}</strong> <span style="color:var(--text-2)">(NADAC×1.15+$3, estimate)</span></dd>` : ''}
        <dt>Effective</dt><dd>${esc(n.effectiveDate || '—')}</dd>
        <dt>NDC</dt><dd><span class="mono">${esc(n.ndc)}</span> · ${n.matches} match${n.matches !== 1 ? 'es' : ''}</dd>
      </dl>
      <a class="src-link" href="${esc(n.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source: CMS NADAC${n.via === 'backend' ? ' (via API)' : ''} ↗</a>`;
  })
    .catch(() => { if (!alive()) return; const el = $('#liveNadac'); if (el) el.innerHTML = `<div class="live-err">NADAC lookup unavailable.</div>`; });

  // FDA shortages + recalls (openFDA drug/shortages + drug/enforcement).
  Promise.allSettled([live.getDrugShortages(d.generic), live.getDrugRecalls(d.generic)])
    .then(([shRes, rcRes]) => {
      if (!alive()) return;
      const el = $('#liveSafety'); if (!el) return;
      const sh = shRes.status === 'fulfilled' ? shRes.value : { records: [] };
      const rc = rcRes.status === 'fulfilled' ? rcRes.value : { records: [] };
      const fmtDate = s => s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : (s || '—');

      let html = '<div class="label" style="margin:0 0 .55rem">FDA shortages</div>';
      if (sh.records.length) {
        html += sh.records.slice(0, 3).map(r =>
          `<div class="row" style="margin-bottom:.3rem"><div class="row-l"><div><div class="row-name">⚠️ ${esc(r.status)}</div><div class="row-note">${esc(r.name)}${r.updated ? ` · updated ${esc(r.updated)}` : ''}</div></div></div></div>`).join('');
        html += `<a class="src-link" href="${esc(sh.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source: openFDA drug shortages ↗</a>`;
      } else {
        html += `<div class="live-note">No active FDA shortage reported for “${esc(token)}.”</div>`;
      }

      html += '<div class="label" style="margin:1rem 0 .55rem">Recent recalls</div>';
      if (rc.records.length) {
        html += rc.records.slice(0, 3).map(r =>
          `<div class="row" style="margin-bottom:.3rem"><div class="row-l"><div><div class="row-name">${esc(r.classification)} · ${esc(r.status)} <span style="color:var(--text-2);font-weight:400">(${fmtDate(r.date)})</span></div><div class="row-note">${esc((r.reason || '').slice(0, 120))}${(r.reason || '').length > 120 ? '…' : ''}${r.firm ? ` — ${esc(r.firm)}` : ''}</div></div></div></div>`).join('');
        html += `<a class="src-link" href="${esc(rc.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source: openFDA enforcement · ${rc.total} total ↗</a>`;
      } else {
        html += `<div class="live-note">No FDA recall records found for “${esc(token)}.”</div>`;
      }
      el.innerHTML = html;
    })
    .catch(() => { if (!alive()) return; const el = $('#liveSafety'); if (el) el.innerHTML = `<div class="live-err">Safety lookup unavailable.</div>`; });

  // FAERS adverse events — top reported reactions (with the spontaneous-report caveat).
  live.getAdverseEvents(d.generic).then(ae => {
    if (!alive()) return;
    const el = $('#liveFaers'); if (!el) return;
    if (!ae.events.length) {
      el.innerHTML = `<div class="live-note">No FDA FAERS reports found for “${esc(token)}.”</div>`;
      return;
    }
    const max = ae.events[0].count || 1;
    el.innerHTML =
      ae.events.map(e =>
        `<div class="row" style="margin-bottom:.3rem"><div class="row-l" style="flex:1"><div style="flex:1"><div class="row-name">${esc(e.term)}</div>
           <div style="height:4px;border-radius:2px;background:var(--surface-3);margin-top:.3rem"><div style="height:100%;border-radius:2px;background:var(--primary);width:${Math.round((e.count / max) * 100)}%"></div></div></div></div>
         <span class="row-price" style="color:var(--text-2);font-weight:600">${e.count.toLocaleString()}</span></div>`).join('') +
      `<div class="live-note"><strong>Spontaneous FDA FAERS reports</strong> — counts reflect reporting volume and drug popularity, <strong>not incidence and not causation</strong>. Not medical advice.</div>` +
      `<a class="src-link" href="${esc(ae.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source: openFDA FAERS ↗</a>`;
  }).catch(() => { if (!alive()) return; const el = $('#liveFaers'); if (el) el.innerHTML = `<div class="live-err">Adverse-event lookup unavailable.</div>`; });

  // FDA label drug-interaction narrative (NOT a checked drug-pair result).
  live.getLabelInteractions(d.generic, d.name).then(di => {
    if (!alive()) return;
    const el = $('#liveInteractions'); if (!el) return;
    if (!di) {
      el.innerHTML = `<div class="live-note">No FDA-label interaction text found for “${esc(token)}.”</div>`;
      return;
    }
    const short = di.text.length > 420 ? di.text.slice(0, 420) + '…' : di.text;
    el.innerHTML =
      `<p style="font-size:var(--t-sm);line-height:1.55">${esc(short)}</p>
       <div class="live-note">From the <strong>FDA label</strong> — narrative text, <strong>not a checked drug-pair interaction</strong>. Verify with a pharmacist.</div>
       <a class="src-link" href="${esc(di.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source: openFDA label ↗</a>`;
  }).catch(() => { if (!alive()) return; const el = $('#liveInteractions'); if (el) el.innerHTML = `<div class="live-err">Interaction lookup unavailable.</div>`; });

  // Coupons / patient-assistance programs (backend only; getCoupons returns null
  // on the static deploy and the #liveCoupons box is never rendered, so this no-ops).
  live.getCoupons(d.slug || d.generic).then(list => {
    if (!alive()) return;
    const el = $('#liveCoupons'); if (!el) return;
    if (!list || !list.length) { el.remove(); return; }   // no coupons or feature off -> remove the box cleanly
    // Collapse identical program cards (a slug can match drug-form variants).
    const seen = new Set();
    const uniq = list.filter(c => { const k = `${c.program_name}|${c.bin}|${c.url}`; return seen.has(k) ? false : seen.add(k); });
    el.innerHTML = uniq.map(c => couponCardHTML(c)).join('') + `<div class="live-note">Reference only — verify each program before use. Manufacturer copay cards cannot be used with Medicare or Medicaid.</div>`;
  }).catch(() => { if (!alive()) return; const el = $('#liveCoupons'); if (el) el.remove(); });
}

// Detail panel for an off-catalog drug — no curated price, pure live data.
function openLiveDetail(display, clean) {
  const token = live.searchToken(clean) || clean.toUpperCase();
  const gslug = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  $('#panelBody').innerHTML = `
    <button class="panel-close" data-close aria-label="Close">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
    <div class="p-name">${esc(display)}</div>
    <div class="p-sub">Live lookup · RxNorm / openFDA / CMS NADAC</div>
    <div class="p-hero" style="background:var(--surface-2)">
      <div><div class="p-hero-sub" style="opacity:1;color:var(--text-2)">Not in the curated cash-pay catalog — showing sourced reference data below. Verify the final price at the pharmacy.</div></div>
    </div>
    ${live.API_BASE ? `<div class="label">Coupons &amp; assistance <span class="live-badge">programs</span></div><div class="live-box" id="liveCoupons"><span class="spinner"></span> <span style="color:var(--text-2)">Loading assistance programs… <span style="opacity:.7">(a few seconds if the server was idle)</span></span></div>` : ''}
    <div class="label">Live drug data <span class="live-badge">live</span></div>
    <div class="live-box" id="liveIdentity"><span class="spinner"></span> <span style="color:var(--text-2)">Looking up <strong>${esc(clean)}</strong> in RxNorm &amp; openFDA…</span></div>
    <div class="live-box" id="liveNadac"><span class="spinner"></span> <span style="color:var(--text-2)">Fetching CMS NADAC acquisition cost…</span></div>
    <div class="label">Safety &amp; supply <span class="live-badge">FDA</span></div>
    <div class="live-box" id="liveSafety"><span class="spinner"></span> <span style="color:var(--text-2)">Checking FDA shortages &amp; recalls…</span></div>
    <div class="label">Reported reactions <span class="live-badge">FAERS</span></div>
    <div class="live-box" id="liveFaers"><span class="spinner"></span> <span style="color:var(--text-2)">Querying FDA adverse-event reports…</span></div>
    <div class="label">Interactions <span class="live-badge">FDA label</span></div>
    <div class="live-box" id="liveInteractions"><span class="spinner"></span> <span style="color:var(--text-2)">Reading FDA label interactions…</span></div>
    <div class="p-acts">
      <a href="https://www.goodrx.com/${esc(gslug)}" target="_blank" rel="noopener noreferrer" class="btn btn-pri">GoodRx ↗</a>
      <a href="${COSTPLUS_URL}" target="_blank" rel="noopener noreferrer" class="btn btn-sec" title="Search Cost Plus Drugs for ${esc(clean)}">Cost Plus ↗</a>
    </div>
    <div class="disclaimer-box">Cash-pay reference data from public sources — verify with the pharmacy before use. Not medical advice.</div>`;
  const ov = $('#overlay');
  ov.classList.add('open');
  $('#panel').scrollTop = 0;
  $('#panelBody [data-close]').focus();
  enrichLive({ generic: clean, name: display }, token, ++_panelGen);
}

function closeDetail() { $('#overlay').classList.remove('open'); }

// ---- Data Sources view -----------------------------------------------------
const PROBE_KEY = { 'NLM RxNorm API': 'rxnorm', 'openFDA Drug NDC': 'openfda', 'CMS NADAC': 'nadac' };

function renderSources() {
  $('#srcGrid').innerHTML = API_SOURCES.map(s => {
    const probe = PROBE_KEY[s.n];
    const statusCls = s.s === 'f' ? 'f' : s.s === 'k' ? 'k' : 'a';
    return `<div class="src-card">
      <div class="src-name"><span class="dot" style="background:${esc(s.c)}"></span>${esc(s.n)}</div>
      <span class="src-status ${statusCls}">${esc(s.b)}</span>
      <div class="src-desc">${esc(s.d)}</div>
      ${probe ? `<div class="src-live checking" data-probe="${probe}"><span class="spinner"></span> checking…</div>` : ''}
      <a class="src-url" href="${esc(s.u)}" target="_blank" rel="noopener noreferrer">${esc(s.u)}</a>
    </div>`;
  }).join('');
  // Live reachability probes for the three APIs we actually call.
  $$('[data-probe]').forEach(async el => {
    const ok = await live.checkSource(el.dataset.probe);
    el.className = 'src-live ' + (ok ? 'ok' : 'down');
    el.innerHTML = ok ? '● live · reachable' : '● unreachable right now';
  });
}

// ---- Coupon Guide view -----------------------------------------------------
// Codes (pcn/group/member) are derived from BIN_INFO at render time, so this
// guide can never drift from what the per-drug detail panel shows.
const COUPONS = [
  { t: 'Cash-Pay Discount — GoodRx Network', d: 'No insurance needed · 70,000+ pharmacies · 600+ generics · avg ~70% off retail', bin: '015995' },
];
function renderCoupons() {
  $('#couponList').innerHTML = COUPONS.map(c => {
    const { pcn, group, member } = binInfo(c.bin);
    return `<div class="coupon" style="margin-top:0">
    <div class="coupon-t">${esc(c.t)} — ${esc(c.d)}</div>
    ${cfieldsHTML([['BIN', c.bin], ['PCN', pcn], ['Group', group], ['Member', member]])}
    <button class="copy-btn" data-copy="${esc(c.bin)}|${esc(pcn)}|${esc(group)}|${esc(member)}">📋 Copy to clipboard</button>
  </div>`;
  }).join('');
}

async function copyCoupon(spec, btn) {
  const [bin, pcn, grp, mem] = spec.split('|');
  const text = `BIN: ${bin}\nPCN: ${pcn}\nGroup: ${grp}\nMember: ${mem}`;
  const done = () => { const t = btn.textContent; btn.textContent = '✅ Copied!'; setTimeout(() => btn.textContent = t, 2000); };
  try { await navigator.clipboard.writeText(text); done(); }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text, style: 'position:fixed;opacity:0' });
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done();
  }
}

// ---- View switching --------------------------------------------------------
function setView(name) {
  state.view = name;
  $$('.ntab').forEach(t => t.classList.toggle('on', t.dataset.nav === name));
  $('.hero').hidden = name !== 'browse';
  $('#filterbar').hidden = name !== 'browse';
  $('#view-browse').hidden = name !== 'browse';
  $('#view-sources').hidden = name !== 'sources';
  $('#view-coupons').hidden = name !== 'coupons';
  if (name === 'sources' && !state.sourcesInit) { renderSources(); state.sourcesInit = true; }
  if (name === 'coupons' && !$('#couponList').children.length) renderCoupons();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- Theme -----------------------------------------------------------------
const SUN = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
const MOON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
function initTheme() {
  const btn = $('[data-theme-toggle]'), root = document.documentElement;
  let mode = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  const apply = () => { root.setAttribute('data-theme', mode); btn.innerHTML = mode === 'dark' ? SUN : MOON; };
  apply();
  btn.addEventListener('click', () => { mode = mode === 'dark' ? 'light' : 'dark'; apply(); });
}

// ---- Wiring ----------------------------------------------------------------
function init() {
  renderFilters();
  renderGrid();
  initTheme();

  const input = $('#search'), clear = $('#searchClear'), sugg = $('#sugg');
  input.addEventListener('input', () => {
    state.q = input.value.trim();
    clear.classList.toggle('vis', !!state.q);
    renderGrid(); renderSuggest();
  });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { input.value = ''; state.q = ''; clear.classList.remove('vis'); renderGrid(); sugg.classList.remove('vis'); } });
  clear.addEventListener('click', () => { input.value = ''; state.q = ''; clear.classList.remove('vis'); renderGrid(); sugg.classList.remove('vis'); input.focus(); });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) sugg.classList.remove('vis'); });

  $('#sort').addEventListener('change', e => { state.sort = e.target.value; renderGrid(); });

  // Event delegation for cards, suggestions, nav, copy, close.
  document.addEventListener('click', e => {
    const open = e.target.closest('[data-open]') || e.target.closest('.card');
    const pick = e.target.closest('[data-pick]');
    const liveEl = e.target.closest('[data-live]');
    const nav = e.target.closest('[data-nav]');
    const copy = e.target.closest('[data-copy]');
    if (e.target.closest('[data-close]')) { closeDetail(); return; }
    if (copy) { copyCoupon(copy.dataset.copy, copy); return; }
    if (nav) { e.preventDefault(); setView(nav.dataset.nav); return; }
    if (pick) { const d = CATALOG.find(x => x.slug === pick.dataset.pick); if (!d) return; input.value = d.name; state.q = d.name; sugg.classList.remove('vis'); renderGrid(); openDetail(pick.dataset.pick); return; }
    if (liveEl) { input.value = liveEl.dataset.live; state.q = liveEl.dataset.live; sugg.classList.remove('vis'); openLiveDetail(liveEl.dataset.live, liveEl.dataset.clean); return; }
    if (open) { const slug = open.dataset.open || open.dataset.slug; openDetail(slug); return; }
  });
  $('#grid').addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) { e.preventDefault(); openDetail(e.target.dataset.slug); }
  });
  $('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay') closeDetail(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

  // Warm a card's live data the instant the user signals intent (press or
  // keyboard focus), so the detail panel is already loading by the time it opens.
  document.addEventListener('pointerdown', e => {
    const card = e.target.closest?.('.card[data-slug]');
    if (card) prefetchDrug(card.dataset.slug);
  }, { passive: true });
  document.addEventListener('focusin', e => {
    const card = e.target.closest?.('.card[data-slug]');
    if (card) prefetchDrug(card.dataset.slug);
  });

  // Progressive Web App: instant repeat loads + offline shell + installable.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* SW is an enhancement */ });
    });
  }

  // Warm the Render backend so the first coupon lookup doesn't hit a cold start.
  // Fire-and-forget: the /health response is ignored; this just prevents the
  // free-tier container from being asleep when a user opens their first drug.
  if (live.API_BASE) {
    fetch(`${live.API_BASE.replace(/\/$/, '')}/health`, { mode: 'cors' }).catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
