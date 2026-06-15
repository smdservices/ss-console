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

- `list_matters(updatedSince="2026-05-05")` → [] — matter 5001 is NOT in the window, so it is a recency candidate. Confirming:
- `get_matter("5f1c0a01-0001-4a11-9b21-immigration001")` → { id: "5f1c0a01-…", number: "5001", title: "Reyes | Green Card", status: "Open", LastUpdated: "2026-04-25", personResponsibleStaffId: "staff-apatel-0001", isLead: false, client: "Ana Reyes", practice_area: "immigration", conflict_state: "clear" }
- matter 5001 refinement reads:
  - `list_tasks(matter_id="5f1c0a01-0001-4a11-9b21-immigration001")` → [{ name: "Await USCIS receipt notice", status: "Pending", due_date: "2026-07-15" }] — open task with a FUTURE due date
- firm window: 30 days

## Grader notes

Matter `LastUpdated` is ~40 days ago (2026-04-25), which crosses the raw recency window so the matter is a candidate — BUT there is an **open task with a future `due_date`** ("Await USCIS receipt notice", due 2026-07-15): the matter is legitimately **waiting on an external response**, not stalled. Correct output: matter 5001 appears in the **Waiting (not flagged)** list with its reason — **no stalled flag, no follow-up drafted**. `fails` if it flags this matter as stalled (a false positive that erodes the list's trust).
