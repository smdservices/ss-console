---
title: AI Employee Per-Customer Observability — Compose Existing Specs + Add Sentry, Heartbeat, Fleet View, Alert Routing
date: 2026-05-26
status: accepted
captain: Scott Durgan
supersedes: none
related-prd: docs/pm/ai-employee/platform-prd.md §7.5, §10.1, §15.1, §17.1, §17.4
related-issue: TBD
---

# ADR 0023 — AI Employee Per-Customer Observability

**Status:** Accepted (Captain decision 2026-05-26).

**Source:** Per-customer Fly Machine isolation (ADR 0007) is the runtime architecture, but no ADR ties together what observability looks like across an engagement. Several detailed specs in `docs/specs/ai-employee/` cover individual observability primitives — audit log, retention, cost telemetry, cost rollup, dashboard roles — but they were authored independently and there is no single document naming what composes the stack, what is genuinely new, and which cross-cutting calls are locked.

---

## Context

The AI Employee runs as one Fly.io Machine per customer per [ADR 0007](./0007-per-customer-machine-isolation.md). Observability for that Machine is a product surface: SMD operates the fleet; customers see their own activity through the dashboard; compliance needs immutable audit; the COGS/MRR ratio is the kill-criterion gate per platform-prd.md §17.1. Without a coherent ADR, each new piece (Sentry, fleet view, alert routing) gets designed in a vacuum and risks contradicting or duplicating the existing spec corpus.

The substrate has five existing specs:

