# operator/migrations/

Per-customer D1 schema migrations. One D1 database per customer (`hermes-{slug}-d1`); these migrations apply to that database.

## How migrations apply

`bin/provision-customer.sh` runs the migration sequence as Step 3 of customer provisioning:

1. `wrangler d1 create hermes-{slug}-d1` — creates the customer's D1 (or no-op if it exists)
2. `wrangler d1 execute hermes-{slug}-d1 --file operator/migrations/0001_per_customer_schema.sql` — applies migration 0001
3. (and each subsequent numbered migration in order)
4. `wrangler d1 execute hermes-{slug}-d1 --command "PRAGMA user_version"` — verifies version matches the highest migration number

Forward-only. There is no rollback path because audit-log immutability would be violated.

## Migration files

- `0001_per_customer_schema.sql` — initial schema (11 tables per `docs/specs/operator/d1-schema.md`): audit log, memory rules, person mappings, skill state, draft queue, cost telemetry, invariant boot checks, voice samples, recipient cohorts, sent-folder state, escalation events.
- `0002_audit_log_indexes.sql` — additional indexes for the audit_log writer (issue #891): timestamp DESC, skill_name + ts DESC, action_type + ts DESC. Documents the Logpush backup configuration plan that lives on the per-customer Hermes Worker deployment side.
- `0003_memory_ingestion.sql` — per-customer memory pipeline state.
- `0004_sticky_stop_state.sql` — sticky-stop state machine table (substrate invariant #4).
- `0005_voice_ingestion.sql` — voice-sample ingestion state.
- `0006_cost_attribution_rollup.sql` — per-customer cost rollup. **Placement superseded by ADR 0062 (2026-07-03):** the cost tables (`cost_telemetry`, `captain_time_events`) now live in the central ss-console D1 (`migrations/0083_central_cost_telemetry.sql`); this file stays as historical record.
- `0007_persona_observations.sql` — **rewritten 2026-05-25** per ADR 0016 rewrite (2026-05-24): mirror-don't-gate posture. Table holds Honcho conclusions mirrored by `hermes-smd-memory-mirror` plugin with `evidence_status` classification (defends against Honcho bug #626); `persona_observations_archive` for TTL'd rows.
- `0008_agent_skills_inventory.sql` — **rewritten + renamed from `0008_skill_drafts.sql` 2026-05-25** per ADR 0017 rewrite (2026-05-24): trust-native posture. Table mirrors agent-authored skills the `skill_manage` tool creates; Captain reviews and physically removes in the admin portal.

## Schema reference

Full schema specification lives at `docs/specs/operator/d1-schema.md` (issue #800). This directory holds the executable migrations that implement the spec.

## Adding migrations

1. Number the new file `NNNN_description.sql` (next sequential number after the highest existing).
2. End the file with `PRAGMA user_version = N;` where N is the migration number.
3. Forward-only: never `DROP TABLE` on tables containing audit log, voice samples, or memory rules. Use `ALTER TABLE` or copy-into-new for column changes.
4. Update the boot-check assertion in `operator/adapter/run_migrations.py` (when implemented) so a Machine running an older migration than is on disk exits with `INVARIANT_BOOT_CHECK_FAILED`.

## Pairs with

- ADR 0009 — cross-Machine query prohibition (this isolation guarantee at the D1 binding layer)
- ADR 0008 — customer-owned memory artifact (these tables hold per-customer data)
- `docs/specs/operator/d1-schema.md` — full schema spec + failure modes + verification strategy
