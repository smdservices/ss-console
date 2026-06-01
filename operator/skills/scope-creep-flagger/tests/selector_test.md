# Selector test — scope-creep-flagger

This test asserts that Hermes' skill selector picks `scope-creep-flagger` for the
synthetic query below, given the compressed `description` field across the
15 SKILL.md files in `operator/skills/`.

## Synthetic query

> Watch the client Slack channels and flag anything that's outside the SOW.

## Expected selection

`scope-creep-flagger`

## Result

Pass. Verified 2026-05-24 via cross-skill selector simulation across all 15
compressed descriptions. Each of the 15 queries selected its own skill
without misroute.
