// ============================================================
// 0penRX app — rendering, interactions, and live-data wiring.
// ============================================================
import { CATALOG, API_SOURCES } from './catalog.js';
import * as live from './live.js';
import { validateCatalog } from './catalog-validator.js';
validateCatalog(CATALOG);

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
    b.setAttribute('aria-pressed', state.cat === cat ? 'true' : 'false');
    b.dataset.cat = cat; b.textContent = label;
    // Update the active chip in place (no rebuild) so the scroll position is kept.
    b.addEventListener('click', () => { state.cat = cat; updateFilterActive(); renderGrid(); });
    bar.appendChild(b);
  };
  mk('all', 'All');
  cats.forEach(c => mk(c, c));
}

// Reflect the active category on the existing chips and scroll it into view.
function updateFilterActive() {
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('#filterbar').querySelectorAll('.chip').forEach(c => {
    const on = c.dataset.cat === state.cat;
    c.classList.toggle('on', on);
    c.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) c.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
  });
}

// Scroll-strip affordances: fade edges + arrow buttons appear only on the side
// with more to scroll; arrows page the strip for mouse users (touch/keyboard
// scroll natively). A ResizeObserver keeps state correct across view switches.
function setupFilterStrip() {
  const track = $('#filterbar'), prev = $('#fsPrev'), next = $('#fsNext');
  if (!track || !prev || !next) return;
  const update = () => {
    const max = track.scrollWidth - track.clientWidth;
    const noScroll = max <= 1, atStart = track.scrollLeft <= 1, atEnd = track.scrollLeft >= max - 1;
    track.classList.toggle('at-start', noScroll || atStart);
    track.classList.toggle('at-end', noScroll || atEnd);
    prev.hidden = noScroll || atStart;
    next.hidden = noScroll || atEnd;
  };
  const page = dir => track.scrollBy({ left: dir * Math.round(track.clientWidth * 0.7),
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  prev.addEventListener('click', () => page(-1));
  next.addEventListener('click', () => page(1));
  track.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(track);
  track.scrollLeft = 0; // some engines render an overflowing flex item scrolled to the end on first layout
  update();
}

// ---- Reference links (the old federal rxgov.hhs.gov portal is offline) ------
// Per-drug authoritative reference: FDA DailyMed label search (verified live).
// Combination/verbose generics ("albuterol/budesonide", "levothyroxine sodium
// tablets") return zero DailyMed results; the bare brand name always resolves to
// the drug's own label — a single match 302-redirects straight to it, and a
// multi-match shows a results page scoped to the brand. We query the first brand
// token (strip ®/™ and any form/strength suffix). Verified ≥1 result for all 88 at the 2026-06 audit.
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
  'premarin-vc': 'premarin-vaginal-cream', // goodrx.com/premarin-vaginal-cream
  'zepbound-kwikpen': 'zepbound',          // goodrx.com/zepbound
};
const goodRxUrl = d => `https://www.goodrx.com/${GOODRX_SLUG[d.slug] || d.slug}`;
// Cost Plus Drugs has no URL-param search and no derivable per-product slug
// (products live at package-specific paths like /medications/<drug>-<strength>-
// <pack>-NN/). A `?search=` query is silently ignored — verified in-browser
// 2026-06, re-checked 2026-07-08 (CDN 403s every automated fetch; the site's
// search is client-side filter-as-you-type with no URL sync) — so we link to the
// working medications search page and the tooltip says "look up", not "search
// results for", to avoid implying a pre-filtered deep link.
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
  // ── AstraZeneca ─────────────────────────────────────────────────────────
  'AZ&Me': 'https://www.azandmeapp.com',
  'AstraZeneca Direct': 'https://www.azandmeapp.com',       // legacy alias
  // ── Sanofi ──────────────────────────────────────────────────────────────
  'Sanofi Patient Connection': 'https://www.sanofipatientconnection.com',
  // ── GSK ─────────────────────────────────────────────────────────────────
  'GSK For You': 'https://www.gskforyou.com',
  // ── Johnson & Johnson ────────────────────────────────────────────────────
  'J&J withMe Savings Program': 'https://www.jnjwithme.com',
  'J&J Direct': 'https://www.jnjwithme.com',                // legacy alias
  // ── Bristol Myers Squibb ─────────────────────────────────────────────────
  'BMS Patient Connect': 'https://www.bmspatientconnect.com',
  'Bristol Myers Squibb': 'https://www.bmsaccesssupport.com', // legacy alias
  // ── Boehringer Ingelheim ─────────────────────────────────────────────────
  'BI Savings Card': 'https://www.boehringer-ingelheim.com/us/patient-support',
  'Boehringer Ingelheim Cares': 'https://www.bicares.com',   // legacy alias (free PAP)
  // ── Eli Lilly ────────────────────────────────────────────────────────────
  'LillyDirect®': 'https://lillydirect.com',
  'LillyDirect': 'https://lillydirect.com',
  // ── Pfizer ──────────────────────────────────────────────────────────────
  'Pfizer RxPathways': 'https://www.pfizerrxpathways.com',
  // ── Amgen ────────────────────────────────────────────────────────────────
  'Amgen SupportPlus': 'https://www.amgensupportplus.com',
  'AmgenNow': 'https://www.amgennow.com',
  'Amgen Assist360': 'https://www.amgenassist360.com',       // legacy alias
  // ── Novo Nordisk ─────────────────────────────────────────────────────────
  'Novo Nordisk Savings Program': 'https://www.novocare.com',
  // ── Novartis ─────────────────────────────────────────────────────────────
  'Alongside MAYZENT': 'https://www.mayzent.com/support',
  'Novartis Oncology Universal Co-pay': 'https://www.novartisoncologysupport.com',
  'Novartis Direct': 'https://www.us.novartis.com',          // legacy alias
  // ── AbbVie ──────────────────────────────────────────────────────────────
  'Synthroid Delivers Program': 'https://www.synthroid.com/savings',
  'AbbVie Synthroid Savings': 'https://www.synthroid.com',   // legacy alias
  'AbbVie At Your Service': 'https://www.savewithays.com',
  'myAbbVie Assist': 'https://www.abbvie.com/patients/patient-support/patient-assistance.html',
  // ── Merck ────────────────────────────────────────────────────────────────
  'MerckHelps': 'https://www.merckhelps.com',
  'Merck Patient Assistance': 'https://www.merckhelps.com',  // legacy alias
  // ── EMD Serono ───────────────────────────────────────────────────────────
  'Fertility Instant Savings Program': 'https://www.fertilityinstantsavings.com',
  'EMD Serono Fertility Savings': 'https://www.fertilityinstantsavings.com', // legacy alias
  // ── Genentech ────────────────────────────────────────────────────────────
  'Genentech Direct-to-Patient': 'https://www.gene.com/patients',
  'Genentech Patient Foundation': 'https://www.gene.com/patients/patient-foundation', // legacy
  // ── Pfizer (additional programs) ─────────────────────────────────────────
  'Amgen Assist360 / Pfizer': 'https://www.amgenassist360.com',
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
  return t.map(([c, l]) => `<span class="tag ${c}">${esc(l)}</span>`).join('');
}

