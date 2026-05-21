# AI Employee — Competitive Analysis Brief

> **Audience:** External competitive analysis team
> **Date:** 2026-05-21
> **Captain:** Scott Durgan
> **Status:** Active assignment

---

## 1. Mission

We need a competitive analysis of SMD Services' **AI Employee** product. The output guides three downstream decisions:

1. **Pricing.** The monthly SKU price is unlocked pending market evidence (see §6). We need a defensible price band, not a single number.
2. **Positioning.** Our June 2026 beta-1 customer (a 20-year PI litigation firm) will compare us to vendors they already know. We need to know which ones, what they cost, and where we win or lose on the demo floor.
3. **Roadmap defense.** A new architectural decision (multi-persona per customer — see §3) was just locked. We need to know whether competitors have or are planning equivalent capabilities, so we know how long that differentiation holds.

This is not academic market sizing. Every finding should map back to one of those three decisions.

---

## 2. What AI Employee Is (Canonical Positioning)

**One sentence:** AI Employee is a productized monthly-SKU AI staffer that operates inside a customer's business under a persistent named identity, drafts work in the customer's voice across every operational surface they use, and never sends external communication as itself — a named human always reviews and sends.

**Tagline (internal):** "The first hire your business doesn't have to make."

**What it is NOT:**

- Not a SaaS the customer self-installs — SMD operates the runtime as a managed service.
- Not a chatbot or Q&A surface — it has an inbox, a calendar, standing responsibilities, steady drafted output.
- Not autonomous — every external send, transaction, and commitment is gated by human review (this is architectural, not advisory).
- Not a build-your-own-agent toolkit — SMD authors and operates skills; customers configure scope, voice, rules, trust.
- Not "AI inside" a tool the customer already uses (e.g. not a Clio plugin) — the product is the agent as identity, not a feature inside another vendor's product.

**Four pillars we claim as white space** (from the platform PRD §1):

1. **Persistent named agent** across the whole work lifecycle under one identity.
2. **Versioned, customer-editable memory** as a human-readable artifact the customer owns and audits.
3. **Reviewer-as-sender** as the core abstraction — the agent ghostwrites; the human signs and sends.
4. **Flat-monthly per-customer SKU** instead of per-seat or per-resolution pricing.

Authoritative sources (read these first):

