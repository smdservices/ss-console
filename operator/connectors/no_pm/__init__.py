"""no_pm connector -- synthetic PracticeManagement adapter for customers
without an external PM system.

Most target-buyer firms operate without a working practice-management
system (paper + Outlook + OneDrive + QuickBooks for billing). The PI
PRDs assume Filevine / Clio / CASEpeer; this adapter is the matching
capability binding for the no-PM-system reality.

Per ADR 0006, skills bind to capability interfaces, not vendors. This
adapter satisfies the same ``PracticeManagement`` contract Filevine
does, so the skill catalog runs unchanged. Storage is per-customer D1
(matters, notes) + per-customer R2 (matter documents) via the existing
memory pipeline substrate (PR #944); this adapter does not introduce a
new persistence layer.

This package exposes:

* ``MatterStore`` -- Protocol the adapter binds to. Production wires
  it to per-customer D1 + R2; tests use ``InMemoryMatterStore``.
* ``InMemoryMatterStore`` -- reference implementation used by tests
  and local dev.
* ``NoPmPracticeManagement`` -- ``PracticeManagement`` capability
  adapter. Implements the read + create/update matter surface against
  ``MatterStore``; no autonomous send paths.

The TypeScript capability contract is the source of truth
(``src/lib/operator/capabilities/practice-management.ts``); this
Python adapter conforms to that contract -- method names, parameter
shape, return shape, and error codes. The cross-language mapping is
documented in README.md.
"""

from __future__ import annotations

from .capabilities import ADAPTER_SLUG, NoPmMatterNoteRef, NoPmPracticeManagement
from .errors import AdapterError, AdapterErrorCode, CAPABILITY_NAMES
from .store import (
    InMemoryMatterStore,
    MatterStore,
    StoredMatter,
    StoredMatterDocument,
    StoredMatterNote,
)

__all__ = [
    "ADAPTER_SLUG",
    "AdapterError",
    "AdapterErrorCode",
    "CAPABILITY_NAMES",
    "InMemoryMatterStore",
    "MatterStore",
    "NoPmMatterNoteRef",
    "NoPmPracticeManagement",
    "StoredMatter",
    "StoredMatterDocument",
    "StoredMatterNote",
]
