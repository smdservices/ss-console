# ai-employee/migrations/

Per-customer D1 schema migrations. One D1 database per customer (`hermes-{slug}-d1`); these migrations apply to that database.

## How migrations apply

`bin/provision-customer.sh` runs the migration sequence as Step 3 of customer provisioning:

1. `wrangler d1 create hermes-{slug}-d1` — creates the customer's D1 (or no-op if it exists)
2. `wrangler d1 execute hermes-{slug}-d1 --file ai-employee/migrations/0001_per_customer_schema.sql` — applies migration 0001
3. (and each subsequent numbered migration in order)
4. `wrangler d1 execute hermes-{slug}-d1 --command "PRAGMA user_version"` — verifies version matches the highest migration number

Forward-only. There is no rollback path because audit-log immutability would be violated.

## Migration files

- `0001_per_customer_schema.sql` — initial schema (11 tables per `docs/specs/ai-employee/d1-schema.md`): audit log, memory rules, person mappings, skill state, draft queue, cost telemetry, invariant boot checks, voice samples, recipient cohorts, sent-folder state, escalation events.

## Schema reference

Full schema specification lives at `docs/specs/ai-employee/d1-schema.md` (issue #800). This directory holds the executable migrations that implement the spec.

## Adding migrations

1. Number the new file `NNNN_description.sql` (next sequential number after the highest existing).
2. End the file with `PRAGMA user_version = N;` where N is the migration number.
3. Forward-only: never `DROP TABLE` on tables containing audit log, voice samples, or memory rules. Use `ALTER TABLE` or copy-into-new for column changes.
4. Update the boot-check assertion in `ai-employee/adapter/run_migrations.py` (when implemented) so a Machine running an older migration than is on disk exits with `INVARIANT_BOOT_CHECK_FAILED`.

## Pairs with

- ADR 0009 — cross-Machine query prohibition (this isolation guarantee at the D1 binding layer)
- ADR 0008 — customer-owned memory artifact (these tables hold per-customer data)
- `docs/specs/ai-employee/d1-schema.md` — full schema spec + failure modes + verification strategy
