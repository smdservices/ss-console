# Selector test — consult-scheduler

Asserts Hermes' skill selector picks `consult-scheduler` for a scheduling request, not `new-matter-intake` (a new inquiry) or `matter-status-responder` (a status question).

## Synthetic query

> A client wants to set up a time to meet with the attorney for their consult next week.

## Expected selection

`consult-scheduler`

## Result

Pass — verified 2026-06-04 via a blind cross-skill selector simulation (6 wedge + 2 spine descriptions). This query selected `consult-scheduler`; no misroute.
