# Memory + Voice Export Pipeline

**Spec for issue [#862](https://github.com/venturecrane/ss-console/issues/862).** Per ADR 0008 (customer-owned memory artifact), the customer can request a portable export of their memory on offboarding. This spec defines the archive layout, the integrity manifest, the signing seam, and the decommission integration point.

## Source

- [ADR 0008 -- Customer-Owned Memory Artifact](../../adr/0008-customer-owned-memory-artifact.md)
- [Memory Ingestion Pipeline](./memory-ingestion.md) -- what gets ingested becomes what gets exported
- [Voice Ingestion Pipeline](./voice-ingestion.md) -- privacy floor (structural-diff only) carried through
- [Decommission Customer Script](./decommission-customer.md) -- pre-step where the export runs
- [D1 Schema](./d1-schema.md) §1 -- accepted `action_type` values

## Files

- `operator/adapter/memory/export.py` -- `export_memory()` plus the `MemoryExportManifest` shape
- `operator/adapter/voice/export.py` -- `export_voice_library()` plus the `VoiceExportManifest` shape and the privacy guard
- `operator/bin/lib/export.py` -- `run_export()` orchestrator that composes memory + voice into a tar.gz, plus the `run_export_for_decommission()` integration seam
- `operator/adapter/memory/tests/test_export.py` -- memory unit tests
- `operator/adapter/voice/tests/test_export.py` -- voice unit tests
- `operator/bin/tests/test_export.py` -- end-to-end orchestrator tests against a tar.gz on disk

## Contract

### Invocation

```python
from bin.lib.export import run_export

summary = await run_export(
    customer_slug="smd",
    memory_reader=memory_reader,    # D1 reads
    memory_r2_reader=memory_r2,     # R2 reads
    voice_reader=voice_reader,
    voice_r2_reader=voice_r2,
    voice_config=voice_config_dict, # opaque dict from customer.yaml
    archive_dir=Path("/var/lib/aie/exports"),
    audit_writer=audit_writer,
)
print(summary.archive_path)
```

The orchestrator returns an `ExportRunSummary` with the archive path, the per-domain entry counts, and the start + finish timestamps. The summary is serialized into the second audit row's metadata.

### Archive layout

The export lands at `archive_dir/{customer-slug}-export-{ISO-timestamp}.tar.gz`. Inside:

```
manifests/
  memory.json
  voice.json
memory/
  state/{source_kind}-{source_id}.json
  items/{source_kind}-{source_id}-{item_type}.json
  vault/narrative/{...}.json
  vault/process/{...}.txt
  rules/memory-rules.json
  people/person-mappings.json
voice/
  state/{source_kind}-{source_id}.json
  provenance/items.json
  samples/cohort/{cohort}/{sample-id}.json
  library/config.json
```

Every artifact is documented in the per-domain manifest. The two manifests are not merged; each is signed (or stub-signed) independently so a downstream consumer can verify the two halves separately.

### Manifest shape

```json
{
  "customer_slug": "smd",
  "exported_at": "2026-05-21T12:00:00.000Z",
  "schema_version": 1,
  "signature": "",
  "signature_kind": "stub",
  "entries": [
    {
      "path": "memory/items/practice_management-filevine-matter.json",
      "kind": "matter",
      "sha256": "...",
      "item_count": 2,
      "scope": "mixed",
      "source_kind": "practice_management",
      "source_id": "filevine"
    }
  ]
}
```

`scope` carries the per-row `access_scope` from the memory pipeline (`firm-wide`, `partner-only`, `attorney-list`). If a collection contains rows with different scopes, the manifest entry records `mixed` and the per-row scope is preserved inside the JSON body so an auditor can read it without losing fidelity.

`schema_version` is `1` at first ship. Bump when the manifest shape, the archive layout, or the per-artifact JSON contract changes. Older archives stay readable; the consumer keys on `schema_version`.

### Integrity verification

Every artifact has a sha256 digest in the manifest. The customer extracts the archive, recomputes the digest of each file, and compares to the manifest. A mismatch indicates either corruption or tampering in transit.

The manifest itself records `signature_kind`. Today the signer is a no-op stub; the manifest still survives integrity verification because the per-artifact digests are independent of the signature. When PGP/age signing lands in a follow-on, the existing per-artifact digests remain valid; downstream consumers verify the signature on the manifest bytes plus the per-artifact digests.

### Privacy controls

- **Memory.** Matters, documents, and recipients carry the `access_scope` from the ingestion pipeline. A matter tagged `partner-only` lands with that tag intact in the manifest. The export does not strip restricted matters; it preserves the tags so the consumer can apply controls.
- **Voice.** Voice samples are the structural-diff JSON produced by the voice ingestion pipeline (PR #951). The raw email body is dropped at ingestion time, before R2 is touched. The export copies the same JSON bytes verbatim.
- **Privacy guard.** `adapter/voice/export.py` walks each sample JSON and raises `VoiceExportPrivacyError` if any field name appears in `_FORBIDDEN_SAMPLE_KEYS` (`body_text`, `raw_body`, `body`, `html`, `plain_text`, `subject_text`, `quoted_text`). The structural-diff format produces none of these today; the guard prevents future regressions from shipping raw content to the customer's archive.

### Signing seam

Both `export_memory()` and `export_voice_library()` accept an optional `signer`. The default is `NoOpExportSigner` (or `NoOpVoiceExportSigner`), whose `sign()` returns the empty string. The manifest records `signature_kind="stub"` so consumers can tell the export pre-dates real signing.

Production wiring swaps the stub for a PGP or age signer. The interface is one async method:

```python
class ExportSigner(Protocol):
    signature_kind: str
    async def sign(self, manifest_bytes: bytes) -> str: ...
```

The signer receives the JSON-serialized manifest (without the `signature` field populated) and returns a detached signature string. The export module re-serializes the manifest with the signature populated and writes the final manifest. Wiring real signing does not require a pipeline rewrite.

### Audit emission

`run_export()` writes two `COMPLIANCE_PACKET_EXPORTED` rows:

| Position | `metadata.kind`           | Contents                                                         |
| -------- | ------------------------- | ---------------------------------------------------------------- |
| Before   | `memory_export.initiated` | `{customer_slug, started_at}`                                    |
| After    | `memory_export.completed` | Full `ExportRunSummary` (archive_path, counts, timestamps)       |
| Failure  | `memory_export.failed`    | Replaces the `completed` row on exception; carries error message |

`COMPLIANCE_PACKET_EXPORTED` is the closest existing action_type in `adapter/audit_log.py::ACCEPTED_ACTION_TYPES`. A `MEMORY_EXPORTED` enum value would be cleaner but introducing it requires a coordinated update to the closed set in `audit_log.py` plus the `d1-schema.md` §1 list. The `metadata.kind` distinguishes the export rows from a compliance-packet export, so dashboard rendering can filter cleanly.

### Idempotency

Re-running `run_export` writes a new timestamped archive. Prior archives are not modified. The customer can request the export as many times as they want; each request produces an independent archive on disk. The cold-storage retention policy is the operator's call.

### Failure behavior

On any export-module failure (D1 read raises, R2 read raises, privacy guard fires, tarfile write fails), `run_export` raises `ExportFailed`. The partial archive is left on disk so an auditor can inspect what was written before the failure. A `memory_export.failed` audit row lands before the exception propagates.

The decommission integration seam (`run_export_for_decommission`) re-raises the same `ExportFailed` so the decommission CLI can halt on the failure. Halting the decommission on export failure is intentional: a partial export paired with a successful decommission would lose customer data with no way to recover.

### Decommission integration

This PR does NOT modify `bin/decommission-customer.sh` or `bin/lib/decommission.py`. The wiring lands in a follow-on of the form:

```python
# in bin/lib/decommission.py, before _step_d1_memory_voice:
summary = await run_export_for_decommission(
    customer_slug=self.customer_slug,
    memory_reader=...,         # constructed from per-customer D1 binding
    memory_r2_reader=...,
    voice_reader=...,
    voice_r2_reader=...,
    voice_config=...,          # loaded from customer.yaml
    archive_dir=self.archive_root / self.customer_slug,
    audit_writer=self.audit_writer,
)
# Surface summary.archive_path on the decommission report.
```

`run_export_for_decommission` is the integration entrypoint. It is a thin wrapper around `run_export` whose name signals "this call's failure is a decommission-halt condition" to the decommission CLI. The wrapper exists so the decommission CLI can catch `ExportFailed` from a single named function without sniffing the call site or duplicating the audit emission contract.

Wiring the call is intentionally deferred. The decommission CLI's substrate-deletion steps already assume the export ran; adding the call in the same PR as the export module makes the change set hard to review and ties a substrate-deletion regression to an export-pipeline rollout. Land the export pipeline, ship a small follow-on that wires the call, leave the decommission script's idempotency guarantees intact.

## Out of scope for this PR

- **Customer-initiated export via signed URL.** ADR 0008 lists this as a post-launch capability. The orchestrator's interface supports it (an `R2ObjectReader` can be backed by any binding), but the signed-URL plumbing is a separate PR.
- **PGP/age signing.** The seam is in place; the implementation is a follow-on. The export remains integrity-verifiable via per-artifact digests in the meantime.
- **Decommission wiring.** Documented above; a small follow-on PR adds the call before step 02 in `bin/lib/decommission.py`.
- **Cold-storage retention policy.** The archive lands at `archive_dir/`; lifetime management is the operator's call and lives outside this module.
