"""Tests for the 0penRX price lookup API."""
import os
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import app

client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_prices_returns_match():
    resp = client.get("/prices", params={"drug": "atorvastatin"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["drug"] == "atorvastatin"
    assert body["count"] >= 1
    assert body["results"][0]["price_usd"] > 0


def test_prices_no_match():
    resp = client.get("/prices", params={"drug": "nonexistent-drug"})
    assert resp.status_code == 200
    assert resp.json()["count"] == 0


def test_prices_requires_drug():
    resp = client.get("/prices")
    assert resp.status_code == 422