function cardHTML(d) {
  const pct = savPct(d);
  // The price shown is a starting/introductory dose — higher doses cost more.
  const startingDose = !!d.priceNote && /starting dose|introductory|first \d+ fills|intro price/i.test(d.priceNote);
  return `<article class="card" data-slug="${esc(d.slug)}">
    <div class="card-top">
      <div>
        <div class="card-name">${esc(d.name)}</div>
        <div class="card-gen">${esc(d.generic)}</div>
        <div class="card-co">${esc(d.company)}</div>
      </div>
      ${d.status === 'archived' ? `<span class="badge lo">Archived</span>`
        : d.priceBasis === 'medicare-negotiated' ? `<span class="badge lo">Medicare price</span>`
        : d.eligibility === 'insured-only' ? `<span class="badge lo">Insurance only</span>`
        : d.eligibility === 'medicare-only' ? `<span class="badge lo">Medicare only</span>`
        : pct > 0 ? `<span class="badge ${savClass(pct)}">${pct}% off</span>` : ''}
    </div>
    <div>
      <div class="price-row"><span class="price">${money(d.price)}</span>${d.retail > d.price ? `<span class="price-was">${money(d.retail)}</span>` : ''}</div>
      <div class="price-lbl">${d.heroType === 'ExternalLinkRouting' ? 'manufacturer program' : 'GoodRx cash'} · reference</div>
      ${startingDose ? `<div class="price-lbl" style="color:var(--gold)">starting dose — higher doses cost more</div>` : ''}
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
  const cmp = s === 'savings' ? (a, b) => b.savings - a.savings
    : s === 'plo' ? (a, b) => a.price - b.price
    : s === 'phi' ? (a, b) => b.price - a.price
    : (a, b) => a.name.localeCompare(b.name);
  // Archived drugs (no longer sold) always sink to the bottom, whatever the sort,
  // so a stale entry can't top the highest-savings list.
  const arch = d => (d.status === 'archived' ? 1 : 0);
  list.sort((a, b) => arch(a) - arch(b) || cmp(a, b));
  return list;
}

function renderGrid() {
  const list = filteredList();
  $('#count').textContent = `${list.length} medication${list.length !== 1 ? 's' : ''}`;
  const grid = $('#grid'), empty = $('#empty');
  if (!list.length) {
    grid.innerHTML = '';
    if (state.q) {
      // Widely-prescribed generics that aren't in the curated catalog: instead of
      // a generic miss, tell the user plainly that these are exactly the drugs the
      // low-cost programs are built for. Names only — no prices are asserted.
      const COMMON_GENERICS = ['metformin', 'lisinopril', 'atorvastatin', 'amlodipine', 'omeprazole',
        'losartan', 'albuterol', 'levothyroxine', 'sertraline', 'gabapentin'];
      const qNorm = state.q.trim().toLowerCase();
      const isCommonGeneric = COMMON_GENERICS.some(g => qNorm === g || qNorm.startsWith(g + ' '));
      const programLinks = `<a href="https://www.walmart.com/cp/4-prescriptions/1078664" target="_blank" rel="noopener noreferrer">Walmart's $4/$10 list</a>,
        <a href="https://www.costplusdrugs.com" target="_blank" rel="noopener noreferrer">Cost Plus Drugs</a>,
        <a href="https://www.goodrx.com" target="_blank" rel="noopener noreferrer">GoodRx</a>, or
        <a href="https://pharmacy.amazon.com" target="_blank" rel="noopener noreferrer">Amazon Pharmacy</a> —
        and see the <a href="/uninsured-guide/#meds-only">medication programs compared</a>. Prices vary by pharmacy and location.`;
      if (isCommonGeneric) {
        $('#emptyTitle').textContent = `“${state.q}” is a common low-cost generic`;
        $('#emptyMsg').innerHTML = `It isn't in our curated catalog, but widely-prescribed generics like this are usually inexpensive without insurance. Pick it under <em>“Any drug · live lookup”</em> in the search box above for live FDA data (NDC, acquisition cost, shortages, recalls).
          <span class="empty-programs">Then check the low-cost programs built for exactly these drugs:
          ${programLinks}</span>`;
      } else {
        $('#emptyTitle').textContent = `“${state.q}” isn't in the cash-price catalog`;
        // Not a dead end: point to live lookup AND the low-cost generic programs —
        // common generics are exactly where the walk-in/mail programs shine.
        $('#emptyMsg').innerHTML = `Only our ${CATALOG.length} featured drugs carry curated cash prices — but <strong>${esc(state.q)}</strong> is still searchable. Pick it under <em>“Any drug · live lookup”</em> in the search box above for live FDA data (NDC, real cost, shortages, recalls).
          <span class="empty-programs">If it's a common generic, it may also be on a low-cost program — check
          ${programLinks}</span>`;
      }
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
  // Word-boundary match first: a token in the name or generic must START WITH q.
  // This prevents mid-word suffix hits (e.g. "lip" matching "El-lip-ta").
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRe = new RegExp('(?:^|[\\s®™/,\\-])' + safe, 'i');
  const wordHits = CATALOG.filter(d => wordRe.test(d.name) || wordRe.test(d.generic));
  // Put name-match entries before generic-only matches
  wordHits.sort((a, b) => (wordRe.test(a.name) ? 0 : 1) - (wordRe.test(b.name) ? 0 : 1));
  return wordHits.slice(0, 6);
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
// ARIA combobox state (WCAG 2.1.1 / 4.1.2): the visually-highlighted option is
// tracked here and conveyed to AT via aria-activedescendant on the input.
let suggIdx = -1;
function closeSugg() {
  const box = $('#sugg'), input = $('#search');
  if (!box || !input) return;
  box.classList.remove('vis');
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  suggIdx = -1;
}
function moveSugg(delta) {
  const box = $('#sugg'), input = $('#search');
  const opts = [...box.querySelectorAll('.si')];
  if (!opts.length) return;
  if (suggIdx >= 0 && opts[suggIdx]) { opts[suggIdx].classList.remove('active'); opts[suggIdx].setAttribute('aria-selected', 'false'); }
  suggIdx = (suggIdx + delta + opts.length) % opts.length;
  const el = opts[suggIdx];
  el.classList.add('active'); el.setAttribute('aria-selected', 'true');
  input.setAttribute('aria-activedescendant', el.id);
  el.scrollIntoView({ block: 'nearest' });
}
function renderSuggestBox(cat, liveList) {
  const box = $('#sugg'), input = $('#search');
  let html = '';
  if (cat.length) html += `<div class="sugg-head">In catalog</div>` + cat.map(suggestCatalog).join('');
  if (liveList.length) html += `<div class="sugg-head">Any drug · live lookup</div>` + liveList.map(suggestLive).join('');
  if (!html) { closeSugg(); return; }
  box.innerHTML = html; box.classList.add('vis'); input.setAttribute('aria-expanded', 'true');
  suggIdx = -1; input.removeAttribute('aria-activedescendant');
  [...box.querySelectorAll('.si')].forEach((el, i) => { el.id = `sugg-opt-${i}`; el.setAttribute('aria-selected', 'false'); });
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
    <div class="coupon-t"><strong>${esc(c.program_name)}</strong>${c.program_type ? ` <span class="badge lo">${esc(c.program_type.replace(/-/g, ' '))}</span>` : ''}</div>
    ${c.manufacturer ? `<p style="font-size:var(--t-sm);color:var(--text-2);margin-bottom:.6rem">${esc(c.manufacturer)}</p>` : ''}
    ${hasCard ? `${cfieldsHTML([['BIN', c.bin], ['PCN', pcn], ['Group', grp], ['Member', mem]])}
      <button class="copy-btn" data-copy="${esc(c.bin)}|${esc(pcn)}|${esc(grp)}|${esc(mem)}">${COPY_ICO} Copy coupon</button>` : ''}
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
      <div class="coupon-t">GoodRx cash-discount network <span class="row-price">${money(d.price)}</span></div>
      ${cfieldsHTML([['BIN', d.bin], ['PCN', pcn], ['Group', group], ['Member', member]])}
      <button class="copy-btn" data-copy="${esc(d.bin)}|${esc(pcn)}|${esc(group)}|${esc(member)}">${COPY_ICO} Copy coupon</button>
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
// The detail body — shared by the modal (openDetail) and the per-drug static
// page (renderDrugPage) so the two are byte-identical. No close button here;
// the modal prepends one, the page uses a back link in its header instead.
function detailBodyHTML(d, token, ext, hTag = 'h2') {
  // Real headings for screen-reader outline (WCAG 1.3.1): h1/h2 when rendered as
  // a standalone drug page, h2/h3 inside the modal dialog.
  const sub = hTag === 'h1' ? 'h2' : 'h3';
  return `
    <${hTag} class="p-name">${esc(d.name)}</${hTag}>
    <div class="p-sub">${esc(d.generic)} · ${esc(d.company)} · ${esc(d.category)}</div>
    <div class="p-hero">
      <div><div class="p-big">${money(d.price)}</div><div class="p-hero-sub">${d.priceBasis === 'medicare-negotiated' ? 'Medicare Part D price · not a cash price' : `${ext ? 'manufacturer direct' : 'GoodRx cash-pay'} · reference`}</div></div>
      ${d.retail > d.price && d.priceBasis !== 'medicare-negotiated' ? `<div><div class="p-hero-vs" style="color:var(--good);font-weight:700">${savPct(d)}% savings</div><div class="p-hero-vs">vs ${money(d.retail)} <abbr title="Wholesale Acquisition Cost — the manufacturer's published list price, not a consumer price">WAC</abbr> list</div></div>` : ''}
    </div>
    ${d.status === 'limited' ? `<span class="status-badge status-limited">Limited Access</span>` : d.status === 'archived' ? `<span class="status-badge status-archived">Archived · Verify Availability</span>` : ''}
    ${d.priceNote ? `<p class="price-note">${esc(d.priceNote)}</p>` : ''}
    ${d.eligibility && d.eligibility !== 'cash-pay' ? (
      d.eligibility === 'insured-only'  ? `<p class="eligibility-warn">⚠ Requires commercial insurance — not available to cash-pay patients</p>` :
      d.eligibility === 'medicare-only' ? `<p class="eligibility-warn">⚠ Medicare Part D beneficiaries only</p>` :
      d.eligibility === 'mixed'         ? `<p class="eligibility-warn">⚠ Pricing channel varies — see price note for details</p>` : ''
    ) : ''}

    ${(!ext && d.bin === '015995') ? `<${sub} class="label">Cash discount card</${sub}>` : ''}

    ${couponBlock(d)}
    ${(!ext && d.bin === '015995') ? `<p class="note-sm">Free, no signup. The cheapest card varies by drug &amp; pharmacy — price-check <a href="https://www.singlecare.com/prescription-discount-card" target="_blank" rel="noopener noreferrer">SingleCare ↗</a>, <a href="https://www.wellrx.com/prescription-discount-card/" target="_blank" rel="noopener noreferrer">ScriptSave WellRx ↗</a> and <a href="https://perks.optum.com/discount-card" target="_blank" rel="noopener noreferrer">Optum Perks ↗</a> too.</p>` : ''}

    ${live.API_BASE ? `<${sub} class="label">Coupons &amp; assistance <span class="live-badge">programs</span></${sub}><div class="live-box" role="status" id="liveCoupons"><span class="spinner"></span> <span style="color:var(--text-2)">Loading assistance programs… <span style="opacity:.7">(a few seconds if the server was idle)</span></span></div>` : ''}

    <${sub} class="label">Live drug data <span class="live-badge">live</span></${sub}>
    <div class="live-box" role="status" id="liveIdentity"><span class="spinner"></span> <span style="color:var(--text-2)">Looking up <strong>${esc(token || d.generic)}</strong> in RxNorm &amp; openFDA…</span></div>
    <div class="live-box" role="status" id="liveNadac"><span class="spinner"></span> <span style="color:var(--text-2)">Fetching CMS NADAC acquisition cost…</span></div>

    <${sub} class="label">Safety &amp; supply <span class="live-badge">FDA</span></${sub}>
    <div class="live-box" role="status" id="liveSafety"><span class="spinner"></span> <span style="color:var(--text-2)">Checking FDA shortages &amp; recalls…</span></div>

    <${sub} class="label">Reported reactions <span class="live-badge">FAERS</span></${sub}>
    <div class="live-box" role="status" id="liveFaers"><span class="spinner"></span> <span style="color:var(--text-2)">Querying FDA adverse-event reports…</span></div>

    <${sub} class="label">Interactions <span class="live-badge">FDA label</span></${sub}>
    <div class="live-box" role="status" id="liveInteractions"><span class="spinner"></span> <span style="color:var(--text-2)">Reading FDA label interactions…</span></div>

    <div class="p-acts">
      <a id="fdaLabelLink" href="${esc(dailyMed(d))}" target="_blank" rel="noopener noreferrer" class="btn btn-pri">FDA label ↗</a>
      <a href="${esc(goodRxUrl(d))}" target="_blank" rel="noopener noreferrer" class="btn btn-sec">GoodRx ↗</a>
      <a href="${COSTPLUS_URL}" target="_blank" rel="noopener noreferrer" class="btn btn-sec" title="Look up ${esc(d.generic)} on Cost Plus Drugs">Cost Plus ↗</a>
    </div>
    <p class="note-sm">More ways to save: <a href="/#coupons">Coupon Guide</a> · <a href="/#store-programs">Walmart $4 program</a> · <a href="/compare-platforms/">Compare Platforms</a> · <a href="/uninsured-guide/">Uninsured Guide</a></p>
    <div class="disclaimer-box">Cash-pay only. Reference prices and coupon codes — verify with the pharmacy before use. Discount-card prices vary by pharmacy and location, so the price at your counter may differ. Do not combine with Medicare, Medicaid, or any government health program.</div>`;
}

// Modal detail (home page): prepend a close button to the shared body.
// The element that opened the dialog, so close can return focus to it (WCAG 2.4.3).
let _dialogTrigger = null;
function openDetail(slug) {
  const d = CATALOG.find(x => x.slug === slug);
  if (!d) return;
  _dialogTrigger = document.activeElement;
  const ext = d.heroType === 'ExternalLinkRouting';
  const token = live.searchToken(d.generic) || live.searchToken(d.name);

  $('#panelBody').innerHTML = `
    <button class="panel-close" data-close aria-label="Close">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>` + detailBodyHTML(d, token, ext);

  const ov = $('#overlay');
  ov.classList.add('open');
  $('#panel').scrollTop = 0;
  $('#panelBody [data-close]').focus();

  enrichLive(d, token, ++_panelGen);
}

// Per-drug static page (/drugs/<slug>/): render the same body inline (no modal),
// wire the coupon copy button, and hydrate the live FDA data exactly as the modal
// does. The page's static HTML already holds a crawler-readable copy of this body.
function renderDrugPage(dp) {
  const d = CATALOG.find(x => x.slug === dp.dataset.slug);
  if (!d) return;
  document.title = `${d.name} cash price & savings — 0penRX`;
  const ext = d.heroType === 'ExternalLinkRouting';
  const token = live.searchToken(d.generic) || live.searchToken(d.name);
  dp.innerHTML = detailBodyHTML(d, token, ext, 'h1');
  document.addEventListener('click', e => {
    const copy = e.target.closest('[data-copy]');
    if (copy) copyCoupon(copy.dataset.copy, copy);
  });
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
  live.getDrugShortages(d.generic, d.name);
  live.getDrugRecalls(d.generic);
  live.getAdverseEvents(d.generic);
  live.getLabelInteractions(d.generic, d.name);
  live.getCoupons(d.slug || d.generic);
  live.getGoodRxCoupons(d.generic);
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
      // Progressive enhancement: once we have the real product NDC, point the
      // "FDA label" button at that specific product instead of a brand-name
      // search (the static link stays as the no-JS fallback).
      if (fv?.productNdc) {
        const fdaBtn = document.getElementById('fdaLabelLink');
        if (fdaBtn) fdaBtn.href = `https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=${encodeURIComponent(fv.productNdc)}`;
      }
    })
    .catch(() => { if (!alive()) return; const el = $('#liveIdentity'); if (el) el.innerHTML = `<div class="live-err">Identity lookup unavailable.</div>`; });

  // NADAC: real acquisition cost + estimated cash price. Pass the display name
  // (carries the "(Inhalant)"-style form) so a wrong-form row can be dropped.
  live.getNadac(d.generic, d.name).then(n => {
    if (!alive()) return;
    const el = $('#liveNadac'); if (!el) return;
    if (!n) {
      el.innerHTML = `<div class="live-err">No CMS NADAC record found for “${esc(token)}” — NADAC surveys generics, so brand-name and biologic drugs often aren’t listed. Use the price links above.</div>`;
      return;
    }
    const est = live.nadacEstimate(n.perUnit, 30);
    el.innerHTML = `
      <h3 class="label" style="margin:0 0 .55rem">Generic acquisition cost (CMS NADAC)</h3>
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
  Promise.allSettled([live.getDrugShortages(d.generic, d.name), live.getDrugRecalls(d.generic)])
    .then(([shRes, rcRes]) => {
      if (!alive()) return;
      const el = $('#liveSafety'); if (!el) return;
      const sh = shRes.status === 'fulfilled' ? shRes.value : { records: [] };
      const rc = rcRes.status === 'fulfilled' ? rcRes.value : { records: [] };
      const fmtDate = s => s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : (s || '—');

      let html = '<h3 class="label" style="margin:0 0 .55rem">FDA shortages</h3>';
      if (sh.records.length) {
        html += sh.records.slice(0, 3).map(r =>
          `<div class="row" style="margin-bottom:.3rem"><div class="row-l"><div><div class="row-name">${WARN_ICO} ${esc(r.status)}</div><div class="row-note">${esc(r.name)}${r.form ? ` · ${esc(r.form)}` : ''}${r.updated ? ` · updated ${esc(r.updated)}` : ''}</div></div></div></div>`).join('');
        html += `<a class="src-link" href="${esc(sh.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source: openFDA drug shortages ↗</a>`;
      } else {
        html += `<div class="live-note">No active FDA shortage reported for “${esc(token)}.”</div>`;
      }
      html += `<a class="src-link" style="margin-top:.4rem" href="https://www.ashp.org/drug-shortages" target="_blank" rel="noopener noreferrer">ASHP Drug Shortage Database (authoritative) ↗</a>`;

      html += '<h3 class="label" style="margin:1rem 0 .55rem">Recent recalls</h3>';
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

  // Coupons / patient-assistance programs (backend only). Live in production via
  // the API_BASE that config.js sets; if a build ships without config.js the
  // functions return null and the #liveCoupons box is never rendered, so this no-ops.
  // GoodRx results are merged with catalog coupons; getGoodRxCoupons returns null
  // when the key is absent so this is a silent no-op until the key is configured.
  Promise.all([
    live.getCoupons(d.slug || d.generic),
    live.getGoodRxCoupons(d.generic),
  ]).then(([list, grx]) => {
    if (!alive()) return;
    const el = $('#liveCoupons'); if (!el) return;
    const combined = [...(list || []), ...(grx || [])];
    // Outbound deep-links — referral only; none of these sources permit scraping.
    // NeedyMeds CCRM: 7,000+ programs / 1,500 branded discount cards (7/2025 PR kit).
    // RxAssist PAP: manufacturer PAP directory operated by RxVantage.
    // PAN Foundation: copay grants for *insured* patients with high cost-sharing
    //   (distinct from PAPs, which serve uninsured patients) — panfoundation.org.
    const gen = encodeURIComponent(d.generic || '');
    const moreLinks = `<div class="live-more">
      <span class="live-more-lbl">Also search:</span>
      <a class="live-more-link" href="https://www.needymeds.org/coupons.taf?_function=name_list&amp;gname=${gen}" target="_blank" rel="noopener noreferrer">NeedyMeds CCRM ↗</a>
      <a class="live-more-link" href="https://www.rxassist.org/pap-info" target="_blank" rel="noopener noreferrer">RxAssist PAP ↗</a>
      <a class="live-more-link" href="https://www.panfoundation.org/" target="_blank" rel="noopener noreferrer">PAN Foundation (insured) ↗</a>
    </div>`;
    if (!combined.length) {
      // No curated record — still surface the external search links so users
      // aren't left with a blank box when assistance programs may exist elsewhere.
      el.innerHTML = `<div class="live-note">No curated record for this drug — search public databases below.</div>${moreLinks}`;
      return;
    }
    // Collapse identical program cards (a slug can match drug-form variants).
    const seen = new Set();
    const uniq = combined.filter(c => { const k = `${c.program_name}|${c.bin}|${c.url}`; return seen.has(k) ? false : seen.add(k); });
    el.innerHTML = uniq.map(c => couponCardHTML(c)).join('')
      + `<div class="live-note">Reference only — verify each program before use. Manufacturer copay cards cannot be used with Medicare or Medicaid.</div>`
      + moreLinks;
  }).catch(() => { if (!alive()) return; const el = $('#liveCoupons'); if (el) el.remove(); });
}

