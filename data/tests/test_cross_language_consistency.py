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

# Placeholder the frontend is allowed to show where the backend value is None.
# Any other value in that slot is treated as fabricated data and fails the test.
_PCN_PLACEHOLDER = "—"  # em dash
_GROUP_PLACEHOLDER = "—"
_MEMBER_PLACEHOLDER = "See Rx"


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


def _parse_bin_info(js: str) -> dict[str, dict[str, str]]:
    block = _js_object_block(js, "BIN_INFO")
    info: dict[str, dict[str, str]] = {}
    for entry in re.finditer(r"'(\d{6})'\s*:\s*\{([^}]*)\}", block):
        bin_value, inner = entry.group(1), entry.group(2)
        info[bin_value] = dict(re.findall(r"(\w+)\s*:\s*'([^']*)'", inner))
    assert info, "Parsed no entries out of BIN_INFO — has its format changed?"
    return info


def _parse_js_partner_url(js: str) -> dict[str, str]:
    block = _js_object_block(js, "PARTNER_URL")
    pairs = dict(re.findall(r"'([^']+)'\s*:\s*'([^']+)'", block))
    assert pairs, "Parsed no entries out of PARTNER_URL — has its format changed?"
    return pairs


def _expected_js(py_value, placeholder):
    """The value the frontend must show for a given authoritative backend value."""
    return placeholder if py_value is None else py_value


def test_bin_codes_match_backend():
    """BIN_INFO (frontend) must agree with BIN_MAP (backend) on every BIN, with
    backend None mapped to the allowed frontend placeholder — never a real code."""
    bc = _load_build_coupons()
    bin_info = _parse_bin_info(APP_JS.read_text(encoding="utf-8"))

    assert set(bin_info) == set(bc.BIN_MAP), (
        "Frontend BIN_INFO and backend BIN_MAP cover different BINs: "
        f"only in app.js={set(bin_info) - set(bc.BIN_MAP)}, "
        f"only in build_coupons.py={set(bc.BIN_MAP) - set(bin_info)}"
    )

    for bin_value, (pcn, group, member) in bc.BIN_MAP.items():
        js = bin_info[bin_value]
        for field, py_value, placeholder in (
            ("pcn", pcn, _PCN_PLACEHOLDER),
            ("group", group, _GROUP_PLACEHOLDER),
            ("member", member, _MEMBER_PLACEHOLDER),
        ):
            expected = _expected_js(py_value, placeholder)
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
