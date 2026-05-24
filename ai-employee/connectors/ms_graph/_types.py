"""Shared types for the Microsoft Graph connector.

Python mirrors of the TypeScript capability shapes locked in
`docs/specs/ai-employee/capability-contracts.md`. The connector emits
these dataclasses; skills consume them via the capability interface.
The error type mirrors the canonical `AdapterError` in
`ai-employee/connectors/filevine/errors.py` -- code names are drawn
from the closed `AdapterErrorCode` union so audit-log routing and
runtime backoff stay vendor-neutral.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional


AdapterErrorCode = Literal[
    "not_found",
    "unauthorized",
    "auth_expired",
    "rate_limited",
    "transient",
    "capability_not_supported",
    "scope_violation",
    "fabrication_blocked",
    "validation_failed",
    "forbidden",
    "upstream_error",
    "unknown",
]


ADAPTER_ERROR_CODES: frozenset[str] = frozenset(
    {
        "not_found",
        "unauthorized",
        "auth_expired",
        "rate_limited",
        "transient",
        "capability_not_supported",
        "scope_violation",
        "fabrication_blocked",
        "validation_failed",
        "forbidden",
        "upstream_error",
        "unknown",
    }
)


CAPABILITY_NAMES: frozenset[str] = frozenset(
    {
        "Email",
        "Calendar",
        "DocumentStorage",
    }
)


class AdapterError(Exception):
    """Canonical adapter error.

    Skill code switches on ``code``, not on message text or exception
    class chain. ``auth_expired`` is the signal the OAuth lifecycle
    spec uses to trigger the re-consent flow per
    `docs/specs/ai-employee/oauth-lifecycle.md`.
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
                f"AdapterError code {code!r} not in closed union; update both "
                "ai-employee/connectors/ms_graph/types.py and the TypeScript "
                "doctrine in src/lib/ai-employee/capabilities/types.ts"
            )
        if capability not in CAPABILITY_NAMES:
            raise ValueError(
                f"MS Graph adapter only supports {sorted(CAPABILITY_NAMES)}; "
                f"got capability={capability!r}"
            )
        super().__init__(message)
        self.code = code
        self.capability = capability
        self.adapter = adapter
        self.cause = cause


@dataclass(frozen=True)
class CapabilitySet:
    """Python mirror of ``CapabilitySet`` from capability-contracts.md."""

    capability: str
    adapter: str
    version: str
    supported_methods: tuple[str, ...]
    unsupported_methods: tuple[str, ...]
    features: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class HealthStatus:
    """Python mirror of ``HealthStatus`` from capability-contracts.md."""

    healthy: bool
    last_ok_at: str  # ISO 8601 UTC
    last_error: Optional[dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Email domain shapes -- minimum surface for v1 per Pattern A
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EmailParticipant:
    name: Optional[str]
    address: str


@dataclass(frozen=True)
class EmailMessage:
    id: str
    thread_id: str
    subject: str
    received_at: str  # ISO 8601 UTC
    from_addr: EmailParticipant
    to: tuple[EmailParticipant, ...]
    cc: tuple[EmailParticipant, ...]
    body_preview: str
    is_read: bool
    folder: str


@dataclass(frozen=True)
class EmailThread:
    id: str
    subject: str
    last_message_at: str  # ISO 8601 UTC
    message_count: int
    messages: tuple[EmailMessage, ...]


@dataclass(frozen=True)
class DraftRef:
    id: str
    storage_uri: str
    created_at: str  # ISO 8601 UTC


# ---------------------------------------------------------------------------
# Calendar domain shapes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TimeSlot:
    start: str  # ISO 8601 UTC
    end: str  # ISO 8601 UTC


@dataclass(frozen=True)
class CalendarAttendee:
    address: str
    name: Optional[str]
    response_status: Optional[str]  # accepted | declined | tentative | none


@dataclass(frozen=True)
class CalendarEvent:
    id: str
    subject: str
    start: str  # ISO 8601 UTC
    end: str  # ISO 8601 UTC
    location: Optional[str]
    body_preview: Optional[str]
    organizer: Optional[EmailParticipant]
    attendees: tuple[CalendarAttendee, ...]
    is_all_day: bool


# ---------------------------------------------------------------------------
# DocumentStorage domain shapes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DocumentRef:
    id: str
    path: str
    filename: str
    mime_type: str
    size_bytes: int
    created_at: str  # ISO 8601 UTC
    modified_at: str  # ISO 8601 UTC


@dataclass(frozen=True)
class DocumentContent:
    ref: DocumentRef
    bytes_: bytes


__all__ = [
    "ADAPTER_ERROR_CODES",
    "CAPABILITY_NAMES",
    "AdapterError",
    "AdapterErrorCode",
    "CalendarAttendee",
    "CalendarEvent",
    "CapabilitySet",
    "DocumentContent",
    "DocumentRef",
    "DraftRef",
    "EmailMessage",
    "EmailParticipant",
    "EmailThread",
    "HealthStatus",
    "TimeSlot",
]
