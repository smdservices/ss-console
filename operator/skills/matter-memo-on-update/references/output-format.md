# Matter Memo on Update — Output Format

One output: a single `create_memo` body, or nothing. There is no client-facing text — the memo is an internal Smokeball record a supervising attorney reads. Most events produce **no** output (first-touch baseline, empty diff, duplicate); that silence is correct.

## The memo body

A two-part body: a one-line header (who / when / how) and the changed-field list. Plain text, terse, no prose, no interpretation.

```
Matter updated by <actor> on <YYYY-MM-DD> at <h:MM AM/PM> (<source>).
<Field>: <old> → <new>
<Field>: <old> → <new>
```

- **`<actor>`** = the resolved staff name, or **"an unidentified user"** when `userId` is absent. Never a guessed name.
- **`<source>`** = `in-app` (`source: Smokeball`) or `via an integration` (`source: API`).
- **timestamp** = the event `timestamp` (.NET ticks) converted to the firm's local time.
- One line per changed field, in the table order below. A field absent from the diff does not appear.

Worked example:

```
Matter updated by Jane Smith on 2026-06-14 at 2:32 PM (in-app).
Status: Open → Pending
Responsible attorney: (none) → Chris Price
```

`userId`-absent example:

```
Matter updated by an unidentified user on 2026-06-14 at 9:05 AM (via an integration).
Description: "Auto accident — intake" → "Auto accident — in treatment"
```

## Tracked fields (the diff set)

These are the matter fields the skill diffs and reports. A change outside this set produces an empty diff and **no memo** (which is also the loop-break — see `algorithm.md`). Resolve ids to human-readable names before rendering; never print a raw UUID in a supervision memo.

| Field (memo label)   | Source field (`smokeball-surface.md`) | Render rule                                                          |
| -------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| Status               | `status`                              | Enum verbatim (`Open`/`Pending`/`Closed`/…)                          |
| Responsible attorney | `personResponsibleStaffId`            | Resolve via `get_staff` → name; empty → `(none)`                     |
| Assisting staff      | `personAssistingStaffId`              | Resolve via `get_staff` → name; empty → `(none)`                     |
| Description          | `description`                         | Quoted string; truncate > 120 chars with `…`                         |
| Title                | `title`                               | Quoted string                                                        |
| Matter number        | `number`                              | Verbatim; blank → `(unassigned)`                                     |
| Matter type          | `matterType` / `matterTypeId`         | Resolve to the matter-type name                                      |
| Clients              | `clients[]`                           | By count + names if resolvable (`1 → 2 clients`; name the added one) |
| Lead / matter        | `isLead`                              | `Lead → Matter` on conversion                                        |

## Rules

1. **Facts only.** No "why," no judgment, no legal characterization, no next-step suggestion. The memo states what changed; the attorney interprets.
2. **Changed fields only.** Never dump the full snapshot — that leaks unchanged state into every memo and buries the signal. Only fields whose value differs appear.
3. **No fabrication.** Every old/new value comes from the diff. An absent `userId` is "an unidentified user," never a name. An unresolvable id renders as its reference, never an invented label.
4. **Resolve ids to names.** A supervision memo a human reads must say "Chris Price," not `526670af-…`. If resolution fails, say so plainly (`staff 526670af… (name unavailable)`), never guess.
5. **Silence is an output.** First-touch, empty-diff, and duplicate events produce no memo. Do not emit a "no change" memo.
