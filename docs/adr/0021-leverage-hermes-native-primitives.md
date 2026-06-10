---
title: Leverage Hermes Native Primitives — execute_code, delegate_task, no-agent cron, skill bundles, webhook gateway, MCP-first connector retirement
date: 2026-05-25
status: accepted
captain: Scott Durgan
supersedes: none
related-spec: docs/specs/operator/customer-yaml-schema.md
related-issue: TBD (parent tracking issue filed alongside this ADR)
---

# ADR 0021 — Leverage Hermes Native Primitives

**Status:** Accepted (Captain decision, 2026-05-25).

**Source:** A focused review of the Hermes Agent documentation
(`hermes-agent.nousresearch.com/docs/llms.txt`, May 2026) against the current
state of the Operator codebase after the 2026-05-24 realignment (ADRs
0015–0020). The review identified six concrete capabilities that Hermes ships
natively and that SMD's product would benefit from but does not yet leverage.

## Context

The 2026-05-24 realignment correctly inverted from "build parallel to Hermes"
to "trust Hermes substrate, mirror don't gate, build only what Hermes won't."
That inversion produced the pin-only fork posture (ADR 0015), the Honcho
disposition (0016), the Curator disposition (0017), the per-profile config
translation (0019), and the MCP-first connector strategy (0020).

It did not address six leverage gaps in how SMD's skills, customer.yaml
schema, and connector code use Hermes' tool surface:

1. **Skill procedures are sequential single-agent recipes.** Four batch-loop
   skills (`inbox-triage`, `retainer-hours-reconciler`,
   `status-report-assembler`, `ar-chaser`) make 10–100 tool calls per run, all
   in the conversation context. Hermes ships `execute_code` — a Python child
   process with RPC tool access — that collapses these into a single inference
   call with no intermediate context bloat.

2. **Cron-scheduled watcher skills always wake the LLM.** `paid-media-anomaly-watcher`
   polls daily; `retainer-hours-reconciler` weekly. Both fire a full agent
   session even when the polling pass finds nothing actionable. Hermes cron
   supports a pre-run script emitting `{"wakeAgent": false}` to skip LLM
   inference when nothing changed.

3. **Compound research workflows don't parallelize.** Three law-PI skills
   (`law-pi-demand-letter-draft`, `law-pi-discovery-response`,
   `law-pi-settlement-prep`) have natural parallel sub-tasks (medicals,
   liability, damages) executed sequentially today. Hermes `delegate_task`
   spawns up to three concurrent isolated subagents with restricted toolsets,
   returning only summaries to the parent — purpose-built for this shape.

4. **Multi-step workflows require N skill invocations.** PI intake is
   `law-pi-intake-triage` then `law-conflict-check`; matter prep is
   `law-pi-demand-letter-draft` then `law-pi-settlement-prep`. Hermes ships
   skill bundles (`~/.hermes/skill-bundles/<slug>.yaml`) that compose multiple
   skills under one slash command. The customer.yaml schema doesn't yet
   declare bundles.

5. **Inbound system events aren't wired to skill triggers.** Filevine, Clio,
   and Microsoft Graph all expose webhook subscriptions for matter-created,
   activity-logged, and mailbox-change events. The current connectors are
   pull-only. Hermes' gateway exposes `pre_gateway_dispatch` which can route
   inbound webhook payloads to skill invocations.

6. **The `ms_graph` BUILD connector predates Microsoft's official Graph MCP
   server.** ADR 0020 directs us to MCP-first; the BUILD adapter was justified
   when Microsoft's MCPs hadn't shipped. They've now shipped, and continuing
   to maintain the BUILD adapter contradicts the rule we set in 0020.

## Decision

**SMD will close all six gaps via documented Hermes capabilities, in a
single cross-repo fleet pass landing in waves over the next sprint.** No new
architectural primitives. No modifications to Hermes core. Every change maps
to a capability documented at `hermes-agent.nousresearch.com/docs` and verified
against the upstream source.

### Six work streams

