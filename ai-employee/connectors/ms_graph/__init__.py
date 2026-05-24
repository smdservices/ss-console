"""Microsoft Graph connector — Phase 1 Email / Calendar / DocumentStorage.

Implements the capability interfaces locked in
`docs/specs/ai-employee/capability-contracts.md` against the Microsoft
Graph REST API (https://graph.microsoft.com/v1.0/). Phase 1 scope is
read + draft only: `Mail.Send` is intentionally NOT requested. The
programmatic-send surface ships in wave-2 (issue #881) under a separate
delegated scope and a distinct adapter method.

Public surface:

* `MSGraphOAuth` -- per-customer OAuth refresh + atomic Fly-volume
  storage at `/opt/data/oauth/microsoft.json` per ADR 0010.
* `MSGraphMailbox` -- `Email` capability adapter (list threads, get
  thread, create draft, update draft, apply label, move folder).
* `MSGraphCalendar` -- `Calendar` capability adapter (list events, get
  event, create event draft, suggest times, RSVP draft).
* `MSGraphDrive` -- `DocumentStorage` capability adapter (list folder,
  get document, put document into the app folder).

The OAuth layer is intentionally vendor-agnostic at the wire level: it
talks to `https://login.microsoftonline.com/common/oauth2/v2.0/token`
and returns a `TokenSet` shape identical to the LawPay and Filevine
connectors so the conformance harness reads the same surface across
adapters.
"""

from __future__ import annotations

from .oauth import MSGraphOAuth, TokenSet, TokenStore
from ._types import (
    AdapterError,
    CapabilitySet,
    HealthStatus,
)

__all__ = [
    "AdapterError",
    "CapabilitySet",
    "HealthStatus",
    "MSGraphOAuth",
    "TokenSet",
    "TokenStore",
]
