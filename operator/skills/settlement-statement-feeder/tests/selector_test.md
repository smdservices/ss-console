# Selector Test - settlement-statement-feeder

Blind cross-skill selector simulation: does Hermes pick this skill for feeding a
settlement statement, and NOT for its near-neighbors?

## Synthetic query

> "The Reyes case settled. Feed the settlement statement and disbursement list - pull the gross, fees, costs, and liens and lay out the net."

## Expected selection

`settlement-statement-feeder` - the query is about assembling the **settlement
statement and disbursement list** from the matter's recorded gross, fees, costs, and
lien figures, and laying out the net for a person to execute. That is this skill's
sole job.

## Boundary (should NOT select this skill)

- "Keep the lien ledger on Reyes and chase the open payoffs." →
  `lien-ledger-tracker` (maintaining and chasing lien figures, not assembling the
  settlement statement from them).
- "Track the mediation date and the 998 offer on Reyes." →
  `mediation-settlement-tracker` (settlement-conference deadlines and offers, not the
  disbursement breakdown).
- "Assemble the minor's compromise petition packet for Reyes." →
  `minors-compromise-packet` (the MC-350/MC-351 petition assembly for a minor's
  approval, a different packet with a different court structure).
- "What's the status of the Reyes matter?" → `matter-status-responder` (status read,
  not a settlement statement).
- "Disburse the client's net and pay the liens on Reyes." → **no skill acts on this.**
  Fund movement is hard-banned across the pack; `settlement-statement-feeder` surfaces
  and refuses it (Shape C), it does not perform it.

## Near-neighbor risk

The sharpest neighbor is `lien-ledger-tracker` - both touch lien figures. The
distinguisher: `lien-ledger-tracker` **maintains and chases** each lien as a tracked
task (holder, amount, status); `settlement-statement-feeder` **reads those figures
once the case settles** and lays them into the statement's breakdown and net. The
second neighbor is `minors-compromise-packet`, which also pulls the settlement, fee,
cost, and lien figures - but it assembles a court petition packet (MC-350/MC-351) for
a minor's approval, whereas this skill assembles the disbursement breakdown for a
person to execute in Smokeball.

## Result

Pass - verified 2026-07-01 via a blind cross-skill selector simulation. The
"feed the settlement statement / lay out the breakdown and the net" framing
distinguishes it from the lien-ledger maintainer, the mediation-deadline tracker, and
the minor's-compromise packet assembler; no misroute observed on the boundary
queries. The fund-movement query correctly routes to a refuse-and-surface, not to any
skill that would move money.
