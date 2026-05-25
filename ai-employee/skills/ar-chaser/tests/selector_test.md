# Selector test — ar-chaser

This test asserts that Hermes' skill selector picks `ar-chaser` for the
synthetic query below, given the compressed `description` field across the
15 SKILL.md files in `ai-employee/skills/`.

## Synthetic query

> We have invoices 30 days past due. Draft chase emails.

## Expected selection

`ar-chaser`

## Result

Pass. Verified 2026-05-24 via cross-skill selector simulation across all 15
compressed descriptions. Each of the 15 queries selected its own skill
without misroute.
