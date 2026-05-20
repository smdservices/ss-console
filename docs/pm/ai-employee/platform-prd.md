# AI Employee Platform — Product Requirements Document

> **Status:** v0 draft (2026-05-19). Captain review pending.
> **Companion docs:** Vertical PRDs (`law-firm-prd.md`, future verticals).
> **Source decisions:** ADR 0004 (Productized AI Employee Offering), Decision #44.
> **Supporting strategy:** `docs/strategy/ai-employee-functional-shape-2026-05-13.md`, `docs/strategy/ai-employee-stack-evaluation-2026-05-13.md`, `docs/strategy/ai-employee-connector-coverage-2026-05-14.md`, `docs/strategy/ai-employee-pricing-2026-05-13.md`, `docs/strategy/ai-employee-service-contract-2026-05-13.md`.

## Table of Contents

0. [Scope and Phasing — How to Read This PRD](#0-scope-and-phasing--how-to-read-this-prd)
1. [Executive Summary](#1-executive-summary)
2. [Product Vision & Identity](#2-product-vision--identity)
3. [Product Principles](#3-product-principles)
4. [Target Users & Personas](#4-target-users--personas)
5. [Core Problem](#5-core-problem)
6. [Competitive Positioning](#6-competitive-positioning)
7. [Architecture & Technical Design](#7-architecture--technical-design)
8. [The Universal Skill Spine](#8-the-universal-skill-spine)
9. [Persona & Voice Model](#9-persona--voice-model)
10. [Memory Model & Learning Loop](#10-memory-model--learning-loop)
11. [Trust Ceiling Model](#11-trust-ceiling-model)
12. [Dashboard Information Architecture](#12-dashboard-information-architecture)
13. [Compliance & Privacy Posture](#13-compliance--privacy-posture)
14. [No Lock-In Architecture](#14-no-lock-in-architecture)
15. [Pricing Posture](#15-pricing-posture)
16. [Demo Framework](#16-demo-framework)
17. [Success Metrics & Kill Criteria](#17-success-metrics--kill-criteria)
18. [Risks & Mitigations](#18-risks--mitigations)
19. [Open Decisions / ADRs](#19-open-decisions--adrs)
20. [Phased Development](#20-phased-development)
21. [Glossary](#21-glossary)

---

## 0. Scope and Phasing — How to Read This PRD

This PRD documents **the platform vision in full**. It does not commit SMD to building all of it at once.

**Two reading layers:**

- **The vision layer (most of this document).** The durable architecture, the principles, the long-form skill catalog, the multi-vertical capability shape, the dashboard IA, the compliance posture. This is the platform's north star — what AI Employee becomes at customer #20+. We document it now so downstream decisions don't drift; we do not implement it now.
- **The v1 commitment layer ([§20 Phased Development](#20-phased-development)).** What ships against the first customer engagement. Materially narrower than the vision. Explicitly enumerated.

**The reason for the split:**

A 20-year PI law firm is meeting with SMD in 2-3 weeks to evaluate the product. A pre-launch venture has zero paying customers on either AI Employee or scope-based consulting. Building the full platform vision before the first customer signs is hubris and bad capital allocation. But shipping v1 without documenting the architectural commitments creates technical debt that ossifies wrong abstractions.

The platform PRD is the durable architectural commitment. Phase 1 ships v1. The platform earns its abstractions retroactively, after each customer reveals what's actually load-bearing.

**Specifically: the v1 scope** (full detail in §20):
- **One vertical** (law firm), **one practice-area overlay** (PI), **one customer** (the meeting firm if they sign as beta-1; otherwise a synthetic-data demo customer).
- **Tier-0 connector floor + one PM adapter** (the firm's actual PM system, identified during the meeting and built within 7 days).
- **5-7 skills**, not 30. Selected based on what the meeting reveals as load-bearing.
- **7 dashboard tabs** (Today, Queue, Memory, Audit, Persona, Skills, Voice), not 16.
- **Single-skill-version** runtime; per-customer skill pinning deferred to Phase 4 (when ≥3 customers exist).
- **Captain-operated**, with documented bus-factor mitigation (per §4).

**Venture-priority constraint.** Per ADR 0004, AI Employee is a second front door alongside scope-based consulting. The consulting venture has zero clients as of 2026-05-19 and incomplete go-to-market collateral. **No platform work proceeds past Phase 1 spine until at least one of: (a) the PI firm signs as beta-1, (b) the consulting venture signs an engagement, or (c) Captain explicitly authorizes parallel investment.** This is a load-bearing constraint, not a footnote.

The Strategist critic's "reconsider approach" finding is addressed by this section. The platform/vertical PRD split is preserved (Captain's directive), but the v1 build commitment is bounded explicitly.

---

## 1. Executive Summary

AI Employee is a productized SKU sold by SMD Services. It is a configurable, persistent, learning AI staffer that operates inside a customer's business under one identity, across every operational surface they use (email, calendar, documents, signing, accounting, practice management, etc.). It drafts work in the customer's voice. It never sends to external parties as itself. A named human always reviews and sends.

The product is sold as a flat-monthly per-customer SKU, not per-seat or per-task. The frame is "the first hire your business doesn't have to make." Customers buy headcount substitution for the operational supply chain of their business, not a tool their team uses.

This PRD specifies the **platform**: what is shared across every AI Employee deployment regardless of vertical. The product family launches with a law-firm vertical (see `law-firm-prd.md`); other verticals follow under the same platform.

The competitive white space the platform claims:

- A **named, persistent agent** that lives across the whole lifecycle of work under one identity (not a per-tool feature, not a per-task service, not a research desk)
- **Versioned, customer-editable memory** as a human-readable artifact the customer owns and audits
- **Reviewer-as-sender** as the core abstraction (the agent ghostwrites; the human reviewer signs and sends)
- **Flat-monthly per-customer SKU** instead of per-seat or per-resolution pricing

No competitor in 2026 ships all four. Most ship none.

---

## 2. Product Vision & Identity

**Working name:** AI Employee. Per-deployment, the customer names the persona (see [Section 9](#9-persona--voice-model)).

**Tagline (internal positioning):** The first hire your business doesn't have to make.

**What this is:**

A multi-tenant platform that provisions, runs, and manages persistent AI agents on behalf of customer businesses. Each customer gets a dedicated runtime instance (one Fly.io Machine, `hermes-{customer-slug}`), connected to their actual operational systems via a pluggable connector layer, configured by a single source-of-truth `customer.yaml`, and operated by SMD as a managed service.

The agent has a name, a voice, a persona, a scope, a memory, and a set of skills the customer turns on. Everything that varies between customers is configuration. The platform code is shared. Adding a new customer is a `customer.yaml` and a `provision-customer.sh` invocation.

**What this is NOT:**

- **Not a SaaS the customer self-installs.** SMD operates the runtime. The customer's relationship is with SMD, the agent, and their named persona — not with infrastructure.
- **Not a chatbot.** The agent is not a query-response surface. It is a worker with an inbox, a calendar, a set of standing responsibilities, and a steady output of drafted work.
- **Not an autonomous decision maker.** The agent never finalizes external work product. Every external send, every transaction, every commitment is gated by a named human reviewer. (See [Section 11 Trust Ceilings](#11-trust-ceiling-model).)
- **Not a build-your-own-agent toolkit.** Customers do not author skills, write prompts, or configure tool calls. SMD authors and operates skills; customers configure scope, voice, rules, and trust.
- **Not "AI inside" a tool the customer already uses.** The product is the agent as identity, not a feature inside Clio or Outlook or QuickBooks.

**Voice standard (binding):**

External-facing positioning uses "we / our team" (per Decision #20 venture-wide). The agent's *own* internal-facing voice is its persona's voice (configured per customer). The product never refers to itself as "I" externally — it operates under the customer's named persona.

---

## 3. Product Principles

These constrain every downstream design and feature decision.

**P1. One identity, every surface.** The agent appears as a single named teammate across email, calendar, documents, dashboard, internal comms. It is not eight separate features in eight separate tools.

**P2. Reviewer is always the sender.** No external communication, transaction, or filing goes out under the agent's identity. Drafts go to the human reviewer's drafts folder. The human reviews and sends. This is architectural, not advisory.

**P3. Memory is the customer's, readable and editable.** Whatever the agent learns about the customer's business is exposed as a human-readable, version-controlled, customer-editable artifact. The customer can read it, edit it, delete from it, export it. This is the trust mechanism.

**P4. Connectors are pluggable; skills are connector-agnostic.** A skill calls a capability interface, not a concrete system. The same skill works whether the customer uses Outlook or Gmail, Filevine or Clio, DocuSign or PandaDoc. Adding a system is a new adapter, not a skill rewrite.

**P5. Configuration is the product surface; code is the platform.** Persona, voice, rules, scope, trust ceilings, connector bindings, skill activation — all configuration. The customer's experience of the product is configuring it and watching it work, not waiting for engineering changes.

**P6. The operational supply chain, not the judgment-bearing core.** The agent handles intake, document collection, deadline tracking, status updates, signing coordination, billing reconciliation, scheduling. It does not advise, strategize, valuate, or produce judgment-bearing work. This boundary is principled and constant.

**P7. Closed-loop architecture by construction.** Customer data never trains a public model. The agent runs in a customer-isolated environment. Inputs are not retained beyond the active session unless customer policy requires retention. This is both a privacy posture and a competitive moat against horizontal Copilot-style products.

**P8. The audit trail is a feature, not a back-office artifact.** Every read, every draft, every edit, every send is logged and surfaced. Customers can see what the agent saw and what it did. This is the defense against "how do we know the AI didn't go off the rails" and the cleanest answer to compliance scrutiny.

**P9. No lock-in. Exit is easy by design.** Memory is exportable. Drafts the customer approved and sent are theirs. The agent identity (email address, signature) is releasable. Data on SMD infra is deletable on request. The selling line is "month to month; if it stops being worth what it costs, leaving is easy."

**P10. Persistent learning, not session amnesia.** The agent gets better at the customer's business over time. Every edit, every correction, every promotion of trust is absorbed. The product is a relationship, not a query.

---

## 4. Target Users & Personas

### Persona 1 — The Owner / Principal (Buyer + Power User)

The person who signs the contract and the person who lives with the agent day-to-day. In law: the firm partner. In other verticals: the founder, the practice owner, the managing director. They have built the business over years; they are not "drowning" — they want capacity expansion without hiring, quality consistency, and time back from the bottom 30% of work that drags down their hour value.

What they need from the agent:
- Drafts ready to send when they open their inbox in the morning
- Status visible at a glance — what's pending, what's flagged, what shipped
- Confidence the agent is staying in its lane (the third-rail boundary is firm)
- Voice on their work that sounds like them, not like AI

What kills them on the product: external communication that sounds robotic, memory that has to be re-taught every Monday, a dashboard that requires them to learn something complicated, a single "AI did the wrong thing" incident that's visible to a client.

### Persona 2 — The Designated Operator (Day-to-Day Touchpoint)

Often *not* the principal. The paralegal, office manager, billing coordinator, or admin who interfaces with the agent most. They configure rules, edit memory, promote trust ceilings, watch the queue.

What they need:
- A dashboard that makes the workload visible and tractable
- An obvious way to teach the agent what was right or wrong
- A scope mechanism so they (or the principal) can keep sensitive matters out of the agent's view
- The same persistence the principal has: the agent remembers what they taught it

What kills them on the product: drafts that don't improve over time, scope controls that are hidden or confusing, a queue that just grows.

### Persona 3 — The Captain (SMD Operator)

SMD itself, operating the platform on behalf of customers. The role responsible for: skill authoring, customer onboarding, voice calibration, trust ceiling discipline, monitoring, regression handling, compliance posture, customer success.

What the Captain needs from the platform:
- Single-customer-config provisioning (`bin/provision-customer.sh` works at scale)
- Skill catalog versioning and pinning per customer (no skill rollout breaks an in-flight customer)
- Health, cost, and behavior telemetry per customer instance
- A clean separation between platform code (shared across customers) and customer-specific config (per `customer.yaml`)

What kills the Captain: skill changes that ripple across customers in unpredictable ways, customer-specific code branching, opaque cost telemetry making margin defensibility impossible.

**Captain operational budget per customer (hard constraint):** At steady state (post-onboarding, week 4+), each customer must require ≤2 hours/week of Captain time on average. Features that exceed this budget are design defects, not customer success investments. The §17.1 metrics include Captain weekly hours per customer as a leading indicator of operational sustainability.

**Captain unavailability mitigation (bus factor):**

A productized SKU with a single SPOF on operations cannot scale past first customer. The platform documents the following backup posture in v1:

- **Designated backup operator** (even part-time, even contractual): identified by name in the operations runbook, with read access to all customer Machines and authority to handle the 5-10 most common operational incidents
- **Operations runbook**: living document at `docs/runbooks/ai-employee-ops.md` covering: OAuth refresh failures, skill regression triage, customer-day incident response, voice calibration session protocol, compliance audit packet generation, customer offboarding flow
- **Customer communication template** for Captain PTO: "Captain on PTO [dates]; for urgent issues contact [backup]; non-urgent items queued for return."
- **Bus-factor minimum**: the platform does not onboard customer #5 until the backup operator is named and trained on the runbook. This is a hard Phase 2 gate.

### Persona 4 — The Customer's Clients (Indirect)

The customers' customers. In law: their clients, opposing counsel, courts, vendors. The agent never communicates with them under the agent's identity — they always interact with the human reviewer. But they receive work the agent drafted.

What they need: communication indistinguishable from what the principal would have sent themselves. No tells.

What kills them on the product: any signal that they're interacting with an AI. The product fails the moment a client says "did a robot send me this?"

---

## 5. Core Problem

Across small-to-mid businesses, an unmet demand: an experienced, operational team member who handles the daily supply chain of the business — intake, communication, document collection, deadline tracking, billing reconciliation, scheduling — without the cost, recruitment friction, and management overhead of hiring one.

The four canonical responses today, each insufficient:

1. **Hire a paralegal / admin / office manager.** Real human. $55-95k/year loaded. Recruitment takes months. Management is constant. The role caps out at one person's daily throughput. Vacation, turnover, and ramp-up costs are real.

2. **Buy software to automate parts.** Clio Manage, Filevine, MyCase, Lawmatics, etc. each cover slivers. The business ends up with 4-7 SaaS products, each with its own login, billing, and update cadence. The customer is the glue between them.

3. **Buy "AI features" inside the software they already have.** Clio Manage AI, MyCase IQ, Filevine AI, etc. Capability menus, not agents. No identity, no memory, no cross-tool reach. The principal still has to context-switch between four tools to see anything.

4. **Buy a vertical "AI worker" for one task.** Eve Legal (PI workflow), EvenUp (demand letters), Harvey (research), 11x.ai (SDR). Each is a single-skill point solution. Buying five gets you five logins and zero coordination.

The unmet need: **one identity, every surface, persistent memory, customer voice, never sends, transparent and editable.** No competitor in 2026 ships this. AI Employee does.

---

## 6. Competitive Positioning

The legal-AI landscape clusters into seven shapes; AI Employee occupies a distinct white space adjacent to all of them.

| Shape | Examples | Where it ends |
|---|---|---|
| **BigLaw research desk** | Harvey ($11B val), CoCounsel (Westlaw), Lexis+ Protégé | $100-$1200/seat/mo; research-shaped; no operational reach; BigLaw-only |
| **Contract drafting in Word** | Spellbook ($20-$350/seat) | Single-skill, Word-bound, no matter awareness |
| **PI demand-letter shop** | EvenUp ($300-800/case), Precedent, Tavrn, Supio | Per-case; demand-only; not a teammate |
| **Workflow-AI for plaintiff firms** | Eve Legal (800-1000+ firms) | Per-seat; episodic tasks + nightly auditor; no versioned memory, no reviewer-as-sender |
| **PM-embedded capability menu** | Clio Manage AI, MyCase IQ, Filevine AI, Smokeball Archie | Feature menu, not agent identity; locked to one tool |
| **Front-of-funnel intake AI** | Lawmatics, Lead Docket AI, Intaker | Stops at conversion |
| **Platform horizontal AI** | Microsoft 365 Copilot (with absorbed Robin AI tech, April 2026) | Generic — doesn't know matter, firm rules, or partner voice |

### The four pillars of differentiation

**1. Productized as an employee, not a tool.** Flat-monthly per-customer SKU. Reframes the buying decision from "how many seats" to "do we want this team member" — the cognitive model customers already use for headcount.

**2. Multi-skill across the lifecycle under one identity.** Every other operational AI is either single-skill (EvenUp = demands) or single-surface (Lawmatics = intake). AI Employee covers intake → conflict → engagement → status → signing → billing → red-flag → closing under one persona, one memory, one voice.

**3. Versioned, customer-editable memory.** No 2026 competitor exposes what the agent has learned as a human-readable, edit-controlled artifact. Supio gestures at voice learning for demands; Eve has firm-level case-value learning. Neither lets the customer read or edit. This is both a UX differentiator and a trust mechanism.

**4. Reviewer-as-sender as core abstraction.** Every defensible governance pattern in 2026 ABA guidance says "named human reviewer per output." No vendor builds this into the product flow. AI Employee does — drafts go to drafts, reviewer sends from their own identity, audit log captures the diff between draft and send.

### Demo-day positioning one-liner

> "Harvey is a research desk. EvenUp is a demand-letter shop. Clio Duo is a feature inside your PM. Hermes is the staffer — one identity, every surface, drafts in your voice, never sends, and you can read and edit what it knows about your firm."

This frame adapts per vertical by swapping references. For non-legal verticals: "Tool X solves this slice. Tool Y solves that slice. Hermes is the staffer — one identity, every surface, drafts in your voice, never sends, and you can read and edit what it knows about your business."

### 6.5 Two demo framings (substitution vs. capacity multiplier)

The "first hire your firm doesn't have to make" framing is buyer-fragile. It works for firms saying "I can't hire fast enough." It fails — or backfires — for firms loyal to existing staff who hear "we're going to replace Sarah." The platform supports two demo framings; the demo opener listens for the signal of which to use:

**Framing A — Headcount substitution.** Use when the customer's discovery answers reveal hiring difficulty, wanting to scale without payroll, or operational stress. The frame: "the first hire you don't have to make." Anchor against $55-95k loaded paralegal salary. Works at firms that are growing capacity-constrained.

**Framing B — Capacity multiplier.** Use when the customer is loyal to existing staff, says things like "I love my team," or expresses concern about displacement. The frame: "Sarah keeps her job. She stops doing the bottom 30%. You stop hiring Sarah #2 when you grow." Anchor against the *incremental* cost of expansion. Works at established firms with stable teams.

**Signal triggers** (the demo opener listens for):
- Framing A: "we can't hire fast enough," "the recruiter brought us junk," "I don't have time to train another paralegal," "we're slammed"
- Framing B: "Sarah's been with us 15 years," "I love my team," "I'm not looking to cut headcount," "I just need more from what I have"

The Captain conducts the demo with whichever framing fits, never both. Mixing framings mid-demo loses both buyers.

---

## 7. Architecture & Technical Design

### 7.1 Multi-tenant model

One Fly.io Machine per customer (`hermes-{customer-slug}`). The Hermes agent runtime is pinned to a content-hash SHA. Each Machine is isolated by default — no cross-customer data flow. The Captain operates the fleet of Machines; SMD's control plane provisions, monitors, and updates them.

Multi-tenancy is achieved through *deployment isolation*, not *runtime tenancy*. Customer data lives in their Machine's bound storage. Memory queries do not span customers. Connector credentials are per-customer-yaml.

This shape is locked in `docs/strategy/ai-employee-stack-evaluation-2026-05-13.md`.

### 7.2 The capability-interface + adapter pattern

Skills bind to abstract **capability interfaces**, not concrete connectors. A skill that opens a matter calls `PracticeManagement.create_matter(client, type, attrs)`. The skill does not know whether Clio, Filevine, PracticePanther, or a hand-rolled CSV importer fulfills the call.

Capability interfaces (sketch — full set defined in `ai-employee/capabilities/`):

- `PracticeManagement` — search/create/update/list entities (matters, contacts, etc.), time entries, billing entries, documents
- `Email` — watch inboxes, read threads, create drafts, apply labels
- `Calendar` — read/create/update events, suggest time, attendee management
- `DocumentStorage` — store/retrieve/version documents and folders
- `ESign` — send for signature, get envelope status, resend, download completed
- `CourtAccess` — case law lookup, docket query, citation extraction (read-only)
- `Payments` — payment requests, transaction lookup (no autonomous trust transfers)
- `Accounting` — invoice draft, AR query, expense entry
- `IntakeCRM` — lead intake, lead status, intake form responses
- `CallTracking` — call records, call recordings, attribution data
- `InternalComms` — Slack/Teams channel posts, DMs, mentions

Concrete adapters live at `ai-employee/connectors/{capability}/{system}/` and implement the relevant interface.

### 7.3 `customer.yaml` as the wiring layer

Each customer has one `customer.yaml` declaring: persona, voice, vertical, region, connectors per capability, skills enabled, trust ceilings, scope, escalation rules.

```yaml
customer: smith-pi-firm
vertical: law-firm
practice_areas: [personal-injury, workers-comp]
region: us-west-2 (lax)
persona:
  name: Marcus
  signature_html: ...
  avatar_url: ...
  tone: warm-but-professional
connectors:
  Email: microsoft-graph
  Calendar: microsoft-graph
  DocumentStorage: sharepoint
  PracticeManagement: filevine
  ESign: docusign
  CourtAccess: courtlistener
  Payments: lawpay
  Accounting: quickbooks-online
  IntakeCRM: lead-docket
  CallTracking: callrail
  InternalComms: microsoft-teams
skills:
  - inbox-triage-and-draft: { trust: draft_for_review, scope: [partner, intake] }
  - conflict-check: { trust: autonomous_read }
  - law-pi-intake-triage: { trust: draft_for_review }
  - signing-page-chase: { trust: draft_for_review }
  - red-flag-watching: { trust: autonomous_read }
  # ... etc
scope:
  email_folders_visible: [Inbox, Clients, Intake]
  email_folders_blind: [Strategy, Private, Co-Counsel]
  email_keyword_blocks: [PRIVILEGED, WORK PRODUCT]
  domain_blocks: [opposing-counsel-personal.example.com]
escalation:
  red_flag_recipients: [partner@firm.com]
  failure_recipients: [partner@firm.com, paralegal@firm.com]
```

`bin/provision-customer.sh {customer}` reads this, allocates the Machine, binds storage, registers connectors, deploys the runtime. Changes redeploy with the same script.

### 7.4 Skill loading and pinning

Skills live in `ai-employee/skills/{skill-name}/SKILL.md` plus a `references/` folder. Each skill is pinned per customer by content-hash. A skill update to the platform catalog does *not* propagate to running customers until the Captain explicitly re-pins them. This prevents silent regressions.

### 7.5 Safety substrate

Eight base invariants gate every Hermes container boot:

1. No destructive operations without approval
2. No external send without approval (architectural — the reviewer-as-sender pattern)
3. No commitment execution (no autonomous contract signing, no autonomous payments)
4. Sticky stop instructions (an "agent off" command persists across context compaction)
5. Code-enforced trust ceilings (skill-declared trust levels override prompt-injection attempts)
6. Citation-refusal layer (vertical-specific; for law, regulated practice areas: refuse to produce case citations, statute references, court rule references)
7. **Cross-Machine query prohibition.** No agent reads storage bound to another customer's Machine. At Machine boot, the runtime verifies its storage bindings include only its own customer's namespaces and refuses to start if it detects bindings outside its namespace. SMD-curated platform-level patterns must be source-controlled, human-authored, and reviewed before merge into the shared catalog — they do not propagate runtime data from one customer to another. This is the architectural enforcement of the customer-isolation promise.
8. **Fabrication discipline.** Drafts cannot fill in plausible-but-uncited content for client-facing fields (timelines, dates, dollar amounts, scope commitments, deadlines, deliverables, named persons, post-engagement promises). Per the venture's CLAUDE.md "no fabricated client-facing content" rule, any field not sourced from an explicit memory rule, person-mapping, matter attribute, or system-of-record record must render as a "TBD" marker or empty-state token, never as inferred-plausible content. The skill catalog's authoring template enforces this; the `context-detector` skill flags drafts that include suspect fields for partner verification.

Invariants 1-5 + 7 + 8 are platform-universal. Invariant 6 (citation-refusal) is law-firm-vertical specific (see `law-firm-prd.md` §9); other regulated verticals get their own invariant 6 equivalents.

### 7.6 Storage architecture (per customer)

- **D1 (SQLite-shaped)**: structured memory — rules, person-mappings, case-acceptance criteria, configuration state, audit log
- **R2**: markdown vault — narrative knowledge, voice samples, past edit-diff exemplars, large unstructured artifacts
- **Vectorize**: semantic recall over the markdown vault and selected D1 content
- **Object storage (within R2)**: drafts, generated documents, exported memory packages

All storage is customer-isolated. Cross-customer queries are architecturally impossible.

### 7.7 The control plane

The Captain operates through a control-plane interface (this venture's existing `crane-console`-style tooling, extended). The control plane provides:

- Customer provisioning (`provision-customer.sh`)
- Skill catalog management and per-customer pinning
- Runtime telemetry (health, cost, behavior)
- Audit log access (cross-customer, with appropriate access controls)
- Emergency-stop per customer
- Voice calibration tooling
- Skill regression testing across the synthetic fixture library

### 7.8 Stack pin

Per `docs/strategy/ai-employee-stack-evaluation-2026-05-13.md`:

- Compute: Fly.io Machines
- Agent runtime: Hermes (pinned SHA, behind a pluggable `AIEmployee` adapter for future runtime swap)
- Connectors: Composio (managed) + native MCP (vendor or community) + custom MCP wrappers (8 Tier-1 declared)
- Memory: D1 + R2 + Vectorize per customer
- Email identity: AgentMail (for internal-facing presence; external send uses the reviewer's account)
- Build harness: Claude Code
- Per-customer config: `customer.yaml`

---

## 8. The Universal Skill Spine

Six universal primitives + nine cross-cutting universal skills + six specialized dedicated skills (defined in vertical PRDs) + practice-area overlays (defined in vertical PRDs). The spine works across every vertical the platform will ship.

### 8.1 The six universal primitives

The primitives that exist in every business that hires a paralegal-shaped role:

| Primitive | What it does | Configuration per vertical/customer |
|---|---|---|
| **intake-and-conflict** | Structured intake of new prospects/customers, conflict check, matter/account open | Fields, conflict-check parties, engagement-letter template, jurisdiction handling |
| **document-collection** | Open document checklists per matter type; nudge customers/sources for outstanding items; verify receipt | What to collect, reminder cadence, receipt verification heuristics |
| **deadline-docketer** | Track and remind on deadlines (statutes, agency response windows, court dates, contract renewals, custom dates) | Deadline rule source per matter type, lead-time policy, escalation thresholds |
| **status-update-generator** | Draft periodic status updates to customers' counterparties (clients, vendors, etc.) | Templates per matter type, cadence, sensitivity level |
| **signing-coordinator** | Track outstanding e-sign envelopes; draft and queue reminders; route returned documents | Signing topology (single vs multi-party), witness/notary, originals-vs-electronic |
| **billing-reconciliation** | Time/expense entry, invoice drafting, AR chase drafts, trust-account reconciliation | Fee model (hourly/contingent/flat), trust rule jurisdiction, reconciliation cadence |

These six are not law-specific. The same primitive runs for a corporate law firm, a real-estate brokerage, a medical practice, an accounting firm, a custom-build contractor. Configuration changes; primitive does not.

### 8.2 The nine cross-cutting universal skills

These supplement the primitives — they are the front door, the safety net, and the operating layer.

| Skill | Role |
|---|---|
| **inbox-triage-and-draft** | The agent's front door. Watches relevant inboxes, categorizes by action class and priority, drafts replies, applies labels |
| **morning-digest** | First-thing-of-day brief: what's pending review, what's overdue, what's coming, what changed |
| **red-flag-watching** | Pattern-based monitoring: late payments, hostile tone, ghosted clients, AR aging, missed touchpoints. Surfaces to the principal |
| **memory-curator** | Continuously refines voice + rules from edits and corrections. Surfaces weekly "I learned X from your edits" digests |
| **context-detector** | Identifies high-risk contexts (court-bound drafts, regulatory submissions, customer-facing transactions) and flags for verification. Per vertical, the "high-risk" definitions are configured |
| **engagement-letter-jurisdictional** | Standard engagement language with jurisdictional clauses (e.g., AI-disclosure language for PA/Utah clients). Per vertical, the legal/regulatory baseline differs |
| **compliance-audit-export** | On-demand generation of compliance evidence packets — audit log, model lineage, data retention proof, DPA/BAA references |
| **privilege-scope-guard** | Pattern-detect privileged/sensitive content; tighten read scope, flag for human attention. Per vertical, privilege definitions vary |
| **referral-thank-you + review-request** | The business-development pair. New customer from referral source → thank-you to source. Positive outcome → review-request at the right interval |

### 8.3 The specialized + overlay model

Beyond the spine, every vertical adds:

- **Specialized dedicated skills** — work that doesn't reduce to configuration of the primitives. Defined per vertical (see law-firm-prd.md §6).
- **Practice-area overlays** — additional skills + configuration packs for sub-segments within a vertical. Defined per vertical.

The platform commits to: primitives + cross-cutting universals + adapter pattern. Verticals commit to: specialized skills + overlays + per-vertical configurations + per-vertical connector strategy + per-vertical demo design.

### 8.4 Skill anatomy (binding for all skills)

Every skill ships as:

- `SKILL.md` — frontmatter (name, vertical/universal, trust ceiling default, connector bindings, cost estimate) + body (capability description with voice rule front-loaded in description per Phase A.6, output spec, invocation triggers)
- `references/voice.md` — full voice rules (long-term canonical, even if the runtime's reference-loading is patchy)
- `references/output-format.md` — exact structure of the output artifact
- `references/categorization-rubric.md` — decision rubric with vertical/practice anchors
- `references/test-cases.md` — synthetic fixture inputs + expected outputs
- `references/{vertical}-policy.md` (vertical-specific) — invariants and constraints relevant to the vertical (e.g., citation policy for law)

Voice rules are *front-loaded in the SKILL.md description* (not just in `references/voice.md`), because Hermes' current skill loader surfaces description at invocation time but doesn't reliably load references. This is Phase A.6 discipline; it applies to every skill the platform authors.

---

## 9. Persona & Voice Model

### 9.1 The persona is a first-class configuration artifact

Each customer's agent has a fully developed persona, declared in `customer.yaml` and rendered consistently across surfaces:

| Element | What it is | Source |
|---|---|---|
| **Name** | A human first-name (e.g., "Marcus," "Sarah," "Aiden") | Customer picks during onboarding; SMD suggests defaults appropriate to the vertical |
| **Pronouns + voice register** | Gender-neutral by default ("they/them"); customer-overridable | Customer choice |
| **Signature** | HTML signature block with name, title ("AI Associate" / "AI Operations" / etc.), customer firm/business, and required disclosure language (see §13) | SMD generates from `customer.yaml`; per-state/regulation language injected |
| **Avatar** | Professional, generated, neutral, consistent across surfaces | SMD-generated during onboarding; customer-replaceable |
| **Tone descriptors** | 3-5 adjectives ("warm-but-professional," "concise," "never effusive," "always end with thanks") | Customer-curated, layered on vertical baselines |
| **Voice samples** | 10-20 anchor samples of real (sanitized) sent communications | Customer uploads during onboarding; mandatory minimum before first external draft |

### 9.2 Internal vs external persona

**Internal-facing** (dashboard, internal comms, principal-and-staff interaction): The persona is fully visible. The agent is openly an AI Employee named Marcus (or whatever). Disclosure is built in; the audit log uses the persona name; internal Slack/Teams posts come from the persona.

**External-facing** (communication to the customer's customers, vendors, opposing counsel, courts): The persona does not exist externally. Drafts go to the human reviewer's drafts folder under the reviewer's identity. The reviewer sends from their own account. The recipient sees only the reviewer's signature.

This split is principled, ethics-defensible (see §13), and removes any deceptive externality. The persona is for the customer's relationship with their agent, not the customer's customers' relationship with the customer.

### 9.3 Voice configuration model (hybrid)

Voice is configured in three layers, with Layer 3 promoted to v1 (was previously deferred — voice is the kill criterion for the entire product, so per-recipient modulation cannot wait).

**Layer 1 — Explicit rules** (declarative, fast iteration):
- Tone register (formal/conversational/warm)
- Banned patterns (no em dashes, no exclamation marks, no contractions, etc.)
- Required patterns (always end with "thank you," always sign with first name, etc.)
- Stylistic guardrails (sentence length max, paragraph density, hedging discipline)

**Layer 2 — Anchor samples** (extractive, slow iteration):
- **30-50** real sent communications uploaded by the customer (revised from 10-20 — single-speaker voice models below ~30 samples reliably fail blind tests against people who know the writer)
- Categorized: to-client, to-vendor, to-counterparty
- Pre-demo bootstrap path: SMD scrapes the customer's published writing (firm About page, partner-attributed blog posts, Recent Verdicts) before the meeting to seed a 10-sample anchor pack. The first real demo draft uses this bootstrap; full samples come during onboarding.
- Agent references at draft time

**Layer 3 — Per-recipient voice cohorts (v1, not deferred):**
- The reviewer's voice differs by recipient class (anxious client vs. opposing counsel vs. routine vendor). Layer 3 declares cohorts in `customer.yaml` and binds samples + tone descriptors per cohort.
- Continuous voice sampling (auto-resampling from reviewer's sent folder, with explicit permission per §10.4 constraints) is v2.

### 9.4 Voice violations and learning

The agent self-monitors voice rule compliance pre-send. Detected violations: agent re-drafts. Surfaces "this week Marcus caught and corrected N voice violations" in the dashboard.

When the reviewer edits a draft before sending (see [§10 Memory](#10-memory-model--learning-loop)), the agent ingests the diff as a voice-correction signal. Cumulative edits update voice models for the next draft.

### 9.5 Voice configuration UI (dashboard)

The dashboard's Voice tab provides:

- Rules editor (categorized, free-text + checkbox)
- Samples library (uploadable, taggable, deletable)
- **Test sandbox** — paste a scenario, see how the agent would draft it; iterate the rules. This is the customer's primary calibration tool.
- Violation log: "this week's caught violations." Builds confidence.

### 9.6 Voice quality gates (before first external draft)

Voice indistinguishability is the platform's most important kill criterion (§17.1). It's also the dimension with the highest failure risk and the weakest detection signal (clients don't usually say "this feels AI"; they quietly migrate). The platform enforces three gates before any external draft ships:

**Gate 1 — Sample minimum**: ≥30 anchor samples loaded into Layer 2, distributed across recipient cohorts. Pre-demo bootstrap from public writing (§9.3) counts toward this minimum at demo time only; production beta requires customer-uploaded samples.

**Gate 2 — Captain-led calibration session**: A scheduled 4-6 hour Captain session with the customer (typically the reviewer + designated operator). Walk through the test sandbox. Run 20+ scenarios per cohort. Tune rules iteratively. Document the agreed voice envelope in `customer.yaml`.

**Gate 3 — Blind-test protocol**: Before the first external draft ships under the reviewer's name, run a blind test:
- 10 reviewer-written + 10 agent-drafted communications, unlabeled, presented to 3 people who know the reviewer well (other partners, longtime staff)
- **Acceptance threshold**: ≥80% indistinguishability (judges cannot reliably identify which is which)
- If <80%: voice recalibration required; first external draft does not ship

**Ongoing adversarial-detection metric**: Quarterly, sample 20 agent-drafted-then-sent communications and run an LLM-judge against them scoring "AI-likely" vs "human-likely." Track the trend in the dashboard's Health view. If "AI-likely" rate climbs above 30%, trigger recalibration. This addresses the silent-degradation failure mode the "voice violation rate" metric alone misses.

**Leading indicators of voice failure** (surfaced in Health view):
- Opposing-counsel-initiated requests to communicate by phone instead of email after agent goes live (often a tell that recipients sense something off)
- Customer's clients increasingly Bcc'ing the partner or asking "is this really from you"
- Reply rate to agent-drafted-then-sent communications dropping vs. baseline

---

## 10. Memory Model & Learning Loop

The single most differentiated product surface. No 2026 competitor exposes memory as a human-readable, edit-controlled, customer-owned artifact.

### 10.1 Memory layers

| Layer | What it holds | Storage |
|---|---|---|
| **Hard rules** | Explicit constraints set by the customer ("we don't take medmal under $1M," "always CC paralegal Sarah on new intake," "no contingency offers under $50k") | D1, structured rows |
| **Person-mappings** | Who's who at the customer's firm + key counterparties ("Sarah is intake paralegal," "Karen Chen is the senior partner," "Acme Insurance's adjuster is Bob") | D1, structured rows |
| **Process knowledge** | How the customer handles common workflows ("intake takes 48h max from form submission to first reply," "all settlement statements go through Karen before client") | R2 markdown, retrievable |
| **Voice samples** | Real sent examples that anchor the agent's writing | R2 markdown, retrievable + Vectorize-indexed |
| **Past corrections** | The diff history of "what the agent drafted vs what the reviewer actually sent," with corrections distilled | R2 markdown + Vectorize-indexed |
| **Audit log** | Every action the agent took, with timestamps and inputs/outputs | D1, immutable rows |

### 10.2 Learning sources (the closed loop)

The agent updates memory from five signals:

**1. Edit-then-send (highest-quality signal).**
Reviewer edits the agent's draft before sending. Agent diffs (draft vs sent), stores the delta as a correction signal. Voice-related deltas update voice models; content-related deltas update process knowledge. *This is the cleanest learning signal* — the reviewer has done the work to refine the agent's output.

**2. Rejection signal.**
Reviewer archives/deletes the draft without sending. Agent flags as rejection. Optional follow-up prompt in dashboard ("I noticed you didn't send the draft to Karen. Was it off, or no longer needed?"). Skippable, never blocking.

**3. Direct correction in thread.**
Reviewer replies to the agent's draft thread with text ("no, we don't do that anymore"). Agent treats as teaching, surfaces in dashboard for confirmation.

**4. Direct teach via dashboard.**
Reviewer adds a rule to Memory tab directly ("we don't take cases under $50k"). Hard rule, applied immediately. Categorized (rule / voice / process / person). Versioned.

**5. Promotion/demotion signals.**
Reviewer promotes a skill to autonomous, or pauses one. Agent updates its self-model. Visible in dashboard.

### 10.3 The Memory tab (the trust mechanism)

The dashboard's Memory tab is **the** product surface for trust. It exposes:

- **What Marcus knows about your firm** — every hard rule, person-mapping, process note. Human-readable. Versioned. Editable. Deletable.
- **What Marcus learned this week** — distilled from edits. Surfaces aggregated, with source references ("based on 12 of your edits last week, Marcus updated voice on closing salutations").
- **Voice samples and rules** — see §9.5.

The customer can edit any memory item. Edits propagate immediately (hard rules) or with confirmation prompts (voice rules where the cascade is broader). Deleted items are removed from memory; the audit log retains the historical record.

### 10.4 Mechanics: how the agent knows what got sent

**V1 default: OFF.** Sent-folder watching is opt-in per-customer, not on-by-default. The privilege-protection and confidentiality posture requires it.

Two paths, in order of preference, both opt-in:

**Path A — Sent-folder watching with structural-diff-only storage (v1 opt-in).**
When the customer opts in, the agent monitors the reviewer's Sent folder. For each outbound matching a prior draft:
- The agent computes a *structural delta* — formatting changes, salutation pattern, sentence-count delta, paragraph rearrangement, voice-rule violations caught.
- The agent does NOT persist the substantive content of the diff. Sensitive content (substantive legal language, settlement terms, opposing-party text) is content-redacted before storage.
- Storage: structural delta to R2 + Vectorize-indexed pattern tokens only.

Scope constraints (enforced in `customer.yaml`):
- Never watch threads to recipients in `domain_blocks`
- Never watch threads with subject-line keyword blocks (e.g., `PRIVILEGED`, `WORK PRODUCT`, `PRIVATE`)
- Never watch threads to opposing counsel, courts, or co-counsel domains
- Per-skill enable: a customer may opt sent-folder watching ON only for skills where the learning signal is needed (e.g., `inbox-triage-and-draft`), not for all skills

**Path B — Send-through-agent (sharper signal, full content visibility, v2).**
Reviewer clicks "send" via a dashboard surface or lightweight add-in. Agent sees the exact final version with full content. Cleaner learning signal, higher friction. Opt-in per-customer.

**Confidentiality posture:**

The §13.1 "no training on customer inputs" claim is preserved by this design: the structural-delta-only storage is *retrieval indexing of formatting patterns*, not substantive content. We distinguish:

- **Training**: building or fine-tuning a model with customer content. SMD does not do this. Per §13.1.
- **Indexing for retrieval**: storing patterns the agent retrieves at draft time. The platform does this only on structural-diff data, not substantive content. Substantive customer content is read at draft time (per active session needs) and not persisted.

This distinction is contractually documented in the DPA (§13.1).

**Privilege-protection posture:**

Sent-folder watching, even at structural-diff-only, may surface privilege questions in the customer's bar/ethics review. The platform supports two postures per customer:

1. **Opt-out (default)**: no sent-folder watching. Memory learns only from explicit corrections and the test sandbox. Slower voice convergence; zero privilege exposure.
2. **Opt-in with scope**: as above, with the scope constraints. Customer's compliance counsel signs off in writing before activation.

The customer chooses. The platform makes the privacy-safe default the path of least resistance.

### 10.5 Memory isolation

Per [§7.1 Multi-tenant model](#71-multi-tenant-model), memory is per-customer. No cross-customer learning unless explicitly authored (e.g., "best practices" patterns identified at the platform level by SMD, applied across customers as platform improvements, never carrying customer-specific content).

---

## 11. Trust Ceiling Model

The product's safety architecture and the principal's confidence dial.

### 11.1 The three trust ceilings

| Ceiling | What it means | Examples |
|---|---|---|
| **autonomous** | Agent acts without per-action review. Logged in audit but no draft step. | Read-only operations (conflict-check returning "no conflict"), monitoring (red-flag detection), internal status reports |
| **draft_for_review** | Agent drafts; named human reviewer must approve before any external action. | All external communications, all transactions, all matter writes, all signing requests |
| **disabled** | Agent does not run this skill at all. | Customer-disabled or trust-revoked skills |

### 11.2 The default ceiling per skill

Every skill ships with a default trust ceiling. The defaults are conservative:

- **Read-only / monitoring / internal**: `autonomous` allowed by default
- **External communication, drafts, transactions, writes to matters**: `draft_for_review` mandatory
- **Anything touching trust accounting, court filing, settlement authority, judgment-bearing work**: `draft_for_review` permanently; cannot be promoted to autonomous

### 11.3 Promotion mechanics

The customer can promote a `draft_for_review` skill to `autonomous` for skills where promotion is permitted. The promotion is:

- Surfaced in the dashboard (Skills tab)
- Logged in the audit trail with timestamp and actor
- Reversible at any time (demotion is one-click)
- Subject to platform-level guardrails — some skills are non-promotable regardless of customer wishes (see §11.2)

### 11.4 Audit log

Every action at every ceiling is logged. Every promotion/demotion is logged. The audit log is exportable (compliance evidence) and queryable in the dashboard (Activity tab and a dedicated Audit view).

### 11.5 Sticky stop

A "pause all skills" action is available from the dashboard. Stop persists across context compaction, agent restarts, skill reloads. Resuming is an explicit action. Per safety invariant #4.

---

## 12. Dashboard Information Architecture

The dashboard is the customer's cockpit. Two halves: **information** (what the agent did/is doing) and **configuration** (what the agent is allowed to do). Designed for the Designated Operator persona; principal-friendly summary views surface to the top.

### 12.1 V1 dashboard surface (ships in Phase 1)

The full dashboard vision is 16 tabs. **V1 ships 7 tabs**, sized to what a single customer actually uses in the first 60 days. Additional tabs ship in Phase 4 (per §20) when the customer base reveals which ones are load-bearing.

**V1 information views (4 tabs):**

| View | Primary user | Content |
|---|---|---|
| **Today** | Principal | Headline metrics (drafts pending review, items flagged, recent absorbed corrections), action queue summary |
| **Queue** | Operator | All pending drafts, sortable by skill / age / priority / matter |
| **Memory** | Both | What the agent knows (per §10) — read, edit, delete |
| **Audit** | Both + Compliance | Full audit log, exportable, queryable |

**V1 configuration views (3 tabs):**

| View | Primary user | Content |
|---|---|---|
| **Persona** | Principal (initial); Operator (ongoing) | Name, signature, voice samples, photo, tone — see §9 |
| **Skills** | Operator | Skill catalog visible to this customer; activation, configuration parameters, trust-ceiling controls |
| **Voice** | Principal + Operator | Rules editor, samples library, test sandbox, violation log, blind-test results (per §9.5–9.6) |

### 12.2 Deferred dashboard surface (Phase 4)

These ship after Phase 1's 7-tab v1 surface is proven against the first customer:

| View | Phase | Why deferred |
|---|---|---|
| **Activity** | Phase 4 | Audit view covers the compliance case for v1; full chronological feed shipped when customer needs it for ops |
| **Flags** | Phase 4 | Subset of Today view; broken out when single-view aggregation isn't enough |
| **Health** | Phase 4 | Captain-internal in v1 (control plane); customer-facing view ships when self-service connector management is needed |
| **Rules** | Phase 4 | Folded into Memory tab in v1; broken out when rule-categories become large enough to need their own UI |
| **Connectors** | Phase 4 | SMD-managed in v1 (Captain handles OAuth); customer-facing when self-service is needed |
| **People** | Phase 4 | Hardcoded in `customer.yaml` in v1; UI ships when multi-user firm dashboards land |
| **Schedule** | Phase 4 | Default-on in v1 (business hours from `customer.yaml`); UI ships if needed |
| **Compliance** | Phase 4 | DPA/BAA delivered as PDF in v1; in-dashboard view ships when audit packet generation is needed at scale |
| **Billing/Usage** | Phase 4 | Captain-internal cost dashboard in v1 (see §15.1); customer-facing transparency view ships at scale |

### 12.3 The headline summary (the "this is working" line)

Top of dashboard, weekly:

> "This week: Marcus drafted 47 replies, sent 42 with your approval, flagged 3 for review, learned from 6 of your edits."

Four elements:
- **Volume** (47 drafts) — proves it's working
- **Trust** (42/47 = 89% approval rate) — proves accuracy
- **Attention** (3 flagged) — directs the principal
- **Learning** (6 edits absorbed) — proves the loop is closing

No "hours saved" estimate at demo or beta-1 — calibration is too soft and a wrong number burns trust. Reintroduced once 60 days of real customer data exists for calibration.

### 12.4 Monthly executive recap (artifact)

End of each month, the dashboard generates a one-page "Marcus's month at {firm}" recap: volume, top categories, top corrections, suggested next-skill promotion. Single email, single attachment. This is the artifact the principal forwards to non-tech-fluent partners; the social object that explains the agent.

### 12.5 Scope/audit set-piece

A dedicated dashboard view: **"What the agent saw this week."** Filterable by sender, by folder, by subject. Shows the agent's read trail with timestamps. The principal can confirm scope is being respected, mark threads "agent-blind," and trust by inspection.

This view is the compliance-defense artifact. When the customer's compliance officer asks "how do we know the AI didn't go off the rails," this is the answer.

---

## 13. Compliance & Privacy Posture

The compliance posture is a sales asset, not a back-office artifact. Customers in regulated verticals (legal, healthcare, financial services, real estate) will probe; we ship a defensible package.

### 13.1 The three architectural controls

**1. Closed-loop architecture, contractually verifiable.**

Specifically, the platform commits to:
- **No training on customer content.** SMD does not train, fine-tune, or update any model with customer inputs. "Training" means modifying model weights.
- **Bounded indexing.** The platform indexes content for retrieval (Vectorize semantic search, R2 markdown vault). Indexing is distinct from training. The platform indexes only: (a) explicit customer-curated content (voice samples uploaded, memory rules entered, process knowledge declared), (b) structural-diff data per §10.4 Path A (formatting patterns, not substantive content), and (c) the customer's curated narrative knowledge (per §10.1). Substantive client communication content is not indexed.
- **Session-bounded reads.** Substantive customer content (matter records, client emails, documents) is read at active draft time. Reads are not persisted into indexes; they exist only within the active draft session.
- **DPA and BAA.** SMD signs a Data Processing Addendum with every customer. BAAs (HIPAA) available for verticals where applicable.
- **Per-customer infrastructure isolation** (one Machine per customer, per §7.1; cross-Machine query prohibition, per invariant #7 in §7.5).
- **Privilege-protection.** AI-generated content is not subject to third-party-tool waiver risk because: (a) the customer's Machine is dedicated to them, (b) no content flows to a public model, (c) the DPA establishes the agency relationship for privilege purposes. Per Judge Rakoff's February 2026 ruling, closed-loop AI architectures with documented data-handling preserve privilege; open architectures may not.

The "no training vs. bounded indexing" distinction is critical and explicitly documented in the DPA. The §13 compliance posture stands or falls on its credibility.

**2. Mandatory human review before any external action.**
- Architecturally enforced via the reviewer-as-sender pattern (§9.2).
- No skill at any trust ceiling sends external communication, executes transactions, or files court documents without a named human pressing send.
- Per safety invariant #2.

**3. Audit trail / explainability.**
- Every draft traceable: source materials accessed, agent reasoning where applicable, reviewer edits, final sent version.
- Per §11.4 and §12 (Audit view).
- Exportable as compliance evidence packet on demand (per the compliance-audit-export skill, §8.2).

### 13.2 Disclosure posture

Per-vertical regulations (see vertical PRDs for specifics). Platform defaults:

- **Internal-facing**: full AI disclosure. The agent is openly an AI Employee named X. Dashboard, internal comms, audit log all surface this.
- **External-facing**: no AI disclosure required unless the vertical's regulatory framework requires it OR the customer's jurisdiction requires it. The platform supports per-jurisdiction disclosure clauses (e.g., engagement letter AI clauses, signature footers) as configurable elements; verticals declare when these apply.

Pattern for regulated verticals: the platform supports both modes (disclose / don't disclose), and the vertical PRD specifies which is the default and what triggers a switch.

### 13.3 Privacy and data handling

- **Data residency**: SMD operates from Cloudflare (global edge) and Fly.io (regional). Customer Machine region is configurable per `customer.yaml`.
- **Data retention**: default 90 days post-termination, restorable in first 7 days; configurable per customer.
- **Customer data export**: one-click export from Memory tab — structured JSON (rules, mappings) + markdown (voice, narrative knowledge) + activity log.
- **Customer data deletion**: post-termination deletion is verifiable; SMD provides written confirmation.

### 13.4 Vendor TOS hostile-content rules

Some third-party content vendors prohibit ingestion of their content into third-party AI. The platform enforces this at the connector layer:

- LexisNexis, Westlaw / Thomson Reuters: content read by human users only; never ingested into agent context.
- The platform supports a "do-not-ingest" connector flag per source. Where content cannot be ingested, the agent does not learn from it and does not include it in drafts.

### 13.5 The paralegal frame (for regulated verticals)

The platform's compliance posture for regulated verticals (law, healthcare, etc.) leans on the paralegal/non-professional-staff analog:

- Existing supervisory frameworks (e.g., ABA Model Rules 5.1/5.3 for lawyers; equivalent rules in other professions) already govern AI under the same rules as non-professional staff
- The product enforces what the rules require (closed-loop, mandatory review, audit trail)
- This frame is the demo's compliance moment — see §16.4

---

## 14. No Lock-In Architecture

### 14.1 What's the customer's (and what we honestly mean)

- **All their email, CRM/PM data, documents** — these live in the customer's own systems (Outlook, Clio, OneDrive, etc.) and have always been theirs. The platform reads via OAuth; it doesn't create a copy SMD owns.
- **The customer's curated configuration artifacts** — voice samples uploaded, memory rules entered, persona configuration. Exportable as JSON (rules, mappings) + markdown (voice samples, narrative knowledge) via one click in the Memory tab. *Note: this is the customer's reference data, not a portable runtime — see §14.5.*
- **Full audit log for the customer's retention period.** Exportable on demand, at any time during the relationship, for the full retention period the customer paid for (not just the most recent 90 days).

### 14.2 What's SMD's

- The Hermes runtime (the agent's "brain")
- The skill library and SKILL.md content (SMD's IP)
- The persona system code (the customer's persona file is theirs; the runtime that animates it is SMD's)
- The connector wrapper code (SMD's integration code)
- **The trained voice model state.** The agent's accumulated voice tuning is the joint product of customer samples + SMD's tuning IP. The export artifact contains the inputs (samples, rules) and the structural patterns the customer can re-feed; it does not contain SMD's tuning IP.

### 14.3 Exit process

1. Customer clicks "Export & Terminate" in dashboard (or via Captain request in v1).
2. Receives a zip with: configuration artifacts (memory rules, person-mappings, voice samples as JSON + markdown), full retention-period audit log (not just 90 days), structured record of all drafts produced (whether sent or not).
3. AgentMail address is released (customer redirects elsewhere or shuts down).
4. SMD deletes customer data within 30 days, with 7-day grace-period restore. Captain-signed written confirmation of deletion provided.
5. **Customer-side work product is unaffected.** Everything the customer sent from their own systems is in their own systems; the platform's deletion doesn't touch it.

### 14.4 What "no lock-in" honestly means

Tightening earlier overclaim — the platform commits to these specific things:

- **Month-to-month contract** (no multi-year commitments required to get the standard SKU price)
- **No data clawback**. Customer keeps everything in their own systems. The platform never had the only copy of anything that mattered.
- **Easy termination.** Customer initiates; SMD completes within 30 days with audit trail.
- **Configuration portability.** The customer's curated artifacts (samples, rules) export as reference material they can use to onboard a successor product (whether that's a competitor or a future SMD product).
- **No data hostage tactics.** Termination is not gated on payment of outstanding balances; SMD handles billing separately.

What "no lock-in" does NOT honestly claim:

- The agent's accumulated learning is not portable to another vendor's runtime (no other vendor exists; this is honest, not deceptive)
- The voice-tuned model state stays with SMD (the customer's *inputs* are exportable; the *tuned model* is not — the export contains the samples + rules they can re-feed elsewhere)
- The relationship has switching cost (the relationship with the agent, the learned voice, the established trust — these are real, like any working employment relationship; we don't pretend otherwise)

### 14.5 Marketing line

> "Month to month. No data clawback. We don't make leaving artificially harder than necessary. If we stop being worth what it costs, we make the exit clean."

Note: the prior framing ("your data is yours, your workflows are yours") overclaimed. The revised framing is narrower and defensible.

### 14.5 The frozen tier (optional, for retention)

Customers who want to keep paying for memory storage and audit log access but pause active drafting can downgrade to a frozen tier. Costs SMD almost nothing; retention upside.

---

## 15. Pricing Posture

This PRD does not redefine pricing; it references `docs/strategy/ai-employee-pricing-2026-05-13.md`. **However, the pricing strategy doc must be updated with COGS modeling before any pricing commitment to a customer.** §15.1 specifies what that modeling must cover.

Operational consequences for the platform:

- **Flat-monthly per-customer SKU** is the structural choice. Customers buy "the AI Employee," not "N seats" or "M resolutions" or "P cases."
- **Pricing positions against headcount, not against tools.** $55-95k loaded paralegal salary is the comparison anchor — though see §6.5 below for buyer-fragility caveat.
- **Specific pricing tiers and price points** are pending finalization in the pricing strategy doc, gated on §15.1 cost modeling.

### 15.1 Cost telemetry and SKU margin discipline

The platform must instrument per-customer cost telemetry before beta-1 deployment. Without it, the §17.3 "per-customer monthly cost <40% of MRR" kill criterion is unfalsifiable, and the SKU pricing decision is made blind.

**Cost drivers to track per customer per day:**

| Driver | Source | Variability |
|---|---|---|
| Claude API input tokens | Anthropic billing | Dominant variable; scales with draft volume + memory absorption + voice calibration |
| Claude API output tokens | Anthropic billing | Tied to draft length × draft count |
| Fly.io Machine baseline | Fly.io billing | Mostly fixed per customer (size + always-on vs. scale-to-zero tradeoff) |
| D1 reads/writes | Cloudflare billing | Tied to memory edits + audit log writes |
| R2 storage + reads | Cloudflare billing | Tied to vault size + retrieval frequency |
| Vectorize index size + queries | Cloudflare billing | Tied to memory volume + retrieval density |
| Composio actions (per-action billing) | Composio billing | Tied to tool calls × draft volume |
| AgentMail per-mailbox + per-message | AgentMail billing | Tied to internal-comms volume |
| Third-party API costs (LawPay, DocuSign, CourtListener, etc.) | Per-vendor billing | Per-call costs vary |
| Captain operations time | Internal time log | Tied to customer complexity + incident frequency |

**Modeling required before pricing commits:**

Three customer profiles:
1. **Light**: 20 drafts/week, 2 memory edits/week, 1 active practice area, 4 connectors
2. **Medium**: 50 drafts/week, 5 memory edits/week, 1 practice area, 6 connectors
3. **Heavy**: 150 drafts/week, 10 memory edits/week, 2 practice areas, 8 connectors

For each profile: total variable cost per month + amortized fixed cost per month + Captain time at loaded $200/hr = total COGS. Then test against three SKU price points ($1.5k, $2.5k, $5k/mo) — identify which profiles break the 40%-COGS margin floor.

**Output**: a written cost-modeling deliverable in the pricing strategy doc, with named worst-case scenarios and recommended usage caps. Captain reviews and signs off before any pricing is committed to a customer.

**Internal cost dashboard (Captain-only in v1)**: a control-plane view showing per-customer per-day cost driver attribution. This is the operational signal for SKU margin defense and for identifying customers approaching usage caps.

---

## 16. Demo Framework

The platform supports a vertical-agnostic demo pattern. Vertical PRDs specialize the framework for their specific buyer.

### 16.1 The structure

| Phase | Duration | What happens |
|---|---|---|
| **Discovery** | 10 min | Informal conversation. Listen to the customer's operational story. Take structured notes that map directly to configuration UI elements |
| **Live configuration** | 5 min | Open the dashboard, configure persona, select connectors, enable skills based on what was just heard. Click provision. Watch agent come up. **The aircraft carrier moment.** |
| **Catalog + drill-down** | 35 min | Show the full skill catalog (30+ skills visible). Customer picks 3-5 to drill into. Run them against synthetic data pre-loaded for their shape. Show drafts, reasoning, memory updates |
| **Differentiation set-pieces** | 10 min | Three demos no competitor can run: (a) memory & learning visible, (b) trust-ceiling promotion, (c) scope/audit log |
| **Open conversation** | 10 min+ | "What did we miss? What would you want? What do you use we didn't anticipate?" Take the order, not pitch the product |

### 16.2 The aircraft carrier moment (pre-provisioned, with live calibration)

**Critical revision from v0**: The "30-second live provisioning on stage" approach is replaced with a **pre-provisioned + live-calibrated** model. Reasons:

1. Real provisioning latency for one Fly.io Machine + D1 + R2 + Vectorize + Composio OAuth pre-stage + AgentMail mailbox is empirically P95 60-180 seconds, not 30. A discriminating partner sees a 90-second white screen and either grows uncomfortable or pattern-matches "fake demo."
2. Voice samples require pre-loaded customer-specific anchors to draft credibly in minute 1 of the demo. Placeholder vertical voice is the uncanny-valley failure (§18).
3. The pre-provisioned approach is *more* impressive than synchronous: it demonstrates SMD did homework on the firm.

**The revised approach:**

24-48 hours before the meeting, SMD pre-provisions `hermes-demo-{firm-slug}` using publicly-discoverable firm data:
- Firm name from website
- Partner names and bios from website
- Practice areas from website
- Likely PM stack from job postings, website footers, vendor case studies (best-effort hypothesis)
- Voice samples scraped from firm's published writing (About page, Recent Verdicts narratives, partner-attributed blog posts) — 10-sample anchor pack
- Synthetic data corpus shaped for their practice (PI in the first meeting case)

**At the meeting, in 5-10 minutes:**

1. Open the dashboard. The firm sees their name, their partner names, their practice areas already configured. Marcus is up and waiting.
2. "Based on your website we hypothesized you're on Filevine. Confirm or correct." — customer answers; we swap PM adapter if needed (this swap itself takes <30 seconds because the runtime is already up; only the connector binding changes).
3. "Here's voice samples we built from your published writing. Let's calibrate." — open Voice tab, run two test-sandbox scenarios, partner edits the agent's draft, voice updates visibly.
4. "Here are the skills we pre-enabled based on practice area. Tell us what else to turn on or off." — Skills tab, configure live.

This is the aircraft carrier moment in the revised design: **professional preparation made visible**, not synchronous magic. A 20-year litigation partner respects preparation more than they respect provisioning theater.

**The live calibration moment** (post-config) is when the partner sees Marcus draft something against synthetic data in their just-calibrated voice. That's the proof. The provisioning latency is hidden because provisioning happened last night.

**Honest measured P95 commitment**: connector swap = ≤30s; voice calibration scenario draft = ≤8s per draft; trust-ceiling promotion = ≤2s. These are measurable and rehearsable.

**Fallback if dashboard glitches**: same as v0 — pre-provisioned instance ready as backup. But unlike v0, "pre-provisioned" is now the *primary* approach, not the fallback. There's no theater being broken.

### 16.3 The principled-boundary moment (script)

A 30-second statement that locks the customer's confidence in scope:

> "Marcus runs the operational supply chain of your business — intake, documents, deadlines, status updates, billing, signing. Marcus never runs the judgment-bearing core — advice, strategy, valuation, anything tribunal-bound without your signature. That's not a limitation; that's the design. Three controls make that real: closed-loop architecture, mandatory human review, full audit trail. Let me show you all three."

Then we show all three on screen (compliance view).

### 16.4 The compliance moment (paralegal frame, for regulated verticals)

> "Your business has had [paralegals / clinical staff / licensed assistants] drafting [communications / documentation] for decades. Marcus works the same way — drafts, you review, you send, you sign. The rules that govern your existing supervised staff govern Marcus. Three controls make that real: closed-loop architecture, mandatory review before send, full audit trail. Here they are."

Per-vertical wording varies (vertical PRDs specify).

### 16.5 Walk-in-cold readiness

For demos without pre-meeting discovery (the law-firm meeting is the first such case), the platform supports:

- Pre-built customer.yaml templates per practice/business shape
- Pre-loaded synthetic data per shape
- Pre-built Tier-0 connectors that work regardless of customer stack
- Pre-built Tier-1 adapters for top vertical-specific systems (e.g., for law: Filevine, Clio, SmartAdvocate, CASEpeer, Neos, MyCase)
- "We'll have your adapter live within 7 days" fallback for un-anticipated systems

Vertical PRDs specify the pre-build set for their buyer profile.

---

## 17. Success Metrics & Kill Criteria

### 17.1 Per-customer success metrics

| Metric | Target | Type |
|---|---|---|
| Weekly draft volume | >40 drafts/week active customer | Outcome |
| Approval rate (sent / drafted) | ≥85% by week 4; ≥90% by week 12 | Outcome |
| Voice violation rate (pre-send self-catch + reviewer catches) | ≤2% by week 4 | Outcome (rule conformance) |
| **Voice blind-test pass rate** | ≥80% indistinguishability before first external draft (§9.6) | Leading (gate) |
| **Quarterly adversarial AI-detection rate** | "AI-likely" score ≤30% on blinded LLM-judge sample | Leading (drift detection) |
| Customer-initiated memory edits | ≥3/week by week 2 (signal that loop is closing) | Leading |
| Trust-ceiling promotions | ≥1 by week 8 (signal that confidence is building) | Leading |
| External "did a robot send me this?" incidents | 0. Single incident is a kill signal for that customer relationship | Outcome (binary) |
| **Opposing-counsel "let's get on a call" pattern** | Baseline-stable (rising rate is a voice-drift leading indicator) | Leading |
| Compliance audit log requests | Available in ≤60 seconds | Outcome |
| **Captain weekly hours per customer** | ≤2 hrs/wk at steady state (week 4+); >3 hrs/wk is an operational defect | Leading (operational sustainability) |
| **Per-customer monthly COGS / MRR** | ≤40%; >40% triggers SKU re-pricing or usage cap | Leading (margin) |

### 17.2 Per-customer kill criteria

A customer relationship is at risk if any of these:
- Approval rate <70% sustained over 2+ weeks (the agent is wrong too often)
- Zero memory edits over 4+ weeks (loop is broken; customer is not engaging)
- External AI disclosure incident (an external recipient identified the work as AI-drafted)
- Compliance failure (audit log incomplete, DPA breach, retention failure)
- Safety invariant violation (the agent did something it should architecturally have refused)

Any of these triggers SMD-side intervention (Captain review, possible pause).

### 17.3 Platform-level success metrics

| Metric | Target |
|---|---|
| Customer count | TBD per pricing/growth plan |
| Customer churn rate | <10% annualized after first 60 days (the AI-SDR market's 50-70% churn in days 60-90 is the failure pattern to beat) |
| Per-customer monthly cost of operation | <40% of MRR (SKU margin defensible) |
| Cross-customer skill regression incidents | 0 (skill catalog versioning works) |
| Cross-customer data leakage incidents | 0 (isolation architecture works) |

### 17.4 Platform-level kill criteria

- Cross-customer data leakage: existential. Single incident triggers platform-wide audit + customer disclosure.
- Cross-customer skill regression: kills the catalog-versioning approach; forces per-customer skill forks (acceptable as last resort, painful operationally).
- Customer churn >25% annualized over a quarter: signals the value proposition isn't landing; triggers product review.

---

## 18. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **External AI disclosure incident** (customer's client identifies an email as AI-drafted) | Single-customer existential; potentially viral | Voice calibration discipline (§9), reviewer-as-sender architecture (§9.2), mandatory voice samples + rules before first send |
| **Memory corruption / wrong learning** (agent absorbs a bad correction and propagates) | Customer trust erosion | Memory tab editability (§10.3), audit log of memory changes, reversibility |
| **Compliance/ethics violation** (an attorney's bar discipline triggered by AI use) | Single-customer existential + reputational | Per-state engagement letter library, three-control architecture (§13), legal review of templates |
| **Connector outage** (Filevine/Clio/etc. down) | Customer-day operational impact | Health view (§12.1) surfaces immediately, graceful degradation (skills that don't require the down connector continue), backup connector strategy for high-criticality capabilities |
| **Skill regression in production** (a catalog update breaks an active customer) | Customer-day impact, churn risk | Per-customer skill pinning (§7.4), regression test library, staged rollout |
| **Captain bandwidth ceiling** (operating fleet at scale exceeds SMD operator capacity) | Growth ceiling | Control plane automation, customer self-service for routine config, escalation tiers |
| **Hostile-content TOS violation** (agent ingests Lexis/Westlaw content despite ban) | Vendor TOS violation, potential legal exposure | Connector-level do-not-ingest flag (§13.4), per-content-source policy enforcement |
| **Sticky-stop bypass via prompt injection** (an attacker convinces the agent to ignore its stop signal) | Catastrophic — agent acts when it shouldn't | Code-enforced trust ceilings (§7.5 invariant #5), safety substrate's invariant #4 (sticky stop), regression testing against adversarial fixtures |
| **Cross-customer data leakage via memory** | Existential platform failure | Per-customer storage isolation (§7.1), architectural impossibility of cross-customer queries, security audit |
| **Persona "uncanny valley"** (the persona is too obviously AI, customer's staff reject it) | Internal adoption failure | Vertical-appropriate persona defaults, customer-curated samples, "test sandbox" UX for iteration before launch, voice blind-test gate before first external draft (§9.6) |
| **Live-configuration demo fails on stage** (any glitch during meeting) | Single-demo loss, potentially the meeting | Pre-provisioned approach as primary (§16.2 revised); 24-48hr advance setup; Captain dry-run before every meeting; pre-provisioned backup instance ready |
| **Captain unavailability** (vacation, illness, single-SPOF on operations) | Customer-day impact; procurement objection at scale | Designated backup operator named by Phase 2; operations runbook in place; customer PTO communication template; bus-factor minimum gate on customer #5 (§4 Persona 3) |
| **Per-customer cost over-run** (heavy customer consumes 3-5x light customer at same MRR) | SKU margin collapse; existential at scale | Cost telemetry instrumented per customer per day (§15.1); usage soft-caps defined in SKU spec; per-customer COGS/MRR ratio surfaced as kill criterion (§17.1) |
| **Voice indistinguishability drift over time** (voice rules "improve" but agent reads more AI-typical to recipients who know the writer) | Silent customer churn with no observable failure event | Quarterly adversarial AI-detection metric (§17.1); leading indicators tracked (opposing-counsel-initiated phone preference, baseline reply-rate drift) |
| **Fabrication of client-facing content** (agent fills in plausible-but-uncited fields, partner doesn't catch, recipient receives invented commitments) | Bar discipline risk + client trust failure; collision with CLAUDE.md "no fabricated client-facing content" rule | Invariant #8 (§7.5) enforces empty-state pattern for unsourced fields; skill authoring template requires citations for client-facing fields; `context-detector` skill flags suspect drafts |
| **Privilege waiver via memory indexing of substantive client content** (Rakoff Feb 2026 ruling on AI privilege) | Loss of attorney-client privilege; bar exposure | Sent-folder watching opt-in only with structural-diff-only storage (§10.4 revised); per-skill scope; DPA enforces no training; closed-loop architecture per §13.1 |
| **Cross-Machine query leakage** (memory contents flow between customer instances) | Existential platform failure; cross-customer data leakage | Invariant #7 (§7.5) enforces architectural prohibition; boot-time storage-binding check; CI gate on shared catalog merges |
| **Customer decommissioning incomplete or slow** (data not fully deleted across substrates) | Compliance breach; reputational loss; potential bar exposure for customer | Automated `bin/decommission-customer.sh` shipped in Phase 1; covers D1 + R2 + Vectorize + Composio + AgentMail + Fly Machine + customer.yaml + audit trail confirmation |

---

## 19. Open Decisions / ADRs

This PRD assumes the following are settled (some by existing ADRs, some pending):

- **ADR 0004 — Productized AI Employee SKU**: settled (referenced in CLAUDE.md)
- **ADR (proposed) — Reviewer-as-sender architecture**: needs an ADR. The decision is locked at the PRD level; formalize as an ADR before merge.
- **ADR (proposed) — Capability-interface + adapter pattern as the connector layer**: needs an ADR.
- **ADR (proposed) — Per-customer Machine isolation as the multi-tenancy model**: needs an ADR.
- **ADR (proposed) — Memory as a customer-owned, editable, exportable artifact**: needs an ADR.
- **ADR (proposed) — Cross-Machine query prohibition (invariant #7)**: needs an ADR. Architectural enforcement of customer isolation.
- **ADR (proposed) — Fabrication discipline (invariant #8)**: needs an ADR. Empty-state pattern for unsourced client-facing fields.
- **ADR (proposed) — Sent-folder watching as opt-in with structural-diff-only storage**: needs an ADR. Privacy posture for the learning loop.
- **ADR (proposed) — Voice quality gates (blind-test ≥80% before first external draft)**: needs an ADR. Operational gate for customer launch.
- **ADR (proposed) — Captain operational budget (≤2 hrs/wk/customer) and backup-operator bus-factor minimum**: needs an ADR. Operational sustainability constraint.

Open product decisions:

- **Per-customer persona naming default**: vertical PRDs propose; platform supports any string. Marketing-defensible default names per vertical not yet picked.
- **Voice-strictness slider semantics**: rules-strict vs samples-leaning. Range and default TBD.
- **Frozen-tier pricing**: not yet sized (referenced in §14.5).
- **Path B send-through-agent UX** (per §10.4): v2 work; not specified in v1.
- **Continuous voice sampling** (per §9.3 Layer 3): v2 work; not specified in v1.
- **Multi-user role model in dashboard** (principal-only vs principal+operator+compliance multi-role): demoed as principal-only; multi-role in beta-1. Role schema not yet specified.

Open architectural decisions:

- **AgentMail's role for internal-facing persona presence**: confirmed for internal comms (dashboard, internal Slack/Teams posts under persona). External communication does not use AgentMail.
- **Composio vs native MCP vs custom for specific connectors**: per-connector decisions live in vertical PRDs and `docs/strategy/ai-employee-connector-coverage-2026-05-14.md`.

---

## 20. Phased Development

### Phase 0 — Foundation (in progress, partially complete)

Scope:
- Hermes runtime on Fly.io Machines
- Five base safety invariants (per §7.5 — invariants #1-#5)
- Composio Gmail/Outlook round-trip
- Provisioning script (`bin/provision-customer.sh`)
- First customer-zero (`hermes-smd`) live

Status: largely complete per `ai-employee-smd-customer-zero` branch progress.

### Phase 1 — Platform spine + first-customer-ready v1 (in flight)

**Narrower than the platform vision; sized to a single first customer.** Scope:

**Architecture:**
- `customer.yaml` schema locked
- Capability-interface contracts defined for: Email, Calendar, DocumentStorage, ESign, PracticeManagement, CourtAccess, Payments, Accounting
- Per-customer Fly.io Machine + D1 + R2 + Vectorize bound
- Safety substrate expanded from 5 invariants (Phase 0) to 8 invariants: +citation-refusal (#6 — already in flight from `ai-employee-smd-customer-zero` branch), +cross-Machine query prohibition (#7 — new), +fabrication discipline (#8 — new)
- Automated `bin/provision-customer.sh` AND `bin/decommission-customer.sh`

**Connectors (minimal v1 floor — not the full Tier-0 catalog):**
- Microsoft Graph (Outlook + Calendar + OneDrive)
- CourtListener / PACER
- DocuSign
- LawPay
- QuickBooks Online
- **One PM adapter built within 7 days of the first meeting**, against whichever system the firm reveals (Filevine / Clio / SmartAdvocate / CASEpeer / Neos / MyCase — chosen by the meeting)

**Skills (5-7 selected, not the full catalog):**
- The 6 universal primitives authored as skill scaffolds, but only 3-4 enabled in v1 based on what the meeting reveals as load-bearing
- Of the 9 cross-cutting universals: enable `inbox-triage-and-draft`, `morning-digest`, `memory-curator`, and `compliance-audit-export` in v1; defer others
- 1-2 PI-specialized skills from the law-firm vertical pack: minimum is `pi-intake-triage`; v1 uses `pi-demand-letter-evidence-packet` (partner authors demand from the assembled inputs). `pi-demand-letter-text-only` deferred to Phase 3+ per law-firm-prd.md §6.2.

**Dashboard (7 tabs, not 16):**
- Information: Today, Queue, Memory, Audit
- Configuration: Persona, Skills, Voice
- Other tabs (Activity, Flags, Health, Rules, Connectors, People, Schedule, Compliance, Billing) deferred to Phase 4

**Persona + voice:**
- Persona system shipped (config-driven name, signature, avatar)
- Voice Layer 1 (rules) + Layer 2 (30+ samples) + Layer 3 (per-recipient cohorts) live in v1
- Voice quality gates per §9.6: pre-meeting public-data sample bootstrap + Captain-led calibration session + blind-test ≥80% gate before first external draft

**Memory:**
- D1 structured rules + R2 markdown vault + Vectorize indexing live (per customer)
- Memory tab in dashboard with editability
- Sent-folder watching opt-out by default (per §10.4 revised)

**Compliance:**
- DPA + BAA-when-applicable signed before first customer engagement
- Audit log live and exportable for full retention period
- Per-state engagement-letter clause library (PA + Utah explicitly + home state)
- Closed-loop architecture verified per §13.1

**Operations:**
- Operations runbook at `docs/runbooks/ai-employee-ops.md`
- Captain operational budget instrumented (≤2 hrs/wk/customer)
- Cost telemetry instrumented per §15.1 (Captain-only dashboard)
- Backup operator designated by name (gate before customer #5, not customer #1)

**Single skill version** in v1; per-customer skill pinning is Phase 4.

### Phase 2 — First vertical pack (in flight: law-firm)

Scope per `law-firm-prd.md`. Phase 2 closes when the law-firm demo to the named PI firm is delivered and the first paying customer (if the firm signs as beta-1) is provisioned.

### Phase 3 — Second vertical pack

Vertical TBD per `docs/strategy/ai-employee-functional-shape-2026-05-13.md` and emerging customer signals. Marketing agencies remain a documented Phase-1 candidate per the functional-shape doc; the law-firm meeting reshuffled actual sequencing. Track 2 (continuous build of customer-zero) feeds into Phase 3 readiness.

### Phase 4 — Multi-customer operations at scale (≥3 customers signed)

**Gated on ≥3 paying customers.** Phase 4 builds the operational machinery the platform vision requires; building it before ≥3 customers is premature.

Scope:
- Per-customer skill catalog versioning + content-hash pinning + per-customer regression test runs
- Remaining 9 dashboard tabs (Activity, Flags, Health, Rules, Connectors, People, Schedule, Compliance, Billing) shipped based on observed customer needs
- Tier-0 connector floor expanded (Google Workspace, Box, Dropbox, Slack, Zoom, Xero)
- Customer self-service: OAuth re-bind, skill activation, voice calibration test sandbox at full capability
- Skill update propagation policy (bugfix auto / minor opt-in / major review)
- Connector-health auto-remediation
- Captain on-call rotation
- Per-customer cost telemetry surfaced in customer-facing Billing/Usage tab
- Cross-customer feature/bug intake mechanism

### Phase 5 — Continuous learning (v2 capabilities)

Scope:
- Path B send-through-agent UX (per §10.4)
- Continuous voice sampling (per §9.3 Layer 3)
- Per-recipient voice modulation
- Cross-customer best-practice pattern identification (with customer-data-isolation preserved)
- Architectural fix to Hermes' skill loader (load references at invocation; see Phase A.6 deferred item)

---

## 21. Glossary

- **Capability interface**: An abstract contract a skill calls (e.g., `PracticeManagement.search_entities`). Skill code does not know which concrete system fulfills it.
- **Concrete adapter**: A specific implementation of a capability interface for a specific system (e.g., `connectors/practice-mgmt/clio/`).
- **`customer.yaml`**: The single source of truth for one customer's configuration: persona, connectors, skills, scope, trust, escalation.
- **Cross-cutting skill**: A skill that's neither a primitive nor a vertical-specialized skill, but runs universally (inbox-triage, memory-curator, etc.).
- **Hermes**: The agent runtime (one process per customer Machine).
- **`hermes-{customer-slug}`**: The Fly.io Machine name for one customer's instance.
- **Persona**: The named identity the agent operates under for one customer. Internal-facing only.
- **Practice-area overlay**: A configuration + small skills pack for a sub-segment within a vertical (e.g., PI within law-firm).
- **Primitive**: One of the six universal operational skills every business needs (intake, doc-collection, deadline-docketer, status-update, signing, billing).
- **Reviewer-as-sender**: The architectural pattern where the agent never sends externally; named humans review drafts and send from their own accounts.
- **Skill**: A unit of capability the agent can perform. Lives at `ai-employee/skills/{skill-name}/`.
- **Specialized dedicated skill**: A vertical-specific skill that doesn't reduce to primitive configuration (e.g., IP docketing rules engine).
- **Trust ceiling**: One of `autonomous`, `draft_for_review`, `disabled`. Per-skill, per-customer.
- **Vertical pack**: A complete set of overlays, specialized skills, connector adapters, persona defaults, and demo materials for one industry vertical (e.g., law-firm).

---

*End of platform PRD v0. Companion vertical PRDs: `law-firm-prd.md`. Critique pass and multi-agent PRD review pending.*
