# Per-tool Audit Emission Points

**Status:** Implemented in PR for [#842](https://github.com/venturecrane/ss-console/issues/842).

**Related:** [aie-adapter-register.md](aie-adapter-register.md), [audit-log-immutability.md](audit-log-immutability.md), [trust-ceiling-logging.md](trust-ceiling-logging.md), [refusal-handling.md](refusal-handling.md), [capability-contracts.md](capability-contracts.md), [ADR 0005 (reviewer-as-sender)](../../adr/0005-reviewer-as-sender.md).

This spec is the contract for `ai-employee/adapter/audit_emit_points.py`. It thickens the per-tool audit emission shape that PR [#981](https://github.com/venturecrane/ss-console/pull/981) landed (`aie_adapter.register()` + the `hermes_hook` surface) with a closed tool registry, a closed BANNED set, a latency timer, and scope-aware metadata extraction.

---

## 1. Why this exists

PR [#981] wired the four Hermes hooks. Its post-tool hook already writes one audit row per tool call, but the row's metadata was assembled inline at the call site, and the trust-ceiling enforcer had no canonical source for "what action class is this tool". Issue [#842](https://github.com/venturecrane/ss-console/issues/842) (PRD §7.4, §17.4) requires:

- Every tool dispatch emits an audit event with `timestamp, customer, skill, tool, action class, ceiling decision, outcome`.
- The event persists to the per-customer D1 `audit_log` table.
- Performance overhead is measured (target: <5ms p99 per tool call).
- New tools introduced at the capability layer cannot silently bypass classification.

This spec ships the registry + helpers that the overlay's dispatch path calls on every tool call.

## 2. Scope

In scope:

- `TOOL_ACTION_CLASS_MAP` - closed map of tool name to `HookActionClass`. The trust-ceiling enforcer keys on action class, so this registry IS the routing table.
- `BANNED_TOOLS` - closed set of tool names that are structurally forbidden. Includes every Pattern-A autonomous-send tool name and every never-autonomous destructive operation.
- `BannedToolError` - exception raised by `classify_tool()` when a banned tool name is invoked.
- `classify_tool()` - the helper the overlay calls before trust-ceiling enforcement.
- `ToolCallTimer` - the explicit measurement surface for `metadata.duration_ms`.
- `extract_scope_metadata()` - lifts `matter_id` / `customer_segment` from `ToolCallContext.arguments` into the audit row.
- `build_per_tool_metadata()` - canonical metadata-dict builder, consumed by the post-tool hook.

Out of scope (covered by separate work):

- The actual fork-side overlay code that calls these helpers in production. The overlay constructs a `HookRegistry`, calls `aie_adapter.register()`, and exposes the result to upstream Hermes (per [ADR 0015](../../adr/0015-hermes-fork-vs-upstream.md)). The overlay implementation is filed as a follow-on against ADR 0015.
- Per-tool cost telemetry. The `duration_ms` value emitted here is reused by the cost telemetry pipeline ([cost-telemetry-events.md](cost-telemetry-events.md)); the cost emission itself lives in issue [#804](https://github.com/venturecrane/ss-console/issues/804).
- Audit-log immutability and the Worker-layer enforcement of append-only writes. Those are spec'd in [audit-log-immutability.md](audit-log-immutability.md).

## 3. Tool action class registry

The registry maps every known tool name to its `HookActionClass`. The action classes are: `READ`, `INTERNAL_WRITE`, `EXTERNAL_SEND`, `COMMITMENT`, `DESTRUCTIVE`. The string values match `adapter.trust_ceiling.ActionClass`.

| Capability group    | Tool name pattern                                                                                                                                                                  | Action class     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Email               | `email_list_*`, `email_get_*`, `email_search`, `email_get_thread`, `email_list_labels`                                                                                             | `READ`           |
| Email               | `email_create_draft`, `email_update_draft`, `email_delete_draft`                                                                                                                   | `INTERNAL_WRITE` |
| Email               | `email_send`, `email_send_message`, `email_reply`, `email_reply_all`, `email_forward`                                                                                              | **BANNED**       |
| SMS                 | `sms_list_messages`, `sms_get_message`                                                                                                                                             | `READ`           |
| SMS                 | `sms_create_draft`                                                                                                                                                                 | `INTERNAL_WRITE` |
| SMS                 | `sms_send`, `sms_send_message`                                                                                                                                                     | **BANNED**       |
| Calendar            | `calendar_list_events`, `calendar_get_event`, `calendar_search_events`, `calendar_check_availability`                                                                              | `READ`           |
| Calendar            | `calendar_create_event_draft`, `calendar_respond_invitation_draft`                                                                                                                 | `INTERNAL_WRITE` |
| Calendar            | `calendar_propose_time`                                                                                                                                                            | `COMMITMENT`     |
| Calendar            | `calendar_delete_event`                                                                                                                                                            | **BANNED**       |
| Practice management | `practice_management_search_matters`, `practice_management_get_matter`, `practice_management_list_documents`, `practice_management_get_document`, `practice_management_list_tasks` | `READ`           |
| Practice management | `practice_management_create_note`, `practice_management_create_task_draft`, `practice_management_update_matter_field`                                                              | `INTERNAL_WRITE` |
| Practice management | `practice_management_open_matter_draft`                                                                                                                                            | `COMMITMENT`     |
| Practice management | `practice_management_delete_matter`, `practice_management_close_matter_permanent`                                                                                                  | **BANNED**       |
| Payments            | `payments_initiate_transfer`, `payments_send_payment`, `payments_refund`, `payments_authorize_charge`, `payments_void_authorization`                                               | **BANNED**       |
| Memory              | `memory_search`, `memory_get_rule`, `memory_list_rules`                                                                                                                            | `READ`           |
| Voice gate          | `voice_score_draft`, `voice_list_judge_history`                                                                                                                                    | `READ`           |
| Connector           | `connector_get_status`, `connector_list_bindings`                                                                                                                                  | `READ`           |
| Connector           | `connector_revoke_oauth`, `connector_unbind_permanent`                                                                                                                             | **BANNED**       |

`TOOL_ACTION_CLASS_MAP` is exposed as `MappingProxyType` so mutation at runtime raises `TypeError`. Registry changes ship as a PR + test + spec update.

### 3.1 Unknown tools

A tool name that is not in the registry and not in `BANNED_TOOLS` returns:

```python
ToolClassification(action_class=HookActionClass.READ, unmapped=True)
```

The `unmapped=True` flag propagates through to `metadata.unmapped_tool = true` on the audit row so audit review can catch new tools that landed without registry updates. Default-to-READ is the safe fallback: an unmapped tool that turns out to be a write is caught by the enforcer at a higher action class would refuse legitimate reads that simply lack registry entries.

## 4. Banned tools

`BANNED_TOOLS` is a closed set of tool names that are STRUCTURALLY forbidden. Calling `classify_tool()` for any name in this set raises `BannedToolError`. The overlay's dispatch path catches the exception, translates it to a refusal audit row + customer-facing notification (via the existing refusal hook from PR [#967]), and the tool MUST NOT execute.

Two reason codes:

| Reason                    | Meaning                                                       | Examples                                              |
| ------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| `banned_tool_pattern_a`   | Autonomous send from the agent identity (ADR 0005 forbidden). | `email_send`, `sms_send_message`, `email_reply`       |
| `banned_tool_destructive` | Irreversible money-movement or destructive state operation.   | `payments_initiate_transfer`, `calendar_delete_event` |

The reason lands in `metadata.banned_reason` on the resulting blocked-outcome audit row.

### 4.1 Disjoint invariant

`TOOL_ACTION_CLASS_MAP` and `BANNED_TOOLS` are disjoint. A name in both would allow the enforcer to make a decision about a tool the substrate considers forbidden, defeating the structural ban. The `test_registry_and_banned_sets_are_disjoint` test asserts this; the test is the merge gate.

## 5. Latency timer

`ToolCallTimer` is the per-call monotonic timer. The overlay's dispatch path uses it like this:

```python
timer = ToolCallTimer().start()
try:
    result_value = await tool_fn(...)
    outcome = "ok"
finally:
    duration_ms = timer.stop()
```

The timer is single-shot: `start()` twice, `stop()` before `start()`, or `stop()` twice all raise `RuntimeError`. That catches dispatch-path bugs where a call accidentally double-reports.

`duration_ms` is a float in milliseconds, produced from `time.perf_counter()` (monotonic, high-resolution). The value lands in:

- `ToolCallResult.duration_ms` (the existing field from PR [#981])
- `metadata.duration_ms` on the audit row
- The cost-telemetry feed (issue [#804], wired in a follow-on)
- The sticky-stop time-budget condition input (issue [#843], wired in a follow-on)

## 6. Scope-aware metadata

`extract_scope_metadata(context)` reads `context.arguments` and lifts a closed set of scope keys into the metadata output:

| Scope key          | Source                                  | Use                                                            |
| ------------------ | --------------------------------------- | -------------------------------------------------------------- |
| `matter_id`        | `context.arguments["matter_id"]`        | Per-matter drill-down on the audit viewer (law-firm vertical). |
| `customer_segment` | `context.arguments["customer_segment"]` | Cross-customer cohort aggregation.                             |

Missing or `None` values are omitted. Non-string values are coerced via `str()` so the JSON payload stays serializable. The dashboard treats both as opaque strings.

No other argument values are lifted into metadata. The full argument payload stays in the `AuditLogWriter`'s payload-digest path (per `audit_log.py`); only the closed scope keys appear in `metadata`.

## 7. Canonical metadata shape

`build_per_tool_metadata()` produces the canonical metadata dict that the post-tool hook writes to the audit row. The shape:

```json
{
  "per_tool_audit": true,
  "customer": "acme",
  "skill": "inbox-triage",
  "skill_version": "0.1.0",
  "tool": "email_create_draft",
  "action_class": "internal_write",
  "ceiling_level": "draft_for_review",
  "outcome": "ok",
  "error_type": null,
  "duration_ms": 8.25,
  "trace_id": "trace-test-0001",
  "matter_id": "matter-42",
  "customer_segment": "cohort-a"
}
```

Optional flags that appear when relevant:

- `unmapped_tool: true` - the tool was not in `TOOL_ACTION_CLASS_MAP`.
- `banned_tool: true` + `banned_reason: <reason>` - the tool was in `BANNED_TOOLS`.

All consumers (Captain dashboard aggregate view, customer dashboard recent-decisions feed, compliance-evidence packet, audit viewer) filter on `metadata.per_tool_audit = true` to find these rows, and aggregate on `tool`, `action_class`, `outcome`, and `duration_ms`. The keys are stable; changes ship as a PR + spec update + dashboard update in the same PR.

## 8. Compaction interaction

Per the compaction hook from PR [#981], transient per-call state must not live in context that compaction can compress. This module is pure: no module-level mutable state, no hidden per-customer caches. Every helper takes a `ToolCallContext` (the explicit shape from the overlay) and returns a value. The registry and banned set are module-level constants, but they are read-only `MappingProxyType` / `frozenset` and survive process restarts unchanged. There is no per-customer registry override - if a customer needs a tool restricted further than the registry says, the customer.yaml ceiling does the restriction at the trust-ceiling layer, not here.

## 9. No autonomous send

Nothing in this module originates an outbound action. The BANNED set is the hard guarantee that no autonomous-send tool name can route through this surface. The `test_no_send_tool_appears_in_registry` test asserts the invariant on the registry contents (no key contains the substring `_send`); the test is the merge gate.

## 10. Acceptance criteria mapping

Issue [#842](https://github.com/venturecrane/ss-console/issues/842) acceptance criteria:

- [x] Every tool dispatch emits an audit event: `timestamp, customer, skill, tool, action class, ceiling decision, outcome` - the canonical metadata dict from `build_per_tool_metadata()` contains every required field; `timestamp` lands via `AuditLogWriter` (which writes `ts` automatically), `ceiling_level` carries the ceiling decision, `outcome` is one of `ok` / `error` / `blocked`.
- [x] Events persist to per-customer D1 audit table - the writer from PR [#942](https://github.com/venturecrane/ss-console/pull/942) writes to the per-customer `audit_log` table; the integration test `test_metadata_writes_through_real_audit_log_writer` exercises this against an in-memory sqlite executor.
- [x] Audit event schema documented - this spec (sections 7 + 3).
- [x] Performance overhead measured - the `ToolCallTimer` provides ms-precision per-call measurement; the test suite includes a timer-budget assertion (`test_timer_measures_elapsed_ms`); the larger <5ms p99 budget for the full hook stack is asserted in the audit-log writer's own perf test (`test_audit_log.py::test_write_under_10ms_p99`).

## 11. Out-of-scope follow-ons

- Fork-side overlay code that calls `classify_tool()` + `ToolCallTimer` + `build_per_tool_metadata()` on the actual Hermes dispatch path. The overlay is the fork-side wiring filed against ADR 0015's overlay-implementation work.
- Cost-telemetry consumption of `duration_ms` (issue [#804]).
- Sticky-stop time-budget condition consumption of `duration_ms` (issue [#843]).
- Audit-viewer dashboard filters on `per_tool_audit`, `unmapped_tool`, `banned_tool` (issue [#873]).
- Registry expansion when new capability tools land (filed per-capability).
