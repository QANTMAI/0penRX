"""Generate one static, crawlable page per catalog drug at /drugs/<slug>/.

Each page has its own URL, <title>, meta, canonical, Open Graph, and JSON-LD
(Drug + Offer + BreadcrumbList), with the full detail baked into static HTML so
search engines and no-JS AI crawlers can index/cite it. On load, app.js detects
`#drugpage` and replaces the static fallback with the exact interactive modal
body + live FDA data — so a per-drug page and the home-page pop-out look
identical to a user.

Source of truth is assets/catalog.js. Regenerates drugs/<slug>/index.html for
every drug and rewrites sitemap.xml. CI (test_drug_pages.py) fails on drift.

Usage:
    python data/build_drug_pages.py            # (re)generate all pages + sitemap
    python data/build_drug_pages.py --check     # exit 1 if anything is stale
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys

_DATA_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_DATA_DIR)
CATALOG_PATH = os.path.join(_REPO_ROOT, "assets", "catalog.js")
DRUGS_DIR = os.path.join(_REPO_ROOT, "drugs")
SITEMAP = os.path.join(_REPO_ROOT, "sitemap.xml")
SITE = "https://0penrx.org"
TODAY = "2026-06-30"  # sitemap lastmod; bump on regeneration

sys.path.insert(0, _DATA_DIR)
from build_coupons import PARTNER_URL, load_catalog  # noqa: E402

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "font-src 'self'; img-src 'self' data:; connect-src 'self' "
    "https://rxnav.nlm.nih.gov https://api.fda.gov https://data.medicaid.gov "
    "https://clinicaltables.nlm.nih.gov https://openrx-api.onrender.com; "
    "base-uri 'self'; object-src 'none'; form-action 'none'; upgrade-insecure-requests"
)

# Mirror of the GoodRx slug overrides in assets/app.js (a few dosage-form slugs
# resolve to a bare GoodRx page).
GOODRX_SLUG = {
    "humira-pen": "humira",
    "humira-syringe": "humira",
    "orencia-sc": "orencia",
    "premarin-vc": "premarin-vaginal-cream",
    "zepbound-kwikpen": "zepbound",
}


def esc(s) -> str:
    return html.escape(str(s if s is not None else ""), quote=True)


def _clean(s: str) -> str:
    return (s or "").replace("®", "").replace("™", "").strip()


def money(n) -> str:
    return f"${float(n):.2f}"


def savpct(d) -> int:
    return (
        round((1 - d["price"] / d["retail"]) * 100) if d["retail"] > d["price"] else 0
    )


def dailymed_url(d) -> str:
    token = re.split(r"[\s(]", d["name"].replace("®", "").replace("™", "").strip())[0]
    return f"https://dailymed.nlm.nih.gov/dailymed/search.cfm?query={token}"


def goodrx_url(d) -> str:
    return f"https://www.goodrx.com/{GOODRX_SLUG.get(d['slug'], d['slug'])}"


def description(d) -> str:
    return (
        f"{_clean(d['name'])} ({d['generic']}) cash-pay reference price "
        f"{money(d['price'])} — {savpct(d)}% off {money(d['retail'])} retail. "
        f"Live FDA identity, cost, shortage and recall data, plus the GoodRx card "
        f"and savings programs. Reference price — verify before use."
    )


# ── Static fallback (what crawlers/no-JS read; JS replaces it with the live view)
def detail_static(d) -> str:
    ext = d["heroType"] == "ExternalLinkRouting"
    p = []
    p.append(f'<h1 class="p-name">{esc(d["name"])}</h1>')
    p.append(
        f'<div class="p-sub">{esc(d["generic"])} · {esc(_clean(d["company"]))} · {esc(d["category"])}</div>'
    )
    hero_sub = "manufacturer direct" if ext else "federal program / cash-pay"
    sav_block = (
        f'<div><div class="p-hero-vs" style="color:var(--good);font-weight:700">{savpct(d)}% savings</div>'
        f'<div class="p-hero-vs">vs {money(d["retail"])} WAC list</div></div>'
        if d["retail"] > d["price"]
        else ""
    )
    p.append(
        f'<div class="p-hero"><div><div class="p-big">{money(d["price"])}</div>'
        f'<div class="p-hero-sub">{hero_sub} · reference</div></div>{sav_block}</div>'
    )
    if d.get("status") == "limited":
        p.append('<span class="status-badge status-limited">Limited Access</span>')
    elif d.get("status") == "archived":
        p.append(
            '<span class="status-badge status-archived">Archived · Verify Availability</span>'
        )
    if d.get("priceNote"):
        p.append(f'<p class="price-note">{esc(d["priceNote"])}</p>')
    elig = d.get("eligibility")
    warn = {
        "insured-only": "⚠ Requires commercial insurance — not available to cash-pay patients",
        "medicare-only": "⚠ Medicare Part D beneficiaries only",
        "mixed": "⚠ Pricing channel varies — see price note for details",
    }.get(elig)
    if warn:
        p.append(f'<p class="eligibility-warn">{warn}</p>')
    if not ext and d.get("bin") == "015995":
        p.append('<h2 class="label">Where to fill</h2>')
        p.append(
            '<div class="coupon"><div class="coupon-t">Pharmacy coupon — cash-pay only, verify before use</div>'
            '<div class="cfields">'
            '<div class="cf"><div class="cf-l">BIN</div><div class="cf-v">015995</div></div>'
            '<div class="cf"><div class="cf-l">PCN</div><div class="cf-v">GDC</div></div>'
            '<div class="cf"><div class="cf-l">Group</div><div class="cf-v">MAHA</div></div>'
            '<div class="cf"><div class="cf-l">Member</div><div class="cf-v">RXFINDER</div></div>'
            "</div></div>"
        )
    elif ext and d.get("partner"):
        url = PARTNER_URL.get(d["partner"], "")
        link = (
            f'<a href="{esc(url)}" target="_blank" rel="noopener noreferrer" class="btn btn-sec">Continue to {esc(d["partner"])} →</a>'
            if url
            else ""
        )
        p.append(
            '<div class="coupon"><div class="coupon-t">Manufacturer direct program</div>'
            f'<p style="font-size:var(--t-sm);color:var(--text-2);margin-bottom:.6rem">{esc(d["partner"])} manages this medication directly — eligibility and checkout on their site.</p>'
            f"{link}</div>"
        )
    p.append(
        f'<div class="p-acts"><a href="{esc(dailymed_url(d))}" target="_blank" rel="noopener noreferrer" class="btn btn-pri">FDA label ↗</a>'
        f'<a href="{esc(goodrx_url(d))}" target="_blank" rel="noopener noreferrer" class="btn btn-sec">GoodRx ↗</a></div>'
    )
    p.append(
        '<div class="disclaimer-box">Cash-pay only. Reference prices and coupon codes — verify with the pharmacy before use. '
        "Do not combine with Medicare, Medicaid, or any government health program.</div>"
    )
    return "\n          ".join(p)


def jsonld(d) -> str:
    url = f"{SITE}/drugs/{d['slug']}/"
    graph = [
        {
            "@context": "https://schema.org",
            "@type": "Drug",
            "name": d["name"],
            "alternateName": d["generic"],
            "manufacturer": {
                "@type": "Organization",
                "name": _clean(d.get("company", "")),
            },
            "description": description(d),
            "url": url,
            "offers": {
                "@type": "Offer",
                "price": f"{d['price']:.2f}",
                "priceCurrency": "USD",
                "url": url,
                "availability": "https://schema.org/InStock"
                if d.get("status") == "active"
                else "https://schema.org/LimitedAvailability",
                "description": "cash-pay reference price — verify before use",
            },
        },
        {
            "@context": "https://schema.org",
            "@type": "MedicalWebPage",
            "name": f"{_clean(d['name'])} — cash-pay price and FDA data",
            "url": url,
            "lastReviewed": d.get("verified") or TODAY,
            "specialty": "Pharmacy",
            "about": {
                "@type": "Drug",
                "name": _clean(d["name"]),
                "alternateName": d["generic"],
            },
            "publisher": {"@type": "Organization", "name": "0penRX", "url": f"{SITE}/"},
        },
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                {
                    "@type": "ListItem",
                    "position": 1,
                    "name": "0penRX",
                    "item": f"{SITE}/",
                },
                {
                    "@type": "ListItem",
                    "position": 2,
                    "name": _clean(d["name"]),
                    "item": url,
                },
            ],
        },
    ]
    # Escape HTML-significant chars so catalog text can never break out of the
    # <script type="application/ld+json"> block (defense-in-depth XSS).
    body = json.dumps(graph, ensure_ascii=False, separators=(",", ":"))
    return body.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def page_html(d) -> str:
    url = f"{SITE}/drugs/{d['slug']}/"
    title = f"{_clean(d['name'])} cash price & savings — 0penRX"
    desc = description(d)
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="{CSP}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:site_name" content="0penRX">
<meta property="og:image" content="{SITE}/assets/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(desc)}">
<meta name="twitter:image" content="{SITE}/assets/og-image.png">
<meta name="theme-color" content="#017a72">
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="preconnect" href="https://openrx-api.onrender.com" crossorigin>
<link rel="preconnect" href="https://api.fda.gov" crossorigin>
<link rel="preload" href="/assets/fonts/instrument-serif-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/dm-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/styles.css">
<script type="application/ld+json">{jsonld(d)}</script>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to content</a>
<header class="hdr">
  <div class="hdr-in">
    <a href="/" class="logo" aria-label="0PENRX home">
      <svg width="27" height="27" viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <circle cx="20" cy="20" r="17.4" stroke="var(--primary)" stroke-width="3.7" fill="none"/>
        <path d="M12.6 10.8 V27 M12.6 10.8 H18.7 a4.8 4.8 0 0 1 0 9.6 H12.6 M16.8 20.4 L24 29" stroke="var(--primary)" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M22 20.6 L30 29.4 M30 20.6 L22 29.4" stroke="var(--primary)" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      </svg>
      <span class="logo-txt">0PENRX<span class="logo-tag">Zero middlemen. Open prices. Your Rx.</span></span>
    </a>
    <nav class="nav" aria-label="Sections">
      <a class="ntab" href="/">Browse</a>
      <a class="ntab" href="/#sources">Data Sources</a>
      <a class="ntab" href="/#coupons">Coupon Guide</a>
      <a class="ntab" href="/compare-platforms/">Compare Platforms</a>
      <a class="ntab" href="/uninsured-guide/">Uninsured Guide</a>
    </nav>
    <div class="hdr-r">
      <button class="icon-btn" data-theme-toggle aria-label="Toggle light/dark theme"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></button>
    </div>
  </div>
</header>
<a class="drug-back" href="/">← All 86 medications</a>
<main id="main-content" class="drug-page-wrap">
  <article class="drug-page" id="drugpage" data-slug="{esc(d["slug"])}">
          {detail_static(d)}
  </article>
</main>
<footer>
  <div class="foot">
    <div class="foot-top">
      <div class="foot-brand">
        <span class="foot-logo">0PENRX</span>
        <span class="foot-tag">Zero middlemen. Open prices. Your Rx.</span>
      </div>
      <nav class="foot-links" aria-label="Live data sources">
        <span class="foot-links-l">Live data</span>
        <a href="https://rxnav.nlm.nih.gov" target="_blank" rel="noopener noreferrer">NLM RxNorm</a>
        <a href="https://open.fda.gov" target="_blank" rel="noopener noreferrer">openFDA</a>
        <a href="https://data.medicaid.gov/datasets?keyword=nadac" target="_blank" rel="noopener noreferrer">CMS NADAC</a>
      </nav>
    </div>
    <div class="foot-legal">
      <p>0penRX is for information only — not medical, legal, insurance, pharmacy, or pricing advice — and is independent, not affiliated with, endorsed by, or sponsored by any manufacturer, PBM, pharmacy, insurer, trade group, coupon network, or government agency. Prices, coupons, and availability change; verify with the pharmacy, manufacturer, or program before use. Cash-pay prices only.</p>
    </div>
    <div class="foot-copy">&copy; 2026 QANTM AI. All rights reserved. · <a href="/privacy/">Privacy</a> · <a href="/compare-platforms/">Compare Platforms</a> · <a href="/uninsured-guide/">Uninsured Guide</a> · <a href="/#sources">Data Sources</a> · <a href="/#coupons">Coupon Guide</a> <span id="catalogVerified" class="foot-verified"></span></div>
  </div>
</footer>
<script src="/assets/config.js"></script>
<script type="module" src="/assets/app.js"></script>
</body>
</html>
"""


