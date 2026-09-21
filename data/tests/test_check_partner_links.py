"""Guard the partner-link classifier: live links must not be reported dead, and real
failures (404/410, DNS/connection errors, 5xx) must still fail the build."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "data"))

from check_partner_links import classify  # noqa: E402


@pytest.mark.parametrize("status", [200, 201, 202, 203, 204, 206])
def test_any_2xx_is_live(status):
    assert classify(status)[1] is False


def test_waf_challenge_is_labelled_live():
    # AWS WAF Challenge: HTTP 202 + x-amzn-waf-action. Regression for AmgenNow, which
    # answered GitHub's runners this way and was wrongly reported DEAD.
    note, dead = classify(202, "challenge")
    assert dead is False
    assert "bot-challenge" in note and "challenge" in note


@pytest.mark.parametrize("status", [301, 302, 307, 308])
def test_redirect_is_live(status):
    assert classify(status)[1] is False


@pytest.mark.parametrize("status", [401, 403, 405, 429])
def test_bot_blocked_is_live(status):
    assert classify(status) == ("bot-blocked (live)", False)


@pytest.mark.parametrize(
    "status", [404, 410, 500, 502, 503, "URLError", "TimeoutError", "ERR"]
)
def test_real_failures_are_dead(status):
    assert classify(status) == ("DEAD", True)


def test_waf_header_does_not_rescue_a_404():
    # The header only relabels a success; it must never hide a genuinely dead page.
    assert classify(404, "block") == ("DEAD", True)
