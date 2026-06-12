# Memory retention policy

> **SUPERSEDED (2026-06-12, #1355).** This spec described the ADR-0008
> control-plane retention runner (`adapter/memory/retention.py` +
> `bin/cron-retention.py`), which was removed: nothing ever scheduled it, and
> the per-customer control-plane Cloudflare D1 it swept was never provisioned
> or written. Live memory is Machine-local (Hermes flat-file + the ADR-0016
> `persona_observations` mirror, TTL-archived by the overlay per ADR 0016);
> the live audit-retention carve-out lives in
> [`audit-retention.md`](./audit-retention.md) (`customer.yaml
memory.retention.audit_log_days` is still read by the decommission
> pipeline). Retained for historical reference.

**Spec for issue [#863](https://github.com/venturecrane/ss-console/issues/863).** Per-customer retention runner that ages out memory, voice, audit, and draft artifacts in line with the per-data-type windows declared on `customer.yaml`. Sibling to the canonical ingestion pipelines (`adapter/memory/pipeline.py`, `adapter/voice/pipeline.py`) and the decommission script (`bin/decommission-customer.sh`).

## Source

- Platform PRD §13 (Compliance & Privacy Posture)
- [Memory ingestion spec](./memory-ingestion.md) — pipeline that produces the rows retention removes
- [Voice ingestion spec](./voice-ingestion.md) §"Retention" — voice's `enforce_retention()` predates this spec
- [Decommission customer spec](./decommission-customer.md) — the off-boarding sibling; retention runs continuously, decommission runs once at end-of-engagement
- [customer.yaml schema](./customer-yaml-schema.md) §"Memory retention" — the `memory.retention.*` config block this spec consumes
- [ADR 0008](../../adr/0008-customer-owned-memory-artifact.md) — customer-owned memory means customer-controlled deletion

## Files

| Path                                       | Role                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `operator/adapter/memory/retention.py`     | Memory retention runner + policy + cross-pipeline orchestrator. New in this PR.                   |
| `operator/adapter/voice/pipeline.py`       | Voice retention enforcer (`enforce_retention()`). Pre-existing from PR #951; this PR composes it. |
| `operator/bin/cron-retention.py`           | Scheduled-job entrypoint that wires policy + clients and calls the cross-pipeline runner.         |
| `operator/adapter/tests/test_retention.py` | Unit tests for policy parsing, per-type window enforcement, scope filtering, idempotency, audit.  |

## Acceptance map

| Acceptance criterion                                  | Covered by                                                                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| customer.yaml has retention config (per data type)    | `customer-yaml-schema.md` §"Memory retention" + `MemoryRetentionPolicy.from_customer_yaml`                        |
| Periodic cleanup job applies retention rules          | `bin/cron-retention.py` + `run_full_retention` in `retention.py`                                                  |
| Decommission removes all memory (D1 + R2 + Vectorize) | `bin/lib/decommission.py` (PR #956) + canonical `decommission_source` hooks (pre-existing). Retention is sibling. |
| Audit log captures every retention action             | `_emit_retention_audit` in `retention.py`; one row per pipeline per run                                           |
| Confirmation step before decommission deletes         | Documented requirement against `bin/decommission-customer.sh` (see §"Decommission confirmation seam" below)       |

## Retention policy shape

`MemoryRetentionPolicy` is the in-process value object the runner consumes. The defaults below match `customer-yaml-schema.md` §"Memory retention" and are biased toward the law-firm vertical (the launch customer profile):

| Field                | Default (days) | Rationale                                                                                                                 |
| -------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `matters_days`       | 730            | 2 years; covers the typical active-matter lifecycle plus a buffer for re-open scenarios.                                  |
| `documents_days`     | 365            | 1 year; document bodies are large and the chunk index can be rebuilt from the source PM system on demand.                 |
| `recipients_days`    | 730            | 2 years; relationship graph is meaningful only as long as the matters it references are retained, so paired with matters. |
| `voice_samples_days` | 365            | 1 year; matches `voice-ingestion.md` §"Retention" default.                                                                |
| `audit_log_days`     | 2555           | 7 years; legal industry retention norm for client records.                                                                |
| `drafts_days`        | 90             | 90 days; drafts are short-lived working state. Pruning below this window risks losing in-flight review threads.           |

`MemoryRetentionPolicy.from_customer_yaml(parsed)` reads `memory.retention.*` and falls back to the defaults for missing keys. Unknown keys under `memory.retention.*` are ignored (forward-compat with future schema versions). Non-int values trigger a logged fallback to default and a `_pick`-pass warning so a bad customer.yaml does not silently disable retention.

## Per-pipeline scope

Retention currently sweeps two pipelines:

1. **Memory** — `run_memory_retention` walks `memory_ingested_items` per `item_type` (`matter` / `document` / `recipient`) and removes any row whose `ingested_at` is older than the type's window. Per-row cleanup deletes the R2 object, deletes the Vectorize vectors, then soft-deletes the provenance row (preserves the audit trail per ADR 0008).
2. **Voice** — `adapter.voice.pipeline.enforce_retention` (pre-existing) walks `voice_ingestion_items` for the `voice_samples_days` window. Composed into `run_full_retention` so the cron entrypoint runs both halves in one call.

Audit-log + draft retention windows are declared on `MemoryRetentionPolicy` for completeness but the cleanup hooks for `audit_log` and `draft_queue` rows are not in this PR's scope. They are filed as follow-ons against this spec:

- **Audit-log retention sweep** — depends on Captain's redaction tooling. The 7-year window is the contract; the sweep code lands when redaction tooling lands.
- **Drafts retention sweep** — depends on the draft-expiry semantics in `draft_queue` (`expires_at`) being finalized. The 90-day window is the policy; the sweep code lands once expiry is canonical.

## Access-scope discipline

Every memory row carries an `access_scope` (one of `firm-wide`, `partner-only`, `attorney-list`). The retention runner accepts a `DeletingScope` parameter that filters the SELECT:

| `DeletingScope` | SQL filter                                                     | When to use                                                                                                          |
| --------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `FIRM_WIDE`     | `access_scope IN ('firm-wide')`                                | Default for the scheduled cron. Never touches partner-only or attorney-list rows.                                    |
| `PARTNER_ONLY`  | `access_scope IN ('partner-only')`                             | Captain runs this when off-boarding a specific partner or fulfilling a redaction request on partner-restricted data. |
| `ATTORNEY_LIST` | `access_scope IN ('attorney-list')`                            | Same posture as `PARTNER_ONLY` but for attorney-list scoped matters.                                                 |
| `ALL`           | `access_scope IN ('firm-wide','partner-only','attorney-list')` | End-of-engagement full sweep; functionally equivalent to running each narrower scope in sequence.                    |

The default cron run is `FIRM_WIDE` precisely because the firm has visibility into firm-wide rows; partner-only rows belong to the partner and should only be deleted with the partner's explicit consent (Captain's narrower sweep).

## Audit emission

`run_full_retention` writes one audit row per pipeline via `adapter.audit_log.AuditLogWriter`:

| Field                    | Value                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `action_type`            | `DECOMMISSION_DRAIN_COMPLETE`                                                        |
| `actor`                  | `"agent"`                                                                            |
| `actor_role`             | `agent`                                                                              |
| `metadata.step`          | `retention/memory` or `retention/voice` — the discriminator across decommission rows |
| `metadata.customer_slug` | The customer slug being swept                                                        |
| `metadata.window_days`   | The window(s) applied for this sweep                                                 |
| `metadata.total_*`       | Aggregate counts (considered / deleted / errors)                                     |
| `metadata.per_type`      | Memory-only: per-`item_type` breakdown                                               |

### Audit-type backlog

`DECOMMISSION_DRAIN_COMPLETE` is the closest neutral cleanup signal in `ACCEPTED_ACTION_TYPES` today; the `metadata.step` discriminator keeps retention rows distinguishable from decommission rows that share the action type. A dedicated `RETENTION_SWEEP_COMPLETE` action type is filed as a follow-on; once it lands, this spec + `_RETENTION_ACTION_TYPE` in `retention.py` flip together.

## Idempotency

`run_memory_retention` selects on `ingested_at < cutoff AND deleted_at IS NULL`. A re-run with no new expired rows reports zero items per type, performs no R2 / Vectorize / D1 writes, and emits an audit row with `total_deleted=0`. This matches the decommission pipeline's "second call is a no-op" contract.

## Decommission integration

Decommission and retention are siblings, not callers:

- **Retention** runs continuously (daily cron, narrow scope). Removes rows that aged past the per-type window. The customer continues operating.
- **Decommission** runs once (`bin/decommission-customer.sh`). Removes ALL rows regardless of window, via the canonical `decommission_source` hooks in `adapter/memory/state.py` and `adapter/voice/pipeline.py`. The customer is being off-boarded.

The `decommission_source` hooks are NOT changed by this PR — retention is a separate code path that uses the same R2 / Vectorize / D1 substrate. Decommission's "remove everything" contract is unaffected.

### Decommission confirmation seam

Issue #863 also requires "Confirmation step before decommission deletes." `bin/decommission-customer.sh` today defaults to `--dry-run` and requires explicit `--live` to execute. This satisfies the "no accidental deletion" half of the requirement, but it does NOT prompt the operator interactively before running.

This PR documents the requirement against `bin/decommission-customer.sh` rather than modifying it (per the file-scope constraint in #863). The follow-on work to add an interactive `read -p` confirmation before `--live` proceeds is filed as a separate issue against the decommission script. Until that lands, the merge gate is the `--live` flag itself plus the audit log emission that records who pressed the button.

## Failure handling

Per-row exceptions are caught in the sweep loop, counted on the per-type result's `errors` field, and logged with the row ID. The sweep continues to the next row; one transient R2 failure never aborts the cron run. The audit row records the error count; the cron exit code is `3` when any per-row error fires, so a downstream wrapper can surface the failure to the dashboard.

A failure to import `adapter.audit_log` (test isolation, partial install) downgrades audit emission to a logged warning so unit tests that exercise retention without the audit_log dependency still run cleanly.

## Cron schedule

The scheduled-job wiring (Hermes Machine cron, Fly scheduled tasks) is the responsibility of the per-customer machine bring-up. The recommendation:

- Run `python -m bin.cron-retention <slug>` once per day, off-peak (e.g., 03:30 customer-local).
- Use `--scope firm_wide` for the default sweep. Narrower scopes are Captain-invoked, not scheduled.
- Wire the cron's stderr to the per-customer log shipper; the dashboard surfaces non-zero exits.

## Cross-references

- [`memory-ingestion.md`](./memory-ingestion.md) — the producer side of the rows retention consumes
- [`voice-ingestion.md`](./voice-ingestion.md) §"Retention" — the voice half of the retention surface
- [`decommission-customer.md`](./decommission-customer.md) — the off-boarding sibling pipeline
- [`customer-yaml-schema.md`](./customer-yaml-schema.md) §"Memory retention" — the policy source
- [`d1-schema.md`](./d1-schema.md) §1 — accepted `action_type` values (the `RETENTION_SWEEP_COMPLETE` follow-on lives here)
- [ADR 0008](../../adr/0008-customer-owned-memory-artifact.md) — customer-owned memory means customer-controlled deletion
