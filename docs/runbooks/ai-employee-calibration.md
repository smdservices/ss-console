# AI Employee calibration runbook

**Audience:** Captain.
**Scope:** Conducting one calibration cycle (four 90-minute sessions over two
weeks) with a customer's partner. Covers what each session is for, what
Captain prepares, what the partner does, and what gets written to the
substrate after each session.
**Source:** Spec at `docs/specs/ai-employee/calibration-session.md`. Backed
by platform PRD §9.6 and law-firm PRD §11.9.
**Companion surface:** `portal.smd.services/portal/products/ai-employee/calibration`
(principal-only).

> The PRD's 4-6 hour single-block calibration collapses at firms that sign.
> The four 90-minute sessions are the canonical structure. Do not attempt to
> condense them back into a single block — the business-analyst critique
> documented that path's failure mode.

---

## Overview

One calibration cycle has four sessions, in scheduling order:

| #   | Session                  | Duration | Output to substrate                                         |
| --- | ------------------------ | -------- | ----------------------------------------------------------- |
| 1   | Voice calibration        | 90 min   | Structural-diffs to voice ingestion (seam 1)                |
| 2   | Skill calibration        | 90 min   | Memory rules to the memory ingestion writer (seam 2)        |
| 3   | Trust-ceiling refinement | 90 min   | Trust-ceiling decisions to `audit_log` via `log_decision()` |
| 4   | Integration and handoff  | 90 min   | Sign-off marker; cycle marked `completed`                   |

Schedule two sessions per week. The partner's calendar drives spacing;
fourteen days is the typical envelope.

Captain may run a calibration cycle on demand by starting a new cycle from
the portal: principal opens
`portal.smd.services/portal/products/ai-employee/calibration` and clicks
"Start new calibration cycle." Starting a new cycle archives any prior cycle.

## Required framing in every session

Every session opens with the assistant-not-replacement framing:

> "{persona name} assists the partner; {persona name} never replaces them."

The persona name is the active persona from `customer.yaml`. The framing
is also rendered on the portal calibration surface; the partner sees the
same words there.

This is not a marketing line. It is the load-bearing posture for every
calibration decision: the partner is the judge of every voice correction,
every rule addition, every ceiling change. The agent does not self-grade.

---

## Session 1: voice calibration (90 minutes)

**Purpose.** Surface the writing voice across recipient cohorts. Capture
10-15 representative drafts edited by the partner, feeding the voice
ingestion seam.

**Prep (Captain, 30 minutes before the session).**

- Confirm the customer has ≥30 voice samples on disk (per platform-prd
  §9.6 gate #1). If under 30, run the dossier voice scrape (see
  `docs/runbooks/pi-firm-demo-prep.md` §3) to top up before the session.
- Open the demo flow at the customer's Hermes Machine.
- Stage 10-15 scenarios across cohorts (anxious client, opposing
  counsel, internal staff, vendor). The mix matches the cohort
  distribution in `customer.yaml.scope`.

**Walkthrough (with the partner, 90 minutes).**

1. Open the calibration surface and read the framing line aloud to the
   partner. Confirm the partner accepts the posture.
2. For each staged scenario:
   - Generate a draft.
   - Hand the keyboard to the partner.
   - Partner edits the draft until it reads as theirs.
   - Captain saves the `(draft, sent)` pair to the voice ingestion
     queue with `source=calibration_session`.
3. After the last scenario, walk the partner through the structural-diff
   for one sample. Confirm the diff matches what the partner expected.

**Substrate output.** 10-15 structural-diff entries written under
`{customer_slug}/voice/cohort/{cohort}/` per
`docs/specs/ai-employee/voice-ingestion.md`. The voice gate counter
advances; the dashboard's voice histogram updates on next render.

**Failure modes.**

- Partner is uncomfortable editing in front of Captain. Pause. Switch to
  the partner editing alone for the next scenario; Captain reviews after.
- Drafts are too far off. Confirm the persona's `tone` array in
  `customer.yaml` matches the partner's stated voice. Adjust if needed.
  Do not silently soften scenarios; the partner needs to see the worst
  cases.
- Partner runs out of time. Stop at the 90-minute mark. The session
  ends `completed` only when ≥5 scenarios produced structural-diffs.
  Below 5: session ends `skipped` and the cycle re-runs session 1 in
  the next available slot.

## Session 2: skill calibration (90 minutes)

**Purpose.** Walk every enabled skill against a representative scenario.
Capture per-skill approve / edit / refuse decisions, feeding memory rules.

**Prep (Captain, 30 minutes before the session).**

- List every skill with a non-`refused` trust ceiling from
  `customer.yaml.personas[0].skills`.
- For each skill, stage one realistic scenario. PI law-firm starts with
  `law-pi-intake-triage`, `law-pi-discovery-response`,
  `law-pi-demand-letter-evidence-packet`, etc.
- Open the memory tab so the partner can see the rule writer landing.

**Walkthrough (with the partner, 90 minutes).**

1. Open the calibration surface; re-read the framing line.
2. For each skill:
   - Run the staged scenario.
   - Partner approves, edits, or refuses the outcome.
   - If the partner stated a new rule ("we don't take medmal under $1M"),
     Captain writes the rule to the memory rule writer with the partner
     watching. The rule appears in the memory tab immediately.
3. After the last skill, walk the partner through the memory tab. Confirm
   every rule the partner stated is visible and correctly categorized
   (rule / voice / process / person).

