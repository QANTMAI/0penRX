#!/usr/bin/env python3
"""Check that every manufacturer-programme link a patient can click still resolves.

These are the highest-stakes external links on the site: the "Continue to <programme>"
button is how an uninsured patient reaches their savings or assistance programme. They
rot silently — a 2026-07 audit found `synthroid.com/savings` returning 404 and
`novartisoncologysupport.com` gone to NXDOMAIN, on two oncology drugs, with nothing in
CI to catch either. This is that missing check.

    python data/check_partner_links.py           # exit 1 if any live-used link is dead

Only partners actually referenced by a catalog entry are checked — an unused row in
PARTNER_URL cannot mislead anyone.

A 403/405/429 is NOT a failure. Several manufacturer sites (LillyDirect, AbbVie) block
automated clients outright while serving humans perfectly well; treating those as dead
would make the check cry wolf until it got ignored. Only an explicit 404/410 or a DNS/
connection failure — which is what actually happened — fails the build.
"""

from __future__ import annotations

import concurrent.futures
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from build_coupons import PARTNER_URL  # noqa: E402

CATALOG_PATH = os.path.join(os.path.dirname(_HERE), "assets", "catalog.js")
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
TIMEOUT = 30
# Served to humans, closed to bots. Live, not dead.
BOT_BLOCKED = {401, 403, 405, 429}


def used_partners() -> dict[str, list[str]]:
    """Partner -> [slug, ...] for partners a catalog entry actually routes to."""
    src = open(CATALOG_PATH, encoding="utf-8").read()
    m = re.search(r"export const CATALOG = (\[.*?\]);", src, re.S)
    if not m:
        raise SystemExit("could not parse CATALOG out of assets/catalog.js")
    used: dict[str, list[str]] = {}
    for d in json.loads(m.group(1)):
        if d.get("partner"):
            used.setdefault(d["partner"], []).append(d["slug"])
    return used


def probe(url: str) -> tuple[int | str, str]:
    ctx = ssl.create_default_context()
    last: tuple[int | str, str] = ("ERR", "")
    for _ in range(2):  # one retry: a single network blip must not fail the build
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": UA, "Accept": "text/html,*/*"}
            )
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as r:
                return r.status, r.geturl()
        except urllib.error.HTTPError as e:
            return e.code, url
        except Exception as e:  # DNS/TLS/connection — retry once, then report
            last = (type(e).__name__, url)
    return last


def main() -> None:
    used = used_partners()
    unmapped = sorted(p for p in used if p not in PARTNER_URL)

    rows = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        futs = {
            ex.submit(probe, PARTNER_URL[p]): p for p in used if p in PARTNER_URL
        }
        for f in concurrent.futures.as_completed(futs):
            p = futs[f]
            status, final = f.result()
            rows.append((p, PARTNER_URL[p], status, final))

    dead = []
    for p, url, status, _final in sorted(rows, key=lambda r: r[0].lower()):
        if status == 200:
            note = "ok"
        elif isinstance(status, int) and 300 <= status < 400:
            note = "redirect"
        elif status in BOT_BLOCKED:
            note = "bot-blocked (live)"
        else:
            note = "DEAD"
            dead.append((p, url, status, used[p]))
        print(f"  {str(status):>9}  {p:<40} {note}")

    print(f"\n{len(rows)} partner link(s) checked, {len(dead)} dead, {len(unmapped)} unmapped.")

    for p in unmapped:
        print(f"::error::partner {p!r} is used by {used[p]} but has no PARTNER_URL entry")
    for p, url, status, slugs in dead:
        print(
            f"::error::partner link dead ({status}): {p} -> {url} "
            f"— reached from the CTA on: {', '.join(slugs)}"
        )

    if dead or unmapped:
        sys.exit(1)
    print("All patient-facing programme links resolve.")


if __name__ == "__main__":
    main()
