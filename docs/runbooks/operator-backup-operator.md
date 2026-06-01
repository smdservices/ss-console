# Operator backup operator runbook

**Audience:** The named backup operator, with Captain in oversight.
**Scope:** The four named scenarios the backup operator must be able to execute end-to-end when Captain is unavailable. Provision a new customer, decommission a customer, handle a sticky-stop, restore from backup.
**Source:** Platform PRD §4 Persona 3 (Captain unavailability mitigation) and issue [#888](https://github.com/venturecrane/ss-console/issues/888).
**Training prerequisite:** Every gate in [`docs/specs/operator/backup-operator-training.md`](../specs/operator/backup-operator-training.md) must be signed off before the operator is trusted as primary on a live customer.

## Sign-off marker

```
backup_operator_ready: <date-Captain-records-here>
operator_name: <Captain-records-here>
```

A blank marker means no operator is ready. While the marker is blank, Captain remains the only operator, the bus-factor minimum gate at customer #5 (PRD §4 Persona 3) is not satisfied, and customer #5 cannot onboard.

---

## Section 1: Provision a new customer

**When to run.** A new customer has signed and Captain is unavailable to drive the provisioning. The agreed-on Day-0 window started; the customer expects an inbox and a kickoff call inside the 48-72 hour envelope from `operator-customer-onboarding.md` §0.

**Tool.** `operator/bin/provision-customer.sh` (shipped under issue [#812](https://github.com/venturecrane/ss-console/issues/812)).

**Procedure.**

1. Confirm the customer.yaml exists at `operator/customers/{slug}/customer.yaml`. If it does not, stop. Authoring the customer.yaml from scratch is Captain-only work; the backup operator does not synthesize customer config under time pressure.
2. Validate the yaml (canonical TS validator per ADR 0019):
   ```bash
   npx tsx scripts/validate-customer-yaml.ts \
     operator/customers/{slug}/customer.yaml
   ```
   The validator must exit 0 before proceeding.
3. Run the provisioner:
   ```bash
   operator/bin/provision-customer.sh {slug}
   ```
4. When the script prompts for secrets, paste from Infisical via pbpaste. Never echo secret values to the terminal.
5. After the script exits 0, confirm the Fly Machine is live (`fly machine list -a hermes-{slug}`) and the per-connector smoke tests are green.
6. Page Captain with the result. Customer-facing communication (welcome email, kickoff calendar invite) is Captain-only; queue it for Captain's return unless Captain has explicitly delegated the message.

**Stop conditions.**

- The validator fails. Stop. Page Captain. Do not patch the customer.yaml in place to make it pass.
- A secret prompt cannot be satisfied because Infisical does not hold the value. Stop. Page Captain.
- The Fly Machine fails to come up after two re-runs of the provisioner. Stop. Page Captain. Re-running a third time will not change the answer.

**Reference.** [Customer onboarding runbook §2.2](operator-customer-onboarding.md). The runbook covers what Captain does after provisioning lands; the backup operator's scope ends at "Machine live, smoke tests green, Captain paged."

---

## Section 2: Decommission a customer

**When to run.** A customer has exited and the agreed-on decommission date has arrived. Captain is unavailable to drive the run. The backup operator runs the pipeline; Captain reviews the audit trail on return.

**Tool.** `operator/bin/decommission-customer.sh` (shipped under issue [#956](https://github.com/venturecrane/ss-console/issues/956), spec at [`decommission-customer.md`](../specs/operator/decommission-customer.md)).

**Procedure.**

1. Confirm the customer is genuinely exiting. The operations runbook (or Captain's handoff note) carries the exit date and the customer's confirmation. If either is missing, stop. Decommission is one-directional; "I think they're exiting" is not enough.
2. Confirm the memory export ran first. The customer-owned memory artifact (per ADR 0008) must be exported and delivered to the customer before substrate deletion. Section 4 of this runbook covers the export procedure.
3. Dry-run first:
   ```bash
   operator/bin/decommission-customer.sh {slug} --dry-run
   ```
   Every line should read `[ planned]`. Review the planned manifest against the nine steps in the spec.
4. Live run:
   ```bash
   operator/bin/decommission-customer.sh {slug} --live
   ```
   Wait for `DECOMMISSION_FINAL`. If the script halts with exit code 3, the run is resumable. Re-run the same command; every step is idempotent.
5. After the script exits 0, confirm the dated tombstone at `operator/customers/{slug}.decommissioned.{iso-date}/`, the compliance manifest at `{archive_root}/{slug}/`, and the audit-log entries.
6. Page Captain with the result.

**Stop conditions.**

- The exit date is unconfirmed or the customer has not signed off in writing. Stop. Decommission is irreversible.
- The memory export has not been delivered to the customer. Stop. Run Section 4 first.
- A live step fails twice in succession. Stop. Page Captain. Re-running again under time pressure risks compounding the failure.

**Reference.** [Decommission customer spec](../specs/operator/decommission-customer.md). The spec covers the nine steps, exit codes, and the idempotency contract in detail.

---

## Section 3: Handle a sticky-stop

**When to run.** A customer's substrate has transitioned into `SOFT_STOP` or `HARD_STOP` (per [`sticky-stop.md`](../specs/operator/sticky-stop.md)) and Captain is unavailable. The customer's agent is currently paused; either the substrate is drafting only (SOFT_STOP) or refusing every skill (HARD_STOP).

**Tool.** Captain `clear()` action through the control plane.

**Procedure.**

1. Read the sticky-stop alert. The page payload names the `customer`, the `persona`, the `from_state`, the `to_state`, and the `condition_triggered`.
2. Pull the audit-log entries that drove the transition. The four conditions are documented in the spec: consecutive tool failures, refusal cascade, time-budget overrun, cost threshold breach. The metadata column carries the exact counters and thresholds.
3. Investigate. The work depends on the condition:
   - **Consecutive tool failures.** The named tool is failing repeatedly. Check the connector status (`prepare-demo-firm.sh` reuses the smoke-test framework). The fix may be vendor-side (vendor tool flap), credential-side (token expired), or skill-side (skill calling the tool with bad input).
   - **Refusal cascade.** Either the skill is drifting in an unsafe direction or the operator's trust ceiling is incompatible with the skill's request shape. Read the skill's recent drafts. Pull the trust-ceiling row from `audit_log`.
   - **Time-budget overrun.** The agent ran past the wall-clock envelope on a single turn. Read the turn's tool-call trace. Usually a skill is looping on a tool that returns success but does not advance state.
   - **Cost threshold breach.** The daily LLM spend exceeded the cap. Read the cost-telemetry rows. Decide whether the cap is wrong, the skill is wasteful, or the customer's workload exceeded forecast.
4. Decide whether to clear. Three outcomes:
   - **Clear immediately.** The cause is understood, has been remedied, and the agent is safe to resume. Issue `clear()` with a non-empty `captain_id` (the backup operator's identity) and a `reason` that names the root cause and the remediation.
   - **Hold the stop.** The cause is understood but the remediation requires Captain. Leave the stop in place, page Captain with the investigation summary, and notify the customer with the platform-paused communication template.
   - **Escalate.** The cause is not understood. Leave the stop in place, page Captain, and capture the audit-log entries for handoff.
5. Verify the `clear()` audit row landed (action_type `AGENT_RESUMED`, actor_role `captain`, metadata `sticky_stop_cleared: true` with the prior state and the reason).

**Stop conditions.**

- The condition_triggered is `cost threshold breach` and the operator does not have Captain's pre-authorization to raise the cap. Hold the stop. Page Captain.
- The condition_triggered is `refusal cascade` and the operator cannot determine whether the skill is drifting unsafe. Hold the stop. Page Captain. A refusal cascade is the substrate detecting a class of failure that warrants Captain review before resume.
- The investigation produces a remediation the operator is not authorized to apply (a new connector credential, a customer.yaml change, a skill rollback). Hold the stop. Apply nothing under time pressure.

**Reference.** [Sticky-stop spec](../specs/operator/sticky-stop.md) for the state-machine semantics, the Captain `clear()` interface, and the audit-emission contract.

---

## Section 4: Restore from backup

**When to run.** A customer's substrate has lost data. The recovery target is the customer's most recent memory export (per ADR 0008 and the [memory export pipeline spec](../specs/operator/memory-export.md)). The export archive is the canonical backup; no separate backup system exists, by design.

**Scope of "restore."** The platform's data-ownership posture (ADR 0008) places memory in customer-owned namespaces. "Restore" means re-hydrating those namespaces from a previously-exported archive. It does not mean restoring SMD-owned state (skill catalog, dashboard config, persona identity); those are versioned in `ss-console` and re-applied via re-provisioning.

**Procedure.**

1. Identify the most recent export archive. Per the export spec, archives land at `archive_dir/{customer-slug}-export-{ISO-timestamp}.tar.gz`. The customer also holds a copy; if SMD's copy is corrupted, request the customer's copy.
2. Verify the archive integrity. Open the manifest at `manifests/memory.json` and `manifests/voice.json`. Confirm every checksum matches the contents.
3. Decide the restore scope:
   - **Full restore.** The customer's substrate is empty or unrecoverable. Re-provision the Fly Machine via `provision-customer.sh` and then re-ingest every domain from the archive.
   - **Partial restore.** A specific domain (memory rules, voice diffs, audit log) was corrupted or wrongly deleted. Re-ingest only the affected domain.
4. Run the restore. The restore tooling lives alongside the export tooling at `operator/adapter/memory/` and `operator/adapter/voice/`. Each adapter exposes an `import_*()` counterpart to its `export_*()` function. Use the per-domain importers; do not hand-edit D1 or R2.
5. Verify the restored state. The customer's dashboard should render the memory tab with every rule the export carried. The audit log should carry the restore event (action_type `MEMORY_RESTORED`) with the source archive's manifest hash.
6. Page Captain with the result. Customer-facing communication about the restore is Captain-only.

**Stop conditions.**

- The most recent export is more than 30 days old. Stop. Page Captain. The platform's export cadence is documented; an export older than 30 days means the cadence broke, which is itself a Captain-level investigation.
- The archive's manifest checksums do not match. Stop. Page Captain. A corrupted archive needs root-cause analysis before any restore attempt.
- The restore target is the audit log and the customer has rows the archive does not. Stop. The audit log is append-only by contract (ADR 0008); restoring an older snapshot would erase rows the customer is entitled to. Page Captain.

**What this is not.** It is not a substitute for the customer-owned memory artifact ownership posture. The export archive is the customer's property by contract; the restore action re-applies that property to the customer's substrate when the substrate has lost it. SMD does not retain a shadow copy outside the export archive.

**Reference.** [Memory export pipeline spec](../specs/operator/memory-export.md), [ADR 0008 (Customer-owned memory artifact)](../adr/0008-customer-owned-memory-artifact.md).

---

## After-action

Every scenario the backup operator runs without Captain present writes an after-action note to `operator/customers/{slug}/backup-operator-runs/{iso-date}-{scenario}.md`. The note carries:

- Trigger (what page or request put the operator on the scenario)
- Outcome (what completed, what was held for Captain, what was escalated)
- Audit-log entries that landed
- Any stop conditions hit, and how they were handled

Captain reads the note on return and decides whether the scenario revealed a runbook gap or a re-training need. Re-training, when triggered, follows the [quarterly drill runbook](operator-quarterly-drill.md) protocol.

## Cross-references

- [Backup operator training requirements](../specs/operator/backup-operator-training.md)
- [Quarterly drill runbook](operator-quarterly-drill.md)
- [Customer onboarding runbook](operator-customer-onboarding.md)
- [PI firm demo prep runbook](pi-firm-demo-prep.md)
- [Calibration runbook](operator-calibration.md)
- [Decommission customer spec](../specs/operator/decommission-customer.md)
- [Sticky-stop spec](../specs/operator/sticky-stop.md)
- [Memory export pipeline spec](../specs/operator/memory-export.md)
- [ADR 0007 (Per-customer Machine isolation)](../adr/0007-per-customer-machine-isolation.md)
- [ADR 0008 (Customer-owned memory artifact)](../adr/0008-customer-owned-memory-artifact.md)
- [ADR 0009 (Cross-Machine query prohibition)](../adr/0009-cross-machine-query-prohibition.md)
- [ADR 0015 (Hermes fork vs upstream)](../adr/0015-hermes-fork-vs-upstream.md)
- [Platform PRD §4 Persona 3](../pm/operator/platform-prd.md)
- [Issue #888](https://github.com/venturecrane/ss-console/issues/888)
