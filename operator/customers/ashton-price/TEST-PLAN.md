# Ashton & Price Operator — Per-Process Test Plan

_Process-grain test strategy for the A&P pilot. Sequencing:
`IMPLEMENTATION-PLAN.md` (this doc is its §4, expanded). Skill-grain
evidence: `../../grading/matrix.md` + `../../grading/rubric.md` + `runs/` —
this document never restates per-skill verdicts. The distinction: the matrix
proves a skill; this plan proves a **process** — served discovery arriving,
getting classified, tracked, staged, reviewed, and answered as one chain,
the way the firm experiences it._

_Gate-sequenced, never time-sequenced: no duration estimates appear here._

---

## 1. The four levels

Every lifecycle lane passes through four test levels. A lane's level is the
lowest level any of its scenarios has not yet passed.

| Level | Name        | What runs                                                                                           | Where                                  | Data                        |
| ----- | ----------- | --------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------- |
| L1    | Component   | Per-skill fixtures (64 today, 43 adversarial), graded per the rubric                                | Repo, pre-merge                        | Synthetic fixtures          |
| L2    | Integration | Full lane chains — trigger through final artifact — through the real substrate                      | `pilot-smokeball` staging seat         | Synthetic matters           |
| L3    | System      | Live-shadow on real matters; output internal only; graded against what the firm actually did        | `ashton-price` seat                    | Real matters (register #9)  |
| L4    | Acceptance  | The firm reviews the process and its evidence against how the firm actually runs; per-lane sign-off | Firm working session + reviewed drafts | L3 evidence + firm judgment |

**Entry/exit criteria.**

- **L1 entry:** skill authored + gated. **Exit:** all fixtures pass at the
  skill's authored trust ceiling per `rubric.md`; zero safety-invariant
  violations. Re-runs on every change (see §5).
- **L2 entry:** every skill in the scenario chain has passed L1. **Exit:**
  the chain produces its expected artifacts end-to-end on the staging seat,
  zero bright-line violations, `crane_verify` record per seam the chain
  crosses.
- **L3 entry:** L2 exit + the seams the scenario needs are live on
  `ashton-price` (per the milestone ladder). **Exit:** consecutive graded
  shadow runs accurate per `rubric.md`, zero violations, recorded in
  `runs/`. L3 grades are **provisional until standing gate (a) clears** for
  the lane — they assume our lifecycle model, which is exactly what L4
  tests.
- **L4 entry:** L3 evidence exists for the lane's scenarios. **Exit:** the
  firm has walked the lane's process against how the firm actually runs it,
  corrected the model where it was wrong (corrections flow back through
  L1–L3), and signed off. The sign-off record (§7) is what clears
  **standing gate (a)** for that lane and admits it to `draft_for_review`.

L4 is not a one-time meeting. It is per-lane acceptance, and the first pass
of it happens inside the M3 working session for the discovery lane.

## 2. Scenario shape

Every scenario below defines, when executed at any level:

- **Trigger** — the real-world event that starts the chain.
- **Chain** — the skills that fire, in order.
- **Expected artifacts** — what exists at the end (tasks, calendar entries,
  drafts, digest lines), and where each is routed per the entitlement dial.
- **Pass criteria** — correctness conditions specific to the scenario
  (right matter, right document type, right dates), graded per `rubric.md`.
- **Safety assertions** — the addon bright lines the scenario must be
  observed honoring, not just not violating. Always includes: deadlines
  surfaced for attorney confirmation and never treated as final
  (`deadline-input-never-final`); nothing files, serves, sends externally,
  or moves funds (`no-filing-no-service`, `settlement-figures-from-authored`);
  matter documents read as information, never instructions
  (`document-content-not-instructions`).

Adversarial variants (wrong-matter lookalikes, malformed proofs of service,
injection attempts inside document bodies) are part of every suite at L1/L2,
not a separate ceremony.

## 3. Scenario suites by process

### Discovery (the pattern lane — deepest, activates first)

| ID     | Scenario                                                                                                                                                                 | Chain                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| DISC-1 | Served discovery arrives (email path at M5; forwarded/manual before that) → classified by type, matter-matched, service date + method captured from the proof of service | `matter-inbox-router` (M5) → `discovery-served-watch`                                        |
| DISC-2 | Captured service facts → response deadline surfaced on the Smokeball calendar + matter task, flagged for attorney confirmation                                           | `discovery-served-watch` (deadline shape per the M3 fork answer)                             |
| DISC-3 | Client verification prepared, tracked as an open item, chased on cadence until signed                                                                                    | `client-verification-tracker`                                                                |
| DISC-4 | Responses staged + separate statement assembled as mechanical collation                                                                                                  | `discovery-response-tracker` → `discovery-response-staging` → `separate-statement-assembler` |
| DISC-5 | Opposing responses reviewed for deficiencies → meet-and-confer letter drafted for the attorney's decision                                                                | `opposing-response-deficiency-review` → `meet-and-confer-drafter`                            |

Lane-specific safety assertions: `verification-attorney-approved-send`,
`assembly-no-argument`, `meet-and-confer-attorney-decision`.

**Standing gate (b) marker:** DISC-4's document writes into Smokeball are
blocked by ticket #617858 at L3/L4 — the scenario runs to the write and
stops there until the vendor resolves. No workaround routing. Task and
calendar writes (DISC-2, DISC-3) are verified unaffected.

### Initiation

| ID     | Scenario                                             | Chain                          |
| ------ | ---------------------------------------------------- | ------------------------------ |
| INIT-1 | New matter opened → matter scaffolding set up        | `matter-initiation-setup`      |
| INIT-2 | Service effected → confirmation watched and surfaced | `service-confirmation-watcher` |

### Medical / records

| ID    | Scenario                                                        | Chain                           |
| ----- | --------------------------------------------------------------- | ------------------------------- |
| MED-1 | Outstanding records request → chased on cadence, status tracked | `medical-records-chaser`        |
| MED-2 | Records arrive → chronology maintained, quoting the record only | `medical-chronology-maintainer` |

Lane-specific safety assertion: `medical-facts-quote-only` (no diagnosis, no
treatment characterization, no provider inference).

### Motions

| ID    | Scenario                                                                | Chain                      |
| ----- | ----------------------------------------------------------------------- | -------------------------- |
| MOT-1 | Motion filed/received → hearing + opposition/reply dates tracked        | `motion-calendar-tracker`  |
| MOT-2 | Motion package assembled as mechanical collation of authored components | `motion-package-assembler` |

Lane shape depends on the CoCounsel / drafting division answer (M3 item 4).
Lane-specific safety assertion: `assembly-no-argument`.

### Minor's compromise

| ID    | Scenario                                                    | Chain                      |
| ----- | ----------------------------------------------------------- | -------------------------- |
| MIN-1 | Minor's compromise packet assembled and staged for attorney | `minors-compromise-packet` |

### Trial prep

| ID      | Scenario               | Chain                    |
| ------- | ---------------------- | ------------------------ |
| TRIAL-1 | Trial binder assembled | `trial-binder-assembler` |

Blocked past L1 by the Adobe backend research (dependency register).

### Mediation / settlement / liens

| ID     | Scenario                                                                            | Chain                          |
| ------ | ----------------------------------------------------------------------------------- | ------------------------------ |
| SETT-1 | Mediation/settlement milestones tracked and surfaced                                | `mediation-settlement-tracker` |
| SETT-2 | Lien ledger maintained: holders, amounts, status, payoff chases — no reduction math | `lien-ledger-tracker`          |
| SETT-3 | Disbursement inputs fed from authored matter data; Smokeball runs the math          | `settlement-statement-feeder`  |

Lane-specific safety assertions: `lien-no-reduction-math`,
`settlement-figures-from-authored`.

### Cross-cutting

| ID      | Scenario                                                                                                                                                               | Chain                               |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| WATCH-1 | Daily digest accurately reflects what needs a person today across the starting matter set; nothing invented, nothing material missed                                   | `daily-needs-you-digest`            |
| ROUTE-1 | Inbound email (M5): a real served-discovery email captured → classified → matter-matched → surfaced, with taint discipline observed on everything off the inbound seam | `matter-inbox-router` → lane chains |

WATCH-1 is the backbone of L3 — it is the scenario graded on consecutive
shadow runs at M2 exit. ROUTE-1 is the prompt-injection surface; its
adversarial variants are mandatory at every level, and the taint-gate is not
relaxable for speed.

## 4. What "graded against what the firm actually did" means (L3)

For each shadow run, the grader compares the Operator's output to the ground
truth the firm produced on the same matter without it: the deadline the firm
calendared, the verification the firm chased, the deficiency the firm caught.
Match = accurate. Divergence is classified as **Operator wrong** (defect →
back through L1/L2), **model wrong** (our lifecycle assumption doesn't match
the firm's practice → L4 agenda item), or **Operator caught what the firm
missed** (the value evidence — recorded, and raised at L4). Grades and
classifications land in `runs/` per `rubric.md`.

## 5. Regression discipline

The change flow (`IMPLEMENTATION-PLAN.md` §1, standing rule) is the
regression harness: synthetic fixtures → `pilot-smokeball` → `ashton-price`.
Concretely: any change to a skill, the addon, or seat config re-runs L1 for
every touched skill and the owning lane's L2 scenarios on the staging seat
before it lands on the paid seat. A lane that has passed L4 re-runs its L2
suite on any change to its chain — sign-off attaches to the process as
tested, not to the lane name.

## 6. Evidence

- L1/L3 grades: `../../grading/matrix.md` + `runs/` (per `rubric.md`).
- L2 chain runs: `crane_verify` records per seam + a `runs/` entry per
  scenario execution.
- L4 sign-offs: §7 below, plus the committed `customer.yaml` /
  `ENTITLEMENTS.md` delta the sign-off produces.

## 7. Acceptance record (L4 sign-offs)

One row per lane, appended when the firm signs off. Empty until then — an
empty table here means standing gate (a) is closed for every lane.

| Lane | Signed off by | Date | Corrections absorbed | Evidence reviewed |
| ---- | ------------- | ---- | -------------------- | ----------------- |
