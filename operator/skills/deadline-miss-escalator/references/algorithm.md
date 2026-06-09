# deadline-miss-escalator algorithm

The escalation decision and ladder, with the never-computes line held in code.

## The authored-only rule (identical to the tracker's)

Every date is read from Clio — an authored calendar entry or a task `due_at`. The only arithmetic is **comparing an authored date to today**. There is no arithmetic that _produces_ a deadline. "Overdue" means an authored date has passed today; it never means a date this skill computed.

## The in-range test (pre-run)

```
for each authored_date d on matter m:
    in_range = m.open and not d.acknowledged and d.authored_date <= today + escalation_window
```

`escalation_window`, `near`, and `notify` windows are firm-authored (defaults: 14 / 7 / 3 days). The pre-run wakes the agent iff any deadline is `in_range`; otherwise it writes a `SUPPRESSED_WAKE` heartbeat and suppresses. `acknowledged` comes from the firm's escalation-ack state — once a human acks, the deadline stops re-firing.

## Rung by proximity

```
days_out = (authored_date - today).days        # comparison arithmetic, not a produced date

if matter.conflict_hold:        rung = clearance     # human conflict clearance, never client-facing
elif days_out <= notify:        rung = notify        # ESCALATION_FIRED to red_flag_recipients
elif days_out <= near:          rung = re-route      # internal flag to responsible humans
else:                           rung = re-surface     # elevated flag on the internal surface
```

- **re-surface** and **re-route** are internal-surface writes (`internal_write`).
- **notify** emits an `ESCALATION_FIRED` audit row and an alert to the firm's authored `escalation.red_flag_recipients` — the **existing** alert channel (the same path refusal-cascade alerts use), not a new action class. The human acks with `ESCALATION_ACKNOWLEDGED`.
- **clearance** surfaces a held matter for human clearance; it never drafts a client-facing step.

## Fail-closed notify (ADR 0035)

The notify rung fires through the firm's authored red-flag channel. If the firm authored **no** `red_flag_recipients`, the alert has nowhere to go and **does not fire** — the escalator still re-surfaces and re-routes internally, but raises no named-human alert and never invents a recipient. Authored on, or it does not happen.

## Routing honesty (v1)

"Route to the responsible attorney" needs the responsible-attorney identity, which Clio's `get_matter` does not return today (`clio-surface.md` finding 2). So v1 routes the re-route and notify rungs to the firm's authored `red_flag_recipients` list — the humans the firm designated for red flags. Per-matter responsible-attorney routing (connector field-widening) is a filed follow-on, not a v1 blocker. The surface says who it routed to; it does not pretend to know the assigned attorney.

## Heartbeat / dead-man's-switch

The `SUPPRESSED_WAKE` row on every quiet tick is the heartbeat (ADR 0021). A scheduled tick that produces **no** audit row is the alarm the watcher-health view fires on — that is the dead-man's-switch. An audit-write failure forces `wakeAgent: true` so a broken heartbeat surfaces as the agent waking, never as silence. The deadline-watch is **advisory and supplemental, never the firm's system of record** (`operator/verticals/law-firm/compliance-floor.md`).

## Why the line is absolute

A cron-driven watcher a firm comes to trust is more dangerous than no watcher if it can fail silently or launder a legal judgment. So: it never computes a date (the judgment stays human), it never goes dark without a signal (the heartbeat + fail-to-wake), and it never reaches a client (every rung is internal). It is a loud, honest alarm for authored dates — nothing more.
