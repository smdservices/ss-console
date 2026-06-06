# Stalled Matter Nudge — Algorithm

Source of truth for catching genuine drift without crying wolf.

## Recency

Clio's matter resource **has** a first-class `updated_at` (last-record-modification). The upstream `oktopeak/clio-mcp` simply does not request it in its matter field set — but it already requests `updated_at` on contacts, proving Clio honors the field, so the connect-step fix is to widen the matter field set (`clio-surface.md` findings 2–3; the same widening `responsible_attorney` needs). With that in place:

```
last_activity = matter.updated_at,  floored by
                latest list_calendar_entries end time (when present)
```

A matter is a **candidate** if `today − last_activity > window` (the firm's authored staleness window, per practice area if set).

**Honest caveat.** `updated_at` is last-record-modification, not last-substantive-activity — a billing run or a note write bumps it. It is a strong proxy and the right primary signal; it is not perfect, and the surfaced list should not imply more precision than the field carries.

**What is NOT available from this connector** (do not author against it): per-task created/updated/completed timestamps — `list_tasks` exposes only `due_at` (a future date) — and note timestamps (no note-read tool exists). The prior `max(task, calendar, note)` model assumed reads the connector does not provide.

**Fallback if the field-widening is not yet live:** recency = latest `list_calendar_entries` end time alone. This misses matters with no calendar history, so specificity drops — surface that limitation in the list rather than presenting a weak signal as a strong one.

## The waiting-vs-stalled filter (specificity)

A candidate is **not** actually stalled if it is legitimately waiting:

- It has an **open task with a future due date** (awaiting a response, a court date, a filing window).
- It is explicitly in a wait-state the firm records (e.g., "awaiting USCIS receipt").

These matters are quiet **on purpose** — flagging them as stalled is a false positive that erodes trust in the list. Only surface matters that are quiet **without** a pending reason.

## The conflict-hold gate

A candidate matter on CONFLICT-HOLD is surfaced **separately** — it needs human conflict clearance, not a client follow-up. Draft no client-facing follow-up for it.

## Surface + draft

- **Surface** (autonomous): the genuinely-stalled matters, each with last-activity date + days-quiet.
- **Draft** (review): a neutral, light follow-up per stalled matter. It says, in effect, "we want to keep this moving; is there anything you're waiting on us for?" — it **surfaces and offers to reconnect**. It never states or advises the next legal step. Deciding what the matter needs is the lawyer's call.

## What this algorithm is NOT

- Not a decider (flags, never prescribes the next legal step).
- Not a wolf-crier (legitimately-waiting matters are filtered out).
- Not a fabricator (recency from real timestamps).
- Not a sender (drafts only); not a nudger of held matters.