- [`docs/adr/0004-productized-ai-employee-offering.md`](../../adr/0004-productized-ai-employee-offering.md) — why this product exists, what's locked, what's deferred
- [`docs/pm/ai-employee/platform-prd.md`](./platform-prd.md) — full vision (read §0–§3 minimum)
- [`docs/pm/ai-employee/law-firm-prd.md`](./law-firm-prd.md) — first vertical
- [`docs/adr/decision-stack.md`](../../adr/decision-stack.md#decision-44) — Decision #44 (pricing reference range)

---

## 3. The Multi-Persona Feature — New, Important, Not Yet Public

A new architectural decision landed today: [**ADR 0011 — Multi-Persona Per Customer**](../../adr/0011-multi-persona-per-customer.md) (merged via [PR #918](https://github.com/venturecrane/ss-console/pull/918) on 2026-05-21).

**What changed.** A single customer subscription can host **multiple AI personas** (e.g. "Marcus" handling inbox triage + "Casey" handling intake) under one firm. They share the customer's connectors, memory vault, and scope envelope, but each persona has its own identity, signature, voice envelope, AgentMail inbox (`<persona_slug>@<customer_slug>.agents.smd.services`), and skill assignments.

**What ships when:**

- **v1 (now → first customer):** schema commits to multi-persona (`customer.yaml: personas[]` array, nullable `persona_slug` columns on D1 tables), but the array ships at length 1. UI is single-persona. **No customer pays for multi-persona at v1.**
- **Phase 2 (gated on a paying customer asking):** per-persona runtime supervisor, dashboard persona picker, memory scoping grammar (`shared:<customer>` vs `persona:<customer>:<slug>`), routing-rules engine.

**Why this matters for the analysis.** Two things:

1. **It reframes the buying conversation.** A firm that wants both an inbox triage agent and an intake agent is buying *more of the same product*, not commissioning a second engagement. Competitors that sell per-seat or per-skill cannot natively express "two named agents, both ours, both knowing our business." We can.
2. **It is currently a paper commitment.** The schema is locked; the runtime is not built. **Treat this as a positioning differentiator we have committed to, not a shipped feature.** Do not analyze it as if it were live. The question for the analysis is: how long does this differentiator hold, and who is closest to shipping equivalent capability?

**Vocabulary discipline:** internally we say **persona**. Externally, marketing may say "employee" or "associate." When you write findings, use **persona** for the AI identity and **employee** only when quoting our marketing surface.

---

## 4. Capabilities & Scope (v1 vs Vision)

**v1 commitment (the first customer demo):**

- One vertical: **law firm**, one practice-area overlay: **PI plaintiff**.
- 5–7 skills (the specific set is determined by what the first customer needs).
- Tier-0 connector floor + one practice-management adapter (Filevine, SmartAdvocate, or CASEpeer — selected at the first customer meeting).
- 7 dashboard tabs: Today, Queue, Memory, Audit, Persona, Skills, Voice.
- Single persona per customer.
- Captain-operated (SMD founder is the operator).

**Platform vision (post-customer-20):**

Six universal primitive skill families that work across every vertical:

1. Inbox triage and draft
2. Calendar / deadline tracking
3. Document collection orchestration
4. Status updates & client communication
5. Signing coordination
6. Billing reconciliation

Plus cross-cutting universal skills (conflict checking, scope enforcement, escalation routing, voice rule application, memory ingestion, audit logging, red-flag detection) and vertical-specific skills (PI intake triage, demand-letter evidence packets, medical-records chronology, etc.).

**Third-rail (out of scope — never autonomous, never our skill):**

Legal advice, citation-bearing arguments, settlement authority, trust account transactions, court filing submission, anything triggering UPL risk. These require partner review and stay with humans.

**In-flight P0 work** (compete-against snapshots for the live product):

- [#860](https://github.com/venturecrane/ss-console/issues/860) memory ingestion pipeline
- [#861](https://github.com/venturecrane/ss-console/issues/861) per-customer namespace isolation
- [#868](https://github.com/venturecrane/ss-console/issues/868) dashboard routing
- [#869](https://github.com/venturecrane/ss-console/issues/869) drafts list view
- [#870](https://github.com/venturecrane/ss-console/issues/870) Approve & Send flow
- [#871](https://github.com/venturecrane/ss-console/issues/871) Matters tab
- [#879](https://github.com/venturecrane/ss-console/issues/879) OAuth callback
- [#880](https://github.com/venturecrane/ss-console/issues/880) per-user accounts within customer dashboard
- [#881](https://github.com/venturecrane/ss-console/issues/881) "send as" identity wiring
- [#891](https://github.com/venturecrane/ss-console/issues/891) audit log persistence

---

## 5. Tech Architecture (Just Enough to Compare)

You don't need to be an expert here, but the comparison hinges on a few choices:

- **Agent harness:** Hermes (leading candidate, not finalized). All other stack components evaluated independently.
- **Deployment isolation:** per-customer Fly.io Machine (`hermes-{customer-slug}`), per-customer D1 database, per-customer R2 vault for memory + voice samples, per-customer Vectorize index. No shared customer state at the storage layer. ([ADR 0007](../../adr/0007-per-customer-machine-isolation.md), [ADR 0009](../../adr/0009-cross-machine-query-prohibition.md))
- **Memory:** customer-owned artifact, human-readable, version-controlled, customer-editable, customer-exportable. Contractually the customer's. ([ADR 0008](../../adr/0008-customer-owned-memory-artifact.md))
- **OAuth tokens:** stored inside the customer's own Machine filesystem, not in an SMD-owned secret store. No cross-customer token blast radius. ([ADR 0010](../../adr/0010-per-customer-oauth-token-storage.md))
- **Sending pattern:** drafts route to the human reviewer's drafts folder; the reviewer presses send from their own identity. ([ADR 0005](../../adr/0005-reviewer-as-sender.md))
- **Connectors:** pluggable adapter pattern. Skills call a capability interface, not a concrete system — same skill works on Outlook or Gmail, Filevine or Clio, DocuSign or PandaDoc. ([ADR 0006](../../adr/0006-capability-adapter-pattern.md))

Compare each finding against these choices. Where competitors share customer data (multi-tenant DBs, central token vaults), our isolation is a defensible compliance differentiator. Where competitors gate sending through their own identity (auto-send "from the AI"), our reviewer-as-sender is a defensible bar-ethics differentiator.

---

## 6. Pricing Posture

**Locked:**

- Pricing **shape** is flat-monthly per customer. Not per-seat, not per-task, not credit-metered. ([ADR 0004](../../adr/0004-productized-ai-employee-offering.md))
- No dollar amounts are published on smd.services or in marketing. Customers see a price in their proposal.

**Not locked:**

- The actual monthly number. The strategic reference range from market practice (Greg Isenberg / Nick Vasilescu, "$1M+ Solo AI Agent Business" podcast) is $5K–$10K/mo. Our number comes from cost-up analysis once stack is finalized. **Pricing recommendations from this analysis should be a band with reasoning, not a single number.**

**Market context** (already partially established — extend rather than redo):

- Harvey: $1,200–$2,000+/seat/mo, ~20-seat minimum → $24K+/mo floor. Am Law 200 buyer.
- Eve Legal: per-seat, low-three-figures range, 1,000+ PI firms installed.
- EvenUp PLAAS: managed service hybrid, multi-thousand/mo, ~$10M+ in early subscriptions as of May 2026.
- Clio Manage AI / Filevine AI: per-seat add-ons, low double-digits to mid-double-digits per user.

The flat-per-firm shape is unvalidated in legal AI. **Telling us whether any direct competitor has tried it and how it performed is high-value finding.**

---

## 7. Target Customer

**Buying ICP:** Same as the consulting funnel — $750K–$5M revenue businesses. Phase 1 narrowed to PI plaintiff law firms, 3–20 attorneys, 50–150 active matters, on a practice-management system.

**First proof point:** A 20-year PI litigation firm, beta-1 meeting scheduled for **June 2026**. No pre-meeting discovery. Walk-in-cold demo required. They are evaluating multiple vendors.

**Buyer:** Firm partner (writes the check). Power users: paralegal, office manager, case coordinator.

**Entry distinction worth understanding for positioning:**

- The consulting funnel attracts prospects who need discovery to identify the problem.
- AI Employee attracts prospects who arrive self-diagnosed ("we need an agent").

Both are valid front doors. Your analysis should help us understand which competitors win each kind of buyer.

---

## 8. What's Already Done — Don't Redo

A round-1 competitive analysis already exists. Read it before doing new work:

[`docs/pm/ai-employee/prd-contributions/round-1/competitor-analyst.md`](./prd-contributions/round-1/competitor-analyst.md) (2026-05-19, ~425 lines)

It covers:

- Seven competitive clusters with threat ratings (BigLaw research desks, contract drafting, PI demand-letter shops, plaintiff-firm workflow AI, PM-embedded menus, front-of-funnel intake, platform horizontals)
- Deep dives on Harvey, Eve Legal, EvenUp, Supio, Spellbook, Filevine AI, Clio Manage AI, Smokeball Archie, Lawmatics, Lead Docket AI, Microsoft 365 Copilot Legal Agent
- A feature matrix
- Market pricing benchmarks
- "Uncomfortable truths" (where the existing PRDs overclaim or underestimate)
- Competitive response timeline

**Treat that doc as the floor, not the ceiling.** Your job is to (a) verify and update what's stale, (b) extend with what's missing, (c) restructure for the three decisions in §1.

Likely staleness — verify these specifically:

- **Eve Legal 2.0 "AI Workforce"** (January 2026 launch) — round 1 says Eve is "episodic"; that characterization is probably outdated.
- **EvenUp PLAAS** (May 13, 2026 launch) — full pre-litigation managed service. Verify scope, pricing, traction.
- **Law Practice AI** (April 2026 launch, claimed 300+ PI firms, "five-solution AI operating system") — round 1 noted but did not deeply analyze. Most direct shape match to AI Employee. **Priority 1 deep dive.**
- **Microsoft 365 Copilot Legal Agent** (April 2026) — Word-bound today; how fast is Outlook/PM expansion?
- **Harvey mid-market push** — March 2026 blog post about helping mid-sized firms, plus the $200M raise. How real is the downmarket motion?
- **Lawmatics AI Suite** — March 2026 "extends beyond intake" expansion.
- **Smokeball + CoCounsel partnership** — March 2026.

---

## 9. Deliverables We Need

Four artifacts. Format flexible; substance is non-negotiable.

### 9.1 Updated competitor matrix

Same shape as the round-1 cluster table, but with these columns added:

- Does the competitor have a **persistent named identity**? (Y/N + evidence)
- Does the competitor expose **customer-editable memory**? (Y/N + evidence)
- Does the competitor enforce **reviewer-as-sender**? (Y/N — note vendors that *auto-send* externally)
- **Pricing shape** (per-seat / per-task / flat / hybrid) and 2026 price points
- Does the competitor support **multiple distinct named agents per customer** under one subscription? (This is the ADR 0011 differentiator check.)

### 9.2 Three-tier threat assessment

For each direct competitor (Eve Legal 2.0, EvenUp PLAAS, Law Practice AI, plus any new findings):

- **What they do well** — what wins them deals against us.
- **What they don't do** — gaps we exploit on the demo floor.
- **How long until parity** — if they were to ship equivalent multi-persona / editable-memory / reviewer-as-sender capability, what's the realistic timeline based on their public roadmap and engineering velocity?

### 9.3 Pricing band recommendation

A defensible monthly band for AI Employee at v1, with reasoning. Inputs you should use:

- Stack cost analysis (we'll provide our cost-up if asked; default to estimates)
- Per-seat → flat-equivalent math for direct competitors at typical firm sizes (3, 5, 10, 20 attorneys)
- Anchoring against EvenUp PLAAS (closest scope analog)
- Anchoring against the consulting funnel's smallest engagement ($2,500 minimum scoped engagement — see [`CLAUDE.md`](../../../CLAUDE.md))
- Tell us what we'd be leaving on the table at each band.

### 9.4 Demo-floor risk list

The 5–10 specific objections, comparisons, or "but what about X" questions the beta-1 customer is most likely to raise in June. For each, the strongest one-sentence answer we can credibly give today. This is what Captain takes into the meeting.

---

## 10. Out of Scope

Do not analyze:

- Adjacent SMD verticals (we will run that analysis separately when those PRDs exist)
- Non-legal verticals (Phase 3+ concern)
- Build-your-own-agent platforms aimed at developers (Crew, LangChain, etc.) — different buyer
- General LLM benchmarks — model choice is downstream of product positioning
- Internal SMD process or staffing — your job is the market, not us

If you find a competitor that doesn't fit our PI-firm Phase-1 frame but seems strategically important, **flag it in an appendix** rather than expanding scope.

---

## 11. Key References

| Source | Path / URL | What it tells you |
| --- | --- | --- |
| ADR 0004 | [`docs/adr/0004-productized-ai-employee-offering.md`](../../adr/0004-productized-ai-employee-offering.md) | Why this product exists, what's locked, what's deferred |
| ADR 0005 | [`docs/adr/0005-reviewer-as-sender.md`](../../adr/0005-reviewer-as-sender.md) | The core sending pattern |
| ADR 0006 | [`docs/adr/0006-capability-adapter-pattern.md`](../../adr/0006-capability-adapter-pattern.md) | Connector portability |
| ADR 0007 | [`docs/adr/0007-per-customer-machine-isolation.md`](../../adr/0007-per-customer-machine-isolation.md) | Cross-customer isolation |
| ADR 0008 | [`docs/adr/0008-customer-owned-memory-artifact.md`](../../adr/0008-customer-owned-memory-artifact.md) | Memory model |
| ADR 0009 | [`docs/adr/0009-cross-machine-query-prohibition.md`](../../adr/0009-cross-machine-query-prohibition.md) | Isolation enforcement |
| ADR 0010 | [`docs/adr/0010-per-customer-oauth-token-storage.md`](../../adr/0010-per-customer-oauth-token-storage.md) | Token storage |
| ADR 0011 | [`docs/adr/0011-multi-persona-per-customer.md`](../../adr/0011-multi-persona-per-customer.md) | **Multi-persona per customer — read fully** |
| Platform PRD | [`docs/pm/ai-employee/platform-prd.md`](./platform-prd.md) | Full product vision |
| Law-firm PRD | [`docs/pm/ai-employee/law-firm-prd.md`](./law-firm-prd.md) | First vertical |
| Round-1 competitor analysis | [`docs/pm/ai-employee/prd-contributions/round-1/competitor-analyst.md`](./prd-contributions/round-1/competitor-analyst.md) | Existing competitive baseline — don't redo |
| Decision Stack | [`docs/adr/decision-stack.md`](../../adr/decision-stack.md) | All 29 locked decisions; #44 is pricing |
| CLAUDE.md | [`CLAUDE.md`](../../../CLAUDE.md) | Venture-level positioning rules (voice, tone, claims we won't make) |

---

## 12. Timeline & Check-Ins

- **Brief delivered:** 2026-05-21 (today).
- **First check-in:** when you have the competitor matrix updated (§9.1) and want directional feedback before going deeper.
- **Final deliverable:** Captain decides target date when first check-in lands.
- **Hard deadline:** before the beta-1 demo. June 2026 — exact date TBD.

Direct questions to Captain via the channel where this brief was handed off. Findings that conflict with our doctrine (CLAUDE.md, ADRs, Decision Stack) should be surfaced as "we may need to revisit X" rather than silently rejected — sometimes the doctrine is the thing that needs to move.