# Standalone content pages (not per-drug). Each entry is
# (path, lastmod, priority). Hand-authored HTML lives in the repo; the sitemap
# is generated here so these stay listed. Keep in sync with the actual files.
CONTENT_PAGES = [
    ("compare-platforms/", "2026-07-03", "0.9"),
    ("uninsured-guide/", "2026-07-03", "0.9"),
    ("privacy/", TODAY, "0.5"),
]


def build(catalog):
    """Return {relative_path: contents} for every drug page + sitemap.xml."""
    files = {}
    for d in catalog:
        files[os.path.join("drugs", d["slug"], "index.html")] = page_html(d)
    # sitemap: homepage + every drug page + the standalone content pages.
    # Each entry is (loc, lastmod, priority).
    entries = (
        [(f"{SITE}/", TODAY, "1.0")]
        + [(f"{SITE}/drugs/{d['slug']}/", TODAY, "0.8") for d in catalog]
        + [(f"{SITE}/{path}", lastmod, prio) for path, lastmod, prio in CONTENT_PAGES]
    )
    urls = "\n".join(
        f"  <url>\n    <loc>{loc}</loc>\n    <lastmod>{lastmod}</lastmod>\n"
        f"    <changefreq>weekly</changefreq>\n    <priority>{prio}</priority>\n  </url>"
        for loc, lastmod, prio in entries
    )
    files["sitemap.xml"] = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{urls}\n</urlset>\n"
    )
    return files


