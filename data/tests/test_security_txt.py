"""RFC 9116 security.txt compliance + anti-rot guard.

security.txt is only useful if it is valid and *current*. A hardcoded `Expires`
date silently lapses; two copies (root + /.well-known) silently drift. This test
makes both failure modes impossible in CI:

  * both files must be byte-identical (no drift),
  * required RFC 9116 fields must be present (>=1 Contact, exactly 1 Expires,
    >=1 Canonical),
  * `Expires` must parse as ISO 8601, be in the future, AND be more than 30 days
    out — so CI turns red ~30 days *before* the file expires, forcing a bump
    while the current file is still valid.

Renewal: when this test warns, update `Expires:` in BOTH
`.well-known/security.txt` and `security.txt` to a new date <1 year out.
"""

from __future__ import annotations

import datetime as dt
import os
import re

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(os.path.dirname(_HERE))
CANONICAL = os.path.join(_ROOT, ".well-known", "security.txt")
LEGACY = os.path.join(_ROOT, "security.txt")

RENEW_WINDOW_DAYS = 30


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _fields(text: str) -> list[tuple[str, str]]:
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^([A-Za-z-]+):\s*(.+)$", line)
        assert m, f"malformed security.txt line (RFC 9116 field: value): {line!r}"
        out.append((m.group(1).lower(), m.group(2).strip()))
    return out


def test_both_locations_exist_and_are_identical():
    assert os.path.exists(CANONICAL), ".well-known/security.txt is missing"
    assert os.path.exists(LEGACY), "root security.txt is missing (legacy-scanner copy)"
    # Byte-identical → the two locations can never drift.
    assert _read(CANONICAL) == _read(LEGACY), (
        "security.txt copies differ — keep .well-known/security.txt and "
        "security.txt byte-identical"
    )


def test_required_rfc9116_fields_present():
    fields = _fields(_read(CANONICAL))
    keys = [k for k, _ in fields]
    assert keys.count("contact") >= 1, "RFC 9116 requires at least one Contact field"
    assert keys.count("expires") == 1, "RFC 9116 requires exactly one Expires field"
    assert keys.count("canonical") >= 1, (
        "Canonical field should declare the authoritative URI"
    )
    # Contact values must be actionable URIs (mailto:/https:/tel:).
    for k, v in fields:
        if k == "contact":
            assert re.match(r"^(mailto:|https?://|tel:)", v), (
                f"Contact must be a URI: {v!r}"
            )


def test_expires_is_valid_future_and_not_near_lapse():
    (expires_raw,) = [v for k, v in _fields(_read(CANONICAL)) if k == "expires"]
    # ISO 8601; normalise a trailing Z to an explicit UTC offset for fromisoformat.
    expires = dt.datetime.fromisoformat(expires_raw.replace("Z", "+00:00"))
    assert expires.tzinfo is not None, (
        "Expires must carry a timezone (RFC 9116 / ISO 8601)"
    )
    now = dt.datetime.now(dt.timezone.utc)
    assert expires > now, (
        f"security.txt Expires has LAPSED ({expires_raw}) — bump it now"
    )
    days_left = (expires - now).days
    assert days_left > RENEW_WINDOW_DAYS, (
        f"security.txt Expires in {days_left} days ({expires_raw}); bump the "
        f"Expires date (<1 year out) in BOTH .well-known/security.txt and "
        f"security.txt before it lapses."
    )
