"""Convert the Team Cuban Card medication list into assets/teamcuban.js.

WHY A MANUAL FILE AND NOT A SCRAPER
-----------------------------------
teamcubancard.com's Terms of Use prohibit "us[ing] robots or scripts with the
Site", so this project does NOT crawl them. Their medication page offers a
"Download an Excel Version of the Current Medication List" button; a person
clicks it and drops the file in data/sources/. This script only ever reads that
local file. There is deliberately no network code here, and adding any would
reintroduce exactly the behaviour their terms forbid.

Because refreshes are manual, the capture date is baked into the output and
surfaced in the UI. A price that silently goes stale on a health site sends
someone to a pharmacy counter with the wrong number, so staleness is made
visible rather than hidden.

Input  : data/sources/teamcuban-medications.xlsx  (or .csv)
Output : assets/teamcuban.js

Usage:
    python data/build_teamcuban.py            # (re)generate
    python data/build_teamcuban.py --check    # exit 1 if stale (CI drift gate)
"""

from __future__ import annotations

import argparse
import csv
import datetime as _dt
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

_DATA_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_DATA_DIR)
_SRC_DIR = os.path.join(_DATA_DIR, "sources")
_OUT_PATH = os.path.join(_REPO_ROOT, "assets", "teamcuban.js")

SOURCE_URL = "https://www.teamcubancard.com/medications/"

# The columns as the site presents them. Matching is case/space-insensitive and
# accepts a few plausible header spellings, because the export's exact headers
# are the vendor's to change and a rename should not silently drop a column.
_COLUMN_ALIASES = {
    # "Generice Name" is the vendor's own spelling in the Sep 2026 export. Kept
    # verbatim rather than "corrected", because the file is theirs and a future
    # export may still carry it.
    "name": (
        "name",
        "drug",
        "drugname",
        "medication",
        "product",
        "genericname",
        "genericename",
        "genericedrugname",
    ),
    "strength": ("strength", "dose", "dosage"),
    "form": ("form", "dosageform", "dosage form"),
    "quantity": ("quantity", "qty", "packsize", "pack size"),
    "price": ("price", "cost", "cashprice", "yourprice"),
}

_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _norm_header(h: str) -> str:
    return re.sub(r"[^a-z]", "", (h or "").lower())


def _map_columns(headers: list[str]) -> dict[str, int]:
    """Map our field names to column indexes, or raise with what was found."""
    normalised = [_norm_header(h) for h in headers]
    mapping: dict[str, int] = {}
    for field, aliases in _COLUMN_ALIASES.items():
        wanted = {_norm_header(a) for a in aliases}
        for idx, h in enumerate(normalised):
            if h in wanted:
                mapping[field] = idx
                break
    # Price is deliberately NOT required. The official Excel export carries only
    # Generic Name / Strength / Form -- it is a COVERAGE list, not a price list
    # (verified against the Sep 3 2026 export: columns A-C, 2411 rows, no price).
    # Prices exist only in the paginated web table, which we do not scrape.
    missing = [f for f in ("name",) if f not in mapping]
    if missing:
        raise SystemExit(
            f"ERROR: could not find required column(s) {missing} in the export.\n"
            f"  Headers seen: {headers}\n"
            f"  If the vendor renamed a column, add the new spelling to "
            f"_COLUMN_ALIASES rather than renaming it by hand in the file."
        )
    return mapping


def _rows_from_csv(path: str) -> list[list[str]]:
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return [row for row in csv.reader(fh) if any((c or "").strip() for c in row)]


