"""Adapter error contract -- Python mirror of `AdapterError` from
`src/lib/ai-employee/capabilities/types.ts`.

Per ADR 0006 invariant TYPED_ERRORS: adapters only raise `AdapterError`
with codes drawn from the closed `AdapterErrorCode` union. Vendor
exceptions are wrapped in `cause`, never re-raised raw. Skill code
switches on `code`, not on `message`.
"""

from __future__ import annotations

from typing import Literal, Optional


AdapterErrorCode = Literal[
    "not_found",
    "unauthorized",
    "rate_limited",
    "transient",
    "capability_not_supported",
    "scope_violation",
    "fabrication_blocked",
    "validation_failed",
    "unknown",
]


ADAPTER_ERROR_CODES: frozenset[str] = frozenset(
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


CAPABILITY_NAMES: frozenset[str] = frozenset(
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


class AdapterError(Exception):
    """Canonical error raised by capability adapters.

    Mirrors `class AdapterError extends Error` in
    `src/lib/ai-employee/capabilities/types.ts`. Skill code switches on
    `.code` rather than `.message` or the exception type chain.

    Parameters
    ----------
    code:
        One of `AdapterErrorCode`. Validated against the closed union;
        unrecognized codes raise `ValueError` at construction time so
        adapters cannot drift the contract.
    capability:
        Capability name this adapter implements (e.g. ``"PracticeManagement"``).
    adapter:
        Adapter slug (e.g. ``"filevine"``).
    message:
        Human-readable detail. Logged; never surfaced verbatim to end-users.
    cause:
        Optional original vendor exception. Recorded for the audit log,
        never re-raised raw.
    """

    def __init__(
        self,
        code: str,
        capability: str,
        adapter: str,
        message: str,
        cause: Optional[BaseException] = None,
    ) -> None:
        if code not in ADAPTER_ERROR_CODES:
            raise ValueError(
                f"AdapterError code {code!r} not in closed union; "
                "update both this constant and src/lib/ai-employee/capabilities/types.ts"
            )
        if capability not in CAPABILITY_NAMES:
            raise ValueError(
                f"AdapterError capability {capability!r} not in CapabilityName union"
            )
        super().__init__(message)
        self.code = code
        self.capability = capability
        self.adapter = adapter
        # `cause` is intentionally a distinct attribute from Python's
        # built-in `__cause__` -- the latter is set by `raise ... from`,
        # the former is what audit-logging consumers read.
        self.cause = cause

    def __repr__(self) -> str:  # pragma: no cover -- debug helper
        return (
            f"AdapterError(code={self.code!r}, capability={self.capability!r}, "
            f"adapter={self.adapter!r}, message={self.args[0]!r})"
        )


__all__ = [
    "ADAPTER_ERROR_CODES",
    "CAPABILITY_NAMES",
    "AdapterError",
    "AdapterErrorCode",
]