// Detail panel for an off-catalog drug — no curated price, pure live data.
function openLiveDetail(display, clean) {
  _dialogTrigger = document.activeElement;
  const token = live.searchToken(clean) || clean.toUpperCase();
  $('#panelBody').innerHTML = `
    <button class="panel-close" data-close aria-label="Close">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
    <div class="p-name">${esc(display)}</div>
    <div class="p-sub">Live lookup · RxNorm / openFDA / CMS NADAC</div>

    <div class="p-hero p-hero-live">
      <div>
        <div class="label" style="margin:0 0 .3rem;color:var(--primary)">What it costs</div>
        <div class="p-hero-sub" style="opacity:1">Not in our curated catalog — check the live cash price:</div>
      </div>
      <div class="p-acts p-acts-lead">
        <a href="https://www.goodrx.com/search?query=${encodeURIComponent(clean)}" target="_blank" rel="noopener noreferrer" class="btn btn-pri">GoodRx price ↗</a>
        <a href="${COSTPLUS_URL}" target="_blank" rel="noopener noreferrer" class="btn btn-pri" title="Look up ${esc(clean)} on Cost Plus Drugs">Cost Plus price ↗</a>
      </div>
    </div>

    <div class="label">Estimated cash price <span class="live-badge">CMS NADAC</span></div>
    <div class="live-box" role="status" id="liveNadac"><span class="spinner"></span> <span style="color:var(--text-2)">Fetching CMS NADAC acquisition cost…</span></div>

    <div class="label">Live drug data <span class="live-badge">live</span></div>
    <div class="live-box" role="status" id="liveIdentity"><span class="spinner"></span> <span style="color:var(--text-2)">Looking up <strong>${esc(clean)}</strong> in RxNorm &amp; openFDA…</span></div>

    <div class="label">Safety &amp; supply <span class="live-badge">FDA</span></div>
    <div class="live-box" role="status" id="liveSafety"><span class="spinner"></span> <span style="color:var(--text-2)">Checking FDA shortages &amp; recalls…</span></div>

    <div class="label">Reported reactions <span class="live-badge">FAERS</span></div>
    <div class="live-box" role="status" id="liveFaers"><span class="spinner"></span> <span style="color:var(--text-2)">Querying FDA adverse-event reports…</span></div>

    <div class="label">Interactions <span class="live-badge">FDA label</span></div>
    <div class="live-box" role="status" id="liveInteractions"><span class="spinner"></span> <span style="color:var(--text-2)">Reading FDA label interactions…</span></div>

    ${live.API_BASE ? `<div class="label">Coupons &amp; assistance <span class="live-badge">programs</span></div><div class="live-box" role="status" id="liveCoupons"><span class="spinner"></span> <span style="color:var(--text-2)">Loading assistance programs… <span style="opacity:.7">(a few seconds if the server was idle)</span></span></div>` : ''}

    <div class="disclaimer-box">Cash-pay reference data from public sources — verify with the pharmacy before use. Prices vary by pharmacy and location. Not medical advice.</div>`;
  const ov = $('#overlay');
  ov.classList.add('open');
  $('#panel').scrollTop = 0;
  $('#panelBody [data-close]').focus();
  enrichLive({ generic: clean, name: display }, token, ++_panelGen);
}

