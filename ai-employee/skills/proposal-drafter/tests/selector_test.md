# Selector test — proposal-drafter

This test asserts that Hermes' skill selector picks `proposal-drafter` for the
synthetic query below, given the compressed `description` field across the
15 SKILL.md files in `ai-employee/skills/`.

## Synthetic query

> Take the meeting transcript with the Smith prospect and draft a proposal.

## Expected selection

`proposal-drafter`

## Result

Pass. Verified 2026-05-24 via cross-skill selector simulation across all 15
compressed descriptions. Each of the 15 queries selected its own skill
without misroute.
