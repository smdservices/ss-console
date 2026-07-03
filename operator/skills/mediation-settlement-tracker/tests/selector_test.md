# Selector Test — mediation-settlement-tracker

Blind cross-skill selector simulation: does Hermes pick this skill for mediation/MSC
prep and its §998/conference deadline tracking, and NOT for its near-neighbors?

## Synthetic query

> "We've got the Vega mediation set — pull together the inputs for the brief and keep an eye on the §998 offer and the conference date."

## Expected selection

`mediation-settlement-tracker` — the query is about assembling the **brief inputs** for
a scheduled **mediation / MSC** and **tracking the §998 offer and the conference date**,
which is this skill's sole job. It stages the inputs (it does not write the brief) and
surfaces the §998/MSC deadlines as proposed-confirm.

## Boundary (should NOT select this skill)

- "The Vega case settled — assemble the settlement statement and the disbursement list."
  → `settlement-statement-feeder` (post-settlement net/disbursement math, not
  pre-conference brief inputs or the §998 clock).
- "What's the SOL / discovery cutoff on the Vega matter?" → `deadline-and-sol-tracker`
  (statute-of-limitations and discovery deadlines generally, not the settlement-posture
  §998/MSC deadlines).
- "When's the hearing on our motion to compel?" → `motion-calendar-tracker` (motion
  hearing/calendar dates, not the mediation/MSC conference).
- "Assemble the separate statement for the motion to compel further responses." →
  `separate-statement-assembler` (CRC 3.1345 compel statement, not a mediation brief's
  inputs).
- "Draft the mediation brief / write the damages argument for Vega." → refused by this
  skill (the brief is the attorney's or co-counsel's work product); the skill assembles
  inputs only and never authors the brief.

The near-neighbor risk is `settlement-statement-feeder` (both touch "settlement") and
`deadline-and-sol-tracker` / `motion-calendar-tracker` (all touch deadlines). The
distinguisher: this skill is the **pre-conference** work — assembling the components a
mediation/MSC brief draws from and tracking the **§998 offer window and the conference
date** as proposed-confirm; the settlement-statement feeder is the **post-settlement**
disbursement math; the deadline/motion trackers are the discovery/SOL and motion-hearing
deadlines, not the settlement-posture ones.

## Result

Pass — verified 2026-07-01 via a blind cross-skill selector simulation. The
mediation/MSC-brief-inputs + §998/conference framing distinguishes it from the
post-settlement statement feeder and the general deadline/motion trackers; no misroute
observed on the boundary queries.
