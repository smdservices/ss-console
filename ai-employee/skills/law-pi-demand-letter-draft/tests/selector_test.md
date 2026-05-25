# Selector test — law-pi-demand-letter-draft

This test asserts that Hermes' skill selector picks `law-pi-demand-letter-draft` for the
synthetic query below, given the compressed `description` field across the
15 SKILL.md files in `ai-employee/skills/`.

## Synthetic query

> Draft a demand letter on the Rodriguez PI case from the medical and economic records.

## Expected selection

`law-pi-demand-letter-draft`

## Result

Pass. Verified 2026-05-24 via cross-skill selector simulation across all 15
compressed descriptions. Each of the 15 queries selected its own skill
without misroute.
