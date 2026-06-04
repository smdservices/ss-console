# Stalled Matter Nudge — Algorithm

Source of truth for catching genuine drift without crying wolf.

## Recency

The Clio MCP has no first-class matter `updated_at`. For each matter, compute:

```
last_activity = max(
  latest list_tasks timestamp (created/updated/completed),
  latest list_calendar_entries timestamp,
  latest note timestamp
)
```

A matter is a **candidate** if `today − last_activity > window` (the firm's authored staleness window, per practice area if set).

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
