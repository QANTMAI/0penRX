"""Unit tests for the Team Cuban Card medication-list import.

The import is manual by design (their Terms of Use forbid robots/scripts on the
site), which means it runs rarely and by hand — exactly the conditions under
which a silent parsing regression goes unnoticed for months. These tests pin the
shapes actually observed on teamcubancard.com/medications/ so a bad parse fails
CI instead of publishing wrong prices to a health site.
"""

import csv
import importlib.util
import os
import zipfile

import pytest

_MODULE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build_teamcuban.py"
)
_spec = importlib.util.spec_from_file_location("build_teamcuban", _MODULE_PATH)
build_teamcuban = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build_teamcuban)


# Rows exactly as the vendor's table renders them: the name cell carries a
# newline and a "(Generic For <Brand>)" suffix, and the price carries a symbol
# and a space.
_OBSERVED = [
    ["Name", "Strength", "Form", "Quantity", "Price"],
    [
        "Abacavir / Lamivudine\n(Generic For Epzicom)",
        "600-300 MG",
        "Tablet",
        "30 Tablets",
        "$ 42.34",
    ],
    [
        "Acetylcysteine\n(Generic For Mucomyst)",
        "20 %",
        "Solution",
        "1 Carton (100 Ml)",
        "$ 410.99",
    ],
    ["Metformin Hcl", "500 MG", "Tablet", "30 Tablets", "$ 4.20"],
]


def _write_csv(tmp_path, rows):
    p = tmp_path / "teamcuban-medications.csv"
    with open(p, "w", newline="", encoding="utf-8") as fh:
        csv.writer(fh).writerows(rows)
    return str(p)


def test_parses_observed_rows(tmp_path):
    rows, _ = build_teamcuban.load_rows(_write_csv(tmp_path, _OBSERVED))
    assert len(rows) == 3
    abacavir = next(r for r in rows if r["n"].startswith("Abacavir"))
    assert abacavir["gf"] == "Epzicom"  # brand split off the name
    assert abacavir["p"] == 42.34  # "$ 42.34" -> float
    assert abacavir["q"] == "30 Tablets"


def test_name_without_generic_for_has_no_gf_key():
    """Absence must be absent, not an empty string that renders as '(Generic For )'."""
    name, gf = build_teamcuban._split_name("Metformin Hcl")
    assert name == "Metformin Hcl" and gf is None


def test_price_parsing_variants():
    assert build_teamcuban._parse_price("$ 42.34") == 42.34
    assert build_teamcuban._parse_price("1,234.50") == 1234.50
    assert build_teamcuban._parse_price("4.2") == 4.2
    # No number at all must yield None so the row is dropped, never priced at 0 —
    # a $0 drug price on a health site is worse than no row.
    assert build_teamcuban._parse_price("") is None
    assert build_teamcuban._parse_price("call for price") is None


def test_nameless_rows_dropped_but_priceless_rows_kept(tmp_path):
    """The official export has NO price column, so a missing price must not
    discard real coverage data. A missing NAME still must."""
    rows, _ = build_teamcuban.load_rows(
        _write_csv(
            tmp_path,
            _OBSERVED
            + [
                ["", "1 MG", "Tablet", "30 Tablets", "$ 9.99"],  # no name -> dropped
                ["Ghost Drug", "1 MG", "Tablet", "30 Tablets", ""],  # no price -> kept
            ],
        )
    )
    assert len(rows) == 4
    assert all(r["n"] for r in rows)
    ghost = next(r for r in rows if r["n"] == "Ghost Drug")
    assert "p" not in ghost  # absent, never 0


def test_empty_result_is_refused(tmp_path):
    """Publishing an empty list would blank the page and look like a real answer."""
    with pytest.raises(SystemExit):
        build_teamcuban.load_rows(
            _write_csv(tmp_path, [_OBSERVED[0]] + [["", "", "", "", ""]])
        )


def test_missing_name_column_fails_loudly(tmp_path):
    """If the vendor renames the NAME column beyond every known alias, that must
    fail CI rather than silently publish an empty medication list."""
    with pytest.raises(SystemExit):
        build_teamcuban.load_rows(
            _write_csv(
                tmp_path,
                [
                    ["Widget", "Thickness", "Shape"],
                    ["Sprocket", "5 MM", "Round"],
                ],
            )
        )


def test_header_aliases_are_accepted(tmp_path):
    """Plausible alternate spellings should keep working without a code change."""
    rows, _ = build_teamcuban.load_rows(
        _write_csv(
            tmp_path,
            [
                ["Drug", "Dosage", "Dosage Form", "Qty", "Cash Price"],
                ["Metformin Hcl", "500 MG", "Tablet", "30 Tablets", "$ 4.20"],
            ],
        )
    )
    assert rows[0]["p"] == 4.2 and rows[0]["f"] == "Tablet"


