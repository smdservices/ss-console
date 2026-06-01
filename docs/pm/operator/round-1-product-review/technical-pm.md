# Technical PM Perspective — Round 1

**Author:** technical-pm (operator-product team)
**Date:** 2026-05-20
**Lens:** Engineering feasibility — can this team actually build this, and at what unfunded cost?
**Sources:** platform-prd.md, law-firm-prd.md, prior `technical-lead.md`, `synthesis-round-1.md`, PR #831 specs, PR #812 source, PR #832 ADRs 0005-0009, PR #829 hermes runbook, ADR 0004, CLAUDE.md.

---

## Stance

**REFINE.** Architecture is sound, ADRs 0005-0009 lock the load-bearing decisions, and PR #831 specs plug the worst gaps the prior tech-lead critique surfaced. But three buried infeasibilities make the §20 Phase 1 commitment fictional at the pace it implies, and the gap between "PR #812 ships" and "configurable, multi-tenant, paying-customer-ready product" is materially larger than synthesis-round-1 acknowledges. Direction stays; calibration on effort, the Hermes integration risk, and what counts as "Phase 1 done" needs to change before the next four weeks are planned.

## What's right

- **Capability-adapter pattern (ADR 0006).** M×N math is correct; the validator already enforces backend-prefix discipline (`composio:` / `mcp:` / `build:` / `synthetic:`). A platform without this cannot ship vertical #3.
- **Per-customer Fly Machine isolation (ADR 0007).** Keeps blast radius small, makes "no cross-customer query" enforceable at the network layer, lets cost telemetry land naturally on Machine naming. `r2-vectorize-naming.md` + `decommission-drain.md` codify prefix and deletion ordering.
- **Pre-output safety substrate (invariants #6 + #8 as runtime filters, not skills).** Avoids the circularity the prior critique caught. `safety-substrate/run_invariants.py` runs `--strict` at boot; `citation_filter.py` ships with adversarial fixtures; `fabrication-filter.md` correctly treats #8 parallel to #6.
- **Reviewer-as-sender (ADR 0005) carries through to OAuth scopes.** `oauth-lifecycle.md` excludes `Mail.Send` / `gmail.send` — architectural enforcement of P2 at the grant layer. A security reviewer can confirm by inspection that the agent literally cannot send.
- **Trust-ceiling enforcement design is sound _as designed_.** `trust_ceiling.py:enforce()` returns `allow | draft | refuse`; action-class taxonomy (`READ` / `INTERNAL_WRITE` / `EXTERNAL_SEND` / `COMMITMENT` / `DESTRUCTIVE`) covers invariants #1-#3. Testable in isolation. _Wiring it to Hermes is different — see #1 below._

## What's wrong

### 1. Hermes integration risk is materially understated everywhere except the Hermes runbook. (HIGH)

`aie_adapter.py:register()` is a stub. The runbook §3 names the actual problem: **Hermes v2026.5.7 has `agent/tool_guardrails.py` and per-provider adapters but no `agent/tool_router.py`** — the hook surface `aie_adapter.py`'s docstring assumes does not exist. Concretely: trust-ceiling enforcement for tool calls is not wired (`trust_ceiling.enforce()` is unit-testable, nothing calls it inside Hermes' dispatch loop); sticky-stop survival across compaction has no handler; per-tool-call audit logging has no emission point. A demo claiming "trust ceiling enforced in code" is not yet true. Runbook estimate is 2-4 days _if the upstream seam is findable_; if Hermes requires forking, this becomes 1-2 weeks plus permanent maintenance on every version bump. Largest gap between PR #812 and the §20 phase commitments.

### 2. Provisioning script doesn't match the spec's surface, and the gap is load-bearing. (HIGH)

