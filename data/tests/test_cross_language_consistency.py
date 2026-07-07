"""Airtight guard against drift between the JavaScript and Python copies of the
coupon-adjudication data.

The same facts are necessarily encoded twice — once for the static frontend
(``assets/app.js``: ``BIN_INFO`` and ``PARTNER_URL``) and once for the backend
dataset generator (``data/build_coupons.py``: ``BIN_MAP`` and ``PARTNER_URL``) —
because one is browser JavaScript and the other is Python. A wrong or drifted
BIN / PCN / Group / Member code fails a real person at the pharmacy counter, so
this test fails CI the moment the two copies disagree.

It also enforces a no-fabrication rule: where the authoritative backend has no
verified value (``None``), the frontend must show a recognised *placeholder*
(``—`` for PCN/Group, ``See Rx`` for Member) and must NOT invent a real code.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
APP_JS = REPO / "assets" / "app.js"


def _load_build_coupons():
    path = REPO / "data" / "build_coupons.py"
    spec = importlib.util.spec_from_file_location("build_coupons", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _js_object_block(js: str, name: str) -> str:
    """Return the text between ``const <name> = {`` and the closing ``\\n};``."""
    m = re.search(rf"const {re.escape(name)}\s*=\s*\{{(.*?)\n\}};", js, re.S)
    assert m, f"Could not locate `const {name} = {{ ... }};` in {APP_JS}"
    return m.group(1)


def _extract_unavailable(js: str) -> str:
    """The single honest string the frontend shows for any unverified field."""
    m = re.search(r"const UNAVAILABLE\s*=\s*'([^']*)'", js)
    assert m, "Could not find `const UNAVAILABLE = '...'` in app.js"
    return m.group(1)


def _parse_bin_info(js: str, unavailable: str) -> dict[str, dict[str, str]]:
    block = _js_object_block(js, "BIN_INFO")
    info: dict[str, dict[str, str]] = {}
    for entry in re.finditer(r"'(\d{6})'\s*:\s*\{([^}]*)\}", block):
        bin_value, inner = entry.group(1), entry.group(2)
        fields: dict[str, str] = {}
        # A field value is either a quoted literal or the bareword UNAVAILABLE.
        for fm in re.finditer(r"(\w+)\s*:\s*(?:'([^']*)'|(UNAVAILABLE))", inner):
            fields[fm.group(1)] = unavailable if fm.group(3) else fm.group(2)
        info[bin_value] = fields
    assert info, "Parsed no entries out of BIN_INFO — has its format changed?"
    return info


def _parse_js_partner_url(js: str) -> dict[str, str]:
    block = _js_object_block(js, "PARTNER_URL")
    pairs = dict(re.findall(r"'([^']+)'\s*:\s*'([^']+)'", block))
    assert pairs, "Parsed no entries out of PARTNER_URL — has its format changed?"
    return pairs


def test_bin_codes_match_backend():
    """BIN_INFO (frontend) must agree with BIN_MAP (backend) on every BIN. Where
    the backend has no verified value (None), the frontend must show the single
    honest 'unavailable' string — never a real code and never a different
    placeholder."""
    js_text = APP_JS.read_text(encoding="utf-8")
    unavailable = _extract_unavailable(js_text)
    bc = _load_build_coupons()
    bin_info = _parse_bin_info(js_text, unavailable)

    assert set(bin_info) == set(bc.BIN_MAP), (
        "Frontend BIN_INFO and backend BIN_MAP cover different BINs: "
        f"only in app.js={set(bin_info) - set(bc.BIN_MAP)}, "
        f"only in build_coupons.py={set(bc.BIN_MAP) - set(bin_info)}"
    )

    for bin_value, (pcn, group, member) in bc.BIN_MAP.items():
        js = bin_info[bin_value]
        for field, py_value in (("pcn", pcn), ("group", group), ("member", member)):
            expected = unavailable if py_value is None else py_value
            assert js[field] == expected, (
                f"BIN {bin_value} field '{field}' has drifted: "
                f"app.js BIN_INFO shows {js[field]!r} but build_coupons.py "
                f"BIN_MAP authoritatively has {py_value!r} "
                f"(expected frontend value {expected!r}). "
                "Update both copies, and never show a real code the backend lacks."
            )


def test_partner_urls_match_backend():
    """The frontend and backend PARTNER_URL maps must be identical, so a given
    program resolves to the same destination on the static site and in the
    generated coupon dataset."""
    bc = _load_build_coupons()
    js_partner = _parse_js_partner_url(APP_JS.read_text(encoding="utf-8"))

    assert js_partner == bc.PARTNER_URL, (
        "Frontend and backend PARTNER_URL have drifted.\n"
        f"only in app.js={set(js_partner) - set(bc.PARTNER_URL)}\n"
        f"only in build_coupons.py={set(bc.PARTNER_URL) - set(js_partner)}\n"
        "url mismatches="
        + repr(
            {
                k: (js_partner.get(k), bc.PARTNER_URL.get(k))
                for k in set(js_partner) | set(bc.PARTNER_URL)
                if js_partner.get(k) != bc.PARTNER_URL.get(k)
            }
        )
    )


def test_catalog_partners_in_partner_url():
    """Every catalog drug that names a partner program must resolve in PARTNER_URL.

    A partner value missing from PARTNER_URL means the coupon record gets
    url=None (the PARTNER_URL.get() call silently returns None) and the user
    sees a broken or missing assistance-program link.  Fail CI the moment a new
    partner is added to the catalog without a corresponding PARTNER_URL entry.
    """
    bc = _load_build_coupons()
    catalog = bc.load_catalog(str(REPO / "assets" / "catalog.js"))
    js_text = APP_JS.read_text(encoding="utf-8")
    partner_url = _parse_js_partner_url(js_text)

    missing = [
        (d["slug"], d["partner"])
        for d in catalog
        if d.get("partner") and d["partner"] not in partner_url
    ]
    assert not missing, (
        "Catalog drugs with partner values not found in PARTNER_URL: "
        + repr(missing)
        + "\nAdd them to PARTNER_URL in both assets/app.js and data/build_coupons.py."
    )


def _parse_goodrx_slug_js(js: str) -> dict[str, str]:
    block = _js_object_block(js, "GOODRX_SLUG")
    pairs = dict(re.findall(r"'([a-z0-9-]+)'\s*:\s*'([a-z0-9-]+)'", block))
    assert pairs, "Parsed no entries out of GOODRX_SLUG — has its format changed?"
    return pairs


def _load_build_drug_pages():
    path = REPO / "data" / "build_drug_pages.py"
    spec = importlib.util.spec_from_file_location("build_drug_pages", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_goodrx_slug_overrides_match():
    """The GoodRx slug-override map exists in JS (modal links) and Python (static
    drug-page links). Drift would send the modal and the static page for the SAME
    drug to two different GoodRx URLs, so the copies must be identical."""
    js = APP_JS.read_text(encoding="utf-8")
    js_map = _parse_goodrx_slug_js(js)
    py_map = _load_build_drug_pages().GOODRX_SLUG
    assert js_map == py_map, (
        f"GOODRX_SLUG drift between app.js and build_drug_pages.py:\n"
        f"  only in JS: { {k: v for k, v in js_map.items() if py_map.get(k) != v} }\n"
        f"  only in PY: { {k: v for k, v in py_map.items() if js_map.get(k) != v} }"
    )
