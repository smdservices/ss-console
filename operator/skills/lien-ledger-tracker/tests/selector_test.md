# Selector Test - lien-ledger-tracker

Blind cross-skill selector simulation: does Hermes pick this skill for a lien-ledger
task, and NOT for its near-neighbors in the Mediation and settlement phase?

## Synthetic query

> "Log the Medi-Cal, the ERISA plan, and the two provider liens on the Reyes matter and chase the ones whose payoff figures are still open."

## Expected selection

`lien-ledger-tracker` - the query is about keeping the matter's **lien ledger**
(holder, amount, status per lien) and **chasing the open payoffs**, which is this
skill's sole job.

## Boundary (should NOT select this skill)

- "Reduce the Medi-Cal lien under §14124.78 and calculate the net to the client." →
  no skill computes this; it is the responsible attorney's determination. This skill,
  if invoked, refuses the computation and surfaces it (Shape D); it must not be
  selected as the thing that "does" the reduction.
- "Disburse the provider payoff from the trust account." → no skill does this; trust
  moves are hard-banned. This skill refuses and surfaces; it is not the disbursement
  actor.
- "Build the settlement statement and total the deductions for Reyes." →
  `settlement-statement-feeder` (feeds/assembles the settlement statement figures;
  this skill only supplies the logged lien amounts to it, it does not build the
  statement).
- "Where does the Reyes mediation / settlement stand?" →
  `mediation-settlement-tracker` (the settlement/mediation status, not the lien
  ledger).
- "Chase the outstanding medical records from the provider on Reyes." →
  `medical-records-chaser` (records, not liens).
- "Is the trust balance under the floor on Reyes?" → `trust-balance-nudge` (trust
  balance floor, a read; not the lien ledger or a payoff chase).

The near-neighbor risk is `settlement-statement-feeder` (both touch settlement
numbers) and `medical-records-chaser` (both are chases in the medical/settlement
arc). The distinguisher: this skill keeps the **lien ledger** and chases **lien
payoffs and reductions**, logging figures a person provides; it never computes a
reduction, never builds the settlement statement, and never moves money.

## Result

Pass - verified 2026-07-01 via a blind cross-skill selector simulation. The
lien-ledger-and-payoff-chase framing distinguishes it from the settlement-statement
feeder, the mediation/settlement tracker, and the records chaser; the two banned acts
(compute a reduction, move money) are refusals it surfaces, not jobs it or any
sibling performs.
