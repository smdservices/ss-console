# Selector test — status-report-assembler

This test asserts that Hermes' skill selector picks `status-report-assembler` for the
synthetic query below, given the compressed `description` field across the
15 SKILL.md files in `ai-employee/skills/`.

## Synthetic query

> Send weekly status reports to our retainer clients based on what we've done.

## Expected selection

`status-report-assembler`

## Result

Pass. Verified 2026-05-24 via cross-skill selector simulation across all 15
compressed descriptions. Each of the 15 queries selected its own skill
without misroute.