| Stream | Capability                                                  | Change                                                                                                                                                                                                                                            |
| ------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | `execute_code`                                              | Rewrite four batch-loop skills to use a single Python `execute_code` block                                                                                                                                                                        |
| B      | No-agent cron (`{"wakeAgent": false}`)                      | Two watcher skills get pre-run scripts with arithmetic-only polling                                                                                                                                                                               |
| C      | `delegate_task`                                             | Three compound-research PI skills parallelize sub-tasks into 3 named subagents                                                                                                                                                                    |
| D      | Skill bundles + `customer.yaml.personas[].bundles[]`        | Three workflow bundles authored; schema extended                                                                                                                                                                                                  |
| E      | `pre_gateway_dispatch` + `customer.yaml.webhook_triggers[]` | Filevine + Clio subscribe(); overlay routes events to skills                                                                                                                                                                                      |
| F      | MCP-first                                                   | Customer.yaml templates bind Email/Calendar/DocumentStorage to MCP (PR #1081). The `operator/connectors/ms_graph/` BUILD adapter was already deleted in #1065 (pre-Wave-2 realignment), so the Wave-4 "removal PR" is documentation cleanup only. |

The exhaustive scope, file paths, dispatch waves, and verification criteria
live in the plan document at `~/.claude/plans/vectorized-prancing-dove.md`
(not committed; the parent tracking issue contains the rolled-up scope for
the team's view). Updates to this ADR reflect material decisions; the
sequencing artifact does not need to ship as a repo doc.

### Two safety constraints added per critique

- **`pre_run.py` MUST emit an audit row on every run**, including the silent
  path. A new `audit_action="suppressed_wake"` row captures the polling
  inputs digest, decision basis, and next scheduled run. Audit-write failure
  forces fallback to `wakeAgent: true`. Otherwise the optimization is
  structurally indistinguishable from "pre_run.py silently broke" — a
  violation of the mirror-don't-gate principle 0016 codified.

- **`delegate_task` parent skills MUST enforce an assembly-time schema
  contract** on each subagent's return before assembling the parent draft.
  Missing/empty required keys emit `audit_action="subagent_incomplete"` and
  the parent refuses to assemble. An approver never sees a quietly
  incomplete draft. Each Stream-C skill ships a fault-injection test fixture
  forcing one subagent to return `{}` and asserting the parent refuses.

## Alternatives Considered

### Status quo (do none of this)

The current product works. Customer-zero (SMD's own inbox triage) operates
without these optimizations. Skipping reduces near-term execution risk.

**Rejected.** Token cost on `inbox-triage` against a 25-message fixture is
~100 tool calls × full context, which scales linearly per customer. At 10
customers running daily, the avoidable cost is material before we have proven
revenue offsetting it. The compound-PI skills' wall-clock latency hurts
demo quality. The skill-bundle UX gap is visible on every PI intake. Doing
nothing locks in a cost+latency posture we'll regret when we have customers.

### Migrate the trust-ceiling drafts queue to `pre_approval_request`

Hermes ships a native approval system with timeout, audit, and per-pattern-key
dedup via `pre_approval_request`/`post_approval_response` hooks. The current
`trust_ceiling.py` produces `audit_action="draft"` and the overlay writes to
a custom drafts queue. Switching to the native system would eliminate the
custom queue.

**Filed as Overlay-5 follow-on, not in this plan.** The existing drafts queue
works and the migration touches the overlay's `hermes-smd-trust` plugin deeply.
Decision packet first; migration follows in a separate plan once the
cost-benefit lands.

### Multi-persona Kanban orchestration

Hermes' Kanban primitive provides durable SQLite task-board coordination
between profiles. SMD has multi-persona ADR 0011 supporting `personas[]`
length ≥ 1 at v1.

**Out of scope for this plan.** ADR 0011 sets `personas[]` length=1 in
practice at v1; Kanban is the right substrate when SMD grows to length ≥ 2.
Filed as a future plan when a customer engagement actually requires multi-persona.

### Retire `lawpay`, `filevine`, `clio` BUILD adapters to MCP

Per the same ADR 0020 logic applied to `ms_graph`.

**Not done.** No acceptable MCP available for these PI-vertical connectors
per the most recent Composio + community catalogs. PI-vertical specificity
matters; the trust-account write paths on LawPay are safer to own end-to-end.
Re-evaluate annually.

## Consequences

### Positive

- **Material cost reduction on batch-loop skills.** `inbox-triage` Stream-A
  acceptance target is ≥50% token reduction against the 25-message fixture.
- **Wall-clock latency reduction on compound PI skills.** Three-way
  parallelism with subagent isolation eliminates the sequential research bottleneck.
- **Cleaner workflow UX.** Three skill bundles cover the highest-frequency
  multi-step workflows; one slash command replaces N invocations.
- **Cron cost reduction.** Watcher skills' silent path costs zero LLM tokens
  on quiet days while preserving full audit visibility via `suppressed_wake` rows.
- **Inbound event triggers.** Webhook-driven intake eliminates polling
  cadence for known event sources, getting closer to zero-touch operation.
- **One less BUILD adapter to maintain.** `operator/connectors/ms_graph/`
  retires after the 48-hour customer-zero parallel run.

### Negative

- **Cross-repo coordination overhead.** Streams C, D, E, and F all involve
  ss-console + overlay-repo PRs that must agree on schema and audit-row
  contracts. Cross-repo PRs cite each other in commit messages so the
  integration trail is reconstructible.
- **Wave-2 fleet dispatch is novel.** 11 concurrent agents across two repos
  is the largest parallel fleet pass SMD has run. The parallel-isolation
  system handles filesystem races; semantic merge collisions are a residual
  risk addressed by the one-skill = one-agent rule documented in the plan.
- **`ms_graph` retirement requires customer-zero coordination.** 48-hour
  parallel run between migration and removal PRs is necessary because
  SMD's own inbox-triage skill runs against this connector.

## Cross-References

- Plan document (private, in `~/.claude/plans/vectorized-prancing-dove.md`) — full
  six-stream scope, file paths, wave map, and verification matrix.
- ADR 0015 — pin-only fork posture (`hermes_ref` discipline).
- ADR 0016 — Honcho disposition (mirror-don't-gate principle this plan extends to `pre_run.py`).
- ADR 0017 — Skill Curator disposition (audit emission via `hermes-smd-audit`).
- ADR 0019 — customer.yaml → per-profile config translation (Stream D bundle pass-through depends on bootstrap CLI).
- ADR 0020 — Connector strategy (Stream F retirement applies this rule).
- Hermes docs:
  - [Skills system](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)
  - [Code execution](https://hermes-agent.nousresearch.com/docs/user-guide/features/code-execution)
  - [Delegation](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation)
  - [Cron jobs](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron)
  - [Hooks](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks)
  - [MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)