- [`audit-log-immutability.md`](../specs/ai-employee/audit-log-immutability.md) (issue #892) — D1 wrapper + Logpush mirror to R2 Object Lock + integrity check. **Pending rehome** to the overlay's `hermes-smd-audit` plugin per [ADR 0015](./0015-hermes-fork-vs-upstream.md).
- [`audit-retention.md`](../specs/ai-employee/audit-retention.md) (issue #893) — per-vertical retention defaults, `memory.retention.audit_log_days` override-up-only rule, decommission audit-log carve-out.
- [`cost-telemetry-events.md`](../specs/ai-employee/cost-telemetry-events.md) (issue #804) — 17 drivers, per-call emission, nightly Worker at `infra/workers/cost-telemetry/worker.ts`, COGS/MRR > 0.40 / two-consecutive-month threshold, Captain CLI `crane ai-employee log-time`.
- [`cost-attribution-rollup.md`](../specs/ai-employee/cost-attribution-rollup.md) (issue #884) — `compute_monthly_rollup` reader contract, nine driver categories, basis-point math.
- [`dashboard-roles.md`](../specs/ai-employee/dashboard-roles.md) (issue #788) — principal / operator / compliance role schema, full permission matrix, `compliance_enabled` opt-in for the dedicated Compliance dashboard.

Two surfaces in `ss-console` are already implemented:

- `src/pages/admin/ai-employee/costs/index.astro` — customer-list page with 30-day COGS, 7-day rolling average, COGS-vs-revenue indicator from `subscriptions.settings_json.monthly_price_cents`, open cost-anomaly alerts via `listOpenAlerts`.
- `src/pages/admin/ai-employee/costs/[customer_slug].astro` — per-customer drill-down.

Plus an existing anomaly-detection helper: `src/lib/admin/cost-anomaly.ts` (`listOpenAlerts`) and `src/lib/admin/cost-query.ts` (`listCostCustomers`, `fetchCustomerCostRows`, `cogsRatio`).

What is missing is:

1. A coherent statement of which existing specs compose the per-customer observability stack.
2. Four genuinely-new pieces that no existing spec covers: Sentry on Machines, `/health` + push heartbeat, fleet roll-up extension of the existing customer-list page, alert routing that composes with the existing cost-anomaly system.
3. Locked Captain decisions on vendor ownership, cost-breach response, and substrate shape.

## Decision

The per-customer observability stack is composed from existing specs (cited, not redesigned) plus four new pieces (introduced here). Cross-cutting Captain decisions are locked below.

### Composed from existing specs

| Layer | Owner | Status |
|---|---|---|
| Audit truth substrate | `audit-log-immutability.md` (post-rehome to `hermes-smd-audit`) | spec done; implementation pending #892 + ADR 0015 rehome |
| Audit retention policy | `audit-retention.md` | spec done |
| Cost telemetry emission | `cost-telemetry-events.md` | spec done; instrumentation tagged Phase 2 |
| Cost rollup + COGS/MRR computation | `cost-attribution-rollup.md` | spec done; v1 on-demand reader |
| Customer-facing dashboard surfaces (Today / Queue / Memory / Audit / Persona / Skills / Voice tabs) | `dashboard-roles.md` | spec done; multi-role v1 ships beta-1 |
| Per-customer cost drill-down at `/admin/ai-employee/costs/{customer_slug}` | `cost-telemetry-events.md` §Per-customer rollup view | implemented |
| Customer-list / COGS overview at `/admin/ai-employee/costs/` | issue #885 | implemented |
| Cost-anomaly alert detection (`src/lib/admin/cost-anomaly.ts`, `listOpenAlerts`) | (predates this ADR) | implemented |

### Introduced by this ADR

**1. Sentry on AI Employee Machines.** One shared `smd-ai-employee` Sentry project; DSN pushed as a Fly secret at provision time (same mechanism as Anthropic / Composio per [ADR 0010](./0010-per-customer-oauth-token-storage.md)). The AI Employee bootstrap reads `customer.yaml` (via the same path used by `hermes-smd bootstrap` per [ADR 0019](./0019-customer-yaml-storage.md) / `0019` equivalent) and initializes the Sentry SDK with a scope tag `tenant=<slug>`.

The marketing-site reference pattern is `src/lib/observability/sentry.ts` (a `withSentryRequestHandler` wrapper using `@sentry/cloudflare@^10.51.0`), invoked from `src/middleware.ts:255`. **That is a TypeScript-for-Workers pattern; the AI Employee Machines are Python, so the implementation uses the `sentry-sdk` Python package, not `@sentry/cloudflare`.** The marketing site is conceptual reference, not code reuse. The Python init lives in `venturecrane/hermes-smd-overlay` per [ADR 0015](./0015-hermes-fork-vs-upstream.md) — that repo is not in the `ss-console` workspace; implementation lands in a separate PR there.

SMD ops configures Sentry alert rules in Sentry UI per customer. No auto-provisioning from `customer.yaml` in v1.

**2. `/health` endpoint + push heartbeat contract.** Each Machine exposes an internal-only `/health` returning:

```json
{
  "last_audit_ts": "...",
  "last_skill_ts": "...",
  "heartbeat_ts": "...",
  "process_uptime_seconds": ...,
  "version": "..."
}
```

`heartbeat_ts` is written by a 30-second internal ticker, independent of any traffic. A background task on the Machine POSTs to its assigned healthchecks.io URL every 60 seconds. Healthchecks.io grace expiration fires a webhook to the alert-router.

`/health` is reachable only via Fly's private network — it is not exposed publicly. The grace and period are configurable per customer via `customer.yaml.observability.health`.

**3. Fleet roll-up view — extends the existing customer-list page.** `src/pages/admin/ai-employee/costs/index.astro` already enumerates every AI Employee customer with COGS metrics. The fleet roll-up extends this page with three new columns:

- Heartbeat status (green / yellow / red, derived from the most recent `fleet_status` row for that customer).
- Sentry error count last hour (tenant-tagged, queried via Sentry API).
- Uptime-since-last-restart.

Per-customer drill-down to `costs/[customer_slug].astro` is unchanged.

Adds a new D1 table `fleet_status` in `ss-console`'s D1 (`env.DB`) — not per-customer — written by Machines via authenticated HTTP, read by this page. [ADR 0009](./0009-cross-machine-query-prohibition.md) §"Out of scope" explicitly permits this control-plane cross-customer aggregation for "fleet health."

No separate `/admin/ai-employee/fleet` page.

**4. Alert routing — composes with the existing cost-anomaly system.** A `customer.yaml.observability.alert_webhook` field (optional; SMD-default Telegram channel if absent — bot token stored in Infisical, populated at Worker deploy as a Cloudflare Worker secret). Telegram is the pinned default because it accepts arbitrary text payloads; alternative destinations (Slack / PagerDuty / email) would require shape negotiation in a follow-on.

The router has two distinct surfaces:

- **Push (webhook receiver Worker).** Sentry's native alert rules POST here; healthchecks.io POSTs on grace expiration. No custom Sentry threshold is invented in this ADR — Sentry's native rate-of-change and frequency rules are the configuration surface, owned per-customer by SMD ops in Sentry UI. **Operational gotcha at scale**: per-customer alert rules in Sentry are configured manually; manageable at five customers, painful at fifty. Auto-provisioning Sentry rules from `customer.yaml` is a follow-on triggered by customer-count scale.

- **Pull (cron consumer Worker).** A scheduled Worker reads `audit_log_integrity` reports (post-rehome) and emits Captain alerts. The **existing cost-anomaly subsystem** (`src/lib/admin/cost-anomaly.ts` + `listOpenAlerts`) already handles COGS/MRR threshold detection and persists alert rows; this ADR adds an outbound-webhook step that posts unacknowledged anomalies to `alert_webhook`. The router does NOT reinvent the anomaly-detection logic.

Both surfaces route outbound to the same `alert_webhook` destination via the same Worker entry, with a `source` field in the payload so Telegram messages are distinguishable.

**5. Fly resource metrics (not new, named explicitly).** Per-Machine CPU, memory, disk, network, and restart count come from Fly's hosted Grafana + Prometheus endpoint. SMD ops bookmark the Fly Grafana view per Machine; nothing in SMD's stack duplicates these signals. Listed here as a layer of the observability stack so the ADR does not leave the resource-metrics gap silent.

### Cross-cutting calls locked

1. **SMD-managed vendor accounts** (Captain decision 2026-05-26). Single Sentry org, single healthchecks.io account, SMD-owned per-customer R2 buckets (Object Lock per `audit-log-immutability.md`). Customer-owned vendor accounts deferred to a follow-on ADR triggered by real demand (premium tier or compliance posture).

2. **Alert-only on COGS/MRR breach** (Captain decision 2026-05-26). The existing > 0.40 / two-consecutive-month threshold from `cost-telemetry-events.md` is the trigger. This ADR adds: alerts route to `alert_webhook`; Captain decides per-incident (re-scope, eat cost, talk to client). No automatic disabling of the AI Employee. Auto-disable / soft-cap / hard-cap mechanisms are explicitly out of scope.

3. **Shared Sentry project, tenant tag at SDK init** — not per-customer Sentry projects. Isolation comes from tag scoping; query filters on `tenant=<slug>` to surface per-customer error streams.

4. **Healthchecks.io for heartbeats**, not self-hosted. The outside-the-trust-boundary property matters more than minimizing vendor count.

5. **Retention defaults inherited from `audit-retention.md`** §"Per-vertical defaults" — `law-firm`, `real-estate`, `manufacturing`, `insurance`, and `mixed` default to 2555 days (7 years); `marketing-agency` defaults to 1095 days (3 years). Override-up-only enforcement is already specified. This ADR does not introduce new retention defaults.

6. **Audit-log substrate rehome is a prerequisite for the audit layer only**, not for the whole ADR. The `audit-log-immutability.md` rehome to `hermes-smd-audit` per [ADR 0015](./0015-hermes-fork-vs-upstream.md) gates the audit-immutability + Logpush-mirror pieces. Sentry, `/health`, healthchecks.io, fleet view, and alert routing are independent — they can ship before the rehome lands. This ADR's implementation proceeds in two waves:

   - **Wave 1 (pre-rehome).** Sentry on Machines, `/health` + heartbeat, fleet view extension, alert routing (with audit-integrity ingestion stubbed).
   - **Wave 2 (post-rehome).** Audit-log Logpush wiring per #892, against the rewritten spec; alert routing wires the audit-integrity report consumer.

7. **Fly's native observability is the resource-metrics substrate.** No SMD-hosted Prometheus stack; no duplicate metrics pipeline. Fly's free tier covers what this ADR needs.

8. **Healthchecks.io heartbeats are push-from-Machine, not pull.** The Machine emits an outbound POST to its assigned healthchecks.io URL every 60 seconds. Push direction means the Machine declares liveness; pull would require exposing `/health` publicly and trusting the responder.

### customer.yaml additions

The existing `logging:` block (`level`, `ship_to`) handles application stdout/stderr destinations — it is unchanged and orthogonal to this addition. `memory.retention.audit_log_days`, `compliance_enabled`, role-related fields, and connector OAuth scope declarations also stay unchanged. The new `observability:` block is parallel to `logging:` and covers vendor wiring only:

```yaml
observability:
  sentry:
    enabled: true                 # default; shared SMD project, tenant-tagged at SDK init
  health:
    period_seconds: 60            # push cadence to healthchecks.io
    grace_minutes: 5              # late before alert fires
  alert_webhook: <url>            # optional; SMD-default Telegram bot channel if absent
```

Sentry error-spike thresholds are NOT in `customer.yaml` — they are owned by Sentry's native alert rules, configured per-customer in Sentry UI by SMD ops. Auto-provisioning from `customer.yaml` is a follow-on triggered by customer-count scale.

No customer-owned vendor fields. Adding them is a follow-on ADR.

## Consequences

**Positive.**

- Per-customer observability is composable rather than reinvented: every layer points at an existing spec or a small new piece, not a parallel substrate.
- Provisioning (`bin/provision-customer.sh`) ends up as a single linear script: stage Sentry DSN, create healthchecks.io check, seed `fleet_status` row, render `fly.toml`, deploy. Decommission reverses cleanly with the existing nine-step pipeline.
- Wave-1 work ships independently of the audit-log rehome; the ADR does not block Sentry, `/health`, fleet view, or alert routing on out-of-tree work.
- The fleet view drops into the existing customer-list page, preserving the drill-down and avoiding a new admin surface that would have its own auth and IA decisions.
- Alert routing composes with the existing `listOpenAlerts` system rather than duplicating cost-anomaly detection logic.
- Telegram as the default `alert_webhook` keeps the SMD-side mechanic single-channel and Captain-readable on mobile; the field stays optional so customers who want their own destination can override.

**Negative / accepted.**

- SMD operates more vendor accounts (Sentry, healthchecks.io, per-customer R2 buckets, Telegram bot). Vendor sprawl is real; the trade is centralized account hygiene vs. per-customer provisioning complexity. We accept.
- Sentry alert rules are configured manually per customer in Sentry UI. Manageable for the first few customers; at ~50 customers this becomes an operational burden, triggering an auto-provisioning follow-on.
- The fleet view depends on a Machine-to-control-plane HTTP write per heartbeat. A control-plane outage degrades the fleet view but does not affect Machine operation. We accept.
- `fleet_status` is a control-plane table that crosses customer boundaries by design. [ADR 0009](./0009-cross-machine-query-prohibition.md) explicitly permits this for fleet health; the choice is auditable but worth re-stating loudly here.
- Wave 1 ships without audit-log Logpush. The audit log still writes to per-customer D1 (the immutability invariant in `audit-log-immutability.md` Layer 1 holds via the Worker wrapper), but the tamper-resistant R2 mirror is deferred to Wave 2. We accept; the marginal compliance posture between "D1-only" and "D1 + Logpush mirror" is small for the pre-customer-zero window.

**Out of scope.**

- Cost telemetry schema, drivers, COGS/MRR computation — owned by `cost-telemetry-events.md` and `cost-attribution-rollup.md`.
- Audit log immutability or retention — owned by `audit-log-immutability.md` (post-rehome) and `audit-retention.md`.
- Dashboard role / permission matrix — owned by `dashboard-roles.md`.
- Audit-log-immutability rehome to `hermes-smd-audit` — prerequisite, separate spec rewrite + PR in the overlay repo.
- Logpush mirror implementation (#892) — prerequisite, lands with the rehome.
- Customer-owned vendor accounts (premium / compliance tier) — follow-on ADR triggered by real demand.
- Cost enforcement / auto-disable mechanisms — Captain decision is alert-only.
- Time-machine retrospect (`ADR 0022` design intent locked; implementation deferred).
- Pricing / packaging of observability costs — folded into AI Employee retainer math (`ADR 0004`), not here.
- Auto-provisioning Sentry alert rules from `customer.yaml` — follow-on triggered by customer-count scale.

## Implementation

### Wave 1 — pre-rehome (independent of audit-log rehome)

**Spec updates:**

- `docs/specs/ai-employee/customer-yaml-schema.md` — add the `observability:` block above (parallel to existing `logging:`).

**Overlay repo (`venturecrane/hermes-smd-overlay`):**

- `sentry-sdk` (Python) init at boot with `tenant=<slug>` scope tag.
- Internal `/health` endpoint exposing `{ last_audit_ts, last_skill_ts, heartbeat_ts, process_uptime_seconds, version }`.
- 30-second internal heartbeat ticker.
- 60-second healthchecks.io push task.

**`ss-console` repo:**

- `ai-employee/bin/provision-customer.sh` — stage shared Sentry DSN secret to Fly app secrets; create healthchecks.io check via API (auth: project API key from Infisical); seed a `fleet_status` row in `env.DB`.
- `ai-employee/bin/decommission-customer.sh` + `ai-employee/bin/lib/decommission.py` — unstub: cancel healthchecks.io check; remove `fleet_status` row.
- New: D1 migration adding `fleet_status` table (control-plane, in `env.DB`).
- Extend: `src/pages/admin/ai-employee/costs/index.astro` — add three new columns (heartbeat status, Sentry errors last hour, uptime).
- New: alert-router Worker — push-surface webhook receiver (Sentry + healthchecks.io inbound); pull-surface cron consumer composing with `listOpenAlerts` from `src/lib/admin/cost-anomaly.ts`. Outbound to `alert_webhook` (Telegram default).

### Wave 2 — post-rehome (gates on audit-log-immutability rehome)

- `docs/specs/ai-employee/audit-log-immutability.md` — rewrite against post-ADR-0015 architecture (overlay-side `hermes-smd-audit` plugin).
- Wire #892 (Logpush mirror) in the overlay.
- Alert-router pull surface adds `audit_log_integrity` report consumer.

### Existing utilities reused

- `src/lib/observability/sentry.ts` — marketing-site Sentry helper (conceptual reference; not code-reusable across the Python boundary).
- `src/lib/admin/cost-anomaly.ts` + `listOpenAlerts` — anomaly detection.
- `src/lib/admin/cost-query.ts` — `listCostCustomers`, `fetchCustomerCostRows`, `cogsRatio`, `thirtyDayCogsToMonthlyEstimateCents`.
- `subscriptions.settings_json.monthly_price_cents` — existing MRR source.
- `compute_monthly_rollup` from `ai-employee/adapter/cost_rollup.py`.
- `audit_log_integrity` from `ai-employee/adapter/audit_log_integrity.py` (post-rehome).
- `crane ai-employee log-time` CLI.

## Verification

### Wave 1

1. **Provisioning** — `bin/provision-customer.sh --dry-run synthetic-test` shows the staged shared Sentry DSN secret, a created healthchecks.io check URL, and a `fleet_status` seed row.
2. **Liveness** — boot Machine; internal `/health` returns 200 with timestamps; 60s push tick lands at healthchecks.io; check flips green within 2 grace windows.
3. **Error tagging** — fire a deliberate unhandled exception; Sentry event arrives scope-tagged `tenant=synthetic-test`; filter by another tenant shows nothing.
4. **Resource metrics** — Fly Grafana view for the Machine renders CPU / memory / disk / network; SMD ops bookmark URL works.
5. **Cost emission** — drive 100 mocked Anthropic calls per `cost-telemetry-events.md` verification suite; `cost_telemetry` rows appear; `compute_monthly_rollup` reads them back; COGS/MRR computation matches expected.
6. **Alert routing — pull surface** — synthetic COGS/MRR breach (seeded cost rows + rollup) fires alert to the configured `alert_webhook`.
7. **Alert routing — push surface** — Sentry alert rule fires test webhook; healthchecks.io test-fail fires webhook; both land at `alert_webhook` with distinguishable `source` payloads.
8. **Fleet view** — extended `/admin/ai-employee/costs/` page shows synthetic-test with new heartbeat / error / uptime columns; kill Machine; heartbeat column flips to red within grace window; drill-down to existing `/admin/ai-employee/costs/{customer_slug}` works unchanged.
9. **Decommission** — `bin/decommission-customer.sh synthetic-test` completes all nine steps; healthchecks check cancelled; `fleet_status` row removed.

### Wave 2

10. **Audit immutability** — insert audit row via writer; R2 Object Lock bucket contains the mirror row within Logpush window; UPDATE / DELETE against `audit_log` raises `AuditLogImmutabilityError`; periodic integrity check reports clean.
11. **Audit-immutability alert routing** — seed an `IN_MIRROR_NOT_IN_D1` finding; alert fires to `alert_webhook`.
12. **Decommission audit carve-out** — `bin/decommission-customer.sh` preserves audit log per `audit-retention.md` carve-out; R2 audit bucket retained per retention policy.

## References

- [ADR 0007](./0007-per-customer-machine-isolation.md) — per-customer Machine isolation
- [ADR 0009](./0009-cross-machine-query-prohibition.md) — cross-Machine query prohibition; control-plane carve-out
- [ADR 0010](./0010-per-customer-oauth-token-storage.md) — per-customer OAuth token storage; SMD-secret push mechanism
- [ADR 0015](./0015-hermes-fork-vs-upstream.md) — Hermes fork posture; overlay-only code surface
- `docs/specs/ai-employee/audit-log-immutability.md` — audit-log immutability (pending rehome)
- `docs/specs/ai-employee/audit-retention.md` — retention defaults, override-up-only, decommission carve-out
- `docs/specs/ai-employee/cost-telemetry-events.md` — cost telemetry emission, COGS/MRR threshold
- `docs/specs/ai-employee/cost-attribution-rollup.md` — monthly rollup contract
- `docs/specs/ai-employee/dashboard-roles.md` — principal / operator / compliance role schema
- `docs/specs/ai-employee/customer-yaml-schema.md` — customer.yaml formal schema
- Platform PRD §10.1, §15.1, §17.1, §17.4
