"""Factory helper that wires `VoiceIngestionRunner` against namespaced R2.

The voice pipeline's `R2Client` Protocol exposes `put(key, body, content_type)`
and `delete(key)` plus a `customer_slug` attribute. The namespace-assertion
wrapper uses `put_object(key, body, *, content_type)` and
`delete_object(key)` — close but not identical, so a thin bridge adapter
glues them together without touching the pipeline.

`build_namespaced_voice_runner` is the public entry point. The Hermes
fork's per-customer Machine boot path calls this instead of constructing
`VoiceIngestionRunner` directly with raw R2 — every put + delete from
the runner then routes through the namespace assertion before hitting
the raw client.

Filed as the recommended migration entry point against
[#1009](https://github.com/venturecrane/ss-console/issues/1009)
(fork-side adoption tracker; do not implement there).
"""

from __future__ import annotations

from datetime import datetime
from typing import Callable, Optional, Protocol

from ..audit_log import AuditLogWriter
from ..namespace_assertion import NamespacedR2Client
from .filter import AuditDigestLookup
from .pipeline import (
    CohortResolver,
    CursorStore,
    EmailSource,
    VoiceIngestionRunner,
)
from .state import VoiceSourceStateStore


class RawR2Client(Protocol):
    """The raw R2 client interface — exactly what `NamespacedR2Client` wraps.

    The fork's overlay constructs one of these per customer Machine. The
    factory below wraps it with `NamespacedR2Client` and then bridges
    that wrapper onto the pipeline's `R2Client.put` / `R2Client.delete`
    shape.
    """

    async def put_object(self, key: str, body: bytes, *, content_type: str) -> None: ...
    async def get_object(self, key: str) -> bytes: ...
    async def delete_object(self, key: str) -> None: ...


class _NamespacedVoiceR2Bridge:
    """Implements the voice pipeline's `R2Client` Protocol via the namespace wrapper.

    `customer_slug` is required by the voice pipeline's R2Client Protocol;
    it is read from the wrapper's bound slug so the two cannot drift.
    """

    def __init__(self, *, r2: NamespacedR2Client, customer_slug: str) -> None:
        self._r2 = r2
        self.customer_slug = customer_slug

    async def put(self, key: str, body: bytes, content_type: str) -> None:
        await self._r2.put_object(key, body, content_type=content_type)

    async def delete(self, key: str) -> None:
        await self._r2.delete_object(key)


def build_namespaced_voice_runner(
    *,
    customer_slug: str,
    source: EmailSource,
    cohort_resolver: CohortResolver,
    raw_r2: RawR2Client,
    state_store: VoiceSourceStateStore,
    cursor_store: CursorStore,
    audit_lookup: AuditDigestLookup,
    audit_writer: Optional[AuditLogWriter] = None,
    source_kind: str = "email",
    clock: Optional[Callable[[], datetime]] = None,
) -> VoiceIngestionRunner:
    """Return a `VoiceIngestionRunner` wired through namespace-asserting R2.

    The Hermes fork's per-customer Machine boot path should call this
    factory instead of constructing `VoiceIngestionRunner` directly with
    raw R2. Every R2 put + delete from the runner is routed through the
    namespace assertion before it hits the raw client, so a foreign-slug
    key refuses + audits at the boundary.

    `audit_writer` is recommended in production so every refusal lands
    one `INVARIANT_VIOLATION` audit row. It may be omitted in tests; the
    refusal still raises `NamespaceAssertionError`.
    """
    r2 = NamespacedR2Client(
        expected_slug=customer_slug,
        inner=raw_r2,
        audit_writer=audit_writer,
    )
    bridge = _NamespacedVoiceR2Bridge(r2=r2, customer_slug=customer_slug)
    return VoiceIngestionRunner(
        source=source,
        cohort_resolver=cohort_resolver,
        r2_client=bridge,  # type: ignore[arg-type]  # bridge implements R2Client
        state_store=state_store,
        cursor_store=cursor_store,
        audit_lookup=audit_lookup,
        source_kind=source_kind,
        _clock=clock,
    )


__all__ = [
    "RawR2Client",
    "build_namespaced_voice_runner",
]
