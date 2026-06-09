# Deadline Miss Escalator — Output Format

Two internal surfaces: the escalation list (firm-internal) and the notify alert (to the authored red-flag recipient). Nothing here is client- or tribunal-bound.

## The escalation surface (firm-internal)

```markdown
# Deadline Escalations — YYYY-MM-DD

**Windows:** escalation <E>d / near <N>d / notify <Y>d (firm-authored; defaults stated when unset)
**In escalation range:** <R> | **Notified:** <Nt> | **Held (clearance):** <H>

## Notify — alert raised

### matter <id> — <client> — <label> <date> (<days_out> days)

- **ESCALATION_FIRED** → <authored red_flag_recipients> · awaiting `ESCALATION_ACKNOWLEDGED`

## Re-route — flagged to the firm

- matter <id> — <client>: <label> <date> in <days_out> days → flagged to <red_flag_recipients>.

## Re-surface — elevated on the tracker

- matter <id> — <client>: <label> <date> in <days_out> days → elevated flag.

## Held — clearance, not escalation

- matter <id> — <client>: on CONFLICT-HOLD with <label> <date> approaching → surfaced for human clearance; no client step.
```

## The notify alert (internal, to the red-flag recipient)

```markdown
Subject: [Deadline] matter <id> — <client> — <label> due <date> (<days_out> days)

An authored <label> on matter <id> (<client>) is <overdue by N days | due in N days>.
This is an internal alert for a named human; no client message has been sent.
Acknowledge to close the escalation.
```

## Rules

1. **Every rung is internal.** Re-surface and re-route write the internal surface; notify alerts the authored red-flag recipient. No client/tribunal send on any path.
2. **The notify alert names the authored date and its source label** — never a computed or "estimated" date.
3. **With no authored red-flag recipient, the Notify section is empty** and the surface says so (fail-closed); re-surface/re-route still run.
4. **Held matters appear only under Clearance,** never with a client-facing step.
5. **A `SUPPRESSED_WAKE` row stands in for the whole surface on a quiet tick** — the heartbeat; the agent does not wake to write an empty surface.