function closeDetail() {
  $('#overlay').classList.remove('open');
  // Return focus to the element that opened the dialog (WCAG 2.4.3).
  if (_dialogTrigger && _dialogTrigger.isConnected) _dialogTrigger.focus();
  _dialogTrigger = null;
}

// ---- Data Sources view -----------------------------------------------------
// Probes exist for the three government APIs the browser calls directly
// (keyed on the stable card id, so renaming a card can't silently kill one).
const PROBED_IDS = new Set(['rxnorm', 'openfda', 'nadac']);

function srcCardHTML(s) {
  const probe = PROBED_IDS.has(s.id) ? s.id : null;
  const statusCls = s.s === 'f' ? 'f' : s.s === 'k' ? 'k' : 'a';
  const host = new URL(s.u).hostname.replace(/^www\./, '');
  return `<div class="src-card">
    <div class="src-name">${esc(s.n)}</div>
    <span class="src-status ${statusCls}">${esc(s.b)}</span>
    <div class="src-desc">${esc(s.d)}</div>
    ${probe ? `<div class="src-live checking" data-probe="${probe}"><span class="spinner"></span> checking…</div>` : ''}
    <a class="src-url" href="${esc(s.u)}" target="_blank" rel="noopener noreferrer">${esc(host)}</a>
  </div>`;
}
function renderSources() {
  const live_ = API_SOURCES.filter(s => s.g === 'live');
  const doc_ = API_SOURCES.filter(s => s.g === 'doc');
  $('#srcGrid').innerHTML = `
    <h3 class="src-group-label">Powers this site <span class="src-group-note">— used at runtime; the three government APIs your browser calls carry a live check</span></h3>
    <div class="src-group">${live_.map(srcCardHTML).join('')}</div>
    <h3 class="src-group-label">Documented pricing sources <span class="src-group-note">— we link out; no data feed</span></h3>
    <div class="src-group">${doc_.map(srcCardHTML).join('')}</div>`;
  // Re-probed on every visit to the view (not once per session).
  $$('[data-probe]').forEach(async el => {
    const ok = await live.checkSource(el.dataset.probe);
    el.className = 'src-live ' + (ok ? 'ok' : 'down');
    el.innerHTML = ok ? '● live · reachable' : '⚠ unreachable right now';
  });
}

