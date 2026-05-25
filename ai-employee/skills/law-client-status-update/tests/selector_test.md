# Selector test — law-client-status-update

This test asserts that Hermes' skill selector picks `law-client-status-update` for the
synthetic query below, given the compressed `description` field across the
15 SKILL.md files in `ai-employee/skills/`.

## Synthetic query

> Send a status update to our client on the Anderson matter from this week's Clio activity.

## Expected selection

`law-client-status-update`

## Result

Pass. Verified 2026-05-24 via cross-skill selector simulation across all 15
compressed descriptions. Each of the 15 queries selected its own skill
without misroute.
