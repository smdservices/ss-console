"""Filevine connector -- PI vertical practice-management adapter v1.

Implements the `PracticeManagement` and `DocumentStorage` capability
interfaces (per ADR 0006) against the Filevine REST API. Filevine is the
v1 PI practice-management adapter per ADR 0014.

This package exposes:

* `FilevineAuthProvider` -- Protocol; production wiring injects a real
  Identity & Access layer (issues #789, #822). Tests inject a fake.
* `FilevineClient` -- thin async HTTP client over the Filevine REST API.
* `FilevinePracticeManagement` -- `PracticeManagement` capability adapter.
* `FilevineDocumentStorage` -- `DocumentStorage` capability adapter.

Vendor-agnostic capability contracts live in TypeScript at
`src/lib/operator/capabilities/`. This Python adapter conforms to the
same contract -- method names, parameter shape, return shape, and error
codes. The cross-language contract mapping is documented in README.md.
"""

from __future__ import annotations

from .auth import FilevineAuthProvider, InMemoryFilevineAuth, TokenSet
from .capabilities import FilevineDocumentStorage, FilevinePracticeManagement
from .client import FilevineClient
from .errors import (
    AdapterError,
    AdapterErrorCode,
    CAPABILITY_NAMES,
)

__all__ = [
    "AdapterError",
    "AdapterErrorCode",
    "CAPABILITY_NAMES",
    "FilevineAuthProvider",
    "FilevineClient",
    "FilevineDocumentStorage",
    "FilevinePracticeManagement",
    "InMemoryFilevineAuth",
    "TokenSet",
]