// ---- Coupon Guide view -----------------------------------------------------
// Universal cash-pay discount cards any uninsured person can use — no insurance,
// no enrollment. GoodRx codes come from BIN_INFO (shared with the per-drug panel).
// The other cards carry their own confirmed-static BIN/PCN/Group; the member ID is
// dynamic on every discount card, so it is never invented — it reads "Printed on
// your card". SingleCare (partner-specific group) and Optum Perks (codes not
// confirmable) are shown link-only so no unverified code is handed to a pharmacist.
// Pharmacy counts and "up to 80%" are each vendor's own published figures.
const COUPONS = [
  { t: 'GoodRx Network', stats: ['No insurance needed', '70,000+ pharmacies', 'Up to 80% off'], bin: '015995', url: 'https://www.goodrx.com/discount-card',
    note: 'Also accepted at Walmart and Sam’s Club — per GoodRx, network pharmacies are contractually required to honor these prices. Exceptions: Walmart takes no discount cards on opioid prescriptions (since June 1, 2018), and coupons for any controlled substance are at the pharmacist’s discretion.' },
  { t: 'ScriptSave WellRx', stats: ['No insurance needed', '65,000+ pharmacies', 'Up to 80% off'], bin: '006053', pcn: 'MSC', group: '977', member: 'Printed on your card', url: 'https://www.wellrx.com/prescription-discount-card/' },
  { t: "America's Pharmacy", stats: ['No insurance needed', '62,000+ pharmacies', 'Up to 80% off'], bin: '003585', pcn: '78470', group: 'ARX0302', member: 'Printed on your card', url: 'https://www.americaspharmacy.com/card/' },
  { t: 'SingleCare', stats: ['No insurance needed', '35,000+ pharmacies', 'Up to 80% off'], linkOnly: true, note: 'Group and member vary by card — get your free card:', url: 'https://www.singlecare.com/prescription-discount-card' },
  { t: 'Optum Perks', stats: ['No insurance needed', '64,000+ pharmacies', 'Up to 80% off'], linkOnly: true, note: 'Codes are printed on each card — get your free card:', url: 'https://perks.optum.com/discount-card' },
];
function renderCoupons() {
  $('#couponList').innerHTML = COUPONS.map(c => {
    const chips = c.stats.map(s => `<span class="stat-chip">${esc(s)}</span>`).join('');
    const link = c.url ? `<a class="btn btn-sec coupon-link" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Get your free card ↗</a>` : '';
    let body;
    if (c.linkOnly) {
      body = `${c.note ? `<p class="coupon-note">${esc(c.note)}</p>` : ''}${link}`;
    } else {
      const info = c.pcn ? { pcn: c.pcn, group: c.group, member: c.member } : binInfo(c.bin);
      body = `${cfieldsHTML([['BIN', c.bin], ['PCN', info.pcn], ['Group', info.group], ['Member', info.member]])}
    <button class="copy-btn" data-copy="${esc(c.bin)}|${esc(info.pcn)}|${esc(info.group)}|${esc(info.member)}">${COPY_ICO} Copy to clipboard</button>
    ${c.note ? `<p class="coupon-note">${esc(c.note)}</p>` : ''}${link}`;
    }
    return `<div class="coupon">
    <div class="coupon-t">${esc(c.t)}</div>
    <div class="coupon-stats">${chips}</div>
    ${body}
  </div>`;
  }).join('');

  renderStorePrograms();
}

// Store cash-price programs — no card, code, or signup. Kept separate from the
// discount cards above so nobody hunts for a BIN that doesn't exist. Every
// figure is from Walmart's own program terms (list PDF effective 2025-03-24)
// and program page, verified 2026-07-06. Walmart+ "Rx for Less" is deliberately
// absent — Walmart discontinued it May 31, 2022.
const STORE_PROGRAMS = [
  {
    t: 'Walmart $4 Prescriptions',
    stats: ['No card or signup', 'About 100 generics', '30-day from $4 · 90-day from $10'],
    note: 'Flat cash prices at the pharmacy counter on select generics (some tiers are $9/$24 or $15/$38). Antibiotics, antihistamines, steroids, and brand-name drugs are not included. Not available in North Dakota; prices are higher in some states, including California and Minnesota. First fill must be in person; a $10 90-day mail option is available. Walmart also accepts GoodRx-style discount cards — except on opioid prescriptions.',
    url: 'https://www.walmart.com/cp/4-prescriptions/1078664',
    cta: 'See the drug list ↗',
  },
];
function renderStorePrograms() {
  const el = $('#storeList');
  if (!el) return;
  el.innerHTML = STORE_PROGRAMS.map(p => `<div class="coupon">
    <div class="coupon-t">${esc(p.t)}</div>
    <div class="coupon-stats">${p.stats.map(s => `<span class="stat-chip">${esc(s)}</span>`).join('')}</div>
    <p class="coupon-note">${esc(p.note)}</p>
    <a class="btn btn-sec coupon-link" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.cta)}</a>
  </div>`).join('');
}

