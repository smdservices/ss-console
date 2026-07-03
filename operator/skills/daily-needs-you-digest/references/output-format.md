# Daily Needs-You Digest — Output Format

One digest per tick, written to the firm's internal notes surface. The result of the
wake decision determines the shape. Two shapes only. Neither ever contains an outbound
draft, because this skill sends nothing and acts on nothing.

## Shape A — The batched digest (something needs a person)

Counts up top; the most time-critical section first. Every line names the matter, the
item, the sourced date/age, and the **owning skill/step** for the next action. The
digest points; it never acts.

```markdown
# Needs a person today — YYYY-MM-DD — <N> item(s) across <M> open matter(s)

## Deadlines near (<count>)

- <matter> (<matter id>) — <deadline item>, <date> (<days> days) — owns: <skill/step>
- ...

## Due soon (<count>)

- <matter> (<matter id>) — <task>, due <date> (<days> days) — owns: <skill/step>
- ...

## Unsigned (<count>)

- <matter> (<matter id>) — <verification/signature item>, sent <date>, unsigned (<N> days) — owns: client-verification-tracker
- ...

## Stalled (<count>)

- <matter> (<matter id>) — <open item>, no movement since <date> (<N> days) — owns: <skill/step>
- ...

## Notes for a paralegal (training)

> Per item, one short line: what needs doing, why it matters (the governing rule where
> the owning step has one, e.g. an unverified response is treated as no response,
> §2030.250), which step owns it, and when to bring the attorney in. Explanatory, not
> advisory. Short.

## Read-failures (only if any)

- <matter id> — reads failed this tick (parse_failed); surfaced, not hidden.
```

## Shape B — The quiet-day digest (nothing genuinely needs a person)

One line. No sections. No padding. Plus the heartbeat, so the tick is auditable.

```markdown
# Needs a person today — YYYY-MM-DD

Nothing needs a person today across <M> open matter(s). Waiting/on-track items are not
listed. (Heartbeat: needs_you_digest_tick, decision_basis: nothing_in_needs_you_band.)
```

## Rules

1. **Neither shape contains an outbound draft or an action.** Every line is a pointer
   to the skill/step that owns the next action, never the action itself.
2. **Only in-band items appear in Shape A.** Due soon / deadline near / unsigned /
   stalled, per the firm's authored windows. Legitimately-waiting items (open task with
   a future due date beyond the window) are excluded, not demoted into a section.
3. **A quiet day is Shape B, always.** Never pad Shape B into Shape A to look useful,
   and never manufacture urgency for an item that is fine.
4. **Every item traces to a Smokeball read.** No invented item, date, age, or urgency.
   Missing data is shown as missing.
5. **Ordering is by time-criticality**, most urgent first, so the firm reads the top
   and stops when it has what it needs.
6. **A tick always leaves a heartbeat row** (Shape A or Shape B). A silent suppression
   is a failure.