`provision-customer.sh` does: validate, render `fly.toml`, create Fly app + volume, stage three tenant-wide secrets, deploy, smoke. It does **not**: provision D1 / R2 / Vectorize resources (validator only checks keys exist, not resources); inject per-customer Infisical paths (`oauth-lifecycle.md` specifies `/ai-employee/{slug}/{connector}/refresh_token`); build the OAuth consent endpoint (ambiguity #4). What ships provisions a chat-only Hermes container. What the v1 PRD describes provisions a multi-substrate, OAuth-wired, audit-logging customer instance. Different work.

### 3. Composio per-connection isolation is unresolved and silently undermines per-customer isolation. (HIGH)

Provisioner stages one tenant-wide `COMPOSIO_API_KEY`. Customer.yaml declares `backend: composio:gmail`; no connection-ID enforcement in validator. ADR 0009 asserts no cross-customer data flow — but if two customers share one Composio API key and connection IDs aren't strictly scoped, a misconfigured call from customer A's Machine can in principle read customer B's mailbox. The PRD treats Composio as managed; the security boundary depends on Composio's per-connection scoping, which is neither documented nor enforced. Most plausible cross-customer-leakage vector, invisible in existing critique.

### 4. NFRs claimed at demo level but not instrumented. (MEDIUM)

§16.2 commits to P95s (connector swap ≤30s, voice draft ≤8s, promotion ≤2s). None instrumented. No latency spans emit from Hermes' tool dispatch (none can — see #1). The `fly status` smoke check confirms "machine started," not response latency. A real customer at 150 drafts/week has different P95s than rehearsal with no leading indicator. §17.3 SKU margin cannot be defended without latency alongside cost.

### 5. Vendor concentration on Anthropic + Composio + Fly with no second-source story. (MEDIUM)

Single-vendor LLM dependency (Hermes ships multi-provider adapters but customer-zero pins Claude only). Composio shutter or 10x pricing blows the connector strategy. Fly 24-hour outage during a customer's first week collapses both §17.1 approval-rate metric and trust. §18 Risks table does not enumerate vendor-shutdown scenarios.

### 6. Skill-loader workaround inflates token cost not reflected in §15.1 profiles. (MEDIUM)

Front-loading voice rules in SKILL.md description adds 1,000-2,800 tokens/invocation at 5-7 active skills. Medium profile (50 drafts/week) under-models by ~250k tokens/month — material against Opus pricing at the 40% COGS ceiling. Synthesis Theme 18 says 1-2 days to fix; optimistic if the loader misbehavior is the same upstream-surface issue as #1.

### 7. Audit-log immutability is application-enforced, not architectural. (MEDIUM)

D1 has no per-role permissions. "Immutability" = "we don't write DELETE statements." Ambiguity #5 parks Logpush mirror as undecided; not in any Phase 1 deliverable. At the PI meeting, ethics counsel asking "can the operator alter the audit log?" gets "application discipline" rather than "architecturally append-only." Distinction matters to a 20-year partner.

## What's missing

**Infrastructure:** customer-facing dashboard (§12 specifies 7 V1 tabs; no frontend in PR #812; `mobile-approval-flow.md` describes screens that don't exist); OAuth callback endpoint at `admin.smd.services/operator/oauth/{connector}/callback`; `bin/decommission-customer.sh` and `bin/reauth-connector.sh` (specs exist, scripts don't); Captain CLI for ops time logging; Microsoft Graph / DocuSign / QuickBooks / CourtListener / one PM adapter — most Tier-0 not wrapped.

**Operational tooling:** pre-commit hook for `customer.yaml` secret-exclusion; CI gate for cross-Machine query violation; synthetic-fixture loader for demo provisioning; cost dashboard at control plane; scheduled audit-retention cleanup.

**Test coverage:** no integration test runs a tool call through the adapter end-to-end (adapter is a stub); no adversarial fixtures for invariant #8; no regression bed for skill version pinning (all `version: pending`); no load test at 150-drafts/week Heavy profile.

**Observability:** no P95 latency dashboard for §16.2; no connector-health surface (failure_recipients email alone is not enough); no infrastructure runs the §9.6 quarterly adversarial AI-detection sample.

## Top 10 technical risks ranked

1. **Hermes adapter integration gap.** Spike 1 dev-day to find real Hermes seam (`tool_guardrails.py` + cron/MCP loop). If <1 week to wire, ship; else fork or scope down the claim.
2. **Composio per-connection isolation unverified.** Sandbox-test two customers' Composio sessions; document model; consider per-customer API keys.
3. **D1/R2/Vectorize provisioning unwired.** Add Cloudflare-API steps to `provision-customer.sh`. 2-3 dev-days.
4. **OAuth refresh failure path untested in prod.** Build `reauth-connector.sh`; integration-test expired-token scenario before week 3.
5. **Vendor concentration on Anthropic/Composio/Fly.** Stress-test cost model at 2x token price; multi-provider fallback ADR.
6. **Dashboard frontend missing entirely.** Add as named Phase 1 deliverable. 3-4 dev-weeks for 7 tabs against the Astro scaffold.
7. **Audit-log application-enforced, not architectural.** Wire Cloudflare Logpush to append-only sink. 1 dev-day.
8. **Skill-loader workaround inflates token cost.** Re-bake §15.1 with overhead included; ship loader fix if small.
9. **No latency instrumentation.** OpenTelemetry spans at tool-call boundaries; surface in Captain dashboard alongside cost.
10. **Skill content-hash pinning is `pending`.** Lock to real SHAs before customer-zero leaves chat-only mode.

## Effort reality check

**Currently complete or near-complete:** validator + schema discipline (partial); safety substrate boot gate (invariants 1-6); Hermes container build + Fly deploy; one real connector (LawPay); ~8 skill scaffolds + 1 real skill at version pending; PI synthetic fixtures (200); ADRs 0005-0009 locked; P0+P1 specs (14, ~80% of contracts).

**Remaining work to "configurable, multi-tenant, paying-customer-ready"** (dev-days): Hermes adapter wiring 4-8 (assumes seam findable); D1/R2/Vectorize provisioning 2-3; Microsoft Graph 5-7; DocuSign + QuickBooks + CourtListener + one PM adapter 12-17; dashboard frontend 15-20; OAuth callback + `reauth-connector.sh` 3-4; `decommission-customer.sh` 2-3; pre-commit + CI gates 1-2; cost telemetry emission 3-4; voice-gate infrastructure 4-5; fabrication filter runtime 2-3; latency instrumentation 3-4; audit-log Logpush 1; demo fixture loader 2-3; skill version hash lock 2.

**Total: 60-90 dev-days** against one Captain operator, bus-factor-of-one, no named backup. At realistic 3-4 dev-days/week with context switching: **5-7 calendar months.**

PI firm meeting is 2-3 weeks away. What credibly ships by 2026-06-02 is the **runbook's recommendation**: Hermes boots, safety substrate enforces, Captain demos `hermes chat` against synthetic PI data, honest framing on "code-enforced ceiling lands next sprint." What cannot: dashboard, full connector floor, audit log surface, voice-gate blind-test, real customer provisioning, COGS modeling.

**Recommendation: split §20 Phase 1 into two phases.**

- **Phase 1A — Customer-zero + demo-ready (2-3 weeks):** Hermes boots; Captain demos against synthetic data; safety substrate firm; honest Phase A.5 framing. Aligns with runbook scope for 2026-06-02.
- **Phase 1B — First paying customer provisionable (8-12 weeks post-meeting):** Dashboard, real connectors, OAuth lifecycle, decommission, cost telemetry, voice-gate. Gated on beta-1 sign per the §0 venture-priority constraint.

This keeps architecture commitments intact while making the build commitment achievable in the bus-factor-of-one model.

---

_End of Technical PM contribution — Round 1._
