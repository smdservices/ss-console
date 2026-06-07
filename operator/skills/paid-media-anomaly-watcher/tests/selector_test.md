# Selector test — paid-media-anomaly-watcher

This test asserts that Hermes' skill selector picks `paid-media-anomaly-watcher` for the
synthetic query below, given the compressed `description` field across the
15 SKILL.md files in `operator/skills/`.

## Synthetic query

> Check whether our Meta and Google ad accounts have any cost spikes today.

## Expected selection

`paid-media-anomaly-watcher`

## Result

Pass. Verified 2026-05-24 via cross-skill selector simulation across all 15
compressed descriptions. Each of the 15 queries selected its own skill
without misroute.
