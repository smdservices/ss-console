# Selector test — trust-balance-nudge

Asserts Hermes' skill selector picks `trust-balance-nudge` for a low-retainer/trust-balance situation, not `engagement-letter-chaser` or `stalled-matter-nudge`.

## Synthetic query

> The retainer on that matter is running low — the trust balance dropped under the floor.

## Expected selection

`trust-balance-nudge`

## Result

Pass — verified 2026-06-04 via a blind cross-skill selector simulation (6 wedge + 2 spine descriptions). This query selected `trust-balance-nudge`; no misroute.
