# Backup operator training requirements

**Spec for issue [#888](https://github.com/venturecrane/ss-console/issues/888).** Training prerequisites a backup operator must satisfy before being trusted as primary on a customer's Operator. Captain selects the person and decides their compensation and primary role; this spec defines what they have to learn, what access they must hold, and how Captain reaches them when the platform needs human hands.

## Source

- [ADR 0007 (Per-customer Machine isolation)](../../adr/0007-per-customer-machine-isolation.md)
- [ADR 0008 (Customer-owned memory artifact)](../../adr/0008-customer-owned-memory-artifact.md)
- [ADR 0009 (Cross-Machine query prohibition)](../../adr/0009-cross-machine-query-prohibition.md)
- [ADR 0015 (Hermes fork vs upstream)](../../adr/0015-hermes-fork-vs-upstream.md)

## What this spec is not

This spec does not name the backup operator. It does not set their pay, their hours, or their primary role outside SMD Services. Those are Captain decisions made outside the repo. The spec defines the checklist a candidate must complete before Captain can mark them ready in the operations runbook.

## Readiness gates

A candidate is "trained" only when every gate below is satisfied. Captain marks each gate complete by initialling the line in the operations runbook. Self-attestation is not enough; the hands-on practice gates require Captain to observe the candidate complete the work end-to-end.

### Gate 1: Architectural literacy

The backup operator must read and be able to summarize the four isolation ADRs and the Hermes fork strategy. The summary does not have to be word-perfect; it has to demonstrate that the candidate understands the customer-data boundary, the per-customer Machine model, the cross-Machine query prohibition, and the fork-vs-upstream posture.

- [ ] Read [ADR 0007 (Per-customer Machine isolation)](../../adr/0007-per-customer-machine-isolation.md). Can explain why one customer's Machine never talks to another customer's storage.
- [ ] Read [ADR 0008 (Customer-owned memory artifact)](../../adr/0008-customer-owned-memory-artifact.md). Can explain that the customer's memory artifact is theirs by contract, what gets exported on offboarding, and what stays platform property (persona email address, dashboard avatar).
- [ ] Read [ADR 0009 (Cross-Machine query prohibition)](../../adr/0009-cross-machine-query-prohibition.md). Can name the runtime, deployment, and CI layers that enforce the boundary.
- [ ] Read [ADR 0024 (Hermes consumption and update cadence)](../../adr/0024-hermes-consumption-and-update-cadence.md). Can explain why SMD pins upstream Hermes by `v{date}@{sha}` and clones `NousResearch/hermes-agent` directly, why the `venturecrane/hermes-agent` fork was retired, and the track-vs-deploy cadence (continuous tracking, deliberate blessed-version promotion).

### Gate 2: Runbook familiarity

The backup operator must have read access to every runbook and spec the platform is operated from, and must have read each one end-to-end. Read access is necessary but not sufficient; the candidate must be able to navigate the documents without Captain guidance.

- [ ] Read [Decommission customer spec](decommission-customer.md). Knows the nine idempotent steps, the dry-run-versus-live distinction, and the recovery path for a mid-sequence failure.
- [ ] Read [Sticky-stop spec](sticky-stop.md). Knows the four states (OK, WARN, SOFT_STOP, HARD_STOP), the system-versus-operator distinction, and that `clear()` is Captain-only.
- [ ] Read [Memory export pipeline spec](memory-export.md). Knows the export archive is the canonical backup per ADR 0008.

### Gate 3: Hands-on practice

The backup operator must have completed the following exercises against a synthetic test customer, observed by Captain. Each exercise is run once before the operator is marked ready and again every quarter.

- [ ] **Provision a synthetic test customer end-to-end.** Run `operator/bin/provision-customer.sh {synthetic-slug}` against a non-production fixture. The exercise covers the validator, the Fly app creation, the secret-prompt flow (paste from the test Infisical scope, never echo), and the per-connector smoke test.
- [ ] **Perform sticky-stop recovery.** Drive the synthetic customer's substrate into HARD_STOP (one of the four conditions documented in [`sticky-stop.md`](sticky-stop.md)). Investigate the cause through the audit-log entries. Issue `clear()` with a non-empty captain_id and reason. Verify the audit row recording the resume.
- [ ] **Run a memory export and verify the archive.** Execute the export pipeline ([`memory-export.md`](memory-export.md)) against the synthetic customer. Open the tar.gz, confirm the manifest checksums, and confirm every domain (memory rules, voice diffs, audit log) is present.
- [ ] **Decommission the synthetic test customer.** Run `operator/bin/decommission-customer.sh {synthetic-slug} --dry-run` followed by `--live`. Confirm the dated tombstone, the archived compliance packet, and a clean second run that reports `skipped` for every step.

### Gate 4: Access provisions

The backup operator must hold the credentials and roles required to execute Gate 3. Captain provisions each item below and confirms presence by having the operator complete a read-only command against each surface.

- [ ] **Fly.io.** Member of the SMD organization with a personal access token scoped to the customer Machines. Verifies by running `fly apps list` and seeing the `hermes-*` apps.
- [ ] **Cloudflare.** Member of the SMD account with read-write on D1, R2, Vectorize, and Workers. Verifies by listing D1 databases and reading the per-customer schema.
- [ ] **AWS.** If and when the platform takes a hard AWS dependency, an IAM role scoped to the backup operator's required actions. Until that dependency exists, this line stays unchecked and the operator does not need an AWS account.
- [ ] **GitHub.** Push and review permission on `venturecrane/ss-console`. Verifies by opening a draft PR against a throwaway branch. (Hermes is consumed from upstream `NousResearch/hermes-agent`, which is public; no special access is required since ADR 0024 retired the `venturecrane/hermes-agent` fork.)
- [ ] **Bitwarden.** Membership in the `smd-services` organization scoped to the customer-credentials collection. Verifies by reading one non-sensitive credential record metadata (never the value).
- [ ] **Infisical.** Workspace member with read on `/ss/customers/*` and `/ss` shared secrets. Verifies by listing secret names with `infisical secrets list` (names only, never with `--plain`).
- [ ] **PagerDuty (or Better Stack).** Listed on the "Operator production" service rotation, even if at a lower-tier escalation. Verifies by triggering a synthetic incident that pages the operator and acknowledging it.
- [ ] **SMD ops chat.** Member of the channel where Captain posts customer-day status. Verifies by acknowledging a test post.

### Gate 5: Communication channels

The backup operator must have an unambiguous way for Captain to reach them and an unambiguous way for the platform to escalate.

- [ ] **Captain-to-operator channel.** A single named channel for reaching the operator: phone (preferred), SMS, or signal. Recorded in the operations runbook with the operator's response-time commitment.
- [ ] **Tier-1 escalation path.** If the platform pages the operator and no acknowledgement lands inside the response-time commitment, the page routes to Captain. The PagerDuty (or equivalent) rotation encodes this.
- [ ] **Tier-2 escalation path.** If both the operator and Captain are unreachable, the page routes to the documented Tier-2 contact. Tier-2 may be a second operator, a contractor on retainer, or (in the absence of either) an explicit silence with a customer-facing "service paused" template. The choice is Captain's; the documented value is mandatory.
- [ ] **PTO communication template.** The operator has the PTO comms template, knows when to send it, and knows which customer roster receives it.

## Gate sign-off

Captain marks each gate complete in the operations runbook by adding the date and the operator's name. The runbook's frontmatter carries a `backup_operator_ready: <date>` marker; a candidate without that marker may not be assigned as primary on any customer.

The bus-factor minimum gate at customer #5 is satisfied when all five gates above are signed off for at least one operator. Re-training is required after any failed quarterly drill.

## Out of scope (Captain-only decisions)

These items are deliberately not specified here. Captain decides them outside the repo and records the outcome in the operations runbook.

- **Who the backup operator is.** Naming a specific person.
- **Compensation.** Hourly, retainer, equity, or in-kind.
- **Primary role.** Whether the operator's day job is at SMD Services, at another venture, or independent.
- **Onboarding sequence.** Order in which Gates 1-5 are completed.
- **Re-training cadence beyond quarterly drill.** Whether a specific failure triggers immediate re-training or a scheduled cycle.

## Cross-references

- [Decommission customer spec](decommission-customer.md)
- [Sticky-stop spec](sticky-stop.md)
- [Memory export pipeline spec](memory-export.md)
- [Issue #888](https://github.com/venturecrane/ss-console/issues/888)
