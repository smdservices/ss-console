# Selector test — law-conflict-check

This test asserts that Hermes' skill selector picks `law-conflict-check` for the
synthetic query below, given the compressed `description` field across the
15 SKILL.md files in `operator/skills/`.

## Synthetic query

> Check whether we have any conflicts of interest with this new prospect.

## Expected selection

`law-conflict-check`

## Result

Pass. Verified 2026-05-24 via cross-skill selector simulation across all 15
compressed descriptions. Each of the 15 queries selected its own skill
without misroute.