**Substrate output.** Per-skill calibration outcomes recorded for
session-2 of the cycle. Memory rules written via the memory ingestion
writer per `docs/specs/ai-employee/memory-ingestion.md`.

**Failure modes.**

- Partner wants to change a skill's behavior more than the rule writer
  supports. Note the request, file a follow-on issue against the skill's
  source. Do not promise a turnaround.
- Partner refuses every skill outcome. This is the strongest signal a
  re-scoping is needed; defer session 3 and convene with Captain and
  the partner on which skills should be disabled outright.

## Session 3: trust-ceiling refinement (90 minutes)

**Purpose.** Refine the per-skill trust ceiling based on the first two
sessions. The principal sets the autonomy boundary. Every ceiling change
writes to `audit_log` via the `log_decision()` emission contract.

**Prep (Captain, 30 minutes before the session).**

- Open the trust-ceiling section on the AI Employee settings page.
- Review the cumulative voice ingestion stats from session 1 and the
  skill calibration outcomes from session 2. Identify skills that look
  ready for promotion and skills that should drop.

**Walkthrough (with the principal, 90 minutes).**

1. Open the calibration surface; re-read the framing line.
2. For each skill:
   - Show the cumulative signal from sessions 1 and 2.
   - The principal sets the ceiling.
   - The ceiling change writes one row to `audit_log` per the emission
     contract; the row carries `metadata.calibration_cycle_id` and
     `metadata.calibration_session_kind=trust_ceiling` so the compliance
     evidence packet can group the rows.
3. After the last skill, confirm the principal has reviewed every skill's
   ceiling. The session ends `completed` when every enabled skill has a
   ceiling decision logged.

**Substrate output.** One `audit_log` row per ceiling change per
`docs/specs/ai-employee/trust-ceiling-logging.md`.

**Failure modes.**

- Principal is hesitant on every skill. The default is
  `draft_for_review`. Set every uncertain skill to the default; promotion
  can land later via the promotion recommendation card (#811).
- Principal wants `autonomous` on every skill. Read the §11.3 promotion
  mechanics paragraph aloud. Promote one skill, observe for a week,
  promote the next.

## Session 4: integration and handoff (90 minutes)

**Purpose.** Live workflow at the partner's keyboard. Final sign-off
before the blind-test gate (§9.6 gate #3) fires.

**Prep (Captain, 30 minutes before the session).**

- Open the partner's actual inbox in the demo flow.
- Have the blind-test materials ready: 10 reviewer-written + 10
  agent-drafted communications, unlabeled.

**Walkthrough (with the partner, 90 minutes).**

1. Open the calibration surface; re-read the framing line.
2. Partner works through their actual inbox for 45 minutes with the
   AI Employee active. Captain observes; intervenes only on request.
3. Switch to the blind-test materials for the remaining 45 minutes.
   Run the blind test per platform-prd §9.6 gate #3. Document the
   indistinguishability rate.
4. If the blind-test rate is ≥80%, the partner signs off and the
   first external draft is unblocked.
5. If the blind-test rate is below 80%, the cycle does not end
   `completed`. Schedule a new cycle for the next available window;
   document the failure mode in the dossier.

**Substrate output.** Cycle marked `completed`. Sign-off marker recorded
under the (customer, cycle) tuple.

**Failure modes.**

- Blind-test rate ≥80% but partner is uncomfortable. The partner's
  judgment overrides the rate. Defer first external draft until the
  partner is ready; document the gap.
- Partner cannot make the 90-minute slot. Reschedule the session;
  do not run it remote-async. Session 4 is in-person by default.

---

## Recovery paths

**A session ran out of time.** Sessions 1 and 2 may end `skipped` if
fewer than 5 / fewer than half the enabled skills got coverage. The
cycle re-runs the skipped session in the next available slot. Sessions
3 and 4 cannot be `skipped` — they must run to `completed` for the
blind-test gate to fire.

**A session produced bad signal.** The partner is the judge. If the
partner says session 2 went badly, do not write the rules collected in
that session. Mark session 2 `skipped`, reschedule, repeat with a fresh
set of scenarios.

**A cycle stalled mid-way.** The principal may start a new cycle from
the portal at any time. Starting a new cycle archives the stalled one
and resets the four-session schedule to `pending`. Document the stall
in the dossier so the next cycle's prep accounts for it.

**The customer has no active persona.** The calibration surface renders
the empty state per `docs/style/empty-state-pattern.md`. Calibration
cannot run; provision a persona through `customer.yaml` first (see
`docs/specs/ai-employee/customer-yaml-schema.md`).

**The customer has no AI Employee subscription.** The calibration
surface redirects to the AI Employee landing per
`resolveProductAccess()`. No calibration is possible until the
subscription is provisioned.

## Cross-references

- spec: `docs/specs/ai-employee/calibration-session.md`
- demo prep: `docs/runbooks/pi-firm-demo-prep.md`
- voice ingestion: `docs/specs/ai-employee/voice-ingestion.md`
- memory ingestion: `docs/specs/ai-employee/memory-ingestion.md`
- trust-ceiling logging: `docs/specs/ai-employee/trust-ceiling-logging.md`
- platform PRD §9.6 (voice quality gates), §10 (memory model), §11
  (trust ceilings)
- law-firm PRD §11.9 (calibration session split)
- issue [#867](https://github.com/venturecrane/ss-console/issues/867)
- issue [#821](https://github.com/venturecrane/ss-console/issues/821)
  (data-capture mechanics unblock)
