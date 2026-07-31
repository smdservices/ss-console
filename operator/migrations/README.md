# operator/migrations/

Per-customer D1 schema migrations. One D1 database per customer (`hermes-{slug}-d1`); these migrations apply to that database.

## How migrations apply

> **They do not (verified 2026-07-31, #2091).** The sequence below is the design as written; no code implements it. `bin/provision-customer.sh` contains no `wrangler d1 create` and no `d1 execute` against a per-customer database, the runner it names (`operator/adapter/run_migrations.py`) does not exist, and `wrangler d1 list` shows no `hermes-*-d1` database in the account. Per ADR 0062 this set is historical; no new consumers may be designed against it. Kept below as the record of what was intended.

`bin/provision-customer.sh` was to run the migration sequence as Step 3 of customer provisioning:

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
- `0009_skill_inventory_r2_capture.sql` — R2 capture of the skill inventory.
- ~~`0010_voice_corrections.sql`~~ — **retired 2026-07-31 (#2091).** See below.

## Retired: 0010_voice_corrections (2026-07-31, #2091)

The file is deleted, not merely superseded. It was schema with no runtime: its header named `adapter/voice/corrections.py::select_active` as the consumer that would resolve and apply corrections, and that module never existed — `operator/adapter/voice/` holds `diff.py`, `filter.py`, `transform.py` and nothing else. ADR 0083 §4 then changed the shape of the thing: a correction is an **edit to an output class's property**, not a before→after glossary substitution, so the table was wrong in structure as well as unwired.

The replacement is split along the trust boundary. **Capture** is an append-only `CORRECTION_PROPOSED` audit row on the seat, written through the uid-gated `correction_propose` broker verb (`operator/workspace_broker/corrections.py`); the agent uid cannot open that ledger for write, and nothing it writes reaches a spec file. **Promotion** is portal-side in the console D1 (`migrations/0102_operator_voice_corrections.sql`), which carries the person axis, the priority, and the restorable supersession chain.

### Negative probes

Per the "gone means gone" discipline in `CLAUDE.md`: a removal is complete when the artifact is absent from every layer it lived in, proven by a probe of each **runtime** layer — not by the diff that deleted it.

| Layer                                                                          | Probe                                                                                    | Result                                                                                           |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| git (migration, test, prose)                                                   | this change; `tests/retired-migrations.test.ts` guards the return                        | absent                                                                                           |
| per-customer Cloudflare D1 (`hermes-{slug}-d1`, the migration's stated target) | `wrangler d1 list`                                                                       | **no such database exists** — the fleet was never provisioned (`vfy_01KYWTNX8A3JYPY08H6GSH8MZ8`) |
| console D1 (`ss-console-db`)                                                   | `SELECT name FROM sqlite_master WHERE name LIKE '%correction%'`                          | empty (`vfy_01KYWTNZVVQY33J4XB1PP02NEZ`)                                                         |
| seat volumes (`/opt/data`, all four deployed seats)                            | byte-level `grep -ral voice_corrections /opt/data`, with an `audit_log` positive control | no table on any seat (`vfy_01KYWTZGDRYTGZDJRHRNBW72SG`)                                          |

### Layers NOT probed from here

Listed because a probe table that only shows what came back clean reads as a clean bill, and this one is not.

- **R2 object contents.** A D1 migration creates no R2 object, so R2 was never a target of `0010` — but that is an argument, not a probe, and it is not the same as having looked. An attempt to enumerate objects (`wrangler r2 object list <bucket>`) produced a **false negative**: that subcommand does not exist in wrangler 4.107.1, the command errored, and grepping its error output for `correction` naturally found nothing. That non-result is discarded rather than recorded. `wrangler r2 bucket list` does work, and the four SMD buckets are `smd-customer-config`, `ss-operator-smd-skills`, `ss-ai-employee-smd-skills`, `ss-operator-scott-skills`; their keys were not enumerated.
- **Preserved exports of decommissioned seats.** The `audit_export` / `memory_export` pull-before-destroy path (ss-console#1355) can have written per-customer state to storage outside these buckets. Not reachable from here.
- **D1 backups / Logpush archives.** Cloudflare-side point-in-time copies of any database are not inspectable with the tooling available in this session.
- **Local `--local` D1 state on other machines.** Any developer's wrangler local state is out of reach by definition.

None of these is a likely home for a table whose migration never ran anywhere. They are unprobed, and are recorded as unprobed.

One hit needed disposition rather than a clean bill: `hermes-smd` carries the string 21 times in `/opt/data/profiles/crane/state.db` and in ten session JSON files dated 2026-06-17. Enumerating that DB's schema (`grep -ao 'CREATE.TABLE.[a-z_]*'`) returns `compression_locks`, `messages`, `schema_version`, `sessions`, `sqlite_sequence`, `state_meta` — no `voice_corrections`. The occurrences are conversation text in the Hermes message store: an agent discussing the migration a month before it was retired. That is history, not a live artifact, and it is deliberately left alone.

### Why this migration set has no runner at all

Worth recording, because it is the reason the probes above came back empty rather than the reason they were unnecessary. `docs/specs/operator/d1-schema.md:254` and this README's "How migrations apply" both describe a step-3 runner, `operator/adapter/run_migrations.py`, called by `provision-customer.sh`. **Neither exists.** `provision-customer.sh` contains no `wrangler d1 create` and no `d1 execute` against a per-customer database. ADR 0062 §28 already declared the consequence — "the per-customer migration set under `operator/migrations/` is historical; no new consumers may be designed against it" — and this retirement is the first removal to confirm it against live state.

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
