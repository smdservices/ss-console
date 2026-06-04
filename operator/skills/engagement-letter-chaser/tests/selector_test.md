# Selector test — engagement-letter-chaser

Asserts Hermes' skill selector picks `engagement-letter-chaser` for an unsigned-engagement follow-up, not `stalled-matter-nudge` (matter inactivity) or `matter-status-responder` (a status question).

## Synthetic query

> The engagement letter we sent that client still hasn't been signed — follow up on it.

## Expected selection

`engagement-letter-chaser`

## Result

Pass — verified 2026-06-04 via a blind cross-skill selector simulation (6 wedge + 2 spine descriptions). This query selected `engagement-letter-chaser`; no misroute.
