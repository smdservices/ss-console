# Operator Stack Evaluation — 2026-05-13

**Issue:** [#771](https://github.com/venturecrane/ss-console/issues/771)
**Authorizes:** Decision on each stack component per [ADR 0004](../adr/0004-productized-ai-employee-offering.md)
**Captain decision required** — does not auto-execute.

---

## Executive summary

ADR 0004 authorized a productized Operator SKU with a "Hermes-leaning, evaluate everything else independently" stack posture. Independent evaluation **confirms Hermes** for the agent harness and recommends specific choices for the five other components.

**The agent harness call.** Hermes and OpenClaw are the only operator-shipped products in this lane. Everything else — Mastra, LangGraph, Cloudflare Agents — is an agent _framework_, a toolkit to build your own. Phase 1 needs a product, not an architecture project. Hermes wins decisively on time-to-first-customer (days vs. 4-6 weeks of agent-managed build to reach parity), ships everything the source episode demoed out of the box, and is MIT-licensed for full portability.

The cost of putting Hermes on Fly.io alongside our CF Workers stack is one additional managed VM per customer (~$5-20/mo) — well within our marginal-cost budget and decisively cheaper than a multi-week framework build.

**Adaptive posture is the durable answer.** The market is changing weekly. Every component in the stack (harness, host/VM, email, connectors) sits behind a pluggable internal interface so we can swap implementations without re-platforming. Hermes is the Phase 1 implementation; Mastra and Cloudflare Agents + Claude Agent SDK are kept on the bench as Phase 2 candidates. Quarterly re-evaluation cadence against signals from real customers.

**Earlier draft correction.** The previous version of this doc recommended Cloudflare Agents + Claude Agent SDK as primary. That call was wrong-headed — it optimized for architectural elegance over time-to-first-customer and conflated agent **frameworks** with operator-shipped **products**. Captain caught it; this revision corrects it.

**The other five components** are cleaner reads — see the table below. All confirm as previously recommended: CF Sandboxes for host/VM (with e2b adapter), Native MCP + Composio two-tier for connectors, AgentMail for email at launch behind a swap interface, hybrid D1 + R2 + Vectorize for memory.

## Recommended stack at a glance

| Component           | Recommendation                                                                           | Diverges from ADR leaning?   | Confidence |
| ------------------- | ---------------------------------------------------------------------------------------- | ---------------------------- | ---------- |
| **Agent harness**   | Hermes on Fly.io (Phase 1) behind pluggable adapter; Mastra + CF-native on Phase 2 bench | No — confirms ADR leaning    | High       |
| **Build harness**   | Claude Code                                                                              | No                           | High       |
| **Host / VM**       | Cloudflare Sandboxes / Containers (primary); e2b (second backend via adapter, if needed) | Yes — replaces Orgo          | High       |
| **Connector layer** | Native MCP for top integrations + Composio for long-tail                                 | Partial — splits the layer   | High       |
| **Email identity**  | AgentMail at launch, with thin internal interface to swap to Resend/Postmark or CF Email | No                           | Medium     |
| **Memory layer**    | Hybrid: D1 (structured) + R2 markdown vault per customer + CF Vectorize (semantic)       | Yes — replaces flat Obsidian | High       |

**Total cost shape per customer at launch load** (1 Hermes agent, ~10K agent actions/month, ~100 emails/month, <5GB memory, occasional computer-use bursts):

- Cloudflare Workers Paid: $5/mo base (shared across all customers, not per-customer)
- **Fly.io Hermes machine: ~$5–20/mo per customer** at moderate active use (shared-cpu-1x or performance-1x depending on customer load)
- Cloudflare Sandboxes (computer-use bursts only — GUI tasks Hermes can't handle headless): <$5/mo per customer at moderate load
- Cloudflare Vectorize (semantic recall over the customer's vault): <$1/mo per customer at early scale
- D1 + R2 (structured memory + markdown vault mirror): <$1/mo per customer at early scale
- AgentMail Builder: $20/mo (covers 10 customer inboxes — amortized ~$2/customer)
- Composio Standard: $29/mo (covers 200K tool calls across all customers — amortized ~$3/customer at 10 customers)
- Claude API tokens: $20–80/mo per customer depending on usage shape (prompt caching mandatory)

**Estimated marginal cost per customer per month: $35–110** depending on token spend, Fly machine class, and Sandbox uptime. This is the input for pricing analysis ([#772](https://github.com/venturecrane/ss-console/issues/772)).

---

## Component 1: Agent harness

### Recommendation: Hermes (Phase 1) behind a pluggable adapter

Hermes is the operator-shipped product purpose-built for this lane. OpenClaw is the only other product-class competitor and is in an uncertain state (creator joined OpenAI April 2026; Anthropic blocked subscription-based use the same week). Everything else — Mastra, LangGraph, Cloudflare Agents, Claude Agent SDK — is an agent **framework**, a toolkit to build your own agent, not a shipped product. That's a real distinction we conflated in the first draft of this doc.

For Phase 1 (now-through-first-5-customers), we are buying not building. We need to ship customers, not architect infrastructure. Hermes ships out of the box:

- **Multi-surface gateway** — Telegram, iMessage, WhatsApp, Signal, Slack, Discord, email, CLI
- **Three-tier memory** — core / recall / archival, coherent across surfaces
- **Skills system** — modular markdown + tool defs the agent dynamically loads
- **Self-evolving / skill auto-creation** — the differentiating learning loop
- **Watchdog** — auto-restore on gateway crash
- **Plugin ecosystem** — community skills already exist for common patterns

Building parity with Cloudflare-native primitives is roughly 4-6 weeks of agent-managed work. Installing Hermes is days. Phase 1 wins on Hermes.

### How Hermes lives alongside our CF Workers stack

Hermes runs per-customer on **Fly.io Machines** (Hetzner, Railway, or any VPS works; Fly is chosen for per-second billing, fast boot, OCI-compatible images, and the cleanest API for programmatic provisioning from a Worker).

- **smd.services** (our CF Worker) stays the customer relationship layer: signup, billing, admin, observability, support inbox.
- **Hermes instances** live on Fly. One machine per customer. Provisioned from our admin Worker via the Fly Machines API. Total marginal cost per machine: ~$5-20/mo at moderate active use.
- **Customer-facing surfaces** (Telegram, email, etc.) connect to the customer's Hermes instance, not to our CF Worker.
- **Customer data the agent learns** lives on the Fly machine's persistent volume (Hermes' default pattern) for Phase 1. Phase 2 evaluation looks at whether memory should migrate to our R2 + D1 hybrid for portability and visibility from the admin Worker.

This is a two-cloud architecture for the agent itself. The friction is real but bounded: Fly's API is REST-clean, observability into Hermes runs through its own logs surfaced into our admin, and incident response involves one additional dashboard. Worth it for a Phase 1 that ships customers in weeks instead of months.

### Pluggable harness adapter — keeping options open

Build customer-facing code against an internal `Operator` interface that abstracts:

- `respond(message, surface)` — model turn against a customer message from any gateway
- `schedule(task, when)` — defer work for later execution
- `addSkill(skill)` — register a new capability
- `memory.read() / memory.write()` — access the agent's vault and structured memory

Hermes is the **first implementation** behind this interface. Cloudflare Agents + Claude Agent SDK and Mastra are kept on the bench as alternative implementations. If the market shifts or our needs evolve, swapping is a contained refactor — not a re-platform.

This is the same pluggability pattern applied to email identity (AgentMail behind a swap interface), host/VM (CF Sandboxes behind an adapter for e2b/Orgo), and connector layer (Native MCP + Composio split). **Pluggability across the stack is the durable answer to a fast-moving market.**

### Phase 2 re-evaluation criteria

After the first 5 paid customers, re-evaluate the harness decision against these signals:

1. **What our customers actually want.** Functional research ([#777-followup-functional-shape](https://github.com/venturecrane/ss-console/issues/)) feeds this — if customers consistently want capabilities Hermes doesn't ship, that's a migration signal.
2. **Hermes evolution.** v0.9 shipped April 2026, active community. If maintenance velocity continues, stay. If breaking changes accumulate or activity slows, migrate.
3. **Cloudflare Agents maturity.** v0.12.4 today; track GA milestones. If DOs + Claude Agent SDK become turnkey, migration is a 4-6 week agent-managed project.
4. **Cost shape under real load.** If per-customer Fly cost climbs above $50/mo at customer load, the equation shifts toward CF Sandboxes-native.
5. **Operational friction.** Two-cloud cost (observability splits, incident response splits, secrets management splits). If it hurts more than expected, migrate.

**Cadence: 90 days.** Review the harness decision once a quarter, then again. Do not lock for longer.

### Alternatives kept on the bench

- **Cloudflare Agents + Claude Agent SDK** — Best stack-coherent rebuild target. Phase 2 candidate if Hermes' product fit weakens. v0.12.4 shipped 2026-05-13 — actively maturing.
- **Mastra** — Apache 2.0, TypeScript-native, ships a first-class CloudflareDeployer, gives us workflows + memory + RAG + evals out of the box. Phase 2 candidate if we want a framework upgrade path rather than a primitive rebuild.

### Rejected for Phase 1

- **OpenClaw.** Creator joined OpenAI April 2026; Anthropic blocked subscription-based usage same week. Product is functional but the maintainer signal is bad. Keep on the bench in case the community fork stabilizes; do not bet Phase 1 on it.
- **LangGraph.** Production-tested framework, Python-primary, heavy. Not the product class we need at Phase 1.
- **Google ADK.** Pulls us off Anthropic onto Gemini/Vertex AI. Wrong direction for a Claude-centric stack.

### Decision asked of Captain

Confirm Hermes on Fly.io for Phase 1, with pluggable `Operator` adapter pattern across the stack. Confirm 90-day re-evaluation cadence.

---

## Component 2: Build harness

**Recommendation: Claude Code.** Clean pick.

We already use Claude Code as the build harness across all eight ventures. The skills layer (`.agents/skills/`), MCP ecosystem, subagent model, and CLAUDE.md pattern are built around it. The customer-facing agent we're configuring will itself run on Claude — using an OpenAI-shaped engineer harness to configure an Anthropic-shaped customer agent is an impedance mismatch that costs more than the optionality buys.

**Rejected: OpenAI Codex.** Credible competitor for code generation, worse fit here. AGENTS.md is shallower than CLAUDE.md + memory + skill stack. No equivalent of `.claude/agents/` or our `.mcp.json` ecosystem.

### Decision asked of Captain

None — keep doing what we're doing.

---

## Component 3: Host / VM

**Recommendation: Cloudflare Sandboxes / Containers (primary); e2b as second backend via adapter if customer relationships require richer GUI/desktop UX.**

Cloudflare Sandboxes went GA in April 2026. Persistent isolated Linux environment per Durable Object — shell, filesystem, background processes, browser terminal over WebSocket. Same auth, observability, and billing surface as the rest of our stack. Billed per 10ms of active container CPU at $0.072/vCPU-hr. No idle charge once container sleeps.

**Cost shape:** Workers Paid ($5/mo base, shared) + per-customer Sandbox at ~$10-25/mo at moderate active load. Cheaper than every alternative at our scale.

**Why not Orgo (the leaning choice):** Orgo's pricing ($29 Hacker / $112 Team / $224 Scale) is workable, but the founder is the same person who recommended his own product on the source podcast. That doesn't disqualify it, but it raises the bar for evidence. The product itself is fine — fast boot, snapshots, scoped VMs — and we should reconsider Orgo if Cloudflare Sandboxes' GUI/desktop affordances disappoint at customer scale. Orgo is the right answer if "watch the agent work" screencast UX becomes a sales requirement.

**Adapter pattern:** Build a thin internal interface (`AgentSandbox` with `boot()`, `exec()`, `writeFile()`, `terminal()`, `snapshot()`) so we can slot in e2b (or Orgo) as a second backend without rewriting agent code. Cloudflare Sandboxes is the first implementation. e2b implementation lands when we have evidence we need it.

**Rejected:**

- **Fly.io Machines** — Excellent infra, no agent-specific tooling. We'd be building Orgo/Daytona-equivalents ourselves.
- **Modal** — Python-first; sandbox pricing premium (3x over base) hurts our economics.
- **Daytona** — Well-funded ($24M Series A), Python-leaning. 15-min auto-pause floor drives idle cost up at the 1-VM-per-customer model.

### Decision asked of Captain

Confirm Cloudflare Sandboxes primary, e2b adapter as P3 follow-up if/when needed. Or override to Orgo if you want the founder-recommended path.

---

## Component 4: Connector layer

**Recommendation: Two-tier strategy — Native MCP for top integrations + Composio for the long tail.**

Native MCP servers from Notion, Linear, GitHub, Stripe, Atlassian, HubSpot, Slack, Sentry, Vercel, Figma, etc. — 25+ official remote endpoints by April 2026, plus 1,000+ production-grade community servers. For the 10-20 apps a typical SMD customer uses (Gmail, Slack, Notion, HubSpot, QuickBooks), native MCPs cover most of it at zero connector-layer cost. Customer OAuth state lives in our D1 + Workers KV using Cloudflare's `workers-oauth-provider` pattern. This is the lowest-lock-in option in the entire stack.

Composio fills the long tail — random CRMs, scheduling tools, niche SaaS where building per-vendor OAuth flows isn't worth the engineering time. $29/mo Standard tier covers 200K tool calls/month across all our customers. Customer credentials live in Composio's vault (SOC 2 Type 2, brokered credentials — LLM never sees raw tokens).

**Why two tiers, not one:** Pure native-MCP means we maintain every OAuth flow ourselves — real engineering cost. Pure Composio means every customer's tokens live with a third party and we pay per-call for integrations we could trivially do ourselves. Splitting the layer captures the best of both.

**Rejected:**

- **Pipedream** — Largest catalog (3,000+ apps) but Workday acquired them January 2026. Roadmap risk on a small-vendor partnership now answering to a $60B enterprise software company.
- **Arcade.dev** — Strong architecture (BYO-credentials, self-host), watch as a Composio replacement if usage exceeds 200K calls/mo. The shortlist's runner-up.
- **Direct SDKs** — Premature optimization. Use selectively for the 2-3 highest-volume integrations once we know what customers actually use.
- **Zapier MCP** — 30,000+ actions but 2-tasks-per-call pricing burns quota and consumer-grade latency is wrong for agent loops.

### Decision asked of Captain

Confirm two-tier (Native MCP + Composio). Or simplify to single-tier Composio if you want one vendor relationship at launch.

---

## Component 5: Email identity

**Recommendation: AgentMail at launch, with a thin internal interface to swap providers later.**

AgentMail (Y Combinator, $6M seed March 2026) is the only option that ships the per-agent-identity abstraction out of the box — inbox, threading, labels, drafts, custom domain per agent or per customer, documented subdomain-per-reputation pattern. For a productized "your agent has its own email" offering, that abstraction _is_ the product. Building it on Postmark or Resend means writing the mailbox-modeling code in D1 ourselves — 4-8 weeks of work that doesn't differentiate us.

**Pricing structure:** Free 3K/mo → Builder $20/mo (10 inboxes, 5K emails) → Scale $200/mo (150 inboxes). The $20→$200 cliff is real — customer 11 forces us into Scale, which then carries 145 unused inboxes until we grow into it.

**Tradeoffs accepted:** AgentMail is the youngest provider on the list. Deliverability track record is short. We're paying a startup premium for a feature-fit no incumbent matches.

**Mitigation:** Architect the email module behind a thin internal interface (`AgentInbox.send()`, `AgentInbox.onInbound()`, `AgentInbox.identity()`). Provider-swappable. If AgentMail deliverability disappoints, we move to Resend (best Workers DX) or Postmark (gold-standard deliverability) — building the mailbox abstraction ourselves becomes a contained project, not a rewrite of everything.

**Watch:** Cloudflare Email Service entered public beta April 2026 with REST API + Workers bindings. Architectural fit is unbeatable. Wait for GA + public deliverability metrics before betting customer agent identity on it.

**Rejected:**

- **SendGrid** — No advantage over Postmark, worse DX than Resend.
- **AWS SES** — Cheapest at scale but operational complexity outweighs early-stage savings. Consider if we ever exceed AgentMail's $200/mo tier with cost as the dominant constraint.

### Decision asked of Captain

Confirm AgentMail at launch with adapter pattern. Or override to Postmark/Resend with the understanding that we build the mailbox abstraction ourselves before any customer ships.

---

## Component 6: Memory layer

**Recommendation: Hybrid — D1 (structured) + R2 markdown vault per customer + Cloudflare Vectorize (semantic recall).**

The source episode named Obsidian vault. The shape of that recommendation is right — markdown-shaped human-readable per-customer "second brain" — but literal Obsidian (the desktop app) doesn't work as an agent memory layer on Workers. Workers don't have a persistent local filesystem.

**Three surfaces, each playing to strength:**

1. **D1 tables** keyed by `customer_id` for entities (people, companies, contracts), facts (key/value with provenance), summaries (rolling). Queryable by SQL. Native to our stack. We already use this pattern in `src/portal/assessments/extraction-schema.ts`.
2. **R2 directory** at `vaults/{customer_id}/` holding `.md` notes the agent reads and writes. Mirrors the Obsidian wiki shape. Human-readable. If a customer asks for their data, we hand them a zip.
3. **Cloudflare Vectorize index** for semantic search across both — embed markdown chunks plus D1-derived summaries; agent retrieves by similarity. Free tier covers 5M vectors per index.

Total memory cost per customer at early scale: <$2/mo.

**Mem0 — the "auto-extraction" pattern is worth borrowing.** Mem0's headline feature is auto-extracting facts from conversation transcripts and writing them to memory. We should build that as a background job: agent finishes a session, a Worker reads the new transcript, proposes vault entries + D1 inserts, gated by human review during Phase 1. We don't adopt Mem0 itself — its SDK is broken on Workers ([mem0ai/mem0#3515](https://github.com/mem0ai/mem0/issues/3515)) and the Pro tier ($249/mo per workspace) is too expensive per customer.

**Rejected:**

- **Literal Obsidian vault** — No local filesystem on Workers; Obsidian-the-app is a human-edit-time tool, not an agent runtime.
- **Letta / MemGPT** — It's an agent framework, not a memory primitive. Adopting it means rebuilding our agent on Letta's runtime — too big a commit from a memory-layer decision.
- **Pinecone** — Proprietary, locked-in. CF Vectorize and Turso (SQLite-compatible) are both cheaper and more portable.

### Decision asked of Captain

Confirm hybrid. None of this requires new vendors — all three primitives are GA on CF.

---

## Open questions for Captain

1. **Confirm Hermes Phase 1 + adapter pattern.** Recommended: Hermes on Fly.io as the Phase 1 harness implementation, behind a pluggable `Operator` interface. Mastra and CF-native kept on the bench as Phase 2 candidates. 90-day re-evaluation cadence.

2. **Confirm functional research as a Phase 2 prerequisite.** Per Captain directive (imperative), we need broad signal on what businesses across verticals actually want from these agents — not from one podcast. Research issue is being filed; deliverable is `docs/strategy/operator-functional-shape-2026-MM-DD.md`. This research feeds the Phase 2 re-evaluation criteria.

3. **Sandbox primary — fully Cloudflare, or hedge with e2b adapter at launch?** Building the adapter pattern early is cheap; building it under pressure when a customer demands GUI screencast UX is expensive. Recommendation: scaffold the interface, implement CF Sandboxes only until we have evidence of need.

4. **Email — accept startup-vendor risk at launch?** AgentMail's per-agent abstraction is a real product fit. Startup premium is real. Adapter pattern in place.

5. **Pricing analysis next?** [#772](https://github.com/venturecrane/ss-console/issues/772) is ready to start once stack is locked. Marginal cost shape per customer ($35-110/mo) is the input — add target margin to get the published retainer price.

---

## Risks tracked

- **Hermes maintenance trajectory.** v0.9 shipped April 2026 with active community. Monitor velocity, breaking-change cadence, security responsiveness. If activity slows, accelerate Phase 2 re-evaluation.
- **Fly.io reliability per-customer.** Track Fly Machine SLA, incident history. If multi-customer outages become a pattern, evaluate alternative hosts (Hetzner Cloud, Railway).
- **Two-cloud operational friction.** Observability, secrets, incident response split across CF + Fly. Mitigation: unified admin dashboard surfacing Fly logs into our CF Worker. Track real cost over first 90 days.
- **AgentMail deliverability at scale is unproven.** Architect the email module behind a provider-swap interface.
- **Composio pricing cliff at 200K tool calls/month** ($29 → $229). Track usage; Arcade.dev BYO-credentials documented as replacement path.
- **Cloudflare Agents v0.12.4** (Phase 2 candidate). Track GA milestone, API stability, real-world references.
- **Functional shape unknown.** Mitigation: functional research follow-on (filed as a new issue) feeds Phase 2 re-evaluation criteria.

---

## Sources

- [ADR 0004 — Productized AI Employee Offering](../adr/0004-productized-ai-employee-offering.md)
- [Hermes agent (Nous Research)](https://github.com/nousresearch/hermes-agent) — primary repository, MIT-licensed
- [Hermes agent docs](https://hermes-agent.nousresearch.com/)
- [Fly.io Machines pricing](https://fly.io/docs/about/pricing/)
- [Fly.io Machines API](https://fly.io/docs/machines/api/)
- [Cloudflare Agents SDK v0.12.4 changelog (2026-05-13)](https://developers.cloudflare.com/changelog/post/2026-05-13-agents-sdk-v0124/) — Phase 2 candidate
- [Claude Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Claude memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Mastra CloudflareDeployer](https://mastra.ai/reference/deployer/cloudflare)
- [Cloudflare Sandboxes GA announcement](https://blog.cloudflare.com/sandbox-ga/)
- [Cloudflare Sandbox SDK](https://developers.cloudflare.com/sandbox/)
- [Cloudflare Containers pricing](https://developers.cloudflare.com/containers/pricing/)
- [Cloudflare Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/)
- [Orgo pricing](https://www.orgo.ai/pricing)
- [e2b pricing](https://e2b.dev/pricing)
- [Northflank AI sandbox pricing comparison 2026](https://northflank.com/blog/ai-sandbox-pricing)
- [Composio pricing](https://composio.dev/pricing)
- [Arcade.dev pricing](https://www.arcade.dev/pricing)
- [Pipedream Connect](https://pipedream.com/connect)
- [AgentMail pricing](https://agentmail.to/pricing)
- [Cloudflare Email Service public beta announcement](https://blog.cloudflare.com/email-service-beta/)
- [Source episode — The $1M+ Solo AI Agent Business](https://www.youtube.com/watch?v=BI-MNjm1tTQ) (Greg Isenberg + Nick Vasilescu, 2026-05-12)