def _rows_from_xlsx(path: str) -> list[list[str]]:
    """Parse a simple .xlsx with the stdlib only (it is a zip of XML).

    Avoids adding openpyxl/pandas to CI for what is a once-in-a-while import.
    """
    with zipfile.ZipFile(path) as z:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", _NS):
                shared.append(
                    "".join(t.text or "" for t in si.iter(f"{{{_NS['m']}}}t"))
                )

        sheets = [
            n for n in z.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)
        ]
        if not sheets:
            raise SystemExit(f"ERROR: no worksheet found inside {path}")
        root = ET.fromstring(z.read(sorted(sheets)[0]))

        rows: list[list[str]] = []
        for row in root.iter(f"{{{_NS['m']}}}row"):
            cells: dict[int, str] = {}
            for c in row.findall("m:c", _NS):
                ref = c.get("r") or ""
                col_letters = re.match(r"[A-Z]+", ref)
                # Column letters → 0-based index, so blank cells don't shift data.
                idx = 0
                for ch in col_letters.group(0) if col_letters else "A":
                    idx = idx * 26 + (ord(ch) - 64)
                idx -= 1

                if c.get("t") == "s":
                    v = c.find("m:v", _NS)
                    text = shared[int(v.text)] if v is not None and v.text else ""
                elif c.get("t") == "inlineStr":
                    text = "".join(t.text or "" for t in c.iter(f"{{{_NS['m']}}}t"))
                else:
                    v = c.find("m:v", _NS)
                    text = (v.text or "") if v is not None else ""
                cells[idx] = text.strip()

            if cells and any(cells.values()):
                width = max(cells) + 1
                rows.append([cells.get(i, "") for i in range(width)])
        return rows


_PRICE_RE = re.compile(r"-?\d+(?:\.\d+)?")


def _parse_price(raw: str):
    """'$ 42.34' → 42.34. Returns None when there is no usable number."""
    m = _PRICE_RE.search((raw or "").replace(",", ""))
    if not m:
        return None
    try:
        return round(float(m.group(0)), 2)
    except ValueError:
        return None


# "Abacavir / Lamivudine (Generic For Epzicom)" → name + brand it is generic for.
_GENERIC_FOR_RE = re.compile(r"\(\s*generic\s+for\s+(.+?)\s*\)\s*$", re.I)


def _split_name(raw: str) -> tuple[str, str | None]:
    text = re.sub(r"\s+", " ", (raw or "").replace("\n", " ")).strip()
    m = _GENERIC_FOR_RE.search(text)
    if not m:
        return text, None
    return text[: m.start()].strip(), m.group(1).strip()


# The export opens with a disclaimer banner, not headers, e.g.
#   "This Team Cuban Card Medication List is subject to change...
#    Last Updated: Sep 3, 2026"
# so the header row must be FOUND, not assumed to be row 0. The banner also
# carries the vendor's own "last updated" date, which is a truer capture date
# than the file's mtime (that only records when someone downloaded it).
_LAST_UPDATED_RE = re.compile(
    r"last\s+updated\s*:\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})", re.I
)
_MONTHS = {
    m: i
    for i, m in enumerate(
        [
            "jan",
            "feb",
            "mar",
            "apr",
            "may",
            "jun",
            "jul",
            "aug",
            "sep",
            "oct",
            "nov",
            "dec",
        ],
        1,
    )
}


def _vendor_last_updated(raw):
    """The vendor's stated 'Last Updated' date as YYYY-MM-DD, if present."""
    for row in raw[:5]:
        for cell in row:
            m = _LAST_UPDATED_RE.search(cell or "")
            if not m:
                continue
            parts = re.match(r"([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})", m.group(1))
            if not parts:
                return None
            mon, day, year = parts.groups()
            key = mon[:3].lower()
            if key not in _MONTHS:
                return None
            return f"{int(year):04d}-{_MONTHS[key]:02d}-{int(day):02d}"
    return None


def _find_header_row(raw):
    """Index of the first row that maps to the columns we need."""
    for i, row in enumerate(raw[:8]):
        try:
            _map_columns(row)
            return i
        except SystemExit:
            continue
    _map_columns(raw[0])  # re-raise naming the real headers
    return 0


def load_rows(path: str) -> tuple[list[dict], str | None]:
    raw = (
        _rows_from_xlsx(path)
        if path.lower().endswith(".xlsx")
        else _rows_from_csv(path)
    )
    if len(raw) < 2:
        raise SystemExit(f"ERROR: {path} has no data rows.")

    vendor_date = _vendor_last_updated(raw)
    hdr = _find_header_row(raw)

    cols = _map_columns(raw[hdr])
    out: list[dict] = []
    skipped = 0
    for row in raw[hdr + 1 :]:

        def cell(field: str) -> str:
            i = cols.get(field)
            return row[i].strip() if i is not None and i < len(row) else ""

        name, generic_for = _split_name(cell("name"))
        price = _parse_price(cell("price"))
        # A nameless row cannot help anyone. A priced row is better, but the
        # official export has no price column at all, so absence of a price must
        # not discard real coverage information.
        if not name:
            skipped += 1
            continue

        rec = {"n": name}
        if price is not None:
            rec["p"] = price
        if generic_for:
            rec["gf"] = generic_for
        for key, field in (("s", "strength"), ("f", "form"), ("q", "quantity")):
            val = re.sub(r"\s+", " ", cell(field)).strip()
            if val:
                rec[key] = val
        out.append(rec)

    if not out:
        raise SystemExit(
            "ERROR: parsed 0 usable rows — refusing to write an empty list."
        )
    if skipped:
        print(f"  note: skipped {skipped} nameless row(s)")
    out.sort(key=lambda r: (r["n"].lower(), r.get("s", ""), r.get("q", "")))
    return out, vendor_date


