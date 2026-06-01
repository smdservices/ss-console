# Operator quarterly drill runbook

**Audience:** The named backup operator, with Captain observing.
**Scope:** A periodic exercise where the backup operator runs the four named scenarios from [`operator-backup-operator.md`](operator-backup-operator.md) against a synthetic test customer. The drill verifies that the operator's training has not decayed and that the runbooks still match the platform's actual surfaces.
**Source:** Platform PRD §4 Persona 3 and issue [#888](https://github.com/venturecrane/ss-console/issues/888).
**Cadence:** Quarterly. The first drill runs within 90 days of the operator's initial sign-off; subsequent drills run at 90-day intervals from the last passing drill.

## Why a drill exists

Three failure modes the drill exists to catch.

1. **Skill decay.** The operator's hands-on practice from Gate 3 of the training spec was real on the day Captain signed off; without re-exposure, the muscle memory fades. The drill keeps the four scenarios within the operator's recent practice.
2. **Runbook drift.** The platform changes. Scripts get renamed; flags get added; failure modes that did not exist at training appear. The drill is the only periodic test that the runbook still matches the platform.
3. **Access drift.** Credentials expire; org membership lapses; PagerDuty rotations get rewritten. The drill exercises every credential gate from the training spec at least quarterly.

## Drill setup

**Synthetic test customer.** The drill runs against a slug reserved for this purpose, not against any live customer. Captain provisions and maintains the synthetic customer's `customer.yaml`, voice samples, and fixture data outside the drill itself. The drill operator does not author customer config under drill conditions, by the same rule that holds during real provisioning.

**Drill window.** The four scenarios run inside one continuous window. Captain observes the entire window; the operator drives every command. Estimated time: three to four hours for an operator at full proficiency, longer for an operator whose skills have decayed (in which case the drill itself surfaces the gap).

**Drill log.** Captain opens a drill log at `operator/customers/{synthetic-slug}/drills/{iso-date}-drill.md` before the drill begins. Every scenario's outcome lands in the log as it completes. The log persists; quarterly drill history is the visible record of the bus-factor program's health.

## Scenario 1: provision

**Goal.** Operator provisions the synthetic test customer end-to-end from a clean Fly state.

**Setup.** Captain confirms the synthetic customer.yaml validates and no `hermes-{synthetic-slug}` Fly app exists. If a previous drill left a Fly app, Captain destroys it before the drill begins; the drill is not the place to teach destroy-then-provision.

**Procedure.** Operator follows [`operator-backup-operator.md` §1](operator-backup-operator.md). Operator may consult the runbook freely; this is not a memorization test.

**Expected outcome.**

- `provision-customer.sh` exits 0.
- The Fly Machine is live and reachable.
- Every per-connector smoke test reports green or synthetic (no `error` states).
- The operator paged Captain (Captain, present at the drill, acknowledges the page).
- Total elapsed time within the runbook's documented envelope.

**Acceptance criteria.** Pass when every expected outcome above is true. Fail when any one is false.

**Failure follow-up.** Captain records the failure in the drill log with the specific gap (script renamed, flag changed, credential missing, operator unfamiliar with a prompt). The follow-up is one of:

- **Runbook update.** The platform changed and the runbook did not catch up. File an issue to update the affected runbook section; the operator's training is fine.
- **Re-training.** The operator was unfamiliar with a step that the runbook covers correctly. Schedule a one-on-one re-walk of [Gate 3 hands-on practice](../specs/operator/backup-operator-training.md#gate-3-hands-on-practice).
- **Access provision.** A credential is missing or expired. Reissue per [Gate 4 access provisions](../specs/operator/backup-operator-training.md#gate-4-access-provisions).

## Scenario 2: handle a sticky-stop

**Goal.** Operator investigates a deliberately-triggered sticky-stop and either clears it correctly or escalates correctly.

**Setup.** Captain primes the synthetic substrate to enter `SOFT_STOP` on one of the four conditions documented in [`sticky-stop.md`](../specs/operator/sticky-stop.md). Captain rotates the condition across drills (consecutive tool failures, refusal cascade, time-budget overrun, cost threshold) so the operator sees every shape over the course of a year.

**Procedure.** Operator follows [`operator-backup-operator.md` §3](operator-backup-operator.md). Captain observes the investigation without prompting.

**Expected outcome.**

- Operator correctly identifies the `condition_triggered` from the audit-log entries.
- Operator chooses one of the three correct outcomes for the planted condition: clear, hold the stop, or escalate. Captain has pre-decided which outcome is correct for the planted condition; the operator's choice must match.
- If clearing: the `clear()` call carries a non-empty `captain_id` (the operator's identity) and a `reason` naming the root cause and remediation. The resulting audit row records `AGENT_RESUMED` with `metadata.sticky_stop_cleared: true`.
- If holding or escalating: Captain receives the investigation summary in a form Captain can act on.

**Acceptance criteria.** Pass when every expected outcome above is true. Fail when the operator misidentifies the condition, picks the wrong outcome, issues `clear()` with an empty reason, or escalates without an investigation summary.

**Failure follow-up.** Re-training on the sticky-stop spec and the audit-log query path. If the gap is the wrong outcome choice, walk through all four conditions and the decision tree for each.

## Scenario 3: restore from backup

**Goal.** Operator verifies an export archive and runs a per-domain restore against the synthetic customer.

**Setup.** Captain stages a recent export of the synthetic customer in the drill's archive directory. Captain deletes one domain (e.g., the memory rules) from the synthetic substrate to create a recoverable gap.

**Procedure.** Operator follows [`operator-backup-operator.md` §4](operator-backup-operator.md). The drill exercises the partial-restore path; full restores are a Captain-coordinated event and are not drilled solo.

**Expected outcome.**

- Operator opens the archive manifest and confirms checksums match.
- Operator identifies the affected domain and chooses the per-domain importer.
- After the restore, the synthetic substrate's memory tab renders every rule the archive carried.
- The audit log records the restore event (action_type `MEMORY_RESTORED`) with the source archive's manifest hash.
- Operator paged Captain with the result.

**Acceptance criteria.** Pass when every expected outcome above is true. Fail when the operator skips the checksum verification, picks the wrong importer, leaves the substrate in a partial state, or omits the audit row.

**Failure follow-up.** Re-training on the memory export spec and the import counterparts. If the gap is the audit log step, walk through the audit-emission contract in [`sticky-stop.md`](../specs/operator/sticky-stop.md) and [`decommission-customer.md`](../specs/operator/decommission-customer.md) as cross-references.

## Scenario 4: decommission

**Goal.** Operator runs the full nine-step decommission pipeline against the synthetic customer.

**Setup.** Captain confirms the synthetic customer's recent memory export from Scenario 3 is in place; the decommission must not run without a delivered export, by the rule in [`operator-backup-operator.md` §2](operator-backup-operator.md).

**Procedure.** Operator follows [`operator-backup-operator.md` §2](operator-backup-operator.md). Dry-run first, then live.

**Expected outcome.**

- Dry-run output shows nine `[ planned]` lines.
- Live run reaches `DECOMMISSION_FINAL` without halting.
- A dated tombstone exists at `operator/customers/{synthetic-slug}.decommissioned.{iso-date}/`.
- A compliance manifest landed in the archive root.
- A second live run of the same slug reports `skipped` for every applicable step (idempotency contract).
- Operator paged Captain with the result.

**Acceptance criteria.** Pass when every expected outcome above is true. Fail when the operator skips the dry-run, fails to verify the tombstone, skips the second-run idempotency check, or runs decommission against a customer whose export was not delivered.

**Failure follow-up.** Re-training on the decommission spec, with emphasis on the dry-run-versus-live distinction and the idempotency contract. The export-prerequisite check is non-negotiable; failing on that point triggers immediate re-training and a re-drill within 30 days, not the standard 90-day cycle.

## Drill outcome and logging

At the end of the drill window, the drill log carries one section per scenario with:

- Pass or fail
- Elapsed time
- Notable observations (operator hesitation, runbook ambiguity, surface that surprised the operator)
- Follow-up classification (runbook update, re-training, access provision, no action)

The drill log is committed to the repo on the same day. The frontmatter of [`operator-backup-operator.md`](operator-backup-operator.md) carries the date of the last passing drill; Captain updates that line as part of the drill close-out.

## Failure response

A failed drill is a serious signal, not a paperwork event. Two outcomes the platform tolerates and one it does not.

- **Tolerated: a runbook gap surfaced.** The platform changed faster than the runbook did. The drill caught it; the gap gets filed and patched. Re-drill on the affected scenario within 30 days; the standard 90-day cycle continues otherwise.
- **Tolerated: a single scenario re-training need.** The operator was rusty on one scenario. Re-train on that scenario within 30 days; re-drill the scenario; the standard 90-day cycle continues otherwise.
- **Not tolerated: a multi-scenario failure.** Three or more scenarios fail in one drill, or any one scenario fails two drills in a row. The bus-factor minimum gate is no longer satisfied. Captain pauses any active customer-onboarding work that would push the live customer count past four, retrains the operator end-to-end against [Gates 1-5 of the training spec](../specs/operator/backup-operator-training.md), and re-runs the full drill before any new customer signs.

## When to skip a drill

The drill does not skip. If the operator is unavailable on the scheduled date, the drill reschedules within the same quarter. If the operator is no longer available at all, the bus-factor minimum gate immediately reverts to unsatisfied and Captain pauses customer-onboarding past four customers until a new operator completes training.

## Cross-references

- [Backup operator runbook](operator-backup-operator.md)
- [Backup operator training requirements](../specs/operator/backup-operator-training.md)
- [Decommission customer spec](../specs/operator/decommission-customer.md)
- [Sticky-stop spec](../specs/operator/sticky-stop.md)
- [Memory export pipeline spec](../specs/operator/memory-export.md)
- [Platform PRD §4 Persona 3](../pm/operator/platform-prd.md)
- [Issue #888](https://github.com/venturecrane/ss-console/issues/888)
