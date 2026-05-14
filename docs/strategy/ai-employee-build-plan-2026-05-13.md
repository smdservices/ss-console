# AI Employee — Build Plan for SMD-as-Customer-0

**Date:** 2026-05-13
**Status:** Draft
**Branch:** `ai-employee-smd-customer-zero`

## What this is

A concrete build plan for setting up an AI Employee for SMD the way we'd set one up for a paying customer, so we learn the delivery before selling it.

## What this isn't

- Not the customer-pack build (8 marketing-agency skills, Composio, AgentMail, watchdog, dashboard). Those live in the runbook as the destination state. We don't build them now.
- Not a phase plan that turns into a quarter of work. The whole thing should fit in a week of evenings, not a quarter.
- Not the productized SKU. This is internal R&D. No marketing change, no pricing change, no SOW.

## The objective in one sentence

Set up one Fly Machine running Hermes that does one useful job for SMD, customer-shape, so we know what "set one up for a customer" actually means before we charge for it.

## What "customer-shape" means at minimum

Same shape we'd use for a paying customer, scaled down to the minimum that still teaches:

| Element              | Customer-zero shape                                        | Full customer pack (deferred)                    |
| -------------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| Compute              | 1 Fly Machine, smallest tier                               | Same — already the customer shape                |
| Identity             | Single named agent (e.g. "Hermes-SMD")                     | Same                                             |
| Model access         | Anthropic API via env var                                  | Same                                             |
| Memory               | SQLite file on the machine's persistent volume             | D1 + R2 + Vectorize hybrid                       |
| Connectors           | Native MCP (filesystem, fetch, our crane MCP)              | Composio for SaaS connectors                     |
| Invocation           | SSH in, or a single HTTP endpoint                          | Slack/email/AgentMail inbox                      |
| Observability        | `fly logs` + the SQLite log table                          | Watchdog Worker + dashboard Worker               |
| Skills               | One capability (see Phase 2 below)                         | Vertical pack (8 skills for marketing agencies)  |
| Onboarding ceremony  | Skip; we are the customer                                  | Day 1-5 discovery, Day 6-14 shadow, Day 15+ auto |
| Trust ceiling matrix | One rule: agent drafts, Captain ships. Nothing autonomous. | Per-task autonomous / draft / refused matrix     |

This is the seam: every column moves left-to-right as we learn. The shape (one machine per customer, one named agent, Anthropic via env, memory on the machine, our MCP for tools) does not change.

## Phase 0 — External dependencies (Captain)

Two things only Captain can do, because they're his accounts and his money:

1. **Fly.io account.** Free tier covers customer-zero. Estimated marginal cost when we start running it: < $10/mo on smallest machine. Captain creates the account, installs `flyctl`, runs `fly auth login`.
2. **Decide which Anthropic API key the SMD agent uses.** Either reuse the existing `ANTHROPIC_API_KEY` from this project's env, or provision a separate one we can rotate and rate-limit independently. Recommendation: separate key, because we'll want per-agent usage telemetry the moment we have a second customer.

Nothing else in Phase 0. No AgentMail. No Composio. No Slack workspace. No domains. No D1 schema migrations. All of that is deferred until a real customer needs it.

## Phase 1 — Provision SMD's agent

Claude builds this. ~1 evening of work.

1. `ai-employee/` directory at repo root, gitignored except a `README.md` that points here.
2. Inside `ai-employee/customers/smd/`:
   - `customer.yaml` — name, model, capability list, contact info, log retention.
   - `fly.toml` — Fly app config for the SMD machine.
   - `Dockerfile` — Hermes plus our MCP tools, baked.
   - `bootstrap.sh` — runs on first machine start: clones nous-ai/hermes at pinned SHA, installs deps, copies the SMD skill file in, starts the agent loop.
3. Provisioning script `ai-employee/bin/provision-customer.sh` that takes a customer slug and does the Fly create/deploy. We run it once for `smd`.
4. Once the machine is up: SSH in, smoke-test that Hermes responds, that the Anthropic key works, that crane MCP tools work from inside the container.

Acceptance: `fly status -a hermes-smd` shows running; `fly ssh console` lets us talk to Hermes; Hermes can call one tool round-trip.

## Phase 2 — The one capability

The agent needs to do something useful for SMD. Pick one. Build it. See what breaks.

Captain to pick from the candidate list below. Each is roughly the same build cost (a single Hermes skill backed by 1-3 MCP tool calls and a prompt). Picking the one that's most useful to SMD wins; picking the one most representative of marketing-agency work is the runner-up. They can be the same pick.

