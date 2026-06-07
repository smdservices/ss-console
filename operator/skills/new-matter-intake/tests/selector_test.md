# Selector test — new-matter-intake

Asserts Hermes' skill selector picks `new-matter-intake` for a new-client inquiry, given the compressed `description` field across the law wedge + spine skills (not misrouting to `inbox-triage`, which routes _to_ this skill, or to a status/chase skill).

## Synthetic query

> A potential new client just submitted the firm's contact form describing their situation and asking whether the firm can help.

## Expected selection

`new-matter-intake`

## Result

Pass — verified 2026-06-04 via a blind cross-skill selector simulation across all 6 wedge + 2 spine compressed descriptions. This query selected `new-matter-intake`; all 6 wedge queries selected their own skill with no misroute.
