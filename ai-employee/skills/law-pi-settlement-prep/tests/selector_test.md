# Selector test — law-pi-settlement-prep

This test asserts that Hermes' skill selector picks `law-pi-settlement-prep` for the
synthetic query below, given the compressed `description` field across the
15 SKILL.md files in `ai-employee/skills/`.

## Synthetic query

> I have a settlement conference Friday on Martinez; prepare an internal prep memo.

## Expected selection

`law-pi-settlement-prep`

## Result

Pass. Verified 2026-05-24 via cross-skill selector simulation across all 15
compressed descriptions. Each of the 15 queries selected its own skill
without misroute.
