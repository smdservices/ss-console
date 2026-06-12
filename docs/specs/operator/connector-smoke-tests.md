# Connector Smoke-Test Framework

> **SUPERSEDED (2026-06-12, Captain decision).** The filevine / no_pm /
> lawpay adapter packages this harness covered were deleted (ADR 0020 went
> MCP-first; the adapters had zero runtime wiring, and
> `run-connector-smoke-tests.sh` invoked `operator/adapter/run_prod_smoke_test.py`,
> which never existed). The live google connector suite runs in CI via
> `operator-substrate.yml`. Retained for historical reference.

**Spec for issue [#852](https://github.com/venturecrane/ss-console/issues/852).** Operationalizes the Phase A stub at [`operator/adapter/run_prod_smoke_test.py`](../../../operator/adapter/run_prod_smoke_test.py) (originally landed in PR #812) into a real connector regression surface. For every enabled BUILD or Composio connector declared in [`customer.yaml`](customer-yaml-schema.md), one read-only call against the customer's tenant runs before any skill exercises a write capability. Auth, scope, and shape issues surface day-1.

## Source

- [ADR 0006](../../adr/0006-capability-adapter-pattern.md) — capability-interface + adapter pattern
- [ADR 0012](../../adr/0012-customer-yaml-storage.md) — git source of truth for customer.yaml
- [`src/lib/operator/capabilities/conformance.ts`](../../../src/lib/operator/capabilities/conformance.ts) — TypeScript conformance harness whose invariants this Python framework mirrors
- [`customer-yaml-schema.md`](customer-yaml-schema.md) §"Capability binding" — connectors block shape
- PR #812 — Phase A stub
- PR #949 — Filevine connector with capability conformance + smoke unit tests

## What this framework is for

A skill that holds `trust_ceiling: autonomous` writes against the customer's real tenant on its first run. If the connector's auth token has expired, the capability scopes are wrong, or the adapter wires an interface the vendor does not actually expose, the failure surfaces inside the production write path — exactly the place where a failure has the highest cost.

The smoke framework moves the failure to provisioning time, when there is no live customer relying on the skill. It also runs periodically thereafter, so an OAuth token that expires three weeks into operation surfaces as a `CONNECTOR_HEALTH_PROBE_FAILED` audit row rather than as a draft that never lands in the reviewer's inbox.

## Scope of the smoke pass

For each enabled connector entry in `customer.yaml`:

1. Resolve the registered probe by `(capability, adapter, backend prefix)`.
2. Build the adapter via the probe's factory (uses the customer's resolved auth tokens; see [`oauth-lifecycle.md`](oauth-lifecycle.md)).
3. Call `describe_capabilities()` and validate the returned `CapabilitySet` against the four shape invariants (matching capability name, capability in the closed `CAPABILITY_NAMES` union, non-empty adapter/version, disjoint supported/unsupported).
4. Call the probe's registered read-only method (one method per probe; see "Read-only allowlist" below).
5. Grade the result as `pass` / `partial` / `fail` per the rules below.

Per-connector results aggregate into a `SmokeReport` with one `overall_status`.

## Read-only allowlist

Probes are registered with one method drawn from a hardcoded per-capability allowlist defined in [`adapter/connector_smoke.py`](../../../operator/adapter/connector_smoke.py) `READ_ONLY_METHODS_BY_CAPABILITY`. A probe that attempts to register a method outside the allowlist raises `ProbeRegistrationError` at construction time. There is no runtime path that lands on a write method.

| Capability         | Representative probes                                            |
| ------------------ | ---------------------------------------------------------------- |
| PracticeManagement | `search_matters(limit=1)`, `health_check()`                      |
| DocumentStorage    | `list_documents(matter_id='smoke-test-dummy')` (empty or 404 OK) |
| Email              | `list_sent_messages(limit=1)`                                    |
| Calendar           | `list_events(start=now-1d, end=now)`                             |
| IntakeCRM          | `list_leads(limit=1)`                                            |
| ESign              | `list_envelopes(limit=1)`                                        |
| Payments           | `list_payment_requests(limit=1)`                                 |
| Accounting         | `list_invoices(limit=1)`                                         |
| CourtAccess        | `list_filings(limit=1)`                                          |
| CallTracking       | `list_calls(limit=1)`                                            |
| InternalComms      | `list_channels(limit=1)`                                         |

