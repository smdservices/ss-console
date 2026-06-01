"""Adapter error contract -- Python mirror of ``AdapterError`` from
``src/lib/operator/capabilities/types.ts``.

Mirrors the Filevine connector's ``errors.py`` so the no_pm adapter
satisfies the same closed unions. The capability-set and error-code
unions are pinned by the TypeScript-side conformance harness; drift
between the two languages is a P0.

Per ADR 0006 invariant TYPED_ERRORS: adapters only raise ``AdapterError``
with codes drawn from the closed ``AdapterErrorCode`` union. Internal
exceptions are wrapped in ``cause``, never re-raised raw. Skill code
switches on ``code``, not on ``message``.
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
    """Canonical error raised by the no_pm capability adapter.

    Mirrors ``class AdapterError extends Error`` in
    ``src/lib/operator/capabilities/types.ts``. Skill code switches
    on ``.code`` rather than ``.message`` or the exception type chain.
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
                "update both this constant and "
                "src/lib/operator/capabilities/types.ts"
            )
        if capability not in CAPABILITY_NAMES:
            raise ValueError(
                f"AdapterError capability {capability!r} not in CapabilityName union"
            )
        super().__init__(message)
        self.code = code
        self.capability = capability
        self.adapter = adapter
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