def main():
    ap = argparse.ArgumentParser(description="Generate per-drug static pages + sitemap")
    ap.add_argument("--check", action="store_true", help="exit 1 if any file is stale")
    args = ap.parse_args()

    catalog = load_catalog(CATALOG_PATH)
    files = build(catalog)

    if args.check:
        stale = []
        for rel, content in files.items():
            path = os.path.join(_REPO_ROOT, rel)
            if (
                not os.path.exists(path)
                or open(path, encoding="utf-8").read() != content
            ):
                stale.append(rel)
        # also flag orphan drug pages (slug removed from catalog)
        valid = {os.path.join("drugs", d["slug"], "index.html") for d in catalog}
        if os.path.isdir(DRUGS_DIR):
            for slug in os.listdir(DRUGS_DIR):
                rel = os.path.join("drugs", slug, "index.html")
                if os.path.exists(os.path.join(_REPO_ROOT, rel)) and rel not in valid:
                    stale.append(f"{rel} (orphan)")
        if stale:
            print("Stale per-drug pages — run: python data/build_drug_pages.py")
            for s in stale[:10]:
                print(f"  {s}")
            sys.exit(1)
        print(f"All {len(catalog)} drug pages + sitemap in sync.")
        return

    for rel, content in files.items():
        path = os.path.join(_REPO_ROOT, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
    print(f"Wrote {len(catalog)} drug pages + sitemap.xml.")


if __name__ == "__main__":
    main()
