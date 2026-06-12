"""Unit tests for the NADAC ingestion normalization."""
import importlib.util
import os

# Load the sibling module without requiring a package install.
_MODULE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ingest_nadac.py"
)
_spec = importlib.util.spec_from_file_location("ingest_nadac", _MODULE_PATH)
ingest_nadac = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ingest_nadac)


SAMPLE_ROW = {
    "ndc_description": "ATORVASTATIN 10 MG TABLET",
    "ndc": "00071015523",
    "nadac_per_unit": "0.04321",
    "pricing_unit": "EA",
    "effective_date": "2025-01-01",
}


def test_normalize_row_maps_fields():
    record = ingest_nadac.normalize_row(SAMPLE_ROW, "http://example/src")
    assert record["drug_name"] == "ATORVASTATIN 10 MG TABLET"
    assert record["ndc"] == "00071015523"
    assert record["price_usd"] == 0.04321
    assert record["unit"] == "EA"
    assert record["source"] == "NADAC"
    assert record["source_url"] == "http://example/src"
    assert record["effective_date"] == "2025-01-01"
    assert record["ingested_at"]


def test_normalize_row_handles_bad_price():
    record = ingest_nadac.normalize_row({"nadac_per_unit": "n/a"}, "u")
    assert record["price_usd"] is None
    assert record["drug_name"] is None


def test_num_coercion():
    assert ingest_nadac._num("1.5") == 1.5
    assert ingest_nadac._num(None) is None
    assert ingest_nadac._num("abc") is None
