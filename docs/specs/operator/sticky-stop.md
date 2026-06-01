# Sticky-stop circuit breaker

**Spec for issue #843.** A forward-only state machine that pins the agent's
dispatch path when the substrate observes runaway-loop signals: consecutive
tool failures, refusal cascades, time-budget overruns, or daily cost-cap
breaches.

The mechanism is named in platform PRD §11.5 and §7.5 invariant #4 but
had no emission or enforcement points before this issue. Without it, a
runaway agent loop has no circuit breaker.

## Source

- platform-prd.md §7.5 ("Safety substrate invariants") — invariant #4
  defines sticky-stop as architecturally pinned, surviving context
  compaction, restart, and skill reload
- platform-prd.md §11.5 ("Sticky stop") — the operator-pause surface
- d1-schema.md §1 — `audit_log` action_type vocabulary the transitions
  emit into

## Why two paths share one mechanism

There are two ways the sticky stop fires:

1. **Operator-initiated.** A human clicks "pause all skills" in the
   dashboard. Covered by platform-prd.md §11.5. The dispatch path
   consults the pinned slot before invoking any skill. Recovery is
   one-click by the same operator.
2. **System-initiated (this spec).** The substrate notices the agent
   is misbehaving — looping on a failing tool, refusing on every call,
   burning the cost cap, exceeding wall-clock time — and pins a stop
   on its behalf. Recovery requires Captain investigation, not a click.

Both paths produce the same dispatch-path effect (skill invocation
blocked or pinned to draft-for-review). The differences are:

- **Audit tagging.** Operator pauses write `AGENT_STOPPED` with
  metadata `actor_role=principal|operator`. System stops write
  `AGENT_STOPPED` (HARD_STOP) or `INVARIANT_VIOLATION` (WARN /
  SOFT_STOP) with `actor=agent`, `actor_role=agent`.
- **Recovery actor.** Operator pauses clear via the dashboard pause
  control. System stops clear via Captain investigation through the
  control plane.
- **Conditions.** Operator pauses have no condition — the human chose
  to stop. System stops always carry a `condition_triggered` value.

The persistence layer (D1 table `sticky_stop_state`) is shared.

## State machine

Four states, forward-only by default:

```
  OK ----> WARN ----> SOFT_STOP ----> HARD_STOP
   ^                                       |
   |                                       |
   +--- Captain clear() -------------------+
```

`clear()` is the only path backwards. There is no autonomous downgrade.
Tool successes reset the failure counter to zero but do NOT downgrade the
level; the runtime is permitted to keep observing without escalating the
sticky-stop tier, and the Captain decides when to clear after
investigation.

### State semantics

| State       | Effect on dispatch                                                                                                                         | UI                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `OK`        | Normal operation                                                                                                                           | No banner                                           |
| `WARN`      | Normal operation; substrate is watching                                                                                                    | Yellow banner: "Substrate flagged X; investigating" |
| `SOFT_STOP` | Every skill's `trust_ceiling` pinned to `draft_for_review`. No autonomous escalation. No auto-actions. Drafts continue, queued for review. | Orange banner: "Auto-actions paused; drafts only"   |
| `HARD_STOP` | Every skill invocation refused. Dispatch entrypoint raises `StickyStopError`.                                                              | Red banner: "Agent paused. Captain investigating"   |

The dashboard surface for these banners is a separate issue. This spec
covers the state-machine module and its persistence; UI is downstream.

## Conditions and default thresholds

