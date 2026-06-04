# Selector test — matter-status-responder

Asserts Hermes' skill selector picks `matter-status-responder` for a client status question, not `stalled-matter-nudge` (firm-initiated inactivity) or `engagement-letter-chaser`.

## Synthetic query

> A client emailed asking for an update on where their matter stands right now.

## Expected selection

`matter-status-responder`

## Result

Pass — verified 2026-06-04 via a blind cross-skill selector simulation (6 wedge + 2 spine descriptions). This query selected `matter-status-responder` (the adjacency to the agency `status-report-assembler` resolved correctly — that skill is a weekly PM/analytics report, not an ad-hoc client status query); no misroute.
