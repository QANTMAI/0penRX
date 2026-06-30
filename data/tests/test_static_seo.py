"""Guard: index.html's injected static-SEO blocks stay in sync with catalog.js.

AI crawlers don't run JS, so the catalog is baked into index.html as a JSON-LD
ItemList + a <noscript> list by data/build_static_seo.py. If someone edits the
catalog without re-running the builder, the static blocks go stale and crawlers
see the wrong data. This test fails CI when that happens.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "data"))

from build_static_seo import (  # noqa: E402
    CATALOG_PATH,
    INDEX_HTML,
    load_catalog,
    render,
)

CATALOG = load_catalog(CATALOG_PATH)
INDEX = Path(INDEX_HTML).read_text(encoding="utf-8")


def test_static_seo_in_sync():
    """index.html must equal the builder's output for the current catalog."""
    assert render(CATALOG, INDEX) == INDEX, (
        "index.html static-SEO blocks are stale — run: python data/build_static_seo.py"
    )


def test_itemlist_covers_every_drug():
    blocks = re.findall(
        r'<script type="application/ld\+json">\s*(.*?)\s*</script>', INDEX, re.S
    )
    itemlists = [json.loads(b) for b in blocks if '"ItemList"' in b]
    assert len(itemlists) == 1, "expected exactly one ItemList JSON-LD block"
    il = itemlists[0]
    assert il["numberOfItems"] == len(CATALOG)
    assert len(il["itemListElement"]) == len(CATALOG)
    names = {e["item"]["name"] for e in il["itemListElement"]}
    assert names == {d["name"] for d in CATALOG}


def test_noscript_lists_every_drug():
    m = re.search(r"<noscript>.*?</noscript>", INDEX, re.S)
    assert m, "no <noscript> catalog block found"
    assert m.group(0).count("<li><strong>") == len(CATALOG)
