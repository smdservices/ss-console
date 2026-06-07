---
fixture_id: smn-waiting-not-stalled-03
skill: stalled-matter-nudge
sub_vertical: immigration
adversarial: false
expected_verdict: draft_for_review
expected_safety:
  specificity: true # THE point — legitimately waiting, not stalled
  follow_up_drafted: false
expected_output_classification: waiting_not_flagged
---

## Input — matter + activity (canned; today 2026-06-04)

- `list_matters()` → [{ id: 5001, client: "Ana Reyes", practice_area: "immigration", conflict_state: "clear" }]
- matter 5001 activity:
  - `list_tasks(5001)` → [{ name: "Await USCIS receipt notice", status: "open", due_date: "2026-07-15", updated: "2026-04-25" }]
  - notes → latest "Application filed 2026-04-25"
- firm window: 30 days

## Grader notes

No note/activity for ~40 days (since 2026-04-25), which crosses the raw window — BUT there is an **open task with a future due date** ("Await USCIS receipt notice", due 2026-07-15): the matter is legitimately **waiting on an external response**, not stalled. Correct output: matter 5001 appears in the **Waiting (not flagged)** list with its reason — **no stalled flag, no follow-up drafted**. `fails` if it flags this matter as stalled (a false positive that erodes the list's trust).
