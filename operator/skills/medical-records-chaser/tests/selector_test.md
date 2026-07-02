# Selector Test — medical-records-chaser

Blind cross-skill selector simulation: does Hermes pick this skill for a
records-chase task, and NOT for its near-neighbors?

## Synthetic query

> "The Reyes matter is still missing the Valley Ortho records — chase the records vendor and stay on it until they come in."

## Expected selection

`medical-records-chaser` — the query is about following up on **outstanding medical
records** requested for the matter until they land, which is this skill's sole job.

## Boundary (should NOT select this skill)

- "Build the medical chronology from the records we've collected on Reyes." →
  `medical-chronology-maintainer` (reads and organizes received records; this skill
  never reads treatment or builds the chronology).
- "Start the client verification for the Reyes interrogatory responses." →
  `client-verification-tracker` (a discovery-response verification signature, not a
  records chase).
- "What's the deadline to respond to the discovery served on Reyes?" →
  `discovery-response-tracker` (a discovery response deadline, not records).
- "Update the lien ledger with the payoff figure from the Reyes provider." →
  `lien-ledger-tracker` (medical liens and payoff, not obtaining the records).
- "What's the status of the Reyes matter?" → `matter-status-responder`.

The near-neighbor risk is `medical-chronology-maintainer` (both touch medical
records) and `lien-ledger-tracker` (both touch providers). The distinguisher: this
skill **chases outstanding records requests** until the document lands, keyed to a
provider request; the chronology maintainer reads records that already arrived, and
the lien tracker works the provider's lien/payoff, not the records themselves.

## Result

Pass — verified 2026-07-01 via a blind cross-skill selector simulation. The
"outstanding records / chase until they land" framing distinguishes it from the
chronology maintainer (reads received records) and the lien tracker (payoff, not
records); no misroute observed on the boundary queries.
