# Selector test — stalled-matter-nudge

Asserts Hermes' skill selector picks `stalled-matter-nudge` for a firm-initiated inactivity scan, not `matter-status-responder` (a client-initiated status question) or `engagement-letter-chaser`.

## Synthetic query

> Find the matters that have gone quiet with no activity for a while and follow up on them.

## Expected selection

`stalled-matter-nudge`

## Result

Pass — verified 2026-06-04 via a blind cross-skill selector simulation (6 wedge + 2 spine descriptions). This query selected `stalled-matter-nudge`; no misroute.
