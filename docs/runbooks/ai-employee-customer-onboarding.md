# AI Employee customer onboarding runbook

**Audience:** Captain.
**Scope:** End-to-end customer onboarding from the moment Captain decides to sign a prospect through Day-45 pivot-gate decision. Composes the pre-provisioning, day-1, calibration, contract, and steady-state specs into one operational sequence.
**Source:** Platform PRD §16 (Demo Framework) and §17 (Success Metrics & Kill Criteria), law-firm PRD §11.8 (Day-1 / Week-1 / Week-4 partner experience) and §11.9 (Calibration session split). Implements the customer-onboarding acceptance criteria for issue [#887](https://github.com/venturecrane/ss-console/issues/887).

This runbook is a composition document. It does not duplicate procedure that lives in cited specs. Where a step delegates, the citation is the authoritative source; this runbook owns sequencing, gate conditions, and the Captain-facing daily monitoring routine.

---

## Companion specs

The runbook reads top-to-bottom and assumes the following companion documents are available:

| Step                     | Companion                                                                                                                                                                                                            | What it owns                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Pre-provisioning         | [`pi-firm-demo-prep.md`](./pi-firm-demo-prep.md) (issue [#819](https://github.com/venturecrane/ss-console/issues/819))                                                                                               | Dossier, voice scrape, customer.yaml authoring, Fly Machine provisioning, readiness gate.            |
| Contract signing         | [`docs/templates/ai-employee/README.md`](../templates/ai-employee/README.md) and [`signing-flow.md`](../templates/ai-employee/signing-flow.md) (issue [#827](https://github.com/venturecrane/ss-console/issues/827)) | Service contract, DPA, BAA-equivalent confidentiality addendum, DocuSign envelope construction.      |
| Day-1 onboarding         | [`docs/specs/ai-employee/day-1-onboarding.md`](../specs/ai-employee/day-1-onboarding.md) (issue [#803](https://github.com/venturecrane/ss-console/issues/803))                                                       | First-hour screen sequence in the dashboard, Captain-led and self-service paths, mobile fallback.    |
| Calibration sessions     | `docs/runbooks/ai-employee-calibration.md` (issue [#867](https://github.com/venturecrane/ss-console/issues/867), forward reference: PR #976 in flight as of this runbook's authoring)                                | Four 90-minute calibration sessions across two weeks, voice-gate transitions, trust-ceiling updates. |
| First-30-days monitoring | This runbook §6.                                                                                                                                                                                                     | Captain's daily checklist, alerting thresholds, escalation paths.                                    |
| Day-45 pivot gate        | This runbook §7.                                                                                                                                                                                                     | Decision criteria, evidence sources, outcome paths.                                                  |

When a companion is not yet on `main`, this runbook says so explicitly and Captain should treat the cited section as a forward reference until the PR lands.

---

## Operational constraints (read first)

Two hard constraints govern every step below.

1. **Captain weekly hours per customer ≤ 2 hours at steady state** (PRD §17.1, §3.7). If the day-by-day monitoring described in §6 starts to exceed this budget, the constraint is the alarm: something is off (an under-tuned skill, a misconfigured connector, an unbalanced trust ceiling) and the work is to fix the source, not to absorb the time. Captain does not bill more hours to make the runbook fit.
2. **No fabricated client-facing content.** Every customer-facing artifact this runbook produces (welcome email, calibration session deliverables, day-1 dashboard surfaces, audit-log exports, monitoring digests) must come from authored data or render the empty-state pattern. See `CLAUDE.md` "No fabricated client-facing content" and `docs/style/empty-state-pattern.md`. The dashboard's day-1 sequence already enforces this per-screen; the rest is Captain's discipline.

---

## Step 1: Captain signs intent

**Trigger:** Demo closes and Captain has high confidence the prospect will sign. Typically this is the end of the §11 walk-in-cold meeting where the partner has said yes to next steps and asked about pricing or contract terms.

**Time budget:** Same business day. ≤30 minutes of Captain time.

**Actions:**

- [ ] Capture the verbal close in the customer dossier (Section 9 checklist in `pi-firm-demo-prep.md` Section 2). Stamp with the meeting date and the named signer.
- [ ] Confirm the chosen pricing SKU. The pricing model is the live ADR thread under issue [#794](https://github.com/venturecrane/ss-console/issues/794); use whatever SKU has been signed off as the v1 offering at the time of close. If the SKU is TBD, escalate before papering.
- [ ] Write a short customer-intent note: customer legal name, signing party, target effective date, monthly fee, initial term months, governing law state, sub-processor list to be appended. This note is the brief that drives Step 2.
- [ ] If the demo firm was a pre-provisioned demo (`hermes-demo-{firm-slug}` per PRD §16.2), confirm whether the same Fly app will be promoted to a paying tenant or whether a fresh app will be provisioned for the signed customer. The default is to promote in place once the customer.yaml is updated and the readiness check re-runs green.

**Output:** A customer-intent note in the customer directory (`ai-employee/customers/{firm-slug}/INTENT.md` or a single commit message on the dossier branch). This is the audit trail that the signing path is open.

---

## Step 2: Contract signing

**Trigger:** Intent captured. The customer is ready to receive papering.

**Time budget:** 2-5 business days end to end. Captain time is 2-4 hours; the rest is customer review.

**Actions:**

- [ ] Pull the three templates from `docs/templates/ai-employee/` per the README: `service-contract.md`, `data-processing-addendum.md`, `baa-equivalent-confidentiality.md` (the third only for law-firm or other regulated customers, per the README's "When used" column).
- [ ] Replace every bracketed field. The standard set is in the templates README §Bracketed fields; the per-template field tables list the narrower fields.
- [ ] Submit the prepared documents to external counsel licensed in the customer's jurisdiction. Per the templates README, "No file in this directory may be sent to a customer as-is." The pre-customer-zero counsel review is the moment that gates first signature; for customers after customer-zero, counsel review confirms only the bracketed-field substitutions and any jurisdiction-specific deltas.
- [ ] On counsel sign-off, run the DocuSign envelope construction per `signing-flow.md`. Captain prepares the envelope, customer countersigns. Captain does not send any envelope that still contains the template footer ("This is a TEMPLATE...") visible to the customer; the footer is removed at envelope-prep time.
- [ ] On countersignature, archive the executed envelope to the customer's compliance evidence packet artifacts 10 (`dpa.pdf`) and 11 (`baa.pdf`) per platform PRD §13.6 / compliance evidence packet spec.

**Output:** Countersigned contract, DPA, and (when applicable) BAA-equivalent confidentiality addendum, archived to the customer's R2 vault and indexed in the audit log.

---

## Step 3: Pre-provisioning

**Trigger:** Countersigned contract on file.

**Time budget:** 2-4 hours of Captain time across the 24-48 hour window before the day-1 calibration session.

**Owner spec:** Sections 1-8 of [`pi-firm-demo-prep.md`](./pi-firm-demo-prep.md). The demo-prep runbook covers identification, dossier, voice scrape, customer.yaml authoring, Fly provisioning, readiness checks, walk-through, and deliverable sign-off. The same eight sections apply to a signed customer; the differences are below.

**Deltas for signed-customer provisioning vs. demo provisioning:**

- The `customer_id` is the legal customer slug, not a `demo-{firm-slug}` slug. If the demo Fly app is being promoted, rename or migrate per Fly's documented procedure; if a fresh app is provisioned, the demo app is decommissioned per `docs/specs/ai-employee/decommission-customer.md`.
- The connectors list in `customer.yaml` now reflects the customer's confirmed PM stack from the meeting, not the website hypothesis. Anything with `confidence: low` in the demo dossier should now resolve to a real adapter or be explicitly deferred with a note in `connectors.yaml`.
- The voice samples now include any additional samples the customer has agreed to share (per Step 6 of the day-1 onboarding spec: emails, status updates, letters from the partner's own files). These are added to `customers/{slug}/voice/` and re-ingested before the calibration session.
- The `users[]` list in `customer.yaml` now contains the named principal and any named operator and compliance reviewer. Roles match `dashboard-roles.md`.
- The `failure_recipients` list now points to Captain's monitored inbox, not the demo escalation address.

**Gate:** Run `ai-employee/bin/prepare-demo-firm.sh --firm-slug {slug}` until it exits 0. If any check fails, fix and re-run. Do not proceed to Step 4 from a yellow readiness report.

**Output:** A green readiness report dated within 24 hours of the scheduled day-1 session.

---

## Step 4: Day-1 onboarding

**Trigger:** Pre-provisioning green. Day-1 session on calendar.

**Time budget:** 60 minutes with the partner plus 4 hours with the paralegal, per law-firm PRD §11.8. Captain is in the room (or on the same video call) for both windows.

**Owner spec:** [`docs/specs/ai-employee/day-1-onboarding.md`](../specs/ai-employee/day-1-onboarding.md). The day-1 spec defines the nine-screen dashboard sequence, the Captain-led co-existing path, the operator and compliance variants, and mobile behavior.

**What this runbook owns:** sequencing the partner-session vs. the paralegal-session vs. the calibration kickoff.

**Recommended sequencing:**

1. **Partner session (60 min).** Captain runs Screens 1 through 5 and Screen 8 of the day-1 sequence with the partner. Screen 6 (additional voice upload) is offered and usually deferred. Screen 7 (first trust promotion) is skipped in the partner session and handled async after the paralegal session per day-1 spec §"Captain walk-through cadence". The partner's first 60 seconds in the dashboard from this point on is the morning digest scan; the partner's day-1 outcome is they have read Screen 9 ("Marcus is now watching your inbox") and know where the dashboard lives.
2. **Paralegal session (4 hours).** Captain runs the operator variant of the day-1 sequence and the bulk of the calibration material per law-firm PRD §11.9. This is the session where voice samples are uploaded and categorized, the memory tab is taught, and the calibration cycle begins (see Step 5).
3. **Async partner sign-off.** Captain sends the partner a summary of voice deltas the paralegal absorbed and the recommended first trust promotion. Partner signs off async (ideally on the morning digest). This closes the day-1 loop.

**Output:** `ONBOARDING_COMPLETED` audit event with `metadata.captain_led: true`. Steady-state Today tab is the principal's default landing surface. The four calibration sessions are scheduled per Step 5.

---

## Step 5: Calibration sessions

**Trigger:** Day-1 onboarding complete. Voice gate state is at least one of Pass, Near-pass, or Fail per `voice-gate-fallback.md`.

**Time budget:** Four 90-minute sessions across two weeks. Captain attends every session; the principal attends two; the operator attends all four. Total Captain time across the two-week window is 6-8 hours including prep.

**Owner spec:** `docs/runbooks/ai-employee-calibration.md` (issue [#867](https://github.com/venturecrane/ss-console/issues/867), PR #976 in flight as of this runbook's authoring; cite as a forward reference until merged). The calibration runbook owns session agendas, deliverables per session, voice-gate transition criteria, trust-ceiling promotion mechanics, and the calibration dashboard surface.

**What this runbook owns:** the gate conditions that allow first external draft.

**Gate conditions for first external draft:**

- Voice blind-test pass rate ≥80% indistinguishability across at least three judges who know the reviewer (PRD §9.6, §17.1, voice-gate-fallback.md Pass state).
- At least 30 anchor voice samples ingested across the relevant cohorts (PRD §9.6).
- Trust ceiling for the first external skill is set per `trust-ceiling.yaml` and confirmed in the partner-signoff session.
- No outstanding sticky-stop hard-stop event on the customer (see `docs/specs/ai-employee/sticky-stop.md`).

If any condition fails, the calibration cycle does not "complete" and Step 6 monitoring begins from a no-external-send posture. The customer still has a working agent (morning digest, drafts in the queue, internal-only skills) and is not blocked from steady-state usage.

**Output:** Calibration cycle marked complete in the calibration dashboard. Voice gate state recorded. First external skill is either live at the configured trust ceiling or explicitly held back with a documented reason.

---

## Step 6: First 30 days monitoring

**Trigger:** Day-1 onboarding complete. The 30-day window begins the morning after `ONBOARDING_COMPLETED` is written.

**Time budget:** ≤2 hours of Captain time per week, per the operational constraint above. The daily checklist is sized to fit inside 5-10 minutes per business day on a normal day.

### 6.1 Captain's daily checklist (5-10 minutes per business day)

Run from the admin dashboard at `https://admin.smd.services/customers/{slug}/`. Each item below maps to a single panel or query; the panel is the answer.

- [ ] **Audit-log spot-check.** Read the last 24 hours of `audit_log` entries for the customer per `docs/specs/ai-employee/audit-log-immutability.md`. Look for any `ONBOARDING_COMPLETED`, `TRUST_PROMOTED`, or new skill-activation events that were not initiated by Captain. Look for any action-type the spec does not define (a vocabulary gap signals a code path that wrote outside the audit contract).
- [ ] **Sticky-stop state.** Confirm there is no active hard-stop on the customer per `docs/specs/ai-employee/sticky-stop.md`. If one is active, that is the day's work; Step 6 monitoring does not advance past it.
- [ ] **Cost telemetry watch.** Read the cost panel per `docs/specs/ai-employee/cost-telemetry-events.md`. Compare the trailing-7-day daily average to the engagement's pricing envelope (per the SKU chosen in Step 1). If daily COGS is on a trajectory to exceed 40% of monthly MRR at end-of-month, that is a Step 7 input and a Captain conversation, not silently absorbed.
- [ ] **Voice-gate state.** Confirm the voice gate is in Pass, Near-pass, or Fail per `voice-gate-fallback.md`. If it has transitioned in the last 24 hours, the daily-digest banner on the customer's dashboard should already reflect the new state; verify that surface matches the gate.
- [ ] **Refusal cascade scan.** Read the count of refusal events in the last 24 hours per `docs/specs/ai-employee/refusal-handling.md`. A single refusal is normal; a cascade (>5 refusals on the same skill in 24 hours, or refusals across more than three skills in 24 hours) is a signal to look at the system prompt or the connector configuration.

If every item on the daily checklist is green and nothing has changed from the prior day, the day's monitoring is done. Log the time in the Captain CLI per PRD §15.2 so the `captain_time` cost driver is observable.

### 6.2 Weekly monitoring (30 minutes, recurring Monday)

On top of the daily checklist:

- [ ] Review the trailing-7-day rollup of every PRD §17.1 metric for which the customer has at least one week of data. The §17.1 table is the canonical metric list; the weekly review is the moment to notice trends, not the moment to define metrics.
- [ ] Send the customer a Weekly Snapshot email per the day-1 onboarding spec's steady-state pattern. The agent drafts; Captain reviews and sends (reviewer-as-sender per ADR 0005).
- [ ] Run any tuning the daily checks have surfaced. Tuning windows are not part of the daily 5-10 minute budget; they are part of the 2-hour weekly budget.

### 6.3 Alarms (Captain pages immediately)

The watchdog and PagerDuty service (per `pi-firm-demo-prep.md` Section 5 connector wiring) page Captain immediately on:

- Any safety invariant violation per `docs/specs/ai-employee/safety-invariants.md`.
- Any external AI disclosure incident (PRD §17.2). Single incident is a kill signal per PRD §17.1.
- Daily COGS exceeds the configured hard cap.
- Hermes Machine stopped or health check failing.
- Audit-log write failure (any append-only invariant break per audit-log-immutability spec).

Alarm response is Step 7-class work; Captain does not roll alarm response into the 2 hr/wk monitoring budget.

### 6.4 Time accounting

Captain logs every monitoring session to the Captain CLI per PRD §15.2. If the trailing-4-week average exceeds 2 hr/wk at steady state, the operational constraint has fired and the next §6.2 review is partly about why.

---

## Step 7: Day-45 pivot-gate decision

**Trigger:** 45 days after `ONBOARDING_COMPLETED`.

**Time budget:** 60-90 minutes of Captain time for the review plus a 30-60 minute customer conversation if the gate decision is "continue with adjustments" or "exit."

**Goal:** A single explicit decision: continue at current trajectory, continue with adjustments, or exit.

### 7.1 Decision criteria

The customer is "on track at day 45" if all four are true:

1. **Trust trajectory.** At least one skill has been promoted to autonomous OR the principal has explicitly opted (in writing, in the audit log) to keep all skills at `draft_for_review`. Either is a healthy state; what is unhealthy is the absence of an explicit choice.
2. **Approval rate.** ≥80% of drafts approved across the trailing 30 days. (PRD §17.1 targets ≥85% by week 4 and ≥90% by week 12. The day-45 gate uses 80% as the floor that allows a "continue with adjustments" verdict; below 80% sustained over the 30-day window is a kill criterion per §17.2's "Approval rate <70% sustained over 2+ weeks" if it is also trending toward 70%. Captain reads the trajectory, not the single number.) [TBD: confirm 80% floor with Captain at customer-zero; the §17.1 target is week-4 ≥85% and this runbook proposes 80% as the day-45 floor pending operational data.]
3. **No sticky-stop hard-stops** in the trailing 30 days (per `docs/specs/ai-employee/sticky-stop.md`). A hard-stop event is a safety-invariant signal; even resolved hard-stops in the 30-day window are reviewed in §7.3.
4. **Cost telemetry envelope.** Per-customer monthly COGS ≤40% of MRR (PRD §17.1 margin metric). At day 45 the agent has ~30 days of cost telemetry; if the trailing-30-day daily-average projection puts month-2 over 40%, that triggers SKU re-pricing or usage cap per PRD §17.1.

If all four are true: **continue at current trajectory.** Schedule the next review at day 90 (per the day-1 spec Captain walk-through cadence and the customer's contract term).

### 7.2 Continue with adjustments

If one or two of the four criteria are amber (criterion-3 cannot be amber; it is binary):

- Document the adjustment plan in the customer directory (`ai-employee/customers/{slug}/day-45-review.md`).
- Schedule a 30-60 minute customer conversation in week 7 to walk the partner and operator through the adjustments. This conversation is not a renegotiation; it is a calibration update.
- Adjustments typically take one of three shapes: (a) trust-ceiling tuning (promote, demote, or refuse a skill); (b) voice recalibration (additional samples, additional cohorts, re-run blind test); (c) connector or scope adjustment (add or remove a connector, narrow the inbox scope, change the digest cadence).
- Re-run day-45 criteria at day 75. If the customer is on track at day 75, return to the standard cadence; if not, re-evaluate per §7.4.

### 7.3 Exit decision

If three or four criteria are red, or any of these is true:

- A safety-invariant violation in the trailing 30 days.
- An external AI disclosure incident at any point in the engagement.
- A compliance failure (audit-log incomplete, DPA breach, retention failure) per PRD §17.2.

Then the day-45 review is also an exit conversation. Captain proposes an exit path with no penalty. Run decommission per `docs/specs/ai-employee/decommission-customer.md`. The customer's data is exported per their DPA rights and the Fly Machine, R2 vault, Vectorize index, D1 partition, and Composio project are torn down per `docs/specs/ai-employee/decommission-drain.md`.

### 7.4 Outcome documentation

The day-45 review produces one of three written outcomes in the customer directory:

- `day-45-review.md` with verdict `continue` (no further action; standard cadence resumes).
- `day-45-review.md` with verdict `adjust` and the adjustment plan + day-75 re-review on calendar.
- `day-45-decommission.md` with the exit timeline and the decommission ticket reference.

Audit-log event: `DAY_45_REVIEW_COMPLETED` with `metadata.verdict` set to `continue`, `adjust`, or `decommission`. This event is the gate that the day-45 ritual ran.

---

## Recovery paths

**Contract counsel review slips past target effective date.** Step 4 and beyond cannot run until contracts are countersigned. Pause Step 3 readiness work if it is already complete (the readiness report has a 24-hour shelf life) and re-run the readiness check the day before the rescheduled day-1.

**Day-1 session is rescheduled by the customer.** Step 3 readiness ages out at 24 hours. Re-run `prepare-demo-firm.sh` within the 24 hours before the new session date. Do not run day-1 from a stale readiness report.

**Calibration sessions slip.** The calibration runbook (when merged from PR #976) owns slip recovery. Until then, treat any calibration slip as a Step 6 input: the customer is in steady-state with an under-calibrated agent, the voice gate may be Near-pass or Fail, and the monitoring banner should reflect that.

**Captain monitoring time exceeds 2 hr/wk.** The constraint is the alarm. Identify the source on the next §6.2 weekly review. Common sources: an under-tuned skill that is generating high-variance drafts, a connector returning unexpected data shapes, a voice cohort that is not absorbing partner edits, or a runbook step that has implicit work the runbook does not surface. Fix the source; do not absorb the time.

**Day-45 review reveals a kill-criterion event in the prior 30 days that was not paged.** The watchdog and §6.3 alarm path failed open. After running the §7.3 exit conversation with the customer, file a Captain-level postmortem on the missed page and update the watchdog rules.

---

## Per-customer artifacts checklist

By Day-45, the following must exist for customer `{slug}`:

**In the customer directory (`ai-employee/customers/{slug}/`):**

- [ ] `customer.yaml` validated per `customer-yaml-schema.md`
- [ ] `dossier.md` complete through Section 9
- [ ] `voice/` directory with ≥30 anchor samples
- [ ] `trust-ceiling.yaml` reflecting calibration outcomes
- [ ] `connectors.yaml` with every customer connector either green or explicitly deferred
- [ ] `INTENT.md` capturing the Step 1 close
- [ ] `day-45-review.md` (or `day-45-decommission.md`) with the gate verdict

**In Cloudflare account (per spec isolation rules):**

- [ ] D1 customer row + partition rows
- [ ] R2 vault under `{customer_id}` namespace
- [ ] Vectorize index named `{customer_id}` exactly
- [ ] `aie-watchdog` Worker entry for this customer
- [ ] Audit-log append history complete from Day 0

**In external accounts:**

- [ ] Fly app `hermes-{slug}` running, Machine ID recorded
- [ ] AgentMail inbox live with webhook receiving
- [ ] Composio project authenticated for all customer connectors
- [ ] DocuSign envelope archived (service contract, DPA, BAA-equivalent when applicable)
- [ ] PagerDuty service entry firing test alerts successfully

**Microsoft 365 customers (when any `mcp:m365-*` connector is bound):**

- [ ] Customer's Microsoft Entra tenant ID captured during the Captain setup session and written to `connectors.{Email,Calendar,InternalComms}.tenant_id` in `customer.yaml`. The bootstrap CLI resolves the per-tenant hosted MCP URL (`agent365.svc.cloud.microsoft/agents/tenants/{tenant_id}/servers/<server>`) from this field; the hosted MCP brokers the Entra app consent flow, so there is no separate refresh token to store. The validator rejects missing or malformed tenant IDs at provisioning time (issue [#1056](https://github.com/venturecrane/ss-console/issues/1056)).

**In Captain's tooling:**

- [ ] Captain CLI logging `captain_time` per customer per PRD §15.2
- [ ] Weekly Monday review recurring on calendar
- [ ] Day-45 review on calendar at `ONBOARDING_COMPLETED + 45d`
- [ ] Day-90 review on calendar at `ONBOARDING_COMPLETED + 90d`

When Captain spins up customer 2, the differences from customer 1 should be small enough that the runbook itself does not change. Customer-specific values change; the sequencing and the gates do not.

---

_Document owner: Captain. Reviewed at Day-45 of customer 1; updated before customer 2 onboarding. All changes through PR per repo rules._
