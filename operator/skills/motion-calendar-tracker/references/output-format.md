# Motion Calendar Tracker - Output Format

One matter, one surface. The surface is **the record, organized** - every row names
its Smokeball source, and anything the record does not support is a **gap**, not a
value. There are no outbound drafts here: this skill only surfaces and writes an
internal log.

## Shape A - Motion calendar surface (the current, sourced picture)

```markdown
# Motion Calendar - <matter description> - matter <id> - YYYY-MM-DD

**Matter status:** <Open | Pending | ...> · **Responsible:** <staff>
**Window:** <from>-<to> · **Sources:** <N> events, <M> tasks

## Filed

| Motion                                        | Filed by        | Filed (source)                 | Status (source)                                                         |
| --------------------------------------------- | --------------- | ------------------------------ | ----------------------------------------------------------------------- |
| <e.g. Motion to Compel Further RFP Responses> | firm / opposing | <date> (task <id> / memo <id>) | <filed / opposed / submitted / heard - each from a record item, or "-"> |

## Due

| Item                     | Date   | Source                 | Note                                                                                                                       |
| ------------------------ | ------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| <e.g. Opposition to MTC> | <date> | task <id> / event <id> | authored by a human                                                                                                        |
| <e.g. Reply to MSJ>      | -      | -                      | not calendared - anchor: hearing <date> (event <id>); MSJ runs on §437c (not §1005(b)) - deadline lane to confirm the rule |

## Hearings

| Motion   | Hearing date | Dept/time               | Source     |
| -------- | ------------ | ----------------------- | ---------- |
| <motion> | <date>       | <dept/time if in event> | event <id> |

## Gaps & Confirms (surfaced - NOT filled)

- <hearing <date> (event <id>) has no matching filed motion in the record - confirm>
- <MTC filed <date> (task <id>) has no hearing date set - confirm>
- <opposition/reply windows for <motion> not calendared - hand to the deadline lane>
- <event "MSJ?" (event <id>) is ambiguous - cannot place; confirm what it is>
```

## Shape B - Gap / ambiguity dominates (nothing clean to surface)

When the record is too thin or too ambiguous to assemble a trustworthy calendar, do
**not** manufacture one. Lead with the gap.

```markdown
# ⚠ Motion Calendar - gaps to resolve - matter <id> - YYYY-MM-DD

**Situation:** <hearing on the calendar with no filed motion | motion filed with no
hearing | status reported in a note but unconfirmed | event too ambiguous to place>
**What the record shows:** <the sourced item(s), verbatim-anchored, e.g. "event <id>:
'MSJ hearing' <date>; no filed-MSJ item in tasks or memos">
**What it does NOT show:** <the missing piece - stated as missing, never inferred>
**Decision:** surfaced for a person. Nothing computed, drafted, or asserted. This is a
judgment the skill does not make on its own.
```

## Internal log (create_memo body)

```markdown
> Motion calendar assembled for <matter> as of <date>: <X> filed, <Y> due (Z
> authored, W un-calendared anchors surfaced), <V> hearings. Gaps surfaced: <list>.
> Source: <N> events, <M> tasks. No deadline computed; no outcome asserted.
>
> **What:** refreshed the motion-calendar surface for this matter from the record.
> **Why:** an un-calendared opposition window or a mis-linked hearing is how a motion
> slips; opposition/reply windows run off the hearing under a rule that depends on the
> motion type (§1005(b) for a regular noticed motion; §437c for MSJ/MSA) - confirm the
> governing rule for the motion type.
> **Next:** the deadline lane / attorney confirms and calendars any un-authored
> windows; the drafter prepares the opposition/reply.
> **Attorney if:** a hearing has no filed motion, a motion has no hearing, a window is
> un-calendared as the hearing nears, or a status is reported but unconfirmed.
```

## Rules

1. **No outbound drafts in any shape.** This skill surfaces and logs internally; it
   never drafts a motion, opposition, reply, or client/court message.
2. **Every Filed / Due / Hearing row names its source** (event id / task id / memo id).
   A row with no source is not a row - it is a Gap.
3. **A missing due date is never computed.** Authored dates are surfaced with their
   source; un-authored windows are surfaced as an **anchor + gap** for the deadline
   lane, never as a stated date.
4. **A missing hearing date or motion status is a Gap**, surfaced with what the record
   does and does not show - never a plausible fill.
5. **A hearing outcome appears only if the record states it, and occurrence is never
   inferred from a passed date.** The record shows a hearing was _set_ for a date, not
   that it was held - hearings get continued, vacated, or taken off calendar. A passed
   hearing date with no minute order or disposition in the record is "hearing was set
   for <date> (event <id>); no minute order or disposition in the record - confirm
   whether it was held, continued, or vacated," never "heard <date>" and never
   "granted"/"denied."
6. **A reported-but-unstructured status is surfaced as "reported in <source>,
   unconfirmed,"** never re-asserted in the skill's own voice.
