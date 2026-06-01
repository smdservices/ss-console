# Decommission Customer Script

**Spec for issue [#820](https://github.com/venturecrane/ss-console/issues/820).** Full per-customer off-boarding sequence. Composes the existing `decommission_source` hooks (memory + voice) with substrate-deletion steps (R2, Vectorize, AgentMail, Fly), the compliance evidence packet archive, and the `customers/{slug}/` tombstone. Implements PRD §14.3 and the contractual obligation in §13.

## Source

- [Platform PRD](../../pm/operator/platform-prd.md) §13 (Compliance & Privacy Posture), §14.3 (Phase 1 ops deliverable)
- [Decommission Drain](./decommission-drain.md) — covers the 60s in-flight grace window (#805)
- [R2 + Vectorize Naming](./r2-vectorize-naming.md) — per-customer namespace convention (#801)
- [OAuth Lifecycle](./oauth-lifecycle.md) — per-customer OAuth token lifecycle (build: adapters)
- [Compliance Evidence Packet](./compliance-evidence-packet.md) — packet structure (#802)
- [D1 Schema](./d1-schema.md) §1 — accepted `action_type` values

## Files

- `ai-employee/bin/decommission-customer.sh` — shell wrapper, dispatches to the Python CLI
- `ai-employee/bin/lib/decommission.py` — `DecommissionPipeline` + Protocols + NoOp stubs
- `ai-employee/bin/lib/decommission_cli.py` — argparse-based CLI entrypoint, audit-writer construction
- `ai-employee/bin/tests/test_decommission.py` — end-to-end tests against the `smd` fixture
- `ai-employee/bin/fixtures/smd/` — synthetic customer-zero fixture for tests

## Contract

### Invocation

```
ai-employee/bin/decommission-customer.sh <slug> [--dry-run|--live]
```

Default is `--dry-run`. The Python CLI may also be invoked directly:

```
cd ai-employee && uv run --quiet --with pyyaml python3 \
  -m bin.lib.decommission_cli <slug> [--dry-run|--live] \
  [--customers-root PATH] [--archive-root PATH] [--audit-db PATH] [--actor NAME]
```

### Exit codes

| Code  | Meaning                                                                |
| ----- | ---------------------------------------------------------------------- |
| `0`   | Dry-run completed, or live decommission completed cleanly.             |
| `2`   | Pre-flight failed (missing slug, no `customer.yaml`, no tombstone).    |
| `3`   | Live decommission halted mid-sequence. Re-run the same slug to resume. |
| `4`   | Unexpected non-step exception (audit writer init failure, etc.).       |
| `130` | Interrupted by Ctrl-C.                                                 |

### The steps

The pipeline also runs a trailing `09_observability_cleanup` step (ADR 0023 Wave 1) not enumerated here; see `bin/lib/decommission.py`.

| #   | Step name               | Action                                                                                                                       | Idempotency mechanism                                                                              |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | `01_drain`              | Verify in-flight LLM drain marker (#805 covers the pause).                                                                   | Always re-runnable; records drain window seconds.                                                  |
| 2   | `02_d1_memory_voice`    | Call `adapter.memory.state.decommission_source` and `adapter.voice.pipeline.decommission_source` for each configured source. | Each canonical hook soft-deletes provenance rows + clears state — repeat calls return zero counts. |
| 3   | `03_r2_namespace`       | Delete every R2 object under `{slug}/` except the `decommission-archive/` subtree.                                           | Second call returns `skipped: true, reason: namespace_already_empty`.                              |
| 4   | `04_vectorize_indexes`  | Delete `hermes-{slug}-vault` and `hermes-{slug}-corrections`.                                                                | Second call returns `skipped: true, reason: indexes_already_absent`.                               |
| 5   | `05_agentmail`          | Deprovision the AgentMail inbox and forwarding rules.                                                                        | `NoOpStub` skip until AgentMail admin API wired.                                                   |
| 6   | `06_fly_machine`        | `fly machine destroy hermes-{slug} --force`.                                                                                 | `NoOpStub` skip until Fly destroy wired.                                                           |
| 7   | `07_compliance_archive` | Generate the compliance evidence packet per `compliance-evidence-packet.md` and copy to `archive_root/{slug}/`.              | Each call writes a new timestamped manifest; the cold-storage retention policy handles overwrites. |
| 8   | `08_tombstone`          | Rename `ai-employee/customers/{slug}/` to `{slug}.decommissioned.{iso-date}` and drop a `DECOMMISSIONED.md` marker.          | Returns `skipped: true, reason: already_tombstoned` when the dated tombstone is present.           |

### Audit-log emission

Every step writes audit rows via `adapter.audit_log.AuditLogWriter`:

- Before the step runs: `DECOMMISSION_INITIATED` with `metadata.step = <step_name>`.
- After success: `DECOMMISSION_DRAIN_COMPLETE` with `metadata.step` plus the step's detail manifest.
- On failure: `DECOMMISSION_INITIATED` with `metadata.detail.failed = true` and the exception class + message.
- Final marker: `DECOMMISSION_FINAL` with `metadata.detail.steps = [...]`.

All three `action_type` values are in `ACCEPTED_ACTION_TYPES` in `adapter/audit_log.py` (Decommission lifecycle section). The local audit log is written to `customers/{slug}/.decommission-audit.sqlite` so the trail survives after the per-customer D1 is deleted by step 2.

### Stub implementations

Two external services are not wired in this PR. Each is fronted by a `Protocol` so production wiring is a constructor swap:

| Protocol               | NoOp implementation | Behavior                                                                                     |
| ---------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| `AgentMailProvisioner` | `NoOpAgentMailStub` | Returns `{"skipped": True, "reason": "external_client_not_wired", "identities_removed": 0}`. |
| `FlyMachineManager`    | `NoOpFlyStub`       | Same shape; `app_destroyed: False`.                                                          |

The CLI defaults to these stubs. When credentials land (per follow-on AgentMail / Fly issues), replace the stubs in `decommission_cli.py` with real clients — no pipeline rewrite required.

### Dry-run vs live output

Both modes emit one line per step. The status column distinguishes them:

```
[ planned] 03_r2_namespace: {"deleter_wired":false,"namespace":"smd/"}
[executed] 03_r2_namespace: {"objects_deleted":12}
[ skipped] 03_r2_namespace: {"reason":"namespace_already_empty","skipped":true}
```

This keeps dry-run vs live diffs cheap — Captain can compare side-by-side before authorizing the live run.

### `smd-cli` integration

When the Captain CLI lands at `bin/smd-cli` (or `ai-employee/bin/smd-cli`), register a `decommission` subcommand that delegates to this script:

```
smd-cli decommission <slug>     # equivalent to: bin/decommission-customer.sh <slug> --live
```

The CLI passes the operator's identity through `--actor`; the script defaults to `$DECOMMISSION_ACTOR` or `captain` so manual invocations still produce attributable audit rows.

### Idempotency contract

`P0 invariant.` Any sequence of `plan` + `run` invocations on the same slug must converge on a fully decommissioned state without raising. The test suite asserts:

1. `plan` x2 (no side effects).
2. `run` (full execution).
3. `run` again (every step reports `skipped` or executes a benign no-op).

Re-running after a mid-sequence failure (`exit 3`) is the supported recovery path; Captain does not have to clean up partial state by hand.

### Failure semantics

Live mode halts on the first step that raises. The failed step's audit row is written before the exception propagates so the trail names the failure. Re-running picks up where it left off because every step is idempotent. There is no rollback path: decommission is one-directional. If a substrate-deletion step fails partway through (e.g., R2 namespace delete throttled mid-batch), the live R2 deleter implementation must accept partial state and only delete what is still present on retry.

## Test plan

`ai-employee/bin/tests/test_decommission.py` runs against the `smd` synthetic fixture (copied into a tmp path per test):

| Test                                                  | Asserts                                                                                                                                                                           |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test_dry_run_returns_planned_steps_and_does_nothing` | Every step returns `PLANNED`; no audit rows written; live dir untouched.                                                                                                          |
| `test_live_runs_full_sequence_and_writes_audit_trail` | Full sequence executes; customer dir tombstoned; compliance manifest written; audit log contains `DECOMMISSION_INITIATED` + `DECOMMISSION_DRAIN_COMPLETE` + `DECOMMISSION_FINAL`. |
| `test_idempotent_repeated_runs`                       | `plan` x2 + `run` + `run` all succeed; second `run` reports `SKIPPED` for tombstone, R2, Vectorize.                                                                               |
| `test_failure_halts_with_step_failed`                 | A runner that raises mid-sequence halts with `DecommissionStepFailed`; audit log records the failure; resume path completes.                                                      |
| `test_tombstone_skips_when_no_customer_dir`           | Tombstoning a non-existent slug returns `skipped: true, reason: no_customer_dir`.                                                                                                 |
| `test_tombstone_idempotent_when_already_tombstoned`   | Second tombstone call returns `skipped: true, reason: already_tombstoned`.                                                                                                        |
| `test_noop_stubs_return_skipped_manifests`            | The AgentMail and Fly NoOp stubs return `skipped: true, reason: external_client_not_wired`.                                                                                       |
| `test_compliance_archiver_writes_manifest`            | The in-process archiver writes a manifest JSON to the archive dir.                                                                                                                |

Run with:

```
cd ai-employee && uv run --quiet --with pytest --with pyyaml python3 -m pytest bin/tests/test_decommission.py -v
```

## Open work

- Wire `AgentMailProvisioner` once the AgentMail admin API is enrolled.
- Wire `FlyMachineManager` to `fly machine destroy --force` once Captain confirms the destroy-without-prompt token flow.
- Replace `InMemoryComplianceArchiver` with the `compliance-audit-export` skill output (#802).
- Land `bin/smd-cli` `decommission` subcommand and remove the standalone-invocation note in this spec.