Mutating prefixes — `create_*`, `send_*`, `upload_*`, `post_*`, `update_*`, `delete_*`, `share_*` — are forbidden by allowlist construction. The test [`test_allowlist_contains_no_mutating_method_names`](../../../operator/adapter/tests/test_connector_smoke.py) asserts this.

## Conformance shape check

Mirrors `assertCapabilitySetWellFormed` from [`src/lib/operator/capabilities/conformance.ts`](../../../src/lib/operator/capabilities/conformance.ts):

- Declared `capability` matches the probe's `capability`.
- Declared `capability` is in the closed `CAPABILITY_NAMES` union.
- `adapter` is non-empty.
- `version` is non-empty.
- `supported_methods` is non-empty.
- `supported_methods` and `unsupported_methods` are disjoint.

Each violation produces a string entry in `ConnectorSmokeResult.shape_violations`. A probe that returns data BUT fails any shape check is graded `partial` rather than `pass` — the connector is reachable, but it does not honestly describe what it implements.

The framework accepts either a Python dataclass (mirror of `CapabilitySet` per the Filevine adapter pattern at [`operator/connectors/filevine/capabilities.py`](../../../operator/connectors/filevine/capabilities.py)) or a dict-shaped payload (Composio / MCP responses normalized upstream).

## Grading rules

Each per-connector result is one of:

- **`pass`** — `describe_capabilities()` is well-formed AND the probe method returned without raising within the wall-clock budget (`PROBE_TIMEOUT_SECONDS = 15`).
- **`partial`** — the probe returned data, but `describe_capabilities()` produced one or more shape violations. The connector is reachable but does not honestly describe itself.
- **`fail`** — the probe raised, the adapter does not expose the probe's method, the factory raised at construction time, the wall-clock budget was exceeded, OR the enabled connector has no registered probe at all.
- **`skipped`** — the connector entry was present but `enabled: false`, or the backend prefix was `synthetic:`.

The aggregated `SmokeReport.overall_status` rolls up:

| Per-connector mix                                       | `overall_status` |
| ------------------------------------------------------- | ---------------- |
| All `pass` (or empty)                                   | `pass`           |
| At least one required `fail`                            | `fail`           |
| At least one `fail` but every failed result is optional | `partial`        |
| At least one `partial`, no required `fail`              | `partial`        |

`optional` is read from each connector's entry in `customer.yaml` as `connectors.<Capability>.optional: true`. Unset defaults to `false` (required).

## CLI exit codes

The CLI wrapper at [`operator/adapter/run_prod_smoke_test.py`](../../../operator/adapter/run_prod_smoke_test.py) exits with:

- `0` on `pass`
- `1` on `partial`
- `2` on `fail`

The shell wrapper [`operator/bin/run-connector-smoke-tests.sh`](../../../operator/bin/run-connector-smoke-tests.sh) propagates the exit code and prints a human-readable status line.

## Failure handling at provisioning time

`bin/provision-customer.sh` already invokes the smoke run at Step 8. Today the script logs `WARN` on non-zero exit but continues. The contract this spec locks in is:

- Exit `2` (FAIL) — provisioning MUST abort. Do not flip any skill from `draft_for_review` to `autonomous`.
- Exit `1` (PARTIAL) — provisioning continues but the Captain sees the failure summary before the customer is handed the dashboard. Onboarding renders the partial state with the per-connector failure details so the Captain can decide which capabilities to leave at `refused` until the issue is resolved.
- Exit `0` (PASS) — provisioning continues normally.

Updating `bin/provision-customer.sh` to enforce the abort-on-`2` semantics is a follow-on PR. The framework ships with the contract; the provisioning wiring lands in a separate PR so the abort behavior can be staged separately.

## Periodic invocation

The periodic cron caller invokes the same shell wrapper with the same arguments, but additionally:

- Passes an `AuditLogWriter` wired to the per-customer D1 via `audit_log.writer_from_env()`.
- Logs `partial` as a degradation event in the dashboard alert channel rather than paging.
- On `fail`, fires a P1 escalation per [`refusal-handling.md`](refusal-handling.md) escalation cascade.

Cron schedule, Worker wiring, and the dashboard's "connector health" tile are filed as follow-ons against this spec.

## Audit emission

Each per-connector result with status `fail` or `partial` writes one `CONNECTOR_HEALTH_PROBE_FAILED` audit row via the supplied `AuditLogWriter`. PASS results do not emit — the audit log is the failure record, not a success ping.

