"""Inject crawler-readable static representations of the catalog into index.html.

AI crawlers (GPTBot, ClaudeBot, PerplexityBot, …) do NOT execute JavaScript, so
they never see the JS-rendered drug grid. This script bakes the catalog into the
static HTML two ways, both generated from assets/catalog.js (the single source of
truth):

  1. A JSON-LD ``ItemList`` of every drug (structured data — Google + AI read it).
  2. A ``<noscript>`` catalog list (readable text shown only when JS is off, i.e.
     to no-JS agents — JS users get the interactive grid instead, so no duplication).

Both are written between HTML-comment markers in index.html so the rest of the
file is untouched. Run after any catalog change; CI (test_static_seo.py) fails if
index.html drifts out of sync.

Usage:
    python data/build_static_seo.py          # rewrite the injected blocks
    python data/build_static_seo.py --check   # exit 1 if index.html is out of date
"""

from __future__ import annotations

import argparse
import html
import json
import os
import sys

_DATA_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_DATA_DIR)
INDEX_HTML = os.path.join(_REPO_ROOT, "index.html")
CATALOG_PATH = os.path.join(_REPO_ROOT, "assets", "catalog.js")

sys.path.insert(0, _DATA_DIR)
from build_coupons import load_catalog  # noqa: E402

SITE = "https://0penrx.org/"

ITEMLIST_START = "<!-- SEO:ITEMLIST:START"
ITEMLIST_END = "<!-- SEO:ITEMLIST:END -->"
CATALOG_START = "<!-- SEO:CATALOG:START"
CATALOG_END = "<!-- SEO:CATALOG:END -->"


def _clean(s: str) -> str:
    return (s or "").replace("®", "").replace("™", "").strip()


def build_itemlist(catalog: list[dict]) -> str:
    """A JSON-LD ItemList of every catalog drug (name, generic, maker, price)."""
    elements = []
    for i, d in enumerate(catalog, start=1):
        drug = {
            "@type": "Drug",
            "name": d["name"],
            "alternateName": d["generic"],
            "manufacturer": {
                "@type": "Organization",
                "name": _clean(d.get("company", "")),
            },
            "offers": {
                "@type": "Offer",
                "price": f"{d['price']:.2f}",
                "priceCurrency": "USD",
                "description": "cash-pay reference price — verify before use",
                "availability": "https://schema.org/InStock"
                if d.get("status") == "active"
                else "https://schema.org/LimitedAvailability",
            },
        }
        elements.append({"@type": "ListItem", "position": i, "item": drug})
    payload = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": "0penRX cash-pay medication catalog",
        "description": "Curated cash-pay reference prices for high-cost brand-name and biosimilar medications.",
        "numberOfItems": len(catalog),
        "itemListElement": elements,
    }
    # Compact (no indentation) — valid JSON-LD, ~3x smaller in the served HTML.
    # Escape HTML-significant chars so catalog text can never break out of the
    # <script> block (e.g. a literal "</script>" or "&"): defense-in-depth XSS.
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    body = body.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return (
        f"{ITEMLIST_START} — generated from assets/catalog.js by "
        f"data/build_static_seo.py; do not edit by hand -->\n"
        f'<script type="application/ld+json">\n{body}\n</script>\n'
        f"{ITEMLIST_END}"
    )


def build_noscript(catalog: list[dict]) -> str:
    """A no-JS readable list of every drug, shown only when JavaScript is off."""
    rows = []
    for d in catalog:
        name = html.escape(d["name"])
        gen = html.escape(d["generic"])
        co = html.escape(_clean(d.get("company", "")))
        cat = html.escape(d.get("category", ""))
        price = f"${d['price']:.2f}"
        retail = f"${d['retail']:.2f}"
        sav = d.get("savings", 0)
        note = d.get("priceNote")
        extra = f" <em>({html.escape(note)})</em>" if note else ""
        rows.append(
            f"<li><strong>{name}</strong> ({gen}) — {co} · {cat} — "
            f"cash-pay reference {price}, {sav}% off retail {retail}{extra}</li>"
        )
    lis = "\n      ".join(rows)
    return (
        f"{CATALOG_START} — generated from assets/catalog.js by "
        f"data/build_static_seo.py; do not edit by hand.\n"
        f"         Shown only when JavaScript is off (the JS app renders the interactive grid above),\n"
        f"         so AI crawlers and no-JS agents can still read the full catalog as text. -->\n"
        f"    <noscript>\n"
        f'      <section class="seo-catalog">\n'
        f"        <h2>All {len(catalog)} cash-pay medications</h2>\n"
        f"        <p>Curated cash-pay reference prices (verify at the pharmacy before use). "
        f"Search any drug above for live FDA identity, cost, shortage and recall data.</p>\n"
        f"      <ul>\n"
        f"      {lis}\n"
        f"      </ul>\n"
        f"      </section>\n"
        f"    </noscript>\n"
        f"    {CATALOG_END}"
    )


def _splice(text: str, start_marker: str, end_marker: str, replacement: str) -> str:
    s = text.find(start_marker)
    e = text.find(end_marker)
    if s == -1 or e == -1:
        raise ValueError(
            f"Markers {start_marker!r}/{end_marker!r} not found in index.html"
        )
    e_end = e + len(end_marker)
    return text[:s] + replacement + text[e_end:]


def render(catalog: list[dict], current: str) -> str:
    out = _splice(current, ITEMLIST_START, ITEMLIST_END, build_itemlist(catalog))
    out = _splice(out, CATALOG_START, CATALOG_END, build_noscript(catalog))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Inject static catalog SEO into index.html"
    )
    ap.add_argument(
        "--check", action="store_true", help="exit 1 if index.html is stale"
    )
    args = ap.parse_args()

    catalog = load_catalog(CATALOG_PATH)
    with open(INDEX_HTML, encoding="utf-8") as f:
        current = f.read()
    updated = render(catalog, current)

    if args.check:
        if updated != current:
            print(
                "index.html static SEO blocks are STALE — run: python data/build_static_seo.py"
            )
            sys.exit(1)
        print(f"index.html static SEO in sync ({len(catalog)} drugs).")
        return

    if updated != current:
        with open(INDEX_HTML, "w", encoding="utf-8") as f:
            f.write(updated)
        print(f"Injected {len(catalog)} drugs into index.html (ItemList + noscript).")
    else:
        print("index.html already up to date.")


if __name__ == "__main__":
    main()
