# Matter Status Digest — Algorithm

The rules that make the digest accurate and honest about Clio's limits.

## Sectioning

1. **Open by stage.** Bucket `list_matters(status=open)` by Clio stage/status. Counts at the top so the principal sees the shape before the detail.
2. **Upcoming.** Per matter: `list_tasks` with a near `due_at`, and `list_calendar_entries` in the window. Sourced dates only — a matter with no scheduled date shows none, never an invented one.
3. **Quiet.** Reuse `stalled-matter-nudge`'s recency: `last_activity = matter.updated_at` floored by the latest calendar-entry end time. Past the firm's window AND not legitimately waiting (an open task with a future `due_at` = waiting on purpose, not quiet). Same `updated_at` caveat (last-record-modification, a strong-not-perfect proxy) and same fallback (calendar-only recency, reduced specificity, flagged) as the nudge skill — the two share the model.
4. **Low trust.** Per matter, the `build:lawpay` read-only trust balance vs. the firm's authored floor. Trust is NOT Clio's `get_billing_summary` (that is AR — `total_outstanding`; do not conflate). Read-only: the flag never triggers a fund movement.
5. **Held.** Conflict-hold matters in their own section — they need human clearance, not a status line.

## The connector dependency (stated, not worked around)

`responsible_attorney` and `updated_at` on matters require widening the Clio MCP matter field set (`clio-surface.md` findings 2–3; the connect-step connector patch). The digest is built to degrade honestly:

- **With the widening:** attorney column populated; quiet flag uses `updated_at`.
- **Without it:** attorney column omitted; quiet flag falls back to calendar-entry recency only (misses matters with no calendar history → lower specificity). The header states which mode is in effect. Never fabricate the attorney or a precise recency the connector cannot supply.

## What this algorithm is NOT

- Not a decider — flags state, never prescribes the legal next step.
- Not a fabricator — every stage, date, and balance is sourced; gaps show as gaps.
- Not a trust-mover — the low-trust flag reads only.
- Not client-facing — internal digest for the principal.
