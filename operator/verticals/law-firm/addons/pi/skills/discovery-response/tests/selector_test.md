# Selector test — discovery-response

This test asserts that Hermes' skill selector picks `discovery-response` for the
synthetic query below, given the compressed `description` field across the
15 SKILL.md files in `operator/skills/`.

## Synthetic query

> Opposing counsel sent us interrogatories; draft objections and the document list.

## Expected selection

`discovery-response`

## Result

Pass. Verified 2026-05-24 via cross-skill selector simulation across all 15
compressed descriptions. Each of the 15 queries selected its own skill
without misroute.
