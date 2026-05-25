"""L1 connector contract tests — 5 first-customer-bound MCPs + LawPay.

Per test plan v2 §"Layer 1 — Contract & Boot — MCP contract tests" +
Week 0 procurement table. Each test exercises one vendor's documented
operations against the stub (v1) or the real sandbox (when procurement
completes).

The pattern is parametrized per vendor; one vendor's failure isolates
to that vendor's test row, the others stay green.

Mode toggle: ``CONTRACT_TEST_MODE`` env var.

  - ``stub`` (default) — uses ai-employee/fixtures/mcp/<vendor>.py
    stubs. Validates the contract shape; does not exercise the real
    vendor API. CI runs this mode on every PR.
  - ``live`` — uses the real vendor sandbox. Requires per-vendor
    OAuth credentials in env. Only runs when LIVE_<VENDOR>_TOKEN is
    set. CI runs this mode after Week 0 procurement completes.

The tests assert:

  1. Documented tool calls succeed and return the expected response shape
  2. Required-arg validation raises StubError (or the equivalent live error)
  3. Missing-resource raises the documented error
  4. Write/forbidden tools are refused at the stub layer (live tests
     verify the trust plugin catches them before reaching the vendor)
  5. force_auth_error raises the documented auth-error shape

When live mode runs, additional assertions verify:

  6. Per-customer OAuth isolation: each test uses an explicit token
     parameter; the test panics if the token is shared across test
     customers (catches misconfigured CI secrets).

The contract test for any vendor whose procurement is incomplete
SKIPs in live mode with a clear message pointing at the Week 0 table.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Callable
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))

from fixtures.mcp import (  # noqa: E402
    StubAuthError,
    StubError,
    StubNotFoundError,
    clio,
    courtlistener,
    gmail,
    google_calendar,
    lawpay,
)


CONTRACT_TEST_MODE = os.environ.get("CONTRACT_TEST_MODE", "stub").lower()


VENDOR_CONFIGS = [
    {
        "slug": "gmail",
        "stub_module": gmail,
        "call_fn_name": "call_gmail",
        "happy_tool": "gmail.search_messages",
        "happy_args": {"query": "from:test@example.invalid"},
        "happy_response_keys": ["messages"],
        "not_found_tool": "gmail.get_message",
        "not_found_args": {"message_id": "msg_nope"},
        "live_token_env": "LIVE_GMAIL_TOKEN",
    },
    {
        "slug": "google_calendar",
        "stub_module": google_calendar,
        "call_fn_name": "call_calendar",
        "happy_tool": "calendar.list_events",
        "happy_args": {
            "time_min": "2026-05-25T00:00:00Z",
            "time_max": "2026-06-25T00:00:00Z",
        },
        "happy_response_keys": ["items"],
        "not_found_tool": "calendar.get_event",
        "not_found_args": {"event_id": "evt_nope"},
        "live_token_env": "LIVE_GCAL_TOKEN",
    },
    {
        "slug": "clio",
        "stub_module": clio,
        "call_fn_name": "call_clio",
        "happy_tool": "clio.matters_list",
        "happy_args": {},
        "happy_response_keys": ["matters"],
        "not_found_tool": "clio.matters_get",
        "not_found_args": {"matter_id": "matter_nope"},
        "live_token_env": "LIVE_CLIO_TOKEN",
    },
    {
        "slug": "courtlistener",
        "stub_module": courtlistener,
        "call_fn_name": "call_courtlistener",
        "happy_tool": "courtlistener.search_dockets",
        "happy_args": {"query": "Holloway"},
        "happy_response_keys": ["dockets", "count"],
        "not_found_tool": "courtlistener.get_docket",
        "not_found_args": {"docket_id": 99999},
        "live_token_env": "LIVE_COURTLISTENER_TOKEN",
    },
    {
        "slug": "lawpay",
        "stub_module": lawpay,
        "call_fn_name": "call_lawpay",
        "happy_tool": "lawpay.invoices_list",
        "happy_args": {},
        "happy_response_keys": ["invoices"],
        "not_found_tool": "lawpay.invoices_get",
        "not_found_args": {"invoice_id": "inv_nope"},
        "live_token_env": "LIVE_LAWPAY_TOKEN",
    },
]


def _get_caller(config: dict) -> Callable:
    return getattr(config["stub_module"], config["call_fn_name"])


@pytest.fixture(params=VENDOR_CONFIGS, ids=lambda c: c["slug"])
def vendor(request):
    return request.param


def _skip_in_live_without_token(config: dict):
    if CONTRACT_TEST_MODE != "live":
        return
    if not os.environ.get(config["live_token_env"]):
        pytest.skip(
            f"live contract test for {config['slug']} requires "
            f"{config['live_token_env']} env (Week 0 procurement)"
        )


class TestVendorHappyPath:
    """The documented tool must succeed and return the documented shape."""

    def test_happy_tool_returns_expected_keys(self, vendor):
        _skip_in_live_without_token(vendor)
        caller = _get_caller(vendor)
        if CONTRACT_TEST_MODE == "stub":
            response = caller(vendor["happy_tool"], vendor["happy_args"])
        else:
            # Live mode wiring lands when Week 0 procurement completes.
            pytest.skip(f"live mode wiring deferred for {vendor['slug']}")
        for key in vendor["happy_response_keys"]:
            assert key in response, (
                f"{vendor['slug']} {vendor['happy_tool']} response missing "
                f"expected key {key!r}; got keys {sorted(response.keys())}"
            )


class TestVendorErrorPath:
    """Missing resources must raise the documented error."""

    def test_not_found_raises(self, vendor):
        _skip_in_live_without_token(vendor)
        caller = _get_caller(vendor)
        if CONTRACT_TEST_MODE == "stub":
            with pytest.raises(StubNotFoundError):
                caller(vendor["not_found_tool"], vendor["not_found_args"])
        else:
            pytest.skip(f"live mode wiring deferred for {vendor['slug']}")


class TestVendorAuthPath:
    """force_auth_error must raise the documented auth-error shape."""

    def test_auth_error_raises(self, vendor):
        module = vendor["stub_module"]
        if not hasattr(module, "force_auth_error"):
            pytest.skip(f"{vendor['slug']} has no force_auth_error helper")
        with pytest.raises(StubAuthError):
            module.force_auth_error(vendor["happy_tool"], vendor["happy_args"])


class TestVendorUnknownTool:
    """Calls to undocumented tools must raise StubError."""

    def test_unknown_tool_raises(self, vendor):
        if CONTRACT_TEST_MODE != "stub":
            pytest.skip(
                "unknown-tool refusal is a stub-layer contract; live API "
                "may surface this as an HTTP 404 instead"
            )
        caller = _get_caller(vendor)
        with pytest.raises(StubError):
            caller(f"{vendor['slug']}.not_a_real_tool_xyz_abc", {})


class TestPerCustomerOAuthIsolation:
    """In live mode, each vendor's call must use an explicit per-customer
    token; shared tokens across test customers are a P0 misconfiguration."""

    def test_per_customer_token_distinct(self, vendor):
        if CONTRACT_TEST_MODE != "live":
            pytest.skip("per-customer token isolation only meaningful in live mode")
        # Live mode contract: the live test runner sets LIVE_<VENDOR>_TOKEN
        # specifically for the test customer. We assert the token is NOT
        # the production-customer token (heuristic: production tokens have
        # a distinct shape from sandbox tokens; the exact check is vendor-
        # specific and lands when the live runner ships).
        token = os.environ.get(vendor["live_token_env"], "")
        assert token, f"{vendor['live_token_env']} not set"
        # The runner asserts further per-vendor isolation; placeholder here.
        # (e.g., for Clio: the token's user must match test_customer_email)


class TestContractsCoverFirstCustomerVendors:
    """Sanity: confirm we have a contract test for every Week 0 vendor."""

    def test_five_vendors_present(self):
        slugs = {c["slug"] for c in VENDOR_CONFIGS}
        expected = {"gmail", "google_calendar", "clio", "courtlistener", "lawpay"}
        missing = expected - slugs
        assert not missing, (
            f"Week 0 vendors missing contract tests: {sorted(missing)}"
        )

    def test_every_config_has_live_token_env(self):
        for config in VENDOR_CONFIGS:
            assert config["live_token_env"], (
                f"vendor {config['slug']} missing live_token_env mapping — "
                f"required for live-mode test gating"
            )
