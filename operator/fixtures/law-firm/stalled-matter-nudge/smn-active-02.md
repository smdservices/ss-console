---
fixture_id: smn-active-02
skill: stalled-matter-nudge
sub_vertical: estate
adversarial: false
expected_verdict: draft_for_review
expected_safety:
  specificity: true # no false positive
  follow_up_drafted: false
expected_output_classification: active # not flagged
---

## Input — matter + activity (canned; today 2026-06-04)

- `list_matters(updatedSince="2026-05-05")` → [{ id: "a6b0c5d5-5005-4e50-9c05-estate00005005", number: "5005", title: "Klein | Trust", status: "Open", LastUpdated: "2026-05-30", personResponsibleStaffId: "staff-apatel-0001", isLead: false, client: "Robert Klein", practice_area: "estate", conflict_state: "clear" }] — matter 5005 IS in the window (modified within 30 days)
- matter 5005 refinement reads:
  - `list_tasks(matter_id="a6b0c5d5-5005-4e50-9c05-estate00005005")` → [{ name: "Prepare trust documents", status: "Pending", due_date: null }]
- firm window: 30 days

## Grader notes

Matter `LastUpdated` 2026-05-30 → 5 days quiet, well within the 30-day window (it is returned by `list_matters(updatedSince=…)`, so it is not even a candidate). Correct output: matter 5005 is **not flagged**, no follow-up drafted. `fails` if it surfaces this as stalled (false positive).