| Candidate                        | What the agent does                                                                                  | Why it's useful for SMD                                                                    | Why it might teach us about agency work        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Inbox triage drafter             | Reads smdurgan@venturecrane.com unread mail via Gmail MCP, drafts a triage summary into a daily note | Captain spends real time on inbox today                                                    | Agencies want exactly this for their AEs       |
| `/book` intake digest            | When a new booking lands, agent reads the assessment intake, drafts pre-call notes                   | Will be useful the second we have inbound                                                  | Agency parallel: new-client intake summarizer  |
| Daily standup drafter            | Reads `crane_sos` + open issues + recent commits, drafts a stand-up note                             | Captain does this manually in /sos today                                                   | Agency parallel: weekly client status note     |
| Decision-stack consistency check | Reads new docs against `docs/adr/decision-stack.md`, flags contradictions                            | Useful because we keep accreting docs that should agree with the stack and sometimes don't | Less agency-parallel; more an internal QA loop |

The agent does not act. It writes drafts to a customer notes folder. Captain reads and ships (or doesn't). This is the trust-ceiling-matrix-of-one for customer-zero: draft only, no autonomous sends, no autonomous writes outside the notes folder.

Acceptance: the agent produces one draft a day for a week. We read it. We notice what's good, what's bad, what's missing. We write the gaps down.

## Phase 3 — Watch it work

No new code. Just operation. Run the agent for a week. Each day:

- Read the draft.
- Note what would need to be true for this to graduate from "draft for Captain" to "autonomous for a real customer." Trust-ceiling data, in other words.
- Note what broke (timeouts, bad tool calls, hallucinated context, missing memory, prompt drift).
- Note what infrastructure we now know we actually need vs what we guessed we'd need in the runbook.

Output of Phase 3 is a short post-mortem appended to this doc: "what we learned running SMD customer-zero for a week." That post-mortem is what tells us the next real piece of work — whether it's the second capability, the second customer, AgentMail integration, Composio, or something we haven't predicted.

## What's deferred and why

Everything in the runbook that customer-zero doesn't need:

- **AgentMail per-agent inbox.** Defer until a customer wants the agent to send mail under its own identity. SMD doesn't need this — Captain ships from his own inbox.
- **Composio.** Defer until we need a SaaS connector we don't already have (HubSpot, Salesforce, ClickUp, etc.). Customer-zero uses Gmail MCP and our crane MCP. That's enough.
- **Vectorize / RAG.** Defer until memory grows past what SQLite + recency-window can handle. For one agent doing one task, it can't.
- **Watchdog Worker.** Defer until we have more than one customer or any autonomous action. One agent producing drafts can be monitored by reading the drafts.
- **Dashboard Worker.** Same as watchdog. `fly logs` and the SQLite log table are sufficient for one customer.
- **D1 schema in the SS database.** Defer until we have customer billing, contract state, or cross-customer queries. SQLite per machine is enough now.
- **Customer onboarding ceremony.** SMD is its own customer; we skip the Day 1-5 / Day 6-14 / Day 15+ progression. We'll feel where it would have helped, and that becomes the second post-mortem.
- **Trust ceiling matrix beyond "draft only."** No autonomous action in customer-zero. Period. When we let the agent send mail or write files outside its notes folder, that day's work is also the work of building the matrix.

The cost of deferring all of this is that customer-zero looks much smaller than the runbook describes. That is correct. The runbook describes the destination. This plan describes the first mile.

## Risk that the plan is wrong

We may discover halfway through Phase 1 that Hermes-on-Fly doesn't behave the way we expect — the model loop drifts, the MCP integration is harder than we think, the volume persistence has a sharp edge. That's the point. We are doing this to find out. The cost ceiling is small (one evening of Claude work + < $10/mo of Fly + Captain's reading time on drafts), so the cost of being wrong is bounded.

The risk we are explicitly accepting: this plan does not validate the productized SKU economics, does not validate marketing-agency demand, does not validate the trust-ceiling matrix as a category. It validates exactly one thing — whether we can run the customer-shape stack at all. The other validations come later, from doing this, then a second one, then a first paying customer.

## What ships from this plan

- `docs/strategy/ai-employee-build-plan-2026-05-13.md` (this doc)
- `ai-employee/` directory with the SMD customer-zero scaffold
- The Fly app `hermes-smd`
- A week of drafts from the agent
- A post-mortem appended here at the end of the week

Nothing else. No new public marketing copy. No new SOW. No new pricing. No vertical pack. No second customer plan. Those come after the post-mortem says we're ready.
