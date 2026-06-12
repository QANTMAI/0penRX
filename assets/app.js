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

// ---- Stat strip (derived from real catalog data) ---------------------------
function renderStats() {
  const maxSav = Math.max(...CATALOG.map(d => d.savings));
  const stats = [
    [CATALOG.length, 'Medications tracked'],
    [maxSav + '%', 'Max savings found'],
    [API_SOURCES.length, 'Data sources'],
    ['$0', 'Cost to search'],
  ];
  $('#stats').innerHTML = stats.map(([n, l]) =>
    `<div class="stat"><span class="stat-n">${esc(n)}</span><span class="stat-l">${esc(l)}</span></div>`).join('');
}

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

// ---- Browse grid -----------------------------------------------------------
const savClass = s => s >= 70 ? 'hi' : s >= 40 ? 'md' : 'lo';

function tagsFor(d) {
  const t = [];
  if (d.bin === '015995') t.push(['grx', 'GoodRx']);
  else if (d.bin === '601341') t.push(['grx', 'AbbVie Assist']);
  else if (d.bin === '610020') t.push(['grx', 'EMD Serono']);
  if (d.heroType === 'ExternalLinkRouting' && d.partner) t.push(['mfr', d.partner]);
  if (d.isGeneric) { t.push(['cpd', 'Cost Plus']); t.push(['amz', 'Amazon Rx']); }
  else t.push(['mfn', 'MFN price']);
  return t.map(([c, l]) => `<span class="tag ${c}">${esc(l)}</span>`).join('');
}

function cardHTML(d) {
  return `<article class="card" role="listitem" tabindex="0" data-slug="${esc(d.slug)}"
      aria-label="${esc(d.name)}, ${money(d.price)}, ${d.savings}% off">
    <div class="card-top">
      <div>
        <div class="card-name">${esc(d.name)}</div>
        <div class="card-gen">${esc(d.generic)}</div>
        <div class="card-co">${esc(d.company)}</div>
      </div>
      ${d.savings > 0 ? `<span class="badge ${savClass(d.savings)}">${d.savings}% off</span>` : ''}
    </div>
    <div>
      <div class="price-row"><span class="price">${money(d.price)}</span>${d.retail > d.price ? `<span class="price-was">${money(d.retail)}</span>` : ''}</div>
      <div class="price-lbl">${d.isGeneric ? 'est. cash-pay' : 'federal program price'} · reference</div>
    </div>
    <div class="tags">${tagsFor(d)}</div>
    <div class="card-foot">
      <button class="btn btn-pri" data-open="${esc(d.slug)}">View details</button>
      <a class="btn btn-sec" href="https://rxgov.hhs.gov/p/${esc(d.slug)}" target="_blank" rel="noopener">Official ↗</a>
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
  if (!list.length) { grid.innerHTML = ''; empty.hidden = false; return; }
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
function pcnFor(bin) { return bin === '015995' ? 'GDC' : bin === '601341' ? 'OHCP' : bin === '610020' ? 'PDMI' : '—'; }
function grpFor(bin) { return bin === '015995' ? 'MAHA' : bin === '601341' ? 'OH9013621' : bin === '610020' ? '99996218' : '—'; }

function couponBlock(d) {
  const ext = d.heroType === 'ExternalLinkRouting';
  if (!ext && d.bin) {
    const pcn = pcnFor(d.bin), grp = grpFor(d.bin), mem = d.bin === '015995' ? 'RXFINDER' : 'See Rx';
    return `<div class="coupon">
      <div class="coupon-t">Pharmacy coupon — cash-pay only, verify before use</div>
      <div class="cfields">
        <div class="cf"><div class="cf-l">BIN</div><div class="cf-v">${esc(d.bin)}</div></div>
        <div class="cf"><div class="cf-l">PCN</div><div class="cf-v">${esc(pcn)}</div></div>
        <div class="cf"><div class="cf-l">Group</div><div class="cf-v">${esc(grp)}</div></div>
        <div class="cf"><div class="cf-l">Member</div><div class="cf-v">${esc(mem)}</div></div>
      </div>
      <button class="copy-btn" data-copy="${esc(d.bin)}|${esc(pcn)}|${esc(grp)}|${esc(d.bin === '015995' ? 'RXFINDER' : 'N/A')}">📋 Copy coupon</button>
    </div>`;
  }
  if (ext && d.partner) {
    return `<div class="coupon">
      <div class="coupon-t">Manufacturer direct program</div>
      <p style="font-size:var(--t-sm);color:var(--text-2);margin-bottom:.6rem">${esc(d.partner)} manages this medication directly — eligibility and checkout on their site.</p>
      <a href="https://rxgov.hhs.gov/p/${esc(d.slug)}" target="_blank" rel="noopener" class="copy-btn" style="display:block;text-align:center;text-decoration:none">Continue to ${esc(d.partner)} →</a>
    </div>`;
  }
  return '';
}

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
      ${d.retail > d.price ? `<div><div class="p-hero-vs" style="color:var(--good);font-weight:700">${d.savings}% savings</div><div class="p-hero-vs">vs ${money(d.retail)} WAC list</div></div>` : ''}
    </div>

    <div class="label">Where to fill</div>
    ${!ext ? `<div class="row"><div class="row-l"><span class="row-tag mfn">MFN</span><div><div class="row-name">Federal MFN Program</div><div class="row-note">GoodRx coupon · BIN ${esc(d.bin || '015995')}</div></div></div><span class="row-price">${money(d.price)}</span></div>` : ''}
    ${d.isGeneric ? `
      <div class="row"><div class="row-l"><span class="row-tag cpd">CPD</span><div><div class="row-name">Cost Plus Drugs</div><div class="row-note">NADAC × 1.15 + $3</div></div></div><span class="row-price">${money(d.price)}</span></div>
      <a class="row" href="https://pharmacy.amazon.com" target="_blank" rel="noopener"><div class="row-l"><span class="row-tag amz">AMZ</span><div><div class="row-name">Amazon Pharmacy</div><div class="row-note">Prime Rx benefit — verify</div></div></div><span class="row-price" style="color:var(--text-2)">Check ↗</span></a>` : ''}

    ${couponBlock(d)}

    <div class="label">Live drug data <span class="live-badge">live</span></div>
    <div class="live-box" id="liveIdentity"><span class="spinner"></span> <span style="color:var(--text-2)">Looking up <strong>${esc(token || d.generic)}</strong> in RxNorm &amp; openFDA…</span></div>
    <div class="live-box" id="liveNadac"><span class="spinner"></span> <span style="color:var(--text-2)">Fetching CMS NADAC acquisition cost…</span></div>

    <div class="label">Safety &amp; supply <span class="live-badge">FDA</span></div>
    <div class="live-box" id="liveSafety"><span class="spinner"></span> <span style="color:var(--text-2)">Checking FDA shortages &amp; recalls…</span></div>

    <div class="p-acts">
      <a href="https://rxgov.hhs.gov/p/${esc(d.slug)}" target="_blank" rel="noopener" class="btn btn-pri">Official page ↗</a>
      <a href="https://www.goodrx.com/${esc(d.slug)}" target="_blank" rel="noopener" class="btn btn-sec">GoodRx ↗</a>
      <a href="https://www.costplusdrugs.com/medications/?search=${encodeURIComponent(d.generic)}" target="_blank" rel="noopener" class="btn btn-sec">Cost Plus ↗</a>
    </div>
    <div class="disclaimer-box">Cash-pay only. Reference prices and coupon codes — verify with the pharmacy before use. Do not combine with Medicare, Medicaid, or any government health program.</div>`;

  const ov = $('#overlay');
  ov.classList.add('open');
  $('#panel').scrollTop = 0;
  $('#panelBody [data-close]').focus();

  enrichLive(d, token);
}

