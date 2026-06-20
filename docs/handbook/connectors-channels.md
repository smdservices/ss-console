---
title: Connectors & Channels
section: product
order: 4
summary: How the Operator reaches a customer's systems (connectors) and how people reach the Operator (channels) - and why both sides treat the channel as a dumb pipe
sources:
  - label: ADR 0020 - Connector Strategy (MCP-first; Composio dropped)
    href: https://github.com/venturecrane/ss-console/blob/main/docs/adr/0020-connector-strategy.md
  - label: ADR 0021 - Leverage Hermes Native Primitives
    href: https://github.com/venturecrane/ss-console/blob/main/docs/adr/0021-leverage-hermes-native-primitives.md
  - label: ADR 0045 - Mediated Connector Capability Broker
    href: https://github.com/venturecrane/ss-console/blob/main/docs/adr/0045-mediated-connector-capability-broker.md
  - label: operator/README.md - connector code location
    href: https://github.com/venturecrane/ss-console/blob/main/operator/README.md
---

## Two sides of the same boundary

The Operator sits between a customer's systems and the people who work with it. Reaching the customer's systems is the **connector** problem: email, calendar, practice-management, accounting, payments, document storage. Reaching the Operator is the **channel** problem: how a human (or an inbound event) gets a request to the worker.

Both sides follow one rule that is easy to get wrong: **a channel is a dumb pipe; the worker holds the intelligence.** The same worker - same memory, same skills, same entitlements, same governance - answers whether you reach it by email, by text, by voice, or by a conversational MCP connection. There is no per-channel brain. The only way to break a channel is to narrow what the worker can do when a request arrives through it. See `/admin/playbook/operator-platform` for what the worker is and `/admin/playbook/autonomy-governance` for how its actions are bounded.

## Connector strategy: MCP-first

Connectors are governed by [ADR 0020](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0020-connector-strategy.md), locked 2026-05-24. Every system the Operator touches resolves at runtime through one of three backend patterns, distinguished by the `customer.yaml.connectors{}.backend:` prefix:

- **`mcp:<server>`** - a Model Context Protocol server, vendor-official or vetted community. The MCP server boots as a child process of Hermes from the per-profile config; **there is no in-tree code** for an `mcp:` binding. Examples: M365 Mail/Calendar/Teams, QuickBooks (Intuit, 144 tools), Xero, Stripe, HubSpot, Salesforce, Slack, CourtListener, Clio (`oktopeak/clio-mcp`), Twilio.
- **`build:<vendor>`** - a Python adapter we maintain. Used only where no acceptable MCP exists, or where trust-ceiling enforcement is safer to own end-to-end (for example trust-account writes against LawPay). Adapters that predate the 2026-05-24 realignment stay in `operator/connectors/<vendor>/` (`filevine/`, `lawpay/`, `no_pm/`); **new** BUILD adapters land in the `venturecrane/hermes-smd-overlay` repo, never in this tree, per ADR 0015.
- **`synthetic:<name>`** - an in-process substrate backed by per-customer D1 and R2 (for example `no_pm`, for a firm with no real practice-management system).

The decision order for a new binding is: vendor-direct MCP first, then a vetted community MCP (subject to a code-review acceptance checklist in ADR 0020), then a BUILD adapter only when neither exists. The per-vendor decision table in ADR 0020 records the reasoned choice for each vendor we expect to wire.

### Composio is dropped

An earlier revision of ADR 0020 reserved a fourth `composio:<connector>` backend as a long-tail fallback. As of the 2026-05-30 revision it is **removed entirely**. Brokering connections through a shared-key third party added tenancy risk, an extra API surface, and a party in the trust chain visible to compliance-audited customers, all without commensurate benefit. We connect to MCPs directly, and any long-tail vendor with no first-party MCP gets a `build:` adapter. The `composio:` prefix now fails validation.

### What is wired today vs. planned

Only the `mcp:` path has a runtime materializer today. At boot, `translate._materialize_mcp_servers` writes the `mcp_servers.*` entries into the per-profile Hermes config (`operator/contracts/customer-yaml-blocks.yaml`). The `build:` and `synthetic:` paths are **planned** - their runtime tool-registration bridge does not exist yet, so a `synthetic:no_pm` binding surfaces zero PM tools at runtime. These are built demand-pull through the first vertical per ADR 0038. A binding in `customer.yaml` is aspirational until the runtime actually materializes it.

