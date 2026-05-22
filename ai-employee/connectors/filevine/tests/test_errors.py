"""Unit tests for the AdapterError contract.

The TypeScript `AdapterError` from
`src/lib/ai-employee/capabilities/types.ts` declares a closed
`AdapterErrorCode` union plus the eleven `CapabilityName` values. The
Python mirror in `errors.py` MUST stay in sync -- this test pins the
constants so accidental drift fails CI.
"""

from __future__ import annotations

import pytest

from connectors.filevine.errors import (  # type: ignore[import-not-found]
    ADAPTER_ERROR_CODES,
    CAPABILITY_NAMES,
    AdapterError,
)


# Pinned from src/lib/ai-employee/capabilities/types.ts. If this list
# changes, change BOTH that file and errors.py in the same PR.
_EXPECTED_CODES = {
    "not_found",
    "unauthorized",
    "rate_limited",
    "transient",
    "capability_not_supported",
    "scope_violation",
    "fabrication_blocked",
    "validation_failed",
    "unknown",
}

_EXPECTED_CAPABILITIES = {
    "PracticeManagement",
    "Email",
    "Calendar",
    "DocumentStorage",
    "ESign",
    "CourtAccess",
    "Payments",
    "Accounting",
    "IntakeCRM",
    "CallTracking",
    "InternalComms",
}


def test_adapter_error_codes_match_typescript_contract():
    assert set(ADAPTER_ERROR_CODES) == _EXPECTED_CODES


def test_capability_names_match_typescript_contract():
    assert set(CAPABILITY_NAMES) == _EXPECTED_CAPABILITIES


def test_adapter_error_rejects_unknown_code():
    with pytest.raises(ValueError):
        AdapterError(
            code="not_a_real_code",
            capability="PracticeManagement",
            adapter="filevine",
            message="bogus",
        )


def test_adapter_error_rejects_unknown_capability():
    with pytest.raises(ValueError):
        AdapterError(
            code="unauthorized",
            capability="WeatherForecast",
            adapter="filevine",
            message="bogus",
        )


def test_adapter_error_preserves_cause():
    cause = RuntimeError("vendor blew up")
    try:
        raise AdapterError(
            code="transient",
            capability="PracticeManagement",
            adapter="filevine",
            message="wrapped",
            cause=cause,
        )
    except AdapterError as exc:
        assert exc.code == "transient"
        assert exc.adapter == "filevine"
        assert exc.cause is cause
