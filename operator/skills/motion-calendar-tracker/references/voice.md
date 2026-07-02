# Motion Calendar Tracker - Voice

One voice, internal only. This skill produces a **sourced surface** and an internal
memo. Nothing here is ever sent to a client, opposing counsel, or the court.

## The surface and the memo (internal)

Factual, compact, auditable. Every claim is anchored to a record item, and every
absence is named as an absence.

The surface MAY: state what is filed, what is due, and the hearing dates **as the
record shows them**, each with its source id; name a gap ("no hearing set for the
MTC in the record"); name an ambiguity ("event 'MSJ?' - cannot place"); point an
un-calendared window at the deadline lane with its anchor and the governing rule as
the reason to confirm.

The surface MAY NOT: state a hearing date that no event carries; state a motion
status that no record item anchors; print a computed opposition/reply date as if it
were fact; assert a hearing outcome (granted/denied/continued) not in the record;
re-assert an unstructured note's claim in the skill's own voice; characterize the
merits of any motion.

## Hard rules

- No em dashes.
- Anti-fiction: if the record does not support it, it is a gap, not a value. When in
  doubt, surface the gap.
- Cite the actual governing rule (e.g. CCP §1005(b) for opposition/reply windows) as
  the **reason a human should confirm**, never as license to compute the date here.
  If the rule is uncertain for the motion type, say "confirm the rule."
- Distinguish an **authored** date (a human set it - a fact) from a **computable**
  one (surface the anchor + gap, never the number).
- Never states or implies a motion was filed, opposed, heard, granted, or denied
  unless that is anchored to a record item.

## Examples

**Good - a sourced Due row with an un-calendared window:**

> Opposition to Motion to Compel: not calendared. Anchor: hearing 2026-08-14 (event
> ev-3320). Opposition/reply windows run off the hearing under CCP §1005(b) - for the
> deadline lane to confirm and set. Not computed here.

**Good - a surfaced gap (anti-fiction):**

> Hearing 2026-08-14 "MSJ" (event ev-3320) has no matching filed-MSJ item in tasks or
> memos. Cannot show the motion as filed. Confirm whether the MSJ is filed and by whom.

**Good - a passed hearing with no disposition:**

> Motion to Compel: heard 2026-07-30 (event ev-3301). No disposition in the record.
> Outcome not asserted; confirm the ruling.

**Bad - invents a hearing date:**

> Motion to Compel: hearing likely mid-August; opposition due 2026-08-01.

(No event carries the hearing; the opposition date is computed and asserted. Both are
fiction.)

**Bad - asserts an outcome from silence:**

> Motion to Compel: the hearing passed last week, so it was granted. Closing it out.

(An outcome inferred from a passed date and silence, with no disposition in the
record.)
