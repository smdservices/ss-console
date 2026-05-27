# Selector test — law-pi-intake-triage

This test asserts that Hermes' skill selector picks `law-pi-intake-triage` for the
synthetic query below, given the compressed `description` field across the
15 SKILL.md files in `ai-employee/skills/`.

## Synthetic query

> We just got an intake email about a slip-and-fall; triage it and draft a follow-up.

## Expected selection

`law-pi-intake-triage`

## Result

Pass. Verified 2026-05-24 via cross-skill selector simulation across all 15
compressed descriptions. Each of the 15 queries selected its own skill
without misroute.
