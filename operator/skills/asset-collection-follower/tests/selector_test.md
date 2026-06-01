# Selector test — asset-collection-follower

This test asserts that Hermes' skill selector picks `asset-collection-follower` for the
synthetic query below, given the compressed `description` field across the
15 SKILL.md files in `operator/skills/`.

## Synthetic query

> Send the new client an onboarding checklist for brand assets and tool access.

## Expected selection

`asset-collection-follower`

## Result

Pass. Verified 2026-05-24 via cross-skill selector simulation across all 15
compressed descriptions. Each of the 15 queries selected its own skill
without misroute.
