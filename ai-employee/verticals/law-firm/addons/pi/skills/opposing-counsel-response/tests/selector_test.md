# Selector test — law-pi-opposing-counsel-response

This test asserts that Hermes' skill selector picks `law-pi-opposing-counsel-response` for the
synthetic query below, given the compressed `description` field across the
15 SKILL.md files in `ai-employee/skills/`.

## Synthetic query

> Opposing counsel sent a settlement counter on Garcia; draft a response.

## Expected selection

`law-pi-opposing-counsel-response`

## Result

Pass. Verified 2026-05-24 via cross-skill selector simulation across all 15
compressed descriptions. Each of the 15 queries selected its own skill
without misroute.
