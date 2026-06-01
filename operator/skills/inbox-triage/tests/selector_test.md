# Selector test — inbox-triage

This test asserts that Hermes' skill selector picks `inbox-triage` for the
synthetic query below, given the compressed `description` field across the
15 SKILL.md files in `operator/skills/`.

## Synthetic query

> Triage my inbox this morning and draft replies I can send.

## Expected selection

`inbox-triage`

## Result

Pass. Verified 2026-05-24 via cross-skill selector simulation across all 15
compressed descriptions. Each of the 15 queries selected its own skill
without misroute.
