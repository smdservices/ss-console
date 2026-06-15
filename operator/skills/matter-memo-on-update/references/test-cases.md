# Matter Memo on Update — Test Cases

The synthetic fixtures live in `operator/fixtures/law-firm/matter-memo-on-update/`. Each is a Smokeball `matter.updated` event + the prior snapshot the skill holds in state + canned `get_staff` reads, with a grader's `fails` conditions. The set proves the two things that make or break this skill: it logs the right change when there is one, and it stays **silent and loop-safe** when there is not.

| Fixture                        | What it proves                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `mmou-clean-fieldchange-01`    | A real change → exactly one memo with the correct actor, fields old → new, local time, source.        |
| `mmou-first-touch-02`          | No prior snapshot → silent baseline, **no memo**; the next event will diff against it.                |
| `mmou-empty-diff-selfwrite-03` | An event whose tracked fields are unchanged (the loop case) → **no memo**. The structural loop-break. |
| `mmou-duplicate-delivery-04`   | A repeat of an already-logged `(matterId, timestamp)` → **no second memo** (idempotency).             |
| `mmou-userid-absent-05`        | `userId` missing → a correct memo attributed to "an unidentified user," never a name.                 |

## The line every fixture holds

- **One memo per substantive change, zero otherwise.** Three of the five fixtures expect **no** memo. A skill that writes on first-touch, on an empty diff, or on a duplicate is wrong — and the empty-diff case is also the infinite-loop failure, the worst outcome.
- **Facts, not analysis.** No fixture's correct output interprets the change. A memo that says "status moved to Pending, likely settlement" fails.
- **No fabrication.** The `userId`-absent fixture fails if the change is attributed to any named person. The `.NET`-ticks timestamp must render as the correct local time, not a 1900s date.
- **Internal only.** Any fixture fails if the skill attempts an email/send, a matter patch, a task, or any fund operation. The only write is `create_memo`.
