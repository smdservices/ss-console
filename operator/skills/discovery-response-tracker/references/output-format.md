# Discovery Response Tracker - Output Format

The direction and the decision determine the shape. A deadline is always keyed to
`(matter, discovery-set, direction)`. Nothing is written to the calendar or sent before
the stated confirm.

## Shape A (inbound) - Present the response deadline for one-click confirm, engine active

```markdown
# Response deadline - <matter> - <type> served <date> (<method>) - inbound - YYYY-MM-DD

**Engine:** court-rules engine active (Smokeball-InfoTrack).
**Engine date:** <date read from the engine via the Smokeball matter> - read, not computed.
**Decision:** surfaced to <responsible attorney> to confirm. Not calendared yet.

## Confirm to <attorney> (internal)

> The engine's response deadline for <type> on <matter> is <date>. Confirm to place it on
> the calendar and the matter task. <one-click confirm, bound to this set>

## Internal log (create_memo body - includes the training note)
```

## Shape B (inbound) - Present the response deadline for confirm, computed by hand

```markdown
# Response deadline - <matter> - <type> served <date> (<method>) - inbound - YYYY-MM-DD

**Engine:** not run here - firm computes by hand (configured).
**Proposed deadline (confirm):** base 30 days (§<2030.260|2031.260|2033.250>) from
<service date>, plus <method extension> (§<1013(a)|1013(c)|1010.6(a)(3)(B)>) = <date>.
<If a +2-court-day method or a possible local rule: final day marked "confirm - court-day
count / local rule not applied here.">
**Decision:** proposed for <responsible attorney> to confirm. Not calendared yet.

## Confirm to <attorney> (internal)

> Proposed response deadline for <type> on <matter>: <date> (30 days + <extension>,
> §<...>). Confirm to calendar it, or correct the date. <one-click confirm>

## Internal log (create_memo body - includes the training note)
```

## Shape C (outbound) - Flag the meet-and-confer / compel point (late or thin)

```markdown
# Opposing discovery - needs a decision - <matter> - <type> - outbound - YYYY-MM-DD

**Trigger:** <no response by the deadline <date> | response received <date> appears thin:
<what was observed, factual, not a sufficiency ruling>>
**Meet-and-confer point:** reached. The window to move to compel is now running.
<For RFAs late: **higher severity - deemed-admissions exposure, §2033.280.**>
**Decision (attorney):** informal meet-and-confer first, or a meet-and-confer letter?
If a letter, it is drafted by `meet-and-confer-drafter` (that skill owns the letter and
the compel-window citation). **This skill does not send anything and does not write the
letter.**

## Internal log (create_memo body - includes the training note)
```

## Shape D - Surface to a human (fail-closed)

```markdown
# ⚠ Discovery deadline - needs a human - <matter> - YYYY-MM-DD

**Situation:** <proof of service unreadable / method or date ambiguous | discovery type
unclear | deadline mode (engine vs by-hand) unconfigured | court-day count or local rule
in play | "late"/"thin" cannot be established from the record | no attorney confirm yet
and deadline near>
**Decision:** surfaced for a person. Nothing computed as final, nothing calendared,
nothing sent. This is a judgment the skill does not make on its own.
```

## Rules

1. **No shape writes to the calendar or sends to a party.** Inbound writes the
   event/task only **after** the attorney confirm; outbound Shape C flags a decision and
   never drafts or sends the letter.
2. **Engine active → read, never recompute** (Shape A). Firm-by-hand → compute as a
   proposal only (Shape B). Mode unconfigured → Shape D, never a silent default.
3. **Every computed date shows its arithmetic and its grounded statute.** A date with no
   cited window is not presented; it is surfaced (Shape D).
4. **"Appears thin" is a surfaced observation, never a sufficiency ruling.** The attorney
   makes the legal call.
5. The decision and its reason are always stated, so the deadline chain is auditable.
