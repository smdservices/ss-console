"""Evidence-packet manifest.json builder + Captain signature stub.

The manifest is the deterministic index of every file in the packet,
their sha256 digests, and the Captain signature block. Per spec
(``compliance-evidence-packet.md`` §manifest.json), the manifest carries:

* ``customer_slug``
* ``period_start`` / ``period_end`` (ISO 8601)
* ``generated_at`` (ISO 8601)
* ``captain_signature`` — name, email, key_id, and a detached signature
* ``file_hashes`` — every packet entry's sha256
* ``packet_version``

Signing is a no-op stub in this PR: ``signature`` carries the literal
string ``"unsigned-stub"`` and ``key_id`` reads from
``CAPTAIN_SIGNING_KEY_ID`` env or falls back to ``"stub-key"``. The PDF
summary page interpolates the manifest's sha256 + the Captain ID
verbatim so a reader can verify the manifest is the same one referenced
by the PDF. Real RSA signing wires in later per the spec's
implementation notes section.

The manifest sha256 is the canonical handle: PDF references it, the
packet generation audit row carries it in metadata, the receipt the
caller emails to outside counsel quotes it. Compute via
:func:`manifest_sha256_hex`.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Mapping, Optional

PACKET_VERSION = "1.0"
SIGNATURE_STUB = "unsigned-stub"


def _iso_utc(now: Optional[datetime] = None) -> str:
    dt = now if now is not None else datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


@dataclass(frozen=True)
class EvidenceManifest:
    """The structured manifest body. Serialize via :meth:`to_bytes`.

    The dataclass is frozen because the manifest must be byte-stable:
    the PDF cites :func:`manifest_sha256_hex` of these exact bytes, and
    any mutation invalidates the citation. Re-build a new manifest
    rather than mutating.
    """

    customer_slug: str
    period_start: str
    period_end: str
    generated_at: str
    captain_name: str
    captain_email: str
    captain_key_id: str
    file_hashes: Mapping[str, str]
    actor: str
    actor_role: str
    matter: str
    packet_version: str = PACKET_VERSION
    signature: str = SIGNATURE_STUB
    extra: Mapping[str, object] = field(default_factory=dict)

    def to_dict(self) -> dict:
        body: dict = {
            "customer_slug": self.customer_slug,
            "period_start": self.period_start,
            "period_end": self.period_end,
            "matter": self.matter,
            "generated_at": self.generated_at,
            "generated_by": {
                "actor": self.actor,
                "actor_role": self.actor_role,
            },
            "captain_signature": {
                "name": self.captain_name,
                "email": self.captain_email,
                "key_id": self.captain_key_id,
                "signature": self.signature,
                "algorithm": "stub-noop",
            },
            "file_hashes": {k: self.file_hashes[k] for k in sorted(self.file_hashes)},
            "packet_version": self.packet_version,
        }
        if self.extra:
            body["extra"] = dict(self.extra)
        return body

    def to_bytes(self) -> bytes:
        """Canonical JSON bytes: sorted keys, no whitespace artifacts.

        The sort + separator choice mirrors :mod:`adapter.audit_log` so
        any future signature implementation sees the same bytes the
        sha256-cite path saw.
        """
        return json.dumps(
            self.to_dict(),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf-8")


def manifest_sha256_hex(manifest: EvidenceManifest) -> str:
    """Return the sha256 of the canonical manifest bytes (hex)."""
    return hashlib.sha256(manifest.to_bytes()).hexdigest()


def build_manifest(
    *,
    customer_slug: str,
    matter: str,
    period_start: str,
    period_end: str,
    file_hashes: Mapping[str, str],
    actor: str,
    actor_role: str,
    captain_name: Optional[str] = None,
    captain_email: Optional[str] = None,
    captain_key_id: Optional[str] = None,
    generated_at: Optional[str] = None,
    extra: Optional[Mapping[str, object]] = None,
) -> EvidenceManifest:
    """Construct an :class:`EvidenceManifest` from packet inputs.

    Captain identity defaults read from env (set by the CLI wrapper or
    bootstrap.sh in production). The signing stub does not require a
    real key, but recording who would have signed is part of the audit
    trail — a future real-signature switch only changes the
    ``signature`` field.
    """
    return EvidenceManifest(
        customer_slug=customer_slug,
        matter=matter,
        period_start=period_start,
        period_end=period_end,
        generated_at=generated_at or _iso_utc(),
        captain_name=captain_name
        or os.environ.get("CAPTAIN_SIGNING_NAME", "Scott Durgan"),
        captain_email=captain_email
        or os.environ.get("CAPTAIN_SIGNING_EMAIL", "scott@smd.services"),
        captain_key_id=captain_key_id
        or os.environ.get("CAPTAIN_SIGNING_KEY_ID", "stub-key"),
        file_hashes=dict(file_hashes),
        actor=actor,
        actor_role=actor_role,
        extra=dict(extra or {}),
    )


__all__ = [
    "EvidenceManifest",
    "PACKET_VERSION",
    "SIGNATURE_STUB",
    "build_manifest",
    "manifest_sha256_hex",
]
