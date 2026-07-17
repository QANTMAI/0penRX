#!/usr/bin/env python3
"""Flag catalog prices whose known expiry is approaching, so a stale price can't sit live.

Some `price` values are only valid until a date the manufacturer published — e.g. the
NovoCare Ozempic/Wegovy $199 intro is a first-2-fills price "through Dec 31, 2026", after
which the real cost is $349/month. A price like that silently becomes WRONG on its expiry;
nothing here would have said so.

Any entry in assets/catalog.js may carry `priceReviewBy: "YYYY-MM-DD"`. This checks each
one against today:

    overdue   reviewBy < today                     the price may already be wrong
    due-soon  today <= reviewBy <= today + LEAD     re-verify before it expires
    ok        reviewBy > today + LEAD               nothing to do

    python data/check_price_freshness.py                 # LEAD = 45 days, today = real
    python data/check_price_freshness.py --today 2026-12-01   # simulate a date (tests)
    python data/check_price_freshness.py --issue-body-file /tmp/body.md   # write reminder

Exit 1 if anything is overdue or due-soon (the scheduled workflow turns that into the
reminder: a GitHub Issue assigned to the repo owner + a failing run + an e-mail). Exit 0
when every dated price is still comfortably in date.

## Where the reminder goes, who responds, and how

Delivered by .github/workflows/price-freshness.yml (monthly):
  - a GitHub **Issue** labelled `price-review`, **assigned to the repo owner (QANTMAI)**,
    listing each due drug and the exact `priceSource` URL to re-check;
  - a **failing scheduled run** — a red check on the Actions tab and a GitHub e-mail to
    the owner;
  - the job **summary** with the table below.
The owner responds by re-verifying each due price at its `priceSource`, then updating
`price` / `priceNote` / `priceReviewBy` (or removing the drug) and committing — which turns
the check green and lets the issue be closed.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG_PATH = os.path.join(os.path.dirname(_HERE), "assets", "catalog.js")
DEFAULT_LEAD_DAYS = 60


def load_catalog() -> list[dict]:
    src = open(CATALOG_PATH, encoding="utf-8").read()
    m = re.search(r"export const CATALOG = (\[.*?\]);", src, re.S)
    if not m:
        raise SystemExit("could not parse CATALOG out of assets/catalog.js")
    return json.loads(m.group(1))


def classify(review_by: dt.date, today: dt.date, lead: int) -> str:
    if review_by < today:
        return "overdue"
    if review_by <= today + dt.timedelta(days=lead):
        return "due-soon"
    return "ok"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lead-days", type=int, default=DEFAULT_LEAD_DAYS)
    ap.add_argument("--today", help="override today's date (YYYY-MM-DD) for testing")
    ap.add_argument(
        "--issue-body-file", help="write a Markdown reminder body here if due"
    )
    args = ap.parse_args()

    today = dt.date.fromisoformat(args.today) if args.today else dt.date.today()

    dated = []
    for d in load_catalog():
        rb = d.get("priceReviewBy")
        if not rb:
            continue
        # Format is validated in catalog-validator.js; guard anyway so a bad date is loud.
        try:
            review_by = dt.date.fromisoformat(rb)
        except ValueError:
            print(f"::error::{d['slug']}: priceReviewBy {rb!r} is not YYYY-MM-DD")
            sys.exit(1)
        dated.append((d, review_by, classify(review_by, today, args.lead_days)))

    dated.sort(key=lambda t: t[1])
    due = [t for t in dated if t[2] != "ok"]

    print(
        f"today={today}  lead={args.lead_days}d  dated prices={len(dated)}  due={len(due)}\n"
    )
    for d, review_by, status in dated:
        days = (review_by - today).days
        mark = {"overdue": "OVERDUE", "due-soon": "due soon", "ok": "ok"}[status]
        print(
            f"  {mark:8} {d['slug']:16} reviewBy {review_by} ({days:+d}d)  {d.get('priceSource', '')}"
        )

    # A machine- and human-readable reminder the workflow turns into an issue body.
    if due:
        lines = [
            "One or more catalog prices are at or past their published expiry and must be "
            "re-verified.\n",
            "| Drug | Review by | Status | Current price | Source to re-check |",
            "|---|---|---|---|---|",
        ]
        for d, review_by, status in due:
            lines.append(
                f"| `{d['slug']}` | {review_by} | {status} | ${d['price']} | "
                f"{d.get('priceSource', '—')} |"
            )
        lines += [
            "",
            "**To resolve:** open each source above, confirm the current cash price, then "
            "update `price` / `savings` / `priceNote` / `priceReviewBy` in `assets/catalog.js` "
            "(or remove the drug if no cash price remains). Committing turns the "
            "**Price freshness** check green; then close this issue.",
        ]
        body = "\n".join(lines)
        if args.issue_body_file:
            with open(args.issue_body_file, "w", encoding="utf-8") as f:
                f.write(body)
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as f:
                f.write("## Price freshness — review due\n\n" + body + "\n")
        print(
            "\n::error::"
            + f"{len(due)} price(s) need re-verification: "
            + ", ".join(d["slug"] for d, _, _ in due)
        )
        sys.exit(1)

    print("\nAll dated prices are comfortably in date.")


if __name__ == "__main__":
    main()