def find_source() -> str:
    for ext in (".xlsx", ".csv"):
        p = os.path.join(_SRC_DIR, f"teamcuban-medications{ext}")
        if os.path.exists(p):
            return p
    raise SystemExit(
        "ERROR: no source file found.\n"
        f"  Expected data/sources/teamcuban-medications.xlsx (or .csv)\n"
        f"  Get it from {SOURCE_URL} — the 'Download an Excel Version of the\n"
        "  Current Medication List' link. This project does not fetch it\n"
        "  automatically: their Terms of Use prohibit robots/scripts on the site."
    )


def render(rows: list[dict], captured: str) -> str:
    body = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    return (
        "// Team Cuban Card retail medication prices — Mark Cuban Cost Plus Benefits LLC.\n"
        "//\n"
        "// GENERATED FILE — do not edit by hand.\n"
        "//   Regenerate: python data/build_teamcuban.py\n"
        f"//   Source:     {SOURCE_URL} (official Excel download, saved to data/sources/)\n"
        f"//   Captured:   {captured}\n"
        "//\n"
        "// These are the Team Cuban Card RETAIL channel prices. They are set\n"
        "// separately from costplusdrugs.com mail order and the vendor states the\n"
        "// two can differ. Prices change without notice, so treat every value here\n"
        "// as a dated reference and confirm at the pharmacy counter.\n"
        "//\n"
        "// Keys are short because this list is large and ships to the browser:\n"
        "//   n = name, gf = generic for (brand), s = strength, f = form,\n"
        "//   q = quantity, p = price in USD\n"
        f"export const TEAMCUBAN_CAPTURED = {json.dumps(captured)};\n"
        f"export const TEAMCUBAN_SOURCE_URL = {json.dumps(SOURCE_URL)};\n"
        f"export const TEAMCUBAN = {body};\n"
    )


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Build assets/teamcuban.js from the official export"
    )
    ap.add_argument(
        "--check", action="store_true", help="exit 1 if assets/teamcuban.js is stale"
    )
    ap.add_argument(
        "--captured", help="capture date YYYY-MM-DD (default: the source file's mtime)"
    )
    args = ap.parse_args()

    src = find_source()
    rows, vendor_date = load_rows(src)

    if args.captured:
        captured = args.captured
    elif args.check and os.path.exists(_OUT_PATH):
        # Reuse the committed date so --check compares data, not the clock.
        prior = re.search(
            r"TEAMCUBAN_CAPTURED = \"([\d-]+)\"",
            open(_OUT_PATH, encoding="utf-8").read(),
        )
        captured = prior.group(1) if prior else _dt.date.today().isoformat()
    elif vendor_date:
        # The vendor states "Last Updated: <date>" in the export banner. That is
        # when THEY refreshed the list; the file mtime is only when we downloaded
        # it, which can be days later and would overstate freshness.
        captured = vendor_date
    else:
        captured = _dt.date.fromtimestamp(os.path.getmtime(src)).isoformat()

    content = render(rows, captured)

    if args.check:
        current = (
            open(_OUT_PATH, encoding="utf-8").read()
            if os.path.exists(_OUT_PATH)
            else ""
        )
        if current != content:
            print(
                "STALE: assets/teamcuban.js does not match data/sources/ — run: python data/build_teamcuban.py"
            )
            sys.exit(1)
        print(
            f"OK — assets/teamcuban.js matches the source export ({len(rows)} medications)."
        )
        return

    with open(_OUT_PATH, "w", encoding="utf-8") as fh:
        fh.write(content)
    print(f"Wrote assets/teamcuban.js — {len(rows)} medications, captured {captured}.")


if __name__ == "__main__":
    main()
