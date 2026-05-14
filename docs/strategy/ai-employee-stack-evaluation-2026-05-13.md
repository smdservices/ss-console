# AI Employee Stack Evaluation — 2026-05-13

**Issue:** [#771](https://github.com/venturecrane/ss-console/issues/771)
**Authorizes:** Decision on each stack component per [ADR 0004](../adr/0004-productized-ai-employee-offering.md)
**Captain decision required** — does not auto-execute.

---

## Executive summary

ADR 0004 authorized a productized AI Employee SKU with a "Hermes-leaning, evaluate everything else independently" stack posture. Independent evaluation surfaces one significant divergence from that posture, plus six concrete recommendations.

**The divergence.** Hermes is open-source, MIT-licensed, and well-architected — but it's designed for a long-running VPS process with persistent local filesystem memory. Our existing infrastructure (Astro on Cloudflare Workers + D1) is ephemeral request/response edge compute. Adopting Hermes means standing up and operating a second hosting environment (Railway, Fly, Hetzner) per customer, which fights our productization economics.

The recommendation below replaces Hermes with **Cloudflare Agents + Claude Agent SDK** — Anthropic's first-party agent primitive paired with Cloudflare's stateful agent runtime (shipped GA at v0.12.4 on 2026-05-13, the day this evaluation ran). This sits on our existing stack with zero new vendors, gives the agent a Durable Object with its own SQL database, supports WebSockets and scheduling, and is the lowest-abstraction-risk path.

**Mastra is the credible alternative** — TypeScript-native, Apache 2.0, ships a first-class CloudflareDeployer, and gives us workflows + memory + RAG + evals out of the box. The tradeoff is one more framework dependency for a venture that hasn't pressure-tested its agent shape yet.

The other five components are cleaner reads — see the table below.

## Recommended stack at a glance

| Component           | Recommendation                                                                           | Diverges from ADR leaning?   | Confidence |
| ------------------- | ---------------------------------------------------------------------------------------- | ---------------------------- | ---------- |
| **Agent harness**   | Cloudflare Agents + Claude Agent SDK (primary); Mastra (credible alternative)            | **Yes** — replaces Hermes    | Medium     |
| **Build harness**   | Claude Code                                                                              | No                           | High       |
| **Host / VM**       | Cloudflare Sandboxes / Containers (primary); e2b (second backend via adapter, if needed) | Yes — replaces Orgo          | High       |
| **Connector layer** | Native MCP for top integrations + Composio for long-tail                                 | Partial — splits the layer   | High       |
| **Email identity**  | AgentMail at launch, with thin internal interface to swap to Resend/Postmark or CF Email | No                           | Medium     |
| **Memory layer**    | Hybrid: D1 (structured) + R2 markdown vault per customer + CF Vectorize (semantic)       | Yes — replaces flat Obsidian | High       |

**Total cost shape per customer at launch load** (1 agent, ~10K agent actions/month, ~100 emails/month, <5GB memory):

- Cloudflare Workers Paid: $5/mo base (shared across all customers, not per-customer)
- Cloudflare Sandboxes runtime: ~$10–25/mo per customer at moderate load
- Cloudflare Vectorize: <$1/mo per customer at early scale
- D1 + R2: <$1/mo per customer at early scale
- AgentMail Builder: $20/mo (covers 10 customer inboxes — amortized ~$2/customer)
- Composio Standard: $29/mo (covers 200K tool calls across all customers — amortized $3/customer at 10 customers)
- Claude API tokens: $20–80/mo per customer depending on usage shape (prompt caching mandatory)

**Estimated marginal cost per customer per month: $30–100** depending on token spend and Sandbox uptime. This is the input for pricing analysis ([#772](https://github.com/venturecrane/ss-console/issues/772)).

---

## Component 1: Agent harness

### Why Hermes doesn't fit our stack

The source episode named Hermes specifically. ADR 0004 leaned that direction. Independent evaluation surfaces three problems:

1. **Hermes is a long-running process.** It assumes a VPS with a persistent filesystem holding skills, memory, and gateway state. Cloudflare Workers are ephemeral — each request gets a fresh isolate. The skills-and-memory pattern Hermes relies on would have to be rebuilt against R2 + D1, which means we're using a tiny fraction of Hermes' value.
2. **Hermes wants its own host.** Running Hermes for SMD means standing up Railway/Fly/Hetzner alongside our existing CF Workers infrastructure. Two clouds, two bills, two observability surfaces, two security boundaries — exactly the friction we want to avoid for a one-person agency at launch.
3. **The Hermes "learning loop" can be reimplemented.** The differentiating feature — self-evolving skills, three-layer memory, automatic skill creation — is a pattern, not a moat. We can build the same surface on Cloudflare Agents + Claude Agent SDK using Claude's memory tool, our R2 vault, and our own skill registry. It's more code, but it sits on our stack.

This is exactly what "evaluate independently before adopting" was supposed to surface. The ADR's "Hermes-leaning" wording was deliberate — leaning, not locked.

### The recommendation: Cloudflare Agents + Claude Agent SDK

**Cloudflare Agents** (`@cloudflare/agents`, v0.12.4 shipped 2026-05-13): Stateful agents running as Durable Objects. Each agent gets its own SQL database, can hold WebSockets open across model turns, supports scheduling, can survive client disconnects. Built specifically for the long-running-agent pattern.

**Claude Agent SDK** (renamed from Claude Code SDK, Anthropic's first-party agent primitive): Python and TypeScript SDKs. Built-in tool use, agent loop, context management, memory tool (filesystem-backed — we point it at R2 or the agent's own Durable Object SQL). Automatic prompt caching (1.25x base for 5min cache, 2x for 1hr; reads at 0.1x).

**Together:** The agent is a Durable Object. Its identity, memory, and skill registry live in that DO's SQL database. Long-horizon work is just code running inside the DO with the agent SDK in the loop. Customer credentials live in D1, scoped by customer ID. The agent's email inbox is a webhook into another Worker that writes to the DO. Cron jobs are scheduled on the DO.

**Cost:** Anthropic API tokens + Workers Paid base + Durable Objects costs (negligible at this scale).

**Lock-in:** Tied to Anthropic for the model and to Cloudflare for the runtime. Both are deliberate choices we're already making. The agent loop and memory shape are reimplementable on any other runtime if we ever need to migrate (the agent's _state_ in D1/R2 is portable).

### The credible alternative: Mastra

**Mastra** (Apache 2.0, $13M seed + $22M Series A): TypeScript-native agent framework. Ships a CloudflareDeployer that bundles your agent into a Workers-compatible output and configures `wrangler.jsonc` automatically. Workflows, agents, RAG, evals as first-class primitives. Unified model router across 3,300+ models and 94 providers.

**Why it's the credible alternative:** Mastra does for agents what Astro did for web frameworks — opinionated structure, good defaults, fast iteration. If we hit a wall building skill/workflow logic directly on Cloudflare Agents + Claude Agent SDK, Mastra is a tidy upgrade path.

**Why not primary:** One more framework dependency, slightly younger than the underlying primitives, and we'd be paying for workflows/RAG/evals features we haven't yet proven we need at our pre-launch stage.

### Rejected

- **Hermes** — Workers mismatch, requires second host. The episode's leaning choice. (Verdict: pattern is right, implementation is wrong for us.)
- **LangGraph** — Production-tested but Python-primary and heavy for Workers. JS port lags.
- **Google ADK** — Pulls us off Anthropic onto Gemini/Vertex AI. Wrong direction.
- **OpenClaw** — Creator joined OpenAI in April 2026; Anthropic blocked subscription-based usage same week. Commoditized exactly as the episode predicted.

### Decision asked of Captain

Confirm Cloudflare Agents + Claude Agent SDK as primary, or override to Mastra. If overriding, note the framework dependency tradeoff.

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

1. **Agent harness override?** The Hermes-leaning posture in ADR 0004 was deliberate but not locked. This evaluation recommends Cloudflare Agents + Claude Agent SDK instead. Three responses possible:
   - Accept the recommendation. Amend ADR 0004 to drop "Hermes-leaning" in favor of "Cloudflare-native stack." File as a minor amendment, not a new ADR.
   - Override and stay with Hermes. Accept the second-cloud operational cost. Reason: the self-evolving learning loop matters enough to pay for.
   - Pick Mastra instead. Same stack fit as the recommendation, with a framework dependency for workflows + RAG + evals out of the box.

2. **Sandbox primary — fully Cloudflare, or hedge with e2b adapter at launch?** Building the adapter pattern early is cheap; building it under pressure when a customer demands GUI screencast UX is expensive. Recommendation is to scaffold the interface but only implement CF Sandboxes until we have evidence of need.

3. **Email — accept startup-vendor risk at launch?** AgentMail's per-agent abstraction is a real product fit. The startup premium is real. Captain calls it.

4. **Pricing analysis next?** [#772](https://github.com/venturecrane/ss-console/issues/772) is ready to start once stack is locked. Marginal cost shape per customer ($30-100/mo) is the input — we then add target margin to get the published retainer price.

---

## Risks tracked

- **Cloudflare Agents v0.12.4 shipped 2026-05-13 (today).** Active development, but version number signals a still-stabilizing API. Pin versions carefully; allocate budget for follow-on bumps.
- **Mastra has a known CF bindings bug ([#8782](https://github.com/mastra-ai/mastra/issues/8782))** if Captain overrides to Mastra. Track resolution before committing.
- **AgentMail deliverability at scale is unproven.** Architect the email module for provider swap.
- **Composio pricing cliff at 200K tool calls/month** ($29 → $229). Track usage; Arcade.dev BYO-credentials is the replacement path.

---

## Sources

- [ADR 0004 — Productized AI Employee Offering](../adr/0004-productized-ai-employee-offering.md)
- [Cloudflare Agents SDK v0.12.4 changelog (2026-05-13)](https://developers.cloudflare.com/changelog/post/2026-05-13-agents-sdk-v0124/)
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
