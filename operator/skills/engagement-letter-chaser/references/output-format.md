# Engagement Letter Chaser — Output Format

The decision determines the shape.

## Shape A — Nudge due

```markdown
# Engagement Chase — <client> — matter <id> — YYYY-MM-DD

**Status:** sent <date>, unsigned (<N> days); last nudge <date or "none">; nudge <#> of <max>
**Decision:** nudge due

## Nudge (DRAFT — reviewer sends)

> <short, warm reminder per voice.md — points to where to sign; offers to answer questions with the team; interprets nothing>

## Internal log (create_note body)

> Engagement nudge <#> drafted for matter <id>; letter sent <date>, still unsigned.
```

## Shape B — Signed (log + stop)

```markdown
# Engagement Signed — <client> — matter <id> — YYYY-MM-DD

**Decision:** signature logged; cadence stopped; matter advances to active.

## Internal log (create_note body)

> Engagement letter for matter <id> signed <signed_date>; chase cadence stopped; matter active.
```

## Shape C — Wait

```markdown
# Engagement Chase — <client> — matter <id> — YYYY-MM-DD

**Status:** sent <date>, unsigned; last nudge <date> (<N> days ago, interval <interval>)
**Decision:** within cadence — wait, no nudge.
```

## Shape D — Surface to human (declined / expired / max reached)

```markdown
# ⚠ Engagement Chase — needs a human — <client> — matter <id> — YYYY-MM-DD

**Status:** <declined | expired | max nudges (<max>) reached>
**Decision:** surfaced for a human — this is a relationship/decision call, not another nudge.
```

## Rules

1. **Only Shape A contains a client-facing draft** (blockquote, drafted, never sent).
2. **No term of the letter appears interpreted** anywhere.
3. The decision and its reason are always stated, so the cadence is auditable.