def test_xlsx_shared_strings_numeric_price_and_blank_column(tmp_path):
    """Excel stores prices as numbers and omits blank cells entirely.

    A positional parser would shift Quantity into Form on the second row; this
    pins the column-letter mapping that prevents it.
    """
    shared = [
        "Name",
        "Strength",
        "Form",
        "Quantity",
        "Price",
        "Abacavir / Lamivudine\n(Generic For Epzicom)",
        "600-300 MG",
        "Tablet",
        "30 Tablets",
        "Metformin Hcl",
        "500 MG",
        "1 Bottle (240 Ml)",
    ]
    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    sst = '<?xml version="1.0"?><sst xmlns="%s">%s</sst>' % (
        ns,
        "".join('<si><t xml:space="preserve">%s</t></si>' % t for t in shared),
    )
    sheet = (
        '<?xml version="1.0"?><worksheet xmlns="%s"><sheetData>'
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>'
        '<c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>'
        '<row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2" t="s"><v>6</v></c>'
        '<c r="C2" t="s"><v>7</v></c><c r="D2" t="s"><v>8</v></c><c r="E2"><v>42.34</v></c></row>'
        # Row 3 has NO column C — the blank-cell case.
        '<row r="3"><c r="A3" t="s"><v>9</v></c><c r="B3" t="s"><v>10</v></c>'
        '<c r="D3" t="s"><v>11</v></c><c r="E3"><v>4.2</v></c></row>'
        "</sheetData></worksheet>" % ns
    )

    p = tmp_path / "teamcuban-medications.xlsx"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("xl/sharedStrings.xml", sst)
        z.writestr("xl/worksheets/sheet1.xml", sheet)

    rows, _ = build_teamcuban.load_rows(str(p))
    metformin = next(r for r in rows if r["n"] == "Metformin Hcl")
    assert metformin["q"] == "1 Bottle (240 Ml)"  # NOT shifted into "f"
    assert "f" not in metformin
    assert metformin["p"] == 4.2


def test_output_carries_provenance_and_capture_date():
    """Every rendered file must say where the data came from and how old it is."""
    out = build_teamcuban.render([{"n": "Metformin Hcl", "p": 4.2}], "2026-08-11")
    assert "2026-08-11" in out
    assert build_teamcuban.SOURCE_URL in out
    assert "do not edit by hand" in out.lower()
    assert "export const TEAMCUBAN =" in out


def test_no_network_code_in_the_builder():
    """The whole point of the manual import is that it never touches their site."""
    src = open(_MODULE_PATH, encoding="utf-8").read()
    for banned in ("import requests", "urllib.request", "urlopen", "httpx", "socket."):
        assert banned not in src, (
            f"builder must not perform network I/O (found {banned!r})"
        )


def test_banner_row_is_skipped_and_vendor_date_extracted(tmp_path):
    """The real export's row 1 is a disclaimer banner; headers are on row 2, and
    the banner carries the vendor's own 'Last Updated' date."""
    rows, vendor_date = build_teamcuban.load_rows(
        _write_csv(
            tmp_path,
            [
                [
                    "This Team Cuban Card Medication List is subject to change. "
                    "Refer to TeamCubanCard.com for the most up to date Medication List. "
                    "Last Updated: Sep 3, 2026",
                    "",
                    "",
                ],
                ["Generice Name", "Strength", "Form"],  # vendor's own spelling
                ["Abacavir / Lamivudine", "600-300 MG", "Tablet"],
                ["Zovia 1/35", "1-35 MG-MCG", "Tablet"],
            ],
        )
    )
    assert len(rows) == 2
    assert vendor_date == "2026-09-03"
    assert rows[0]["n"] == "Abacavir / Lamivudine"
    assert rows[0]["s"] == "600-300 MG" and rows[0]["f"] == "Tablet"
    assert "p" not in rows[0]  # coverage list, no prices


def test_vendor_header_typo_is_accepted(tmp_path):
    """'Generice Name' is what the vendor actually ships. Matching must not
    depend on them fixing their own typo."""
    rows, _ = build_teamcuban.load_rows(
        _write_csv(
            tmp_path,
            [
                ["Generice Name", "Strength", "Form"],
                ["Metformin Hcl", "500 MG", "Tablet"],
            ],
        )
    )
    assert rows[0]["n"] == "Metformin Hcl"
