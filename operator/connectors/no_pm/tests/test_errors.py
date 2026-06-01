"""Pin the AdapterError code + capability union against the TypeScript
contract.

If anyone changes ``src/lib/operator/capabilities/types.ts`` without
updating ``operator/connectors/no_pm/errors.py``, these tests fail
and force a paired update. The same shape is asserted in the Filevine
connector; both adapters share the closed unions by design.
"""

from __future__ import annotations

import pytest

from connectors.no_pm import (  # type: ignore[import-not-found]
    ADAPTER_SLUG,
    AdapterError,
    CAPABILITY_NAMES,
)
from connectors.no_pm.errors import ADAPTER_ERROR_CODES  # type: ignore[import-not-found]


# Closed unions pinned against ``src/lib/operator/capabilities/types.ts``.
EXPECTED_ERROR_CODES = frozenset(
    {
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
)

EXPECTED_CAPABILITIES = frozenset(
    {
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
)


def test_adapter_error_codes_match_typescript_union():
    assert ADAPTER_ERROR_CODES == EXPECTED_ERROR_CODES


def test_capability_names_match_typescript_union():
    assert CAPABILITY_NAMES == EXPECTED_CAPABILITIES


def test_adapter_error_rejects_unknown_code():
    with pytest.raises(ValueError):
        AdapterError(
            code="not_a_real_code",
            capability="PracticeManagement",
            adapter=ADAPTER_SLUG,
            message="should reject",
        )


def test_adapter_error_rejects_unknown_capability():
    with pytest.raises(ValueError):
        AdapterError(
            code="unknown",
            capability="NotARealCapability",
            adapter=ADAPTER_SLUG,
            message="should reject",
        )


def test_adapter_error_records_code_capability_adapter_message():
    err = AdapterError(
        code="validation_failed",
        capability="PracticeManagement",
        adapter=ADAPTER_SLUG,
        message="example message",
    )
    assert err.code == "validation_failed"
    assert err.capability == "PracticeManagement"
    assert err.adapter == ADAPTER_SLUG
    assert err.args[0] == "example message"
    assert err.cause is None


def test_adapter_error_carries_cause_distinct_from_python_chain():
    inner = RuntimeError("vendor blew up")
    err = AdapterError(
        code="unknown",
        capability="PracticeManagement",
        adapter=ADAPTER_SLUG,
        message="wrapped",
        cause=inner,
    )
    # ``cause`` is a distinct attribute from Python's ``__cause__``; the
    # audit-log reads ``cause``, the user-facing chain reads ``__cause__``.
    assert err.cause is inner
    assert err.__cause__ is None