The action type is pinned to `CONNECTOR_HEALTH_PROBE_FAILED` because that name is already present in `ACCEPTED_ACTION_TYPES` per [`d1-schema.md`](d1-schema.md) §1. A separate `CONNECTOR_HEALTH_CHECK` event type that records PASS pings would require coordinating with the schema spec and the fabrication-filter consumers; this PR stays within the existing accepted set. The test `test_audit_action_type_is_in_accepted_set` asserts the pinned type remains valid.

Each audit row's metadata block carries:

```json
{
  "capability": "PracticeManagement",
  "adapter": "filevine",
  "backend": "build:filevine-mcp",
  "method": "search_matters",
  "status": "fail",
  "optional": false,
  "elapsed_ms": 312.5,
  "shape_violations": [],
  "error_code": "unauthorized",
  "error_message": "AdapterError: token expired"
}
```

## Probe registration

Each vendor connector package exposes `register_smoke_probes(registry: SmokeProbeRegistry) -> None`. The CLI imports each entry in `_REGISTERED_PACKAGES` (in [`run_prod_smoke_test.py`](../../../operator/adapter/run_prod_smoke_test.py)) at startup. Import failures are logged and skipped — a connector that fails to import surfaces during the run as "no probe registered for <capability>" anyway, which is the right diagnostic.

When a new connector ships, the connector package author MUST:

1. Add `register_smoke_probes(registry)` to the package.
2. Add the package to `_REGISTERED_PACKAGES` in `run_prod_smoke_test.py`.
3. Add a test under that connector's `tests/` directory exercising the probe with the package's existing `FakeHttpClient` (Filevine's mirror is at [`operator/connectors/filevine/tests/_helpers.py`](../../../operator/connectors/filevine/tests/_helpers.py)).

The registry is a per-process object, not a singleton. CLI invocations construct a fresh registry each run; tests construct their own. This makes the framework safe to test against multiple connectors simultaneously without polluting state.

## Non-goals

- **Vendor sandbox testing.** Sandbox-credentialed exercise of an adapter end-to-end lives with the connector (e.g. [`operator/connectors/filevine/bin/smoke-test-filevine.py`](../../../operator/connectors/filevine/bin/smoke-test-filevine.py)). The framework here is the production-tenant regression surface, not the developer sandbox.
- **Full conformance harness re-execution.** The TypeScript conformance harness runs in JS CI against the adapter package; the framework here cross-checks only the shape invariants that can be verified by inspecting a real response.
- **Write-path verification.** Not in scope by design. The framework's purpose is to surface read-path issues before any write capability runs.

## Invariants

The framework enforces three invariants beyond the per-test assertions:

1. **No mutating method ever invoked.** Enforced by the `READ_ONLY_METHODS_BY_CAPABILITY` allowlist + `ProbeRegistrationError` at construction time. Tested by `test_probe_rejects_write_method` and `test_allowlist_contains_no_mutating_method_names`.

2. **Read-only probes.** Smoke probes only ever invoke read methods — they never send, write, or move anything, regardless of a connector's configured send entitlement. Send itself is a configurable entitlement gated at runtime by the trust ceiling (ADR 0035), not banned at the adapter; the smoke framework simply does not exercise it, and additionally refuses to invoke any name from the irreversibility-floor list (`BANNED_METHOD_NAMES`: money movement, ledger posting, court filing) at probe registration time.

3. **Per-customer audit log isolation.** The optional `AuditLogWriter` writes only to the per-customer D1 bound by the calling environment (see [`audit-log-immutability.md`](audit-log-immutability.md) for Worker-layer enforcement). Cross-customer queries are forbidden by binding scope per [ADR 0009](../../adr/0009-cross-machine-query-prohibition.md).

## File map

| File                                                                                                        | Purpose                                                                                     |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [`operator/adapter/connector_smoke.py`](../../../operator/adapter/connector_smoke.py)                       | Framework module: `SmokeProbe`, `SmokeProbeRegistry`, `SmokeReport`, `run_smoke_tests()`.   |
| [`operator/adapter/run_prod_smoke_test.py`](../../../operator/adapter/run_prod_smoke_test.py)               | CLI entrypoint. Loads registered probes, runs `run_smoke_tests`, exits 0/1/2.               |
| [`operator/bin/run-connector-smoke-tests.sh`](../../../operator/bin/run-connector-smoke-tests.sh)           | Shell wrapper for provisioning + cron callers.                                              |
| [`operator/adapter/tests/test_connector_smoke.py`](../../../operator/adapter/tests/test_connector_smoke.py) | 38-test suite covering registration validation, shape conformance, grading, audit emission. |
