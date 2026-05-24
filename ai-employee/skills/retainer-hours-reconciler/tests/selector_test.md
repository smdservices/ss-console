# Selector test — retainer-hours-reconciler

This test asserts that Hermes' skill selector picks `retainer-hours-reconciler` for the
synthetic query below, given the compressed `description` field across the
15 SKILL.md files in `ai-employee/skills/`.

## Synthetic query

> We have several monthly retainer clients; tell me which ones I'm losing money on.

## Expected selection

`retainer-hours-reconciler`

## Result

Pass. Verified 2026-05-24 via cross-skill selector simulation across all 15
compressed descriptions. Each of the 15 queries selected its own skill
without misroute.