async function copyCoupon(spec, btn) {
  const [bin, pcn, grp, mem] = spec.split('|');
  const text = `BIN: ${bin}\nPCN: ${pcn}\nGroup: ${grp}\nMember: ${mem}`;
  const done = () => {
    const t = btn.innerHTML; btn.innerHTML = CHECK_ICO + ' Copied!'; setTimeout(() => { btn.innerHTML = t; }, 2000);
    // Announce to screen readers (WCAG 4.1.3) — a shared polite status region.
    let st = document.getElementById('a11yStatus');
    if (!st) { st = document.createElement('div'); st.id = 'a11yStatus'; st.className = 'sr-only'; st.setAttribute('role', 'status'); document.body.appendChild(st); }
    st.textContent = 'Coupon codes copied to clipboard';
    setTimeout(() => { st.textContent = ''; }, 3000);
  };
  try { await navigator.clipboard.writeText(text); done(); }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text, style: 'position:fixed;opacity:0' });
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done();
  }
}

// ---- View switching --------------------------------------------------------
const VIEW_TITLES = {
  browse: '0PENRX — Find your lowest prescription price',
  sources: 'Data Sources & APIs — 0penRX',
  coupons: 'Coupon Guide — 0penRX',
  dashboard: 'Catalog dashboard — 0penRX',
};
function setView(name) {
  state.view = name;
  if (VIEW_TITLES[name]) document.title = VIEW_TITLES[name];
  $$('.ntab').forEach(t => {
    const on = t.dataset.nav === name;
    t.classList.toggle('on', on);
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  $('.hero').hidden = name !== 'browse';
  $('#filterstrip').hidden = name !== 'browse';
  $('#view-browse').hidden = name !== 'browse';
  $('#view-sources').hidden = name !== 'sources';
  $('#view-coupons').hidden = name !== 'coupons';
  $('#view-dashboard').hidden = name !== 'dashboard';
  if (name === 'sources') renderSources(); // rebuilt each visit so probes re-run
  if (name === 'coupons' && !$('#couponList').children.length) renderCoupons();
  if (name === 'dashboard' && !_dashboardInit) { renderDashboard(); _dashboardInit = true; }
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

// ---- Theme -----------------------------------------------------------------
const SUN = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
const MOON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
// Inline UI icons (no emoji) — stroke currentColor so they inherit type color.
const COPY_ICO = '<svg class="ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_ICO = '<svg class="ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const WARN_ICO = '<svg class="ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
function initTheme() {
  const btn = $('[data-theme-toggle]'), root = document.documentElement;
  // Persist an explicit choice; fall back to the OS preference when unset.
  const saved = (() => { try { return localStorage.getItem('orx-theme'); } catch { return null; } })();
  let mode = (saved === 'dark' || saved === 'light')
    ? saved
    : (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
  const apply = () => {
    root.setAttribute('data-theme', mode);
    btn.innerHTML = mode === 'dark' ? SUN : MOON;
    btn.setAttribute('aria-label', mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  };
  apply();
  btn.addEventListener('click', () => {
    mode = mode === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('orx-theme', mode); } catch { /* private mode: in-memory only */ }
    apply();
  });
}

// ---- Wiring ----------------------------------------------------------------
// Surface the catalog freshness date in the footer from the data itself (the
// oldest `verified` date across the catalog), so it can never go stale relative
// to the data the way a hardcoded string would.

function init() {
  initTheme();

  // Screen-reader note on links that open a new tab (WCAG 2.4.4/3.2.5 advisory):
  // annotate current and future target=_blank links with visually-hidden text.
  const annotateNewTab = root => root.querySelectorAll?.('a[target="_blank"]:not([data-newtab])').forEach(a => {
    a.dataset.newtab = '1';
    const s = document.createElement('span');
    s.className = 'sr-only'; s.textContent = ' (opens in new tab)';
    a.appendChild(s);
  });
  annotateNewTab(document);
  new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) annotateNewTab(n); })))
    .observe(document.body, { childList: true, subtree: true });

  // Per-drug static page (/drugs/<slug>/): render the detail, register the SW,
  // and skip all the home-page (grid/search/nav) wiring — those elements don't
  // exist here.
  const dp = document.getElementById('drugpage');
  if (dp) { renderDrugPage(dp); registerSW(); return; }

  // Content pages (e.g. /privacy/) have neither the app grid nor a drug panel.
  // Theme is already applied above; register the SW and stop before the SPA wiring.
  if (!document.getElementById('grid')) { registerSW(); return; }

  // Privacy transparency notice (home page only). A non-blocking trust notice —
  // no consent is required (the site sets no cookies and runs no tracking), so it
  // never traps focus or blocks the page. Shown once, then remembered on-device
  // (functional first-party storage, disclosed in the privacy policy).
  const pn = document.getElementById('privacyNotice');
  if (pn) {
    const acked = (() => { try { return localStorage.getItem('orx-privacy-ack'); } catch { return null; } })();
    if (!acked) {
      pn.hidden = false;
      let onKey;
      const dismissNotice = () => {
        if (pn.contains(document.activeElement)) $('#search')?.focus();
        pn.hidden = true;
        document.removeEventListener('keydown', onKey);
        try { localStorage.setItem('orx-privacy-ack', '1'); } catch { /* private mode: shown again next visit */ }
      };
      onKey = e => { if (e.key === 'Escape') dismissNotice(); };
      $('#privacyAck').addEventListener('click', dismissNotice);
      document.addEventListener('keydown', onKey);
    }
  }

  renderFilters();
  setupFilterStrip();
  renderGrid();

  const input = $('#search'), clear = $('#searchClear'), sugg = $('#sugg');
  // Keep the URL in sync with the query so searches are deep-linkable and
  // shareable — this is what makes the WebSite SearchAction schema (/?q=<term>)
  // real rather than decorative.
  const syncQ = () => {
    const u = new URL(location.href);
    if (state.q) u.searchParams.set('q', state.q); else u.searchParams.delete('q');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  };
  input.addEventListener('input', () => {
    state.q = input.value.trim();
    clear.classList.toggle('vis', !!state.q);
    renderGrid(); renderSuggest(); syncQ();
  });
  // ARIA combobox keyboard support: arrows move the highlighted suggestion,
  // Enter activates it, Escape closes then clears (WCAG 2.1.1).
  input.addEventListener('keydown', e => {
    const open = sugg.classList.contains('vis');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { renderSuggest(); return; }
      moveSugg(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      if (open && suggIdx >= 0) {
        e.preventDefault();
        const el = sugg.querySelectorAll('.si')[suggIdx];
        if (el) el.click();
        closeSugg();
      }
    } else if (e.key === 'Escape') {
      if (open) { closeSugg(); return; }
      input.value = ''; state.q = ''; clear.classList.remove('vis'); renderGrid(); syncQ();
    }
  });
  clear.addEventListener('click', () => { input.value = ''; state.q = ''; clear.classList.remove('vis'); renderGrid(); sugg.classList.remove('vis'); syncQ(); input.focus(); });
  // Deep link: /?q=<term> pre-fills the box and runs the search on load.
  const q0 = new URLSearchParams(location.search).get('q');
  if (q0) { input.value = q0; state.q = q0.trim(); clear.classList.toggle('vis', !!state.q); renderGrid(); }
  document.addEventListener('click', e => { if (!e.target.closest('.search')) closeSugg(); });

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
    if (pick) { const d = CATALOG.find(x => x.slug === pick.dataset.pick); if (!d) return; input.value = d.name; state.q = d.name; closeSugg(); renderGrid(); openDetail(pick.dataset.pick); return; }
    if (liveEl) { input.value = liveEl.dataset.live; state.q = liveEl.dataset.live; closeSugg(); openLiveDetail(liveEl.dataset.live, liveEl.dataset.clean); return; }
    if (open) { const slug = open.dataset.open || open.dataset.slug; openDetail(slug); return; }
  });
  $('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay') closeDetail(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });
  // Focus trap while the dialog is open (WCAG 2.1.2 / 2.4.3): Tab and Shift+Tab
  // cycle within the panel instead of escaping into the obscured page behind it.
  $('#overlay').addEventListener('keydown', e => {
    if (e.key !== 'Tab' || !$('#overlay').classList.contains('open')) return;
    const focusables = [...$('#panel').querySelectorAll('button, a[href], select, input, [tabindex]:not([tabindex="-1"])')]
      .filter(el => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

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

  registerSW();

  // Deep-link support: /#sources and /#coupons open those views on load, so the
  // header nav on sub-pages (privacy, comparison guides, drug pages) can link
  // straight into them as real anchors. Falls through to the default browse view.
  const viewFromHash = () => {
    const h = (location.hash || '').replace('#', '');
    if (h === 'sources' || h === 'coupons' || h === 'browse' || h === 'dashboard') setView(h);
    else if (h === 'store-programs') {
      // Deep-link to the Coupon Guide's store-programs section (e.g. /#store-programs).
      setView('coupons');
      setTimeout(() => $('#store-programs')?.scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 60);
    }
  };
  viewFromHash();
  window.addEventListener('hashchange', viewFromHash);

  // Warm the Render backend so the first coupon lookup doesn't hit a cold start.
  // Fire-and-forget: the /health response is ignored; this just prevents the
  // free-tier container from being asleep when a user opens their first drug.
  if (live.API_BASE) {
    fetch(`${live.API_BASE.replace(/\/$/, '')}/health`, { mode: 'cors' }).catch(() => {});
  }
}

// Progressive Web App: instant repeat loads + offline shell + installable.
// Shared by the home page and every per-drug page.
function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* SW is an enhancement */ });
    });
  }
}

