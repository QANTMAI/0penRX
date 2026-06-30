"""Guard: the per-drug static pages + sitemap stay in sync with catalog.js.

build_drug_pages.py emits one crawlable page per drug at drugs/<slug>/index.html
plus sitemap.xml. If the catalog changes without regenerating, search engines
and AI crawlers index stale data. This test fails CI when that happens.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "data"))

from build_drug_pages import CATALOG_PATH, build, load_catalog  # noqa: E402

CATALOG = load_catalog(CATALOG_PATH)
FILES = build(CATALOG)


def test_every_drug_has_a_page():
    for d in CATALOG:
        assert f"drugs/{d['slug']}/index.html" in FILES


def test_pages_and_sitemap_in_sync():
    stale = []
    for rel, content in FILES.items():
        p = REPO / rel
        if not p.exists() or p.read_text(encoding="utf-8") != content:
            stale.append(rel)
    assert not stale, (
        f"stale per-drug pages — run: python data/build_drug_pages.py ({stale[:5]})"
    )


def test_no_orphan_pages():
    valid = {f"drugs/{d['slug']}/index.html" for d in CATALOG}
    drugs_dir = REPO / "drugs"
    if drugs_dir.is_dir():
        for slug_dir in drugs_dir.iterdir():
            if (slug_dir / "index.html").exists():
                rel = f"drugs/{slug_dir.name}/index.html"
                assert rel in valid, f"orphan drug page (slug not in catalog): {rel}"


def test_sitemap_lists_homepage_plus_every_drug():
    sitemap = FILES["sitemap.xml"]
    locs = set(re.findall(r"<loc>(.*?)</loc>", sitemap))
    assert "https://0penrx.org/" in locs
    for d in CATALOG:
        assert f"https://0penrx.org/drugs/{d['slug']}/" in locs
    assert len(locs) == len(CATALOG) + 1


def test_each_page_has_canonical_and_valid_jsonld():
    for d in CATALOG:
        h = FILES[f"drugs/{d['slug']}/index.html"]
        assert f'rel="canonical" href="https://0penrx.org/drugs/{d["slug"]}/"' in h
        m = re.search(r'<script type="application/ld\+json">(.*?)</script>', h, re.S)
        assert m, f"no JSON-LD in {d['slug']} page"
        graph = json.loads(m.group(1))
        types = {b["@type"] for b in graph}
        assert "Drug" in types and "BreadcrumbList" in types
        assert f'id="drugpage" data-slug="{d["slug"]}"' in h
