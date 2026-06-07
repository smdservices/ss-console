# Selector test — assessment-findings-draft

Asserts that Hermes' skill selector picks `assessment-findings-draft` for the
synthetic query below, given the compressed `description` field across the
SKILL.md files in `operator/skills/`.

## Synthetic query

> The assessment interview with the prospect is done — draft the findings for their report.

## Expected selection

`assessment-findings-draft`

## Disambiguation note

The nearest neighbor is `proposal-drafter` (also transcript-in, draft-out). The
distinguishing signals: this skill keys on **assessment / findings / report**
and explicitly produces the evidence-bound X-ray that **withholds** the verdict,
where `proposal-drafter` keys on **proposal / SOW / pricing** and runs _after_
the human close. A query naming "proposal" or "SOW" must route to
`proposal-drafter`; one naming "assessment findings" or "the report" routes here.

## Result

Authored 2026-06-06. Cross-skill selector simulation across all
`operator/skills/` descriptions is pending the next selector run — flagged so it
is verified, not assumed, before this skill is relied on in routing.