Configurable per customer via `customer.yaml.safety.sticky_stop` (see
[Customer.yaml shape](#customeryaml-shape) below). When unset, the
following defaults apply. They are conservative — easier to loosen than
to recover from a tighter-than-needed loop that ran for hours.

### 1. Consecutive tool failures

A tool call returns a failure within a rolling time window.

| Threshold                     | Default      | Transition               |
| ----------------------------- | ------------ | ------------------------ |
| `tool_failure_warn`           | 3            | `OK -> WARN`             |
| `tool_failure_soft_stop`      | 5            | `WARN -> SOFT_STOP`      |
| `tool_failure_hard_stop`      | 8            | `SOFT_STOP -> HARD_STOP` |
| `tool_failure_window_seconds` | 600 (10 min) | window for streak        |

A successful tool call resets the streak. A failure outside the window
resets the streak to 1 and starts a new window.

### 2. Refusal cascade

A trust-ceiling refusal (the substrate refused to allow a skill action).
Counts within a rolling window. A skill spamming `refused` responses is
itself a runaway signal — either the prompt drifted in an unsafe direction
or the operator's ceiling is incompatible with the skill's request shape.

| Threshold                | Default       | Transition               |
| ------------------------ | ------------- | ------------------------ |
| `refusal_warn`           | 5             | `OK -> WARN`             |
| `refusal_soft_stop`      | 10            | `WARN -> SOFT_STOP`      |
| `refusal_hard_stop`      | 20            | `SOFT_STOP -> HARD_STOP` |
| `refusal_window_seconds` | 1800 (30 min) | window for cascade       |

### 3. Time budget exceeded

Wall-clock seconds for a single agent run. If observed runtime exceeds
the budget, the machine single-steps to `SOFT_STOP` — the agent has
already exceeded its envelope; we do not wait for a second data point.

| Threshold             | Default       | Transition       |
| --------------------- | ------------- | ---------------- |
| `time_budget_seconds` | 3600 (1 hour) | `* -> SOFT_STOP` |

Callers feed `record_runtime_seconds()` per turn or per minute (poll).
The machine itself has no async wakeup.

### 4. Cost threshold

Daily $ cap on LLM costs in cents (so cost_telemetry's integer-cents
convention applies). Resets at UTC date rollover.

| Threshold            | Default        | Transition                           |
| -------------------- | -------------- | ------------------------------------ |
| `cost_daily_cents`   | 5000 ($50/day) | per-day cap                          |
| `cost_warn_pct`      | 80             | `OK -> WARN` (at 80% of cap)         |
| `cost_soft_stop_pct` | 100            | `WARN -> SOFT_STOP` (at cap)         |
| `cost_hard_stop_pct` | 200            | `SOFT_STOP -> HARD_STOP` (at 2x cap) |

Cost is fed in via `record_cost_cents()` as LLM-cost events fire. The
cost-telemetry pipeline (cost-telemetry-events.md) is the natural source.

## Captain recovery

`clear()` is the only path that decreases level. The interface:

```python
await machine.clear(
    customer="acme",
    persona="marcus",
    captain_id="captain-scott",  # caller-asserted identity
    reason="vendor tool flap confirmed; runaway-loop false positive",
)
```

Caller responsibility: the actor must be a Captain. Identity verification
lives in the control-plane RBAC layer; this module trusts the caller to
have established identity before invoking. The control plane MUST NOT
expose `clear()` to non-Captain roles.

`clear()` resets `level=OK`, zeroes the rolling counters
(`consecutive_tool_failures=0`, `refusal_count=0`), and preserves
`cost_cents_today` (the cost cap is a daily resource accounting; clearing
sticky-stop does not buy back budget).

## Audit emission

Every state transition writes exactly one row to `audit_log` via the
`AuditLogWriter` (`ai-employee/adapter/audit_log.py`, on main from PR
#942). Action types reuse the existing closed-set vocabulary
(`ACCEPTED_ACTION_TYPES`) so this module does not need to extend the
audit-log contract:

| Transition kind                | `action_type`         | `actor`      | `actor_role` |
| ------------------------------ | --------------------- | ------------ | ------------ |
| Entry to `HARD_STOP`           | `AGENT_STOPPED`       | `agent`      | `agent`      |
| Entry to `WARN` or `SOFT_STOP` | `INVARIANT_VIOLATION` | `agent`      | `agent`      |
| Captain `clear()`              | `AGENT_RESUMED`       | `captain_id` | `captain`    |

The transition-specific detail lives in the `metadata` column as JSON:

```json
{
  "sticky_stop_transition": true,
  "customer": "acme",
  "persona": "marcus",
  "from_state": "WARN",
  "to_state": "SOFT_STOP",
  "condition_triggered": "consecutive_tool_failures",
  "reason": "consecutive_tool_failures=5 (window=600s, skill=inbox-triage)",
  "consecutive_tool_failures": 5,
  "window_seconds": 600,
  "thresholds": { "warn": 3, "soft_stop": 5, "hard_stop": 8 }
}
```

For Captain clears the metadata sets `sticky_stop_cleared: true` and
includes the prior state and the Captain's reason. The compliance-evidence
packet generator (`compliance-evidence-packet.md`) groups rows by these
metadata keys to render the sticky-stop section.

## Customer.yaml shape

```yaml
safety:
  sticky_stop:
    tool_failure:
      warn: 3
      soft_stop: 5
      hard_stop: 8
      window_seconds: 600
    refusal:
      warn: 5
      soft_stop: 10
      hard_stop: 20
      window_seconds: 1800
    time_budget_seconds: 3600
    cost:
      daily_cents: 5000
      warn_pct: 80
      soft_stop_pct: 100
      hard_stop_pct: 200
```

All keys optional; module-level defaults apply when absent.

The `customer-yaml-schema.md` schema does not yet have a `safety` top-level
section. When the schema picks one up (under a future ADR), the sticky-stop
block lives under it. Until then the block is read directly by the
sticky-stop module at construction time via a customer.yaml resolver
(provisioning-time wiring, not in scope of this module).

## D1 table

Per ADR 0008 + 0009 the state lives in the per-customer D1 database
(`hermes-{slug}-d1`). One row per `(customer, persona)` tuple. The
composite primary key enforces uniqueness.

Schema in `ai-employee/migrations/0004_sticky_stop_state.sql`. Columns:

| Column                           | Type                       | Notes                                            |
| -------------------------------- | -------------------------- | ------------------------------------------------ |
| `customer`                       | TEXT NOT NULL              | customer_id slug; equals the D1 binding's tenant |
| `persona`                        | TEXT NOT NULL              | `customer.yaml.personas[].slug`                  |
| `level`                          | TEXT NOT NULL DEFAULT 'OK' | one of OK / WARN / SOFT_STOP / HARD_STOP         |
| `updated_at`                     | TEXT NOT NULL              | ISO 8601 UTC                                     |
| `reason`                         | TEXT                       | snapshot at last transition                      |
| `condition`                      | TEXT                       | last condition that drove a transition           |
| `consecutive_tool_failures`      | INTEGER NOT NULL DEFAULT 0 | rolling counter                                  |
| `tool_failure_window_started_at` | TEXT                       | ISO; NULL when no streak                         |
| `refusal_count`                  | INTEGER NOT NULL DEFAULT 0 | rolling counter                                  |
| `refusal_window_started_at`      | TEXT                       | ISO                                              |
| `cost_cents_today`               | INTEGER NOT NULL DEFAULT 0 | resets on UTC day rollover                       |
| `cost_date`                      | TEXT                       | YYYY-MM-DD                                       |

Index: `idx_sticky_stop_active` on `updated_at DESC WHERE level != 'OK'`,
for the dashboard's "is anything stuck?" indicator.

## Verification

`ai-employee/safety-substrate/tests/test_sticky_stop.py` exercises:

- Initial state is `OK` and read alone does not persist
- Each of the four conditions drives the WARN -> SOFT_STOP -> HARD_STOP
  ladder
- Tool success resets the failure counter
- Tool success does NOT downgrade level (forward-only invariant)
- Failures outside the rolling window reset the streak to 1
- Time-budget overrun single-steps to SOFT_STOP
- Cost threshold ladder respects the three percentages and resets on
  UTC day rollover
- Negative cost amounts raise `ValueError`
- State is forward-only — autonomous downgrade is impossible
- Dispatch guard `assert_allowed()` passes through at SOFT_STOP and
  raises `StickyStopError` at HARD_STOP
- Captain `clear()` resets level to OK, zeros counters, and emits an
  `AGENT_RESUMED` audit row carrying the prior state and clear reason
- `clear()` requires non-empty captain_id and reason
- Integration: each of the four conditions, run end-to-end, produces a
  visible audit-log row tagged with the right `condition_triggered`
- Restart resilience: opening a fresh `SqliteStickyStopStore` over the
  same connection returns the persisted state intact

Run locally:

```
cd ai-employee && uv run --with pytest python -m pytest safety-substrate/tests/test_sticky_stop.py -v
```

## Failure modes

- **Audit write fails during a transition.** The `AuditWriteError`
  propagates out of the `record_*` method. The state row WAS persisted
  before the audit call. This means the runtime can end up with a state
  change that has no audit trail. The acceptable mitigation: the caller
  (Hermes dispatch) treats `AuditWriteError` as fatal — same rule as the
  audit log writer itself — and the boot-check picks up the stale state
  on restart. A future refinement may wrap the two writes in a
  best-effort transactional shape, but D1's HTTP API does not support
  multi-statement transactions across audit-log and sticky-stop-state
  tables today.
- **D1 unavailable.** `get_state()` fails with the underlying executor's
  exception. The dispatch guard then cannot determine state. The caller
  must treat this as "stop" (fail-closed): if you cannot read the state,
  you cannot dispatch.
- **Threshold misconfiguration.** Customer.yaml ships a `cost_daily_cents`
  of zero. The cost-threshold check short-circuits to OK (division-by-zero
  guard). This is a configuration error, not a runtime error; the customer
  has effectively disabled the cost dimension.
- **Cost rollover skew.** The day boundary uses UTC. Customers in non-UTC
  time zones see the daily reset at non-midnight local time. This is the
  same convention as `cost_telemetry.date` (per cost-telemetry-events.md)
  and is acceptable; the spec calls out the dimension explicitly.

## Implementation notes

- Module: `ai-employee/safety-substrate/sticky_stop.py`
- Migration: `ai-employee/migrations/0004_sticky_stop_state.sql`
- Tests: `ai-employee/safety-substrate/tests/test_sticky_stop.py`
- The module follows the same pure-Python + injectable-store shape as
  `audit_log.py`. Production wiring uses a D1 HTTP executor (when the
  Hermes-side `HttpD1StickyStopStore` lands; not in this PR).
- The state machine is import-callable from any dispatch path. There is
  no global state, no module-level singleton — callers construct a
  `StickyStopMachine` from a store and an audit writer.
- Clock is injectable for deterministic tests via the `clock` constructor
  kwarg.
- The `consecutive_tool_failures` and `refusal_count` counters are
  persisted in the row (not in process memory) so the machine survives
  Hermes restarts without losing failure history per safety invariant #4.

## Cross-references

- platform-prd.md §7.5 (safety substrate invariants), §11.5 (sticky stop)
- d1-schema.md §1 (audit_log action types)
- customer-yaml-schema.md (future `safety.sticky_stop` block)
- compliance-evidence-packet.md (compliance packet renders the sticky-stop
  section from `metadata.sticky_stop_transition` and
  `metadata.sticky_stop_cleared` audit rows)
- cost-telemetry-events.md (cost source feeding `record_cost_cents()`)
- ADR 0008 (customer-owned memory artifact)
- ADR 0009 (cross-machine query prohibition)
- PR #942 (audit log persistence) — provides `AuditLogWriter`