// Fetch + inject the real RxNorm / openFDA / NADAC data.
async function enrichLive(d, token) {
  // Identity: RxNorm + openFDA in parallel.
  Promise.allSettled([live.getRxNorm(d.generic), live.getOpenFda(d.generic, d.name)])
    .then(([rx, fda]) => {
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
         <a class="src-link" href="${esc(src)}" target="_blank" rel="noopener">Source: ${fv ? 'openFDA NDC' : 'RxNorm'} ↗</a>`;
    });

  // NADAC: real acquisition cost + estimated cash price.
  live.getNadac(d.generic).then(n => {
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
      <a class="src-link" href="${esc(n.sourceUrl)}" target="_blank" rel="noopener">Source: CMS NADAC${n.via === 'backend' ? ' (via API)' : ''} ↗</a>`;
  });

  // FDA shortages + recalls (openFDA drug/shortages + drug/enforcement).
  Promise.allSettled([live.getDrugShortages(d.generic), live.getDrugRecalls(d.generic)])
    .then(([shRes, rcRes]) => {
      const el = $('#liveSafety'); if (!el) return;
      const sh = shRes.status === 'fulfilled' ? shRes.value : { records: [] };
      const rc = rcRes.status === 'fulfilled' ? rcRes.value : { records: [] };
      const fmtDate = s => s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : (s || '—');

      let html = '<div class="label" style="margin:0 0 .55rem">FDA shortages</div>';
      if (sh.records.length) {
        html += sh.records.slice(0, 3).map(r =>
          `<div class="row" style="margin-bottom:.3rem"><div class="row-l"><div><div class="row-name">⚠️ ${esc(r.status)}</div><div class="row-note">${esc(r.name)}${r.updated ? ` · updated ${esc(r.updated)}` : ''}</div></div></div></div>`).join('');
        html += `<a class="src-link" href="${esc(sh.sourceUrl)}" target="_blank" rel="noopener">Source: openFDA drug shortages ↗</a>`;
      } else {
        html += `<div class="live-note">No active FDA shortage reported for “${esc(token)}.”</div>`;
      }

      html += '<div class="label" style="margin:1rem 0 .55rem">Recent recalls</div>';
      if (rc.records.length) {
        html += rc.records.slice(0, 3).map(r =>
          `<div class="row" style="margin-bottom:.3rem"><div class="row-l"><div><div class="row-name">${esc(r.classification)} · ${esc(r.status)} <span style="color:var(--text-2);font-weight:400">(${fmtDate(r.date)})</span></div><div class="row-note">${esc((r.reason || '').slice(0, 120))}${(r.reason || '').length > 120 ? '…' : ''}${r.firm ? ` — ${esc(r.firm)}` : ''}</div></div></div></div>`).join('');
        html += `<a class="src-link" href="${esc(rc.sourceUrl)}" target="_blank" rel="noopener">Source: openFDA enforcement · ${rc.total} total ↗</a>`;
      } else {
        html += `<div class="live-note">No FDA recall records found for “${esc(token)}.”</div>`;
      }
      el.innerHTML = html;
    });
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
    <div class="label">Live drug data <span class="live-badge">live</span></div>
    <div class="live-box" id="liveIdentity"><span class="spinner"></span> <span style="color:var(--text-2)">Looking up <strong>${esc(clean)}</strong> in RxNorm &amp; openFDA…</span></div>
    <div class="live-box" id="liveNadac"><span class="spinner"></span> <span style="color:var(--text-2)">Fetching CMS NADAC acquisition cost…</span></div>
    <div class="label">Safety &amp; supply <span class="live-badge">FDA</span></div>
    <div class="live-box" id="liveSafety"><span class="spinner"></span> <span style="color:var(--text-2)">Checking FDA shortages &amp; recalls…</span></div>
    <div class="p-acts">
      <a href="https://www.goodrx.com/${esc(gslug)}" target="_blank" rel="noopener" class="btn btn-pri">GoodRx ↗</a>
      <a href="https://www.costplusdrugs.com/medications/?search=${encodeURIComponent(clean)}" target="_blank" rel="noopener" class="btn btn-sec">Cost Plus ↗</a>
    </div>
    <div class="disclaimer-box">Cash-pay reference data from public sources — verify with the pharmacy before use. Not medical advice.</div>`;
  const ov = $('#overlay');
  ov.classList.add('open');
  $('#panel').scrollTop = 0;
  $('#panelBody [data-close]').focus();
  enrichLive({ generic: clean, name: display }, token);
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
      <a class="src-url" href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.u)}</a>
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
const COUPONS = [
  { t: 'Federal Program — GoodRx Network', d: '70,000+ pharmacies · 600+ generics · avg ~70% off retail', bin: '015995', pcn: 'GDC', grp: 'MAHA', mem: 'RXFINDER' },
  { t: 'AbbVie myAbbVie Assist', d: 'Humira® $950 · Combigan® $10 · Alphagan® $45', bin: '601341', pcn: 'OHCP', grp: 'OH9013621', mem: 'See Rx label' },
  { t: 'EMD Serono Fertility', d: 'Gonal-F® $168 · Cetrotide® $22.50 · Ovidrel® $84', bin: '610020', pcn: 'PDMI', grp: '99996218', mem: 'See Rx label' },
];
function renderCoupons() {
  $('#couponList').innerHTML = COUPONS.map(c => `<div class="coupon" style="margin-top:0">
    <div class="coupon-t">${esc(c.t)} — ${esc(c.d)}</div>
    <div class="cfields">
      <div class="cf"><div class="cf-l">BIN</div><div class="cf-v">${esc(c.bin)}</div></div>
      <div class="cf"><div class="cf-l">PCN</div><div class="cf-v">${esc(c.pcn)}</div></div>
      <div class="cf"><div class="cf-l">Group</div><div class="cf-v">${esc(c.grp)}</div></div>
      <div class="cf"><div class="cf-l">Member</div><div class="cf-v">${esc(c.mem)}</div></div>
    </div>
    <button class="copy-btn" data-copy="${esc(c.bin)}|${esc(c.pcn)}|${esc(c.grp)}|${esc(c.mem)}">📋 Copy to clipboard</button>
  </div>`).join('');
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
  renderStats();
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
    if (pick) { const d = CATALOG.find(x => x.slug === pick.dataset.pick); input.value = d.name; state.q = d.name; sugg.classList.remove('vis'); renderGrid(); openDetail(pick.dataset.pick); return; }
    if (liveEl) { input.value = liveEl.dataset.live; state.q = liveEl.dataset.live; sugg.classList.remove('vis'); openLiveDetail(liveEl.dataset.live, liveEl.dataset.clean); return; }
    if (open) { const slug = open.dataset.open || open.dataset.slug; openDetail(slug); return; }
  });
  $('#grid').addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) { e.preventDefault(); openDetail(e.target.dataset.slug); }
  });
  $('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay') closeDetail(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });
}

document.addEventListener('DOMContentLoaded', init);