document.addEventListener('DOMContentLoaded', init);

// ============================================================
// DASHBOARD VIEW
// ============================================================

let _dashboardInit = false;

let dbTableSort = { col: 'savings', dir: 'desc' };
let dbTableFilter = '';
let _dbTableListenersAttached = false;

function renderDashboardKPI() {
  const total = CATALOG.length;
  document.getElementById('dbKpi-1').textContent = total;

  // Avg / top savings must reflect what a cash-pay patient can actually get, so
  // exclude archived drugs (no longer sold) and Medicare-negotiated prices
  // (flagged "not a cash price"). Total count above stays the full catalog.
  const sv = d => (typeof d.savings === 'number' ? d.savings : savPct(d));
  const base = CATALOG.filter(d => d.status !== 'archived' && d.priceBasis !== 'medicare-negotiated');

  const avgSav = Math.round(base.reduce((a, d) => a + sv(d), 0) / base.length);
  document.getElementById('dbKpi-2').textContent = avgSav + '%';

  const topDrug = base.reduce((best, d) => (sv(d) > sv(best) ? d : best));
  const topPct = sv(topDrug);
  document.getElementById('dbKpi-3').textContent = topPct + '%';
  const lbl3 = document.getElementById('dbKpiLbl-3');
  if (lbl3) lbl3.textContent = esc(topDrug.name);
  const delta3 = document.getElementById('dbKpiDelta-3');
  if (delta3) { delta3.textContent = 'top savings'; delta3.className = 'db-kpi-delta ok'; }

  const grxCount = CATALOG.filter(d => d.bin === '015995').length;
  document.getElementById('dbKpi-4').textContent = grxCount;

  const mfrCount = CATALOG.filter(
    d => d.heroType === 'ExternalLinkRouting' && !!d.partner
  ).length;
  document.getElementById('dbKpi-5').textContent = mfrCount;

  const numEl6 = document.getElementById('dbKpi-6');
  const deltaEl6 = document.getElementById('dbKpiDelta-6');
  const numEl7 = document.getElementById('dbKpi-7');
  const deltaEl7 = document.getElementById('dbKpiDelta-7');

  if (!live.API_BASE) {
    numEl6.textContent = 'N/A';
    deltaEl6.textContent = 'not configured';
    deltaEl6.className = 'db-kpi-delta off';
    numEl7.textContent = 'N/A';
    deltaEl7.textContent = 'not configured';
    deltaEl7.className = 'db-kpi-delta off';
    return;
  }

  const healthUrl = live.API_BASE.replace(/\/$/, '') + '/health';
  const t0 = performance.now();

  fetch(healthUrl, {
    mode: 'cors',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(9000)
  })
    .then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(health => {
      const latencyMs = Math.round(performance.now() - t0);
      numEl6.textContent = latencyMs + 'ms';
      const statusOk = health.status === 'ok' || health.coupons_loaded;
      deltaEl6.textContent = statusOk && latencyMs < 500 ? 'online' : statusOk ? 'slow' : 'degraded';
      deltaEl6.className = 'db-kpi-delta ' + (statusOk && latencyMs < 500 ? 'ok' : 'warn');
      const grxEnabled = !!health.goodrx_enabled;
      numEl7.textContent = grxEnabled ? 'enabled' : 'disabled';
      numEl7.style.fontSize = 'var(--t-sm)';
      deltaEl7.textContent = grxEnabled ? 'live prices' : 'reference only';
      deltaEl7.className = 'db-kpi-delta ' + (grxEnabled ? 'ok' : 'warn');
    })
    .catch(() => {
      numEl6.textContent = 'offline';
      deltaEl6.textContent = 'unreachable';
      deltaEl6.className = 'db-kpi-delta off';
      numEl7.textContent = '—';
      deltaEl7.textContent = 'api offline';
      deltaEl7.className = 'db-kpi-delta off';
    });
}

function _updateSourceRow(id, dotClass, statusText, latencyMs) {
  const row = document.getElementById(id);
  if (!row) return;
  const dot = row.querySelector('.db-dot');
  const txt = row.querySelector('.db-source-status-txt');
  const lat = row.querySelector('.db-latency');
  if (dot) dot.className = 'db-dot ' + dotClass;
  if (txt) { txt.textContent = statusText; txt.className = 'db-source-status-txt ' + dotClass; }
  if (lat) lat.textContent = (typeof latencyMs === 'number' && isFinite(latencyMs)) ? Math.round(latencyMs) + 'ms' : '';
}