> TODO(why): ADR 0020's verification section says BUILD-adapter tool registration via `ctx.register_tool()` in the overlay is the target contract, but the adapters "do not exist yet." The handbook should be re-checked once the first `build:` adapter ships in `hermes-smd-overlay`, because the "only mcp: is wired" statement here will then be stale. Checked: ADR 0020 §"Customer.yaml backend resolution at boot" and §Verification; operator/README.md.

### Google is a special case: the broker, not a connector

Google Workspace (Gmail, Calendar, Drive, Docs, Sheets) was originally wired as `build:google-*` CLI adapters. Those were **superseded 2026-06-17 by [ADR 0045](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0045-mediated-connector-capability-broker.md)**, the Mediated Connector Capability Broker. Google now runs through a **Workspace broker**: a separate process holds the domain-wide-delegation service-account credential and exposes governed `workspace_*` tools. The agent never holds the Google credential, and there is no connector CLI for it to shell to. Google is therefore **not** a `connectors[]` entry - it is declared by `customer.yaml.google_auth:` and served by the broker. The broker is the authorization boundary for every Google operation; see `/admin/playbook/autonomy-governance` for how that boundary enforces entitlements.

## Leverage Hermes native primitives

[ADR 0021](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0021-leverage-hermes-native-primitives.md) records the decision to use what Hermes already ships rather than reinvent it. Five native primitives matter to connectors and channels:

- **`execute_code`** - a Python child process with RPC tool access. Batch-loop skills (inbox triage, hours reconciliation, status assembly) that would otherwise make 10 to 100 tool calls in the conversation context collapse into a single inference call. The CLI connectors the agent shells to (where they still exist) are reached this way.
- **No-agent cron (`{"wakeAgent": false}`)** - a cron pre-run script can do arithmetic-only polling and skip waking the LLM when nothing changed, costing zero model tokens on quiet days. The pre-run script must emit an audit row on every run (including the silent path), or the optimization is indistinguishable from "the script silently broke."
- **`delegate_task`** - spawns up to three concurrent isolated subagents with restricted toolsets, returning only summaries to the parent. Compound research workflows parallelize their sub-tasks this way.
- **Skill bundles** - compose multiple skills under one slash command, declared in `customer.yaml`.
- **Webhook gateway (`pre_gateway_dispatch`)** - routes inbound system events (a matter created, a mailbox change) to skill invocations, so known event sources do not need polling.

The point of ADR 0021 is restraint: no new architectural primitives, no modifications to Hermes core. Every change maps to a documented Hermes capability.

## Channels: how people reach the Operator

A channel carries a message in and a message out. It holds none of the worker's intelligence. The channels the Operator supports:

- **Inbound email** - `crane@smd.services`, allow-list gated. Only senders on the authored allow-list can reach the worker by email; everything else is dropped. The inbound path routes the message body to the worker through the gateway.
- **Outbound Gmail push** - event-driven outbound, so the Operator can send (under whatever send-posture the engagement authored) rather than only reply when polled.
- **Voice** - a voice-synthesis backend plus a transform hook, so the Operator can speak in the customer's authored voice. Voice is a separate concern from the worker's personality; the channel renders, it does not decide.
- **Conversational MCP channel** - an MCP connection with Clerk authentication supporting multi-turn conversation. This is the "just talk to it" front door: one verb, the worker on the other end. Clerk identity gates who is talking; the authored entitlements govern what the worker will do for them.

### The managed-mailbox capability

Beyond reaching the Operator's own mailbox, the Operator can **manage a principal's mailbox** - read, triage, and draft against a human's inbox - through a per-operation delegation subject. The broker is the authorization boundary: it validates the requested subject and sender against the mailboxes the engagement authored in `customer.yaml.google_auth.managed_mailboxes` before any operation runs. This is the same broker that serves Google generally (ADR 0045); the managed-mailbox path is one set of governed `workspace_*` operations on top of it.

> TODO(why): the managed-mailbox runtime materialization (whether the broker's `workspace_*` tools are live against a real managed mailbox end to end) is verified in source/ADR but not re-confirmed against a running Machine here. Checked: ADR 0045 header and overview; operator/README.md. A live-Machine check belongs to whoever next reprovisions.

## Why the dumb-pipe rule is load-bearing

If channels held intelligence, every new front door would mean re-implementing memory, entitlements, and governance, and the four doors would drift apart. Keeping the worker as the single seat of intelligence means a capability authored once is reachable through every pipe, and a governance ceiling set once binds every pipe. The connector side mirrors this: the boundary that matters is per-customer credential isolation (per-customer OAuth or API keys, the broker for Google), not which backend pattern a vendor happens to use. Both sides push all the judgment into the worker and keep the edges dumb on purpose.
