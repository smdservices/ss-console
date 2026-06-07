# Memory Ingestion Pipeline

**Spec for issue #860.** Vendor-neutral pipeline that consumes capability-adapter outputs and writes to the per-customer memory store (D1 + R2 + Vectorize). Scheduled daily plus on-demand, sharing one entrypoint.

## Source

- Platform PRD §10 (Memory Model & Learning Loop)
- ADR 0006 (capability-adapter pattern)
- ADR 0008 (customer-owned memory artifact)
- ADR 0009 (cross-machine query prohibition)
- d1-schema.md (per-customer D1 tables)
- r2-vectorize-naming.md (R2 keys + index names)

## Pipeline shape

One entrypoint:

```python
await runner.run_ingestion(
    SourceDescriptor(source_kind="practice_management", source_id="filevine"),
    IngestionMode.SCHEDULED,
)
```

The runner is constructed with the source adapter, R2/Vectorize storage client, embedding client, chunker, and the D1-backed state store. It holds no per-run state and is safe to share across scheduled and on-demand calls.

`source_kind` is the capability name (lowercased). `source_id` is the vendor slug (`"filevine"`, `"clio"`) or `"none"` for the no-PM-system fallback. The pipeline never branches on the vendor — adapters implement the `PracticeManagement` capability contract; the pipeline calls the contract.

## What gets ingested

| Item type   | Source                                                                             | Storage                                                                                |
| ----------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `matter`    | `PracticeManagement.search_matters`                                                | R2 narrative JSON at `{slug}/vault/narrative/pm-{vendor}-matter-{id}.json` + D1 row    |
| `document`  | `PracticeManagement.list_matter_documents`                                         | R2 body at `{slug}/vault/process/pm-{vendor}-doc-{id}.txt` + Vectorize chunks + D1 row |
| `recipient` | `PracticeManagement.search_contacts` (+ communications-history derivation; future) | D1 row only; relationship graph                                                        |

The pipeline writes one `memory_ingested_items` row per item with the R2 key, the Vectorize chunk ID array, and a content digest. Decommission walks that table to enumerate and remove every artifact.

## Document chunking

Paragraph + overlap. `target_chars` defaults to 1800, `overlap_chars` defaults to 200. Chunk IDs are content-derived (`sha256(document_id + index + text)[:32]`) so re-runs over unchanged content produce identical IDs and citations stay stable.

## Per-matter access controls

Every matter and document carries an `access_scope` from the source adapter:

- `firm-wide` (default)
- `partner-only`
- `attorney-list` (with `access_scope_detail` listing the attorney IDs)

The pipeline does NOT decide ACLs. It propagates whatever the connector returns. The retrieval layer (skill code that reads memory) is responsible for enforcing the scope against the requesting actor.

## Failure handling

Every run upserts `memory_source_state` regardless of outcome:

- success → `ingest_status='ok'`, `last_success_at` advances, `last_error` cleared
- failure → `ingest_status='error'`, `last_success_at` preserved, `last_error` populated

The runner never re-raises a source error. Scheduled runs continue to the next source; on-demand callers receive an `IngestionResult` with `ok=False`. Skill code reads cached items (`memory_ingested_items` rows where `deleted_at IS NULL`) when ingestion is errored — reads never block on a failed ingestion (AC: agent operates on cached).

A separate freshness sweep (cron) flips `ingest_status` from `ok` to `stale` once `last_ingestion_at` ages past the per-source threshold. That sweep is filed separately; the schema field is present.

## Captain dashboard surface

The dashboard reads `memory_source_state` and renders one row per source with the status color, `last_ingestion_at`, `last_success_at`, `last_error`, and `items_last_run`. The dashboard endpoint is a separate issue; this PR provides the table + the `read_source_states()` helper the endpoint will call.

## No PM system fallback

`NoPracticeManagementSource` returns empty lists for matters, documents, and recipients. A scheduled run against it produces a green `memory_source_state` row with `items_last_run = 0`. The demo customer with no PM system sees the source as healthy.

## Decommission (ADR 0008)

`decommission_source(store, storage, source_kind=..., source_id=...)` walks `memory_ingested_items` for the source, deletes every R2 object, deletes every Vectorize vector, soft-deletes the provenance rows (preserves the audit trail), and removes the `memory_source_state` row. Returns a manifest with counts; the caller writes the `DECOMMISSION_DRAIN_COMPLETE` audit row.

## Out of scope for #860

- Filevine, Clio, MyCase, CASEpeer adapter implementations — separate issues per vendor.
- Communications-history mining for the recipient relationship graph beyond direct contact listings — future.
- Stale-status sweep cron — filed separately; the schema field is present.
- Dashboard query endpoint — separate issue; the `read_source_states` helper is the contract it will call.
- Sent-folder watching integration — already tracked under voice-gate work (`sent_folder_state` table in 0001).