async function renderDashboardSources() {
  ['rxnorm', 'openfda', 'nadac', 'backend'].forEach(key => {
    _updateSourceRow('db-src-' + key, 'checking', 'checking...', null);
  });
  _updateSourceRow('db-src-goodrx', 'off', 'pending backend', null);

  const probe = (key) => {
    const t0 = performance.now();
    return live.checkSource(key)
      .then(ok => {
        const ms = performance.now() - t0;
        _updateSourceRow('db-src-' + key, ok ? 'ok' : 'err', ok ? 'online' : 'unreachable', ms);
      })
      .catch(() => {
        _updateSourceRow('db-src-' + key, 'err', 'error', performance.now() - t0);
      });
  };

  const probeBackend = (() => {
    if (!live.API_BASE) {
      _updateSourceRow('db-src-backend', 'off', 'not configured', null);
      _updateSourceRow('db-src-goodrx', 'off', 'key pending', null);
      return Promise.resolve();
    }
    const t0 = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    return fetch(live.API_BASE.replace(/\/$/, '') + '/health', {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' }
    })
      .then(res => { clearTimeout(timer); if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(health => {
        const ms = performance.now() - t0;
        const ok = health && (health.status === 'ok' || health.coupons_loaded);
        const detail = [];
        if (health.coupons_loaded) detail.push('coupons');
        _updateSourceRow('db-src-backend', ok ? 'ok' : 'warn', ok ? ('online' + (detail.length ? ' · ' + detail.join(', ') : '')) : (health.status || 'degraded'), ms);
        _updateSourceRow('db-src-goodrx', health.goodrx_enabled ? 'ok' : 'warn', health.goodrx_enabled ? 'enabled' : 'key pending', null);
      })
      .catch(err => {
        clearTimeout(timer);
        const ms = performance.now() - t0;
        _updateSourceRow('db-src-backend', 'err', err && err.name === 'AbortError' ? 'timeout' : 'unreachable', ms);
        _updateSourceRow('db-src-goodrx', 'off', 'key pending', null);
      });
  })();

  return Promise.allSettled([probe('rxnorm'), probe('openfda'), probe('nadac'), probeBackend]);
}

function renderDashboardCoverage() {
  const total = CATALOG.length;
  if (!total) return;

  const grxCount = CATALOG.filter(d => d.bin === '015995').length;
  const mfrCount = CATALOG.filter(d => d.heroType === 'ExternalLinkRouting' && !!d.partner).length;
  const genCount = CATALOG.filter(d => d.isGeneric).length;

  const ptEl = document.getElementById('dbCovProgramType');
  if (ptEl) {
    ptEl.innerHTML = [
      { label: 'GoodRx Network', count: grxCount, color: '--primary' },
      { label: 'Mfr Direct',     count: mfrCount, color: '--live'    },
      { label: 'Generic',        count: genCount, color: '--good'    },
    ].map(r => {
      const pct = (r.count / total) * 100;
      return `<div class="db-cov-row"><span class="db-cov-lbl">${esc(r.label)}</span><div class="db-cov-bar-wrap"><div class="db-cov-fill" style="width:${pct.toFixed(1)}%;background:var(${r.color})"></div></div><span class="db-cov-num">${r.count}</span></div>`;
    }).join('');
  }

  const catMap = {};
  CATALOG.forEach(d => { const c = d.category || 'Uncategorized'; catMap[c] = (catMap[c] || 0) + 1; });
  const sortedCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxCount = sortedCats.length ? sortedCats[0][1] : 1;

  const catEl = document.getElementById('dbCovCategories');
  if (catEl) {
    catEl.innerHTML = sortedCats.map(([cat, count]) => {
      const pct = (count / maxCount) * 100;
      return `<div class="db-cov-row"><span class="db-cov-lbl">${esc(cat)}</span><div class="db-cov-bar-wrap"><div class="db-cov-fill" style="width:${pct.toFixed(1)}%"></div></div><span class="db-cov-num">${count}</span></div>`;
    }).join('');
  }

  const clsOf = s => s >= 70 ? 'hi' : s >= 40 ? 'md' : 'lo';
  let hi = 0, md = 0, lo = 0;
  CATALOG.forEach(d => {
    const s = typeof d.savings === 'number' ? d.savings : savPct(d);
    if (s >= 70) hi++; else if (s >= 40) md++; else lo++;
  });

  const svEl = document.getElementById('dbCovSavings');
  if (svEl) {
    svEl.innerHTML = [
      { label: 'High ≥70%',   count: hi, color: '--good'    },
      { label: 'Medium 40–69%', count: md, color: '--primary' },
      { label: 'Low <40%',         count: lo, color: '--gold'    },
    ].map(r => {
      const pct = (r.count / total) * 100;
      return `<div class="db-cov-row"><span class="db-cov-lbl">${esc(r.label)}</span><div class="db-cov-bar-wrap"><div class="db-cov-fill" style="width:${pct.toFixed(1)}%;background:var(${r.color})"></div></div><span class="db-cov-num">${r.count}</span></div>`;
    }).join('');
  }
}

function _sortAndFilter(catalog) {
  let list = dbTableFilter
    ? catalog.filter(d =>
        (d.name + ' ' + (d.generic || '') + ' ' + (d.company || '')).toLowerCase().includes(dbTableFilter)
      )
    : catalog.slice();

  const { col, dir } = dbTableSort;
  const m = dir === 'asc' ? 1 : -1;

  if (col === 'name') {
    list.sort((a, b) => m * a.name.localeCompare(b.name));
  } else if (col === 'price') {
    list.sort((a, b) => m * (a.price - b.price));
  } else if (col === 'retail') {
    list.sort((a, b) => m * (a.retail - b.retail));
  } else {
    list.sort((a, b) => {
      const sa = typeof a.savings === 'number' ? a.savings : savPct(a);
      const sb = typeof b.savings === 'number' ? b.savings : savPct(b);
      return m * (sa - sb);
    });
  }
  return list;
}

function _programTag(d) {
  if (d.bin === '015995') return '<span class="tag grx">GoodRx</span>';
  if (d.heroType === 'ExternalLinkRouting') return '<span class="tag mfr">Mfr Direct</span>';
  if (d.isGeneric) return '<span class="tag cpd">Generic</span>';
  return '<span style="color:var(--text-3);font-size:11px">—</span>';
}

function _renderDrugTable() {
  const list = _sortAndFilter(CATALOG);

  const countEl = document.getElementById('dbDrugCount');
  if (countEl) countEl.textContent = list.length + ' medication' + (list.length !== 1 ? 's' : '');

  document.querySelectorAll('#view-dashboard th[data-col]').forEach(th => {
    const isActive = th.dataset.col === dbTableSort.col;
    th.classList.toggle('sorted', isActive);
    const arr = th.querySelector('.db-sort-arrow');
    if (arr) arr.remove();
    if (isActive) {
      const span = document.createElement('span');
      span.className = 'db-sort-arrow';
      span.setAttribute('aria-hidden', 'true');
      span.textContent = dbTableSort.dir === 'asc' ? ' ↑' : ' ↓';
      th.appendChild(span);
    }
  });

  const tbody = document.getElementById('dbDrugTbody');
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="db-empty">No medications match your search.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(d => {
    const pct = typeof d.savings === 'number' ? d.savings : savPct(d);
    return `<tr data-slug="${esc(d.slug)}" tabindex="0" role="row"><td class="name-cell">${esc(d.name)}</td><td class="gen-cell">${esc(d.generic || '')}</td><td>${_programTag(d)}</td><td class="r mono">${money(d.price)}</td><td class="r mono dim">${money(d.retail)}</td><td class="r"><span class="badge ${savClass(pct)}">${pct}%</span></td></tr>`;
  }).join('');
}

function renderDashboardTable() {
  if (!_dbTableListenersAttached) {
    _dbTableListenersAttached = true;

    const searchEl = document.getElementById('dbDrugSearch');
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        dbTableFilter = searchEl.value.trim().toLowerCase();
        _renderDrugTable();
      });
      searchEl.addEventListener('keydown', e => {
        if (e.key === 'Escape') { searchEl.value = ''; dbTableFilter = ''; _renderDrugTable(); }
      });
    }

    const thead = document.querySelector('#view-dashboard .db-table thead');
    if (thead) {
      thead.addEventListener('click', e => {
        const th = e.target.closest('th[data-col]');
        if (!th) return;
        const col = th.dataset.col;
        if (col === 'program' || col === 'generic') return;
        dbTableSort.dir = dbTableSort.col === col
          ? (dbTableSort.dir === 'asc' ? 'desc' : 'asc')
          : (col === 'name' ? 'asc' : 'desc');
        dbTableSort.col = col;
        _renderDrugTable();
      });
    }

    const tbody = document.getElementById('dbDrugTbody');
    if (tbody) {
      tbody.addEventListener('click', e => {
        const row = e.target.closest('tr[data-slug]');
        if (row) openDetail(row.dataset.slug);
      });
      tbody.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          const row = e.target.closest('tr[data-slug]');
          if (row) { e.preventDefault(); openDetail(row.dataset.slug); }
        }
      });
    }
  }

  _renderDrugTable();
}

function renderDashboard() {
  renderDashboardKPI();
  renderDashboardSources();
  renderDashboardCoverage();
  renderDashboardTable();
}
