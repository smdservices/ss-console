# Audit log retention policy

**Spec for issue [#893](https://github.com/venturecrane/ss-console/issues/893).** Per-vertical retention window for `audit_log` rows, with a `customer.yaml` override mechanism (override-up-only) and a decommission carve-out that preserves the audit log after the rest of the per-customer substrate is destroyed.

Sibling to [`memory-retention.md`](./memory-retention.md) (continuous per-data-type cleanup) and [`decommission-customer.md`](./decommission-customer.md) (one-shot end-of-engagement off-boarding). The retention policy declared here is the contract; the audit-log sweep code itself is filed as a follow-on against `memory-retention.md` §"Per-pipeline scope" (depends on Captain's redaction tooling). This spec defines the policy, the override schema, and the decommission preservation behavior.

## Source

- Platform PRD §13 (Compliance & Privacy Posture)
- Law Firm PRD — 7-year retention requirement per state-bar audit norms
- [Memory retention spec](./memory-retention.md) — sibling continuous-sweep runner; declares the same `audit_log_days` field for forward-compat
- [Decommission customer spec](./decommission-customer.md) — the off-boarding pipeline this spec extends with an audit-log carve-out
- [customer.yaml schema](./customer-yaml-schema.md) §"Memory retention" — the `memory.retention.*` block this spec adds field rules to
- [D1 schema](./d1-schema.md) §1 — `audit_log` table shape
- [Audit log immutability](./audit-log-immutability.md) — Worker-layer INSERT-only enforcement; the same invariant that requires retention-driven deletion to flow through Captain's redaction tooling

## Acceptance map

| Acceptance criterion (#893)                                          | Covered by                                                                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Retention period documented per vertical (law-firm: 7 years default) | §"Per-vertical defaults" below                                                                                        |
| customer.yaml supports retention override (longer; not shorter)      | §"Override-up-only enforcement" + `checkMemoryRetention` in `src/lib/operator/customer-yaml/sections-other.ts`        |
| Decommission preserves audit log per retention                       | §"Decommission carve-out" + `DecommissionPipeline._step_d1_memory_voice` audit-log preservation branch                |
| Retention policy documented in customer contract                     | §"Customer contract surface" — the engagement-letter clause that names the retention window for the signed engagement |

## Per-vertical defaults

The default window per vertical reflects the regulatory and professional-responsibility norm for that practice. Defaults are codified in `MemoryRetentionPolicy.from_customer_yaml` (Python; `operator/adapter/memory/retention.py`) and mirrored in the portal-side validator (TypeScript; `src/lib/operator/customer-yaml/sections-other.ts`).

| Vertical           | `audit_log_days` default | Rationale                                                                                      |
| ------------------ | ------------------------ | ---------------------------------------------------------------------------------------------- |
| `law-firm`         | 2555 (7 years)           | State-bar client-records retention norm; covers most malpractice statutes of limitations.      |
| `marketing-agency` | 1095 (3 years)           | Contract-dispute statute of limitations covers the typical engagement-claim window.            |
| `real-estate`      | 2555 (7 years)           | Transaction-record retention norms align with most state real-estate commission rules.         |
| `manufacturing`    | 2555 (7 years)           | OSHA / product-liability statute of limitations exposure.                                      |
| `insurance`        | 2555 (7 years)           | Insurance-commissioner record-retention norms.                                                 |
| `mixed`            | 2555 (7 years)           | Conservative default; engagement letter should pin the specific window for the matter at hand. |

The 7-year baseline is the launch posture. Verticals that ship with a shorter default (`marketing-agency` today) explicitly recognize that the contract-dispute window is the binding constraint; the engagement letter for a `marketing-agency` customer with elevated regulatory exposure (e.g. healthcare-adjacent marketing) MUST raise this via the override.

## Override-up-only enforcement

The `customer.yaml` author MAY set `memory.retention.audit_log_days` to a value greater than or equal to the per-vertical default. Setting it BELOW the default is a validation error — there is no business case where the customer benefits from less audit history than the vertical norm permits, and several where shorter retention is a bar-discipline or compliance-violation vector.

### Schema

`memory.retention.audit_log_days` is the existing optional field declared in [`customer-yaml-schema.md`](./customer-yaml-schema.md) §"Memory retention". This spec adds two rules on top of the existing "positive integer" rule:

1. **Per-vertical minimum.** The value MUST be ≥ the vertical's default. Below-default is a `ValidationError` with code `RetentionOverrideBelowDefault`. The error message names both the supplied value and the vertical's minimum.
2. **Reasonable upper bound.** The value MUST be ≤ 36500 (100 years). Above is a `ValidationError` with code `RetentionOverrideUnreasonable`. The cap is a sanity-check, not a policy — values above the realistic litigation horizon are almost always typos (e.g. day-vs-year confusion). The cap is documented in the engagement letter when raised.

The validator runs after `vertical` has been resolved; the per-vertical minimum is read from the same constant table both the validator and the runtime retention policy consume so the two cannot drift.

### Examples

```yaml
# Valid: matches the law-firm default exactly.
memory:
  retention:
    audit_log_days: 2555
```

```yaml
# Valid: 10 years, raises above the law-firm 7-year default.
memory:
  retention:
    audit_log_days: 3650
```

```yaml
# Invalid: 5 years is below the law-firm 7-year default.
memory:
  retention:
    audit_log_days: 1825 # rejected: RetentionOverrideBelowDefault
```

```yaml
# Invalid: 200 years is past the sanity cap.
memory:
  retention:
    audit_log_days: 73000 # rejected: RetentionOverrideUnreasonable
```

### Override-down is impossible by construction

Because the value floors at the vertical default and only ratchets up, there is no path for a customer.yaml edit to shorten the audit-log window. A customer who genuinely needs a shorter window (rare) MUST raise the question to Captain, who routes it through engagement-letter renegotiation rather than a customer.yaml edit. This is the same posture as `customer_id` and the connector isolation fields — the YAML cannot weaken a compliance-bound invariant.

## Decommission carve-out

`bin/decommission-customer.sh` runs at end-of-engagement and tears down the per-customer substrate. The 9-step sequence ([`decommission-customer.md`](./decommission-customer.md) §"The 9 steps") currently treats memory + voice + R2 + Vectorize as fully removable. Audit-log rows are special: they belong to the customer's compliance record, not the per-engagement working state, and must survive past the per-customer D1's deletion until the retention window has elapsed.

### Behavior

Step 2 (`02_d1_memory_voice`) is extended with a pre-cleanup audit-log preservation branch:

1. **Read the retention policy.** Resolve `audit_log_days` from `customer.yaml.memory.retention.audit_log_days` (falling back to the per-vertical default per §"Per-vertical defaults").
2. **Export the audit log to cold storage.** Before the per-customer D1 is dropped, export the full `audit_log` table to the compliance-archive directory (`{archive_root}/{slug}/audit-log-{iso-date}.csv` plus a sidecar `audit-log-manifest-{iso-date}.json` recording the retention window and the row count). The export is composed by step 8 (`08_compliance_archive`) under normal flow, but is a separate emission here so the audit trail survives a step-8 failure.
3. **Compute the preservation deadline.** `preserve_until = decommission_ts + audit_log_days * 86400`. The deadline is recorded in the manifest.
4. **Stamp the tombstone.** The `09_tombstone` `DECOMMISSIONED.md` marker (see `decommission-customer.md` §FilesystemTombstoner) gains an `audit_log_preserve_until: <iso-date>` line that names the deadline.
5. **Do NOT delete `audit_log` rows during step 2.** The canonical `decommission_source` hooks for memory + voice continue to soft-delete their own provenance rows; the audit-log table is explicitly skipped at decommission time.

Once `preserve_until` has elapsed, a separate Captain-invoked sweep (`bin/audit-log-purge.sh`, filed against this spec as a follow-on) removes the archived CSV from cold storage. Until that sweep ships, the manifest entry serves as the human-readable reminder.

### Audit-log emission

The decommission pipeline writes one additional audit row for the carve-out:

| Field                     | Value                                                 |
| ------------------------- | ----------------------------------------------------- |
| `action_type`             | `DECOMMISSION_DRAIN_COMPLETE`                         |
| `actor`                   | `captain`                                             |
| `actor_role`              | `captain`                                             |
| `metadata.step`           | `02_d1_memory_voice/audit_log_preserved`              |
| `metadata.customer_slug`  | The customer slug being decommissioned                |
| `metadata.audit_log_days` | The resolved retention window                         |
| `metadata.preserve_until` | ISO 8601 UTC timestamp of the deadline                |
| `metadata.archive_path`   | Path of the CSV export under `{archive_root}/{slug}/` |
| `metadata.rows_preserved` | Count of `audit_log` rows exported                    |

The `DECOMMISSION_DRAIN_COMPLETE` action type is the closest existing neutral signal in `ACCEPTED_ACTION_TYPES`; the `metadata.step` discriminator distinguishes the preservation row from the canonical D1-cleanup row. A dedicated `AUDIT_LOG_PRESERVED` action type is filed as a follow-on against `d1-schema.md` §1; once it lands, this spec + the emission constant flip together.

### Dry-run behavior

In `--dry-run` mode the decommission script reports the preservation plan without writing anything:

```
[ planned] 02_d1_memory_voice: {"audit_log_days":2555,"preserve_until":"2033-05-23T00:00:00Z","rows_to_preserve":4218,"memory_sources":3,"voice_sources":2}
```

Live mode prints `executed` and records the actual export path. The dry-run cell makes the deadline visible before Captain authorizes the live run — a typo in the override is caught here, not after the customer's D1 is gone.

### Failure semantics

If the audit-log export raises (R2 throttle, manifest write fails), step 2 halts with `DecommissionStepFailed("02_d1_memory_voice/audit_log_preserved")`. The canonical memory + voice cleanup HAS NOT yet run, so resumption is safe — the substrate is still intact. The failure is the same shape as any other step-2 failure: re-run `--live` with the same slug, the preservation re-attempts, the memory + voice hooks pick up where they left off.

If the export succeeds but the subsequent canonical cleanup fails, the manifest is already on cold storage and the rerun's preservation step short-circuits when it sees the existing manifest for the same UTC date (idempotency contract). The rerun proceeds straight to the memory + voice hooks.

## Customer contract surface

The engagement letter ([`compliance-evidence-packet.md`](./compliance-evidence-packet.md) §"08-engagement-letter-clauses") includes a `Records retention` clause that names the specific window for this engagement. The clause is generated from the resolved `audit_log_days` value (default OR override) at engagement signing and stays fixed for the life of the engagement.

Sample clause text (law-firm default):

> SMD Services will retain the audit log of all AI-mediated actions taken on behalf of this firm for a period of seven (7) years from the date of engagement termination. The audit log is preserved in encrypted cold storage after decommission and is destroyed at the end of this period. The firm may request a copy at any time during this window.

When the customer raises the override (e.g. to 10 years), the clause re-renders with the new window. Captain reviews the clause at signing; the customer countersigns the engagement letter as the binding artifact.

## Cross-references

- [`memory-retention.md`](./memory-retention.md) — sibling continuous-sweep spec; consumes the same `audit_log_days` field
- [`decommission-customer.md`](./decommission-customer.md) — the off-boarding pipeline extended by §"Decommission carve-out"
- [`customer-yaml-schema.md`](./customer-yaml-schema.md) §"Memory retention" — the `memory.retention.*` block this spec adds field rules to
- [`d1-schema.md`](./d1-schema.md) §1 — `audit_log` table shape; accepted `action_type` values (the `AUDIT_LOG_PRESERVED` follow-on lives here)
- [`audit-log-immutability.md`](./audit-log-immutability.md) — Worker-layer INSERT-only enforcement; informs the redaction-tooling dependency for the eventual `audit_log` row sweep
- [`compliance-evidence-packet.md`](./compliance-evidence-packet.md) — the engagement-letter clause that names the resolved window
