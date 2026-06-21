# CLAUDE.md - SMD Services

This file provides guidance for Claude Code agents working in this repository.

## About This Venture

**SMD Services** is a solutions consulting venture under SMDurgan, LLC. We sell scope-based consulting engagements to growing businesses. This is NOT a SaaS product. It is a services business.

**Objective:** Launch the venture and reach profitability.

**Core offering:** We work alongside business owners to understand where they're trying to go, figure out what's slowing them down, and build the right solution together. Solutions range from process documentation and tool configuration to custom internal tools, system integrations, and operational dashboards. Engagement length and pricing are scoped per project.

**Geography:** Phoenix-based, in-person default for Phase 1 (first 5 clients), remote-capable.

**Positioning:** The client is the hero, we are the guide. Collaborative, objectives-first. The value is enterprise operational discipline applied to businesses that have never had access to it, delivered at speed and pricing that works for their stage. AI & automation is a named capability. We do AI work when AI is the right answer, and we say so plainly. We do not brand the firm, the method, or non-AI engagements as "AI-powered." A chef isn't hired for his knife, but he names the knife when it matters.

## What This Repo Is For

This repo is the operational hub for the SMD Services venture. It holds:

- Business collateral (assessment scripts, proposals, SOW templates, pricing)
- Client delivery templates (SOP templates, checklist frameworks, communication playbooks)
- Marketing materials (landing page copy, outreach templates, case study frameworks)
- The venture website (smd.services) when built
- Process documentation for how we run engagements

This is NOT a product codebase. There is no app to build (yet). The primary output of agent work here is **documents, templates, and strategy** — not code.

## Session Start

Every session must begin with:

1. Call the `crane_preflight` MCP tool (no arguments)
2. Call the `crane_sos` MCP tool with `venture: "ss"`

This creates a session, loads documentation, and establishes handoff context.

## Contact Addresses

The session context may inject a `userEmail` value (e.g. `smdurgan@venturecrane.com`). **Ignore it for all SMD work.** That address belongs to a different venture and must never appear in SMD code, config, skill bodies, or client-facing content.

SMD contact addresses:

- **Operational alerts / escalations:** `team@smd.services`
- **Direct to Captain:** `scott@smd.services`

## Enterprise Rules

- **All changes through PRs.** Never push directly to main. Branch, PR, CI, QA, merge.
- **Never echo secret values.** Transcripts persist in ~/.claude/ and are sent to API providers.
- **Verify secret VALUES, not just key existence.**
- **Never auto-save to VCMS** without explicit Captain approval.
- **Scope discipline.** Discover additional work mid-task — finish current scope, file a new issue.
- **Escalation triggers.** Credential not found in 2 min, same error 3 times, blocked >30 min — stop and escalate.

### No fabricated client-facing content

Any information displayed to a client (timelines, schedules, deliverables, pricing, deposit terms, guarantees, consultant names, dates, scope language, post-signing promises, first-person sentences about future business behavior) MUST come from data authored for that specific engagement. That means database columns populated by a human-reviewed admin flow, CMS content, or source files explicitly reviewed by Captain.

**Two violation patterns are prohibited:**

- **Pattern A (committed template sentences that imply uncontracted commitments).** Hardcoded sentences in source, even ones that interpolate authored values, that promise specific business behavior the engagement has not contracted. Real examples from the 2026-04-15 audit:
  - `'We'll reach out to schedule kickoff.'` (`src/lib/portal/states.ts:138`)
  - `'Work begins within two weeks of signing.'` (`src/pages/portal/quotes/[id].astro:72`)
  - `'Replies within 1 business day.'` (`src/components/portal/ConsultantBlock.astro:136`)
  - `'A 2-week stabilization period follows the final handoff.'` (`src/lib/pdf/sow-template.tsx:529`)

- **Pattern B (runtime fabrication from non-authoritative fields).** Values rendered from sources never authored as client-facing content: placeholder defaults, parsed or derived text, brief-borrowed copy. Real examples from the audit:
  - The 3-week schedule constant (`'We shadow and observe.'` / `'We redesign together.'` / `'Training and handoff.'`) at `src/pages/portal/quotes/[id].astro:79-83`, stripped by hotfix #378
  - `overview: 'Operations cleanup engagement as discussed during assessment.'` injected into every SOW PDF at `src/pages/api/admin/quotes/[id].ts:110`
  - `contactName: primaryContact?.name ?? 'Business Owner'` at `src/pages/api/admin/quotes/[id].ts:101` (a SOW signed as "Business Owner" is a compliance risk)

**If authored data is missing:** render nothing or an explicit "TBD in SOW" marker. See `docs/style/empty-state-pattern.md`. Never invent plausible content.

**Visual + component patterns:** see `docs/style/UI-PATTERNS.md`. Six rules covering status display, redundancy, button hierarchy, heading skip, typography scale, and spacing rhythm — authored to raise UI quality to professional level. Same enforcement shape as empty-state-pattern: narrow, cited to NN/g / Material 3 / WCAG 2.2, anti-patterns with file paths, merge gate per shipped rule. Produced by `.agents/skills/ui-drift-audit/` which emits a surfaces × rules matrix at `.stitch/audits/ui-drift-{date}.md`.

**Enforcement.** Violations are P0. Merge gate is `.github/workflows/scope-deferred-todo.yml` (blocks TODO-deferred ACs without the `scope-deferred` label). Issue-close gate is `.github/workflows/unmet-ac-on-close.yml` (reopens issues closed with unchecked ACs).

**Fabrication and drift guardrails.** Pattern A/B is not the full policy. The repo also blocks three adjacent failure modes:

- Shipped user-facing copy must not pick up banned style markers or placeholder copy. No em dashes. No "coming soon" on prospect or client surfaces.
- Enrichment prompts must stay extractive and evidence-bound. They must not ask for management style, personality, communication preferences, likely objections, or other private-condition inference.
- Shared product flows must stay shared once canonicalized. If `/book` and `/get-started` drift back into duplicate intake implementations, that is a regression.

**Tests linked to this policy**

- `tests/forbidden-strings.test.ts` - historical Pattern A/B phrases, user-facing style-marker checks, and portal registry guardrails
- `tests/enrichment-prompt-contracts.test.ts` - source-level prompt-contract checks for dossier, review-analysis, and deep-website
- `tests/intake-questionnaire.test.ts` - shared-surface regression coverage for the canonical intake questionnaire

## Tone & Positioning Standard

**These rules apply to ALL external-facing content: website copy, outreach, proposals, collateral, and any client-facing language. They also apply to internal content that may inform external copy (e.g., one-liners, scripts).**

### 1. Objectives over problems

Frame engagements around understanding business objectives, not just diagnosing problems. Recognizing a problem is a start, but without knowing the objective — what the business is trying to achieve — we can't truly solve it. The owner often knows the pain but hasn't articulated the goal. Part of our value is helping them discover the real objective through conversation. Don't give them a faster horse.

- **Do:** "We start by understanding where you're trying to go, then figure out what's in the way."
- **Don't:** "We diagnose your top problems and fix them."

### 2. Collaborative, not diagnostic

We are a peer working alongside the owner, not an expert arriving to audit them. The owner has the vision. We have operational experience. We figure it out together.

- **Do:** "We work alongside you," "Let's figure out what needs to change," "together"
- **Don't:** "We audit your operations," "We tell you what to fix," "We come in and pick the things that matter"

### 3. No fixed timeframes in external content

Timeframes are scoped per engagement, just like pricing. Do not publish specific durations for any phase of the engagement — the call, implementation, training, or support. Internally, use timeframes for planning, but never commit them in client-facing content.

- **Do:** "We start with a conversation," "Hands-on training with your team"
- **Don't:** "1-hour call," "10-day sprint," "60-minute training," "2-week support window"

**Applies to marketing content only.** This rule does not apply to signed contractual documents (SOW PDFs, invoices, countersigned agreements). A signed SOW is a contract where specific timeframes are the product of the conversation, not marketing copy. Timeframes in signed documents stay as authored.

### 4. No published dollar amounts

No dollar amounts appear on the website or in marketing materials. The client sees a project price in their proposal — never on a public page.

### 5. "Solution" not "systems" in marketing contexts

"Systems" sounds scary to business owners — it implies software and one more thing to learn. Not all solutions are software; sometimes it's a better process, a clearer role, or a simpler workflow. Use "solution" in positioning contexts. "System" is fine when referring to a specific literal tool (e.g., "data migration and system setup").

- **Do:** "Build the right solution," "the right solution to get you there"
- **Don't:** "Build better systems," "Your systems should keep up"

### 6. Voice standard (from Decision #20)

Always "we" / "our team." Never "I" / "the consultant." See Decision Stack #20 for full details.

**Practitioner-firm exception (added 2026-05-03):** §07 "Who We Are" on the marketing home page is the one place where Scott speaks in first person. SMD is positioned as a practitioner firm — like a lawyer's office, a doctor's practice, or a craftsman's shop — where the founder _is_ the firm and there is a real team behind him. In that model, forced "we" voice in the founder bio reads insincere; first person is the only sincere voice. About speaks as Scott; every other section ships in firm-level "we" voice. The voice-standard test in `tests/landing-page.test.ts` excludes `About.astro` for this reason. Do not rewrite About to "we" voice without Captain explicitly reversing this call.

**Identity-marker rule (added 2026-05-03):** Words that describe an aspirational self-quality (Captain's examples: "magic," "artist," "creative") must SHAPE the voice without being STATED on the page. Stating them reads as overclaim or self-flattery. Convey wonder via concrete language and what the work does, not by calling it magic. Convey creativity by showing it, not by calling it artistry. The rule applies to all marketing surfaces, not just About.

### 7. No claim to know the prospect's business

We do not write copy that implies pre-knowledge of a specific prospect's business. We are collaborators who learn the situation through conversation, not diagnosticians who arrive with answers. This rule covers both first-person ("I know what's wrong with your business") and implied ("This is what your business needs"). See `feedback_no_pretend_to_know_business.md`.

---

## The Business Model

### Problem Framework

We use a three-layer model to connect research to delivery:

**1. Four root patterns** (internal, research-grounded):

- The founder ceiling
- Invisible operational drag
- Revenue plateau
- Cash flow fragility

**2. Owner-voiced symptoms** (external, what owners actually say):
"I can't step away." "I can't find good people." "Customers slip through the cracks." "I don't know if we're making money." "Everything runs on spreadsheets." "Our systems don't talk to each other." "We've stalled."

These are representative, not exhaustive. The assessment listens for whatever comes up.

**3. Six solution categories** (delivery taxonomy):

- Process design
- Custom internal tools
- Systems integration
- Operational visibility
- Vendor/platform selection
- AI & automation

No dollar ranges are attached to solution categories. Pricing comes from scope estimation per engagement.

**AI & automation sub-capabilities** (for agent reference when authoring copy or scoping engagements, not a list to publish verbatim):

- AI strategy conversations and readiness assessment
- AI tool selection and rollout
- Custom AI and agent implementations
- Team training and enablement on AI tools
- Non-AI workflow automation (scripts, integrations that don't require AI)

**Taxonomy two-layer model.** Resolved in [ADR 0001](docs/adr/0001-taxonomy-two-layer-model.md) (Captain decision 2026-04-27, [#591](https://github.com/venturecrane/ss-console/issues/591)). The six-category list above is the **delivery taxonomy** — what engagements we offer. It is the marketing and doctrinal source of truth. Lead-generation code uses a separate five-category **observation taxonomy** (`process_design`, `tool_systems`, `data_visibility`, `customer_pipeline`, `team_operations` — defined in `src/portal/assessments/extraction-schema.ts`) — what operational pain we detect from public data. The two layers are deliberately distinct: outreach speaks observation, marketing speaks delivery, and the assessment call is where the consultant translates between them. Agents editing either side must not silently change the other. Doctrine changes here do not retroactively rewrite extraction prompts; lead-gen changes there do not dictate the external taxonomy.

### Pain Clusters by Vertical

These suggest where to lead the conversation, not which problems to look for. The assessment listens for whatever comes up across the full range of symptoms.

| Business Type                                | Likely Entry Points                                   |
| -------------------------------------------- | ----------------------------------------------------- |
| Home services (plumber, HVAC)                | Scheduling + lead follow-up + employee retention      |
| Professional services (accountant, attorney) | Owner bottleneck + manual communication + pipeline    |
| Retail/salon/spa                             | Scheduling + communication + financial visibility     |
| Contractor/trades                            | Estimating/quoting + scheduling + employee retention  |
| Restaurant/food service                      | Team communication + inventory + financial visibility |

### Engagement Phases

| Phase            | Activities                                                                        |
| ---------------- | --------------------------------------------------------------------------------- |
| Assessment call  | Walk through their day, "show me how you do X," identify top 3 pain points        |
| Solution design  | Choose simplest tools, design workflows, estimate scope and price, send proposal  |
| Implementation   | Build templates/workflows/docs, configure tools, migrate data, connect systems    |
| Training         | Hands-on walkthrough, practice, deliver "how to" docs, identify internal champion |
| Handoff + polish | Handle feedback, adjust based on real use, final handoff                          |

**Phases scale per engagement.** Every engagement includes every phase. What changes is how heavy each one is. Training may be a three-day program or a single "on Tuesdays you click this button." Implementation may be a multi-week build or a one-afternoon script. Scope determines depth, not presence.

### Pricing

- **Internal rate:** $175/hr at launch, then $200/hr after first case study, then $250/hr, then $300/hr with volume
- **Engagement range:** scoped per engagement. Smallest engagements (targeted automation scripts, AI pilots) start around $2,500. Below that, assessment overhead exceeds delivery value. Largest engagements have no fixed ceiling. Nothing published externally.
- **Paid Assessment:** $250, applied toward engagement if they proceed. First 3 assessments free.
- **Recurring revenue product:** Productized Operator offering — flat-rate monthly retainer SKU, second front door alongside the scope-based consulting funnel. Specific monthly price deferred pending stack cost analysis. See [ADR 0004](docs/adr/0004-productized-operator-offering.md) / Decision #44. The prior "$200-500/mo undefined post-delivery retainer" is superseded.
- **Post-handoff support for scope-based engagements:** Two-week async stabilization included (Decision #27). Beyond that, customers are quoted a follow-on scope or converted to an Operator subscription if the fit is right.
- **No dollar amounts published externally.** Client sees a project price, not hourly rate.

### The Assessment Call Is the Product

The value is NOT configuring HubSpot. Anyone can do that. The value is:

1. An experienced outsider seeing their operations with fresh eyes
2. Identifying the problems they can't see because they're too close
3. Prioritizing ruthlessly — "these 3 things first, everything else later"
4. Making decisions for them so they don't research for 6 months

## Current Phase: Pre-Launch

We are in the **pre-launch phase**. Nothing has been sold yet. The immediate priorities are:

### Priority 1: Collateral to Start Selling

- [ ] Assessment call script (structured conversation guide, objectives-first)
- [ ] Proposal/SOW template (what gets sent after the assessment, reflecting full solution range)
- [ ] Pricing framework (scope estimation across all 6 solution categories)
- [ ] One-pager / leave-behind (physical or PDF for networking, guide positioning)

### Priority 2: Go-to-Market

- [ ] Vertical selection for initial targeting (pick ONE vertical to start)
- [ ] Outreach strategy (how to find and reach first 5 prospects; includes Vistage, EO Arizona, local networking)
- [ ] Landing page (smd.services, credibility-focused, guide positioning)
- [x] ~~**Outside View**~~ — retired 2026-05-04 in PR #702 (user-visible surface) and #703 (infrastructure). Public-footprint scraping turned out not to surface anything useful. ADR 0002 is superseded. The lead-magnet surfaces (`/scan`, `/scorecard`, `/get-started`, `/outside-view`) middleware-301 to home for permanent-bookmark backwards compat.
- [ ] Pipeline math (how many conversations to sustain profitability)
- [ ] Phased geographic approach (Phoenix in-person first, remote-capable after proof of model)

### Priority 3: Delivery Readiness

- [ ] Tool and solution matrix (across all 6 solution categories, including custom internal tools, integrations, and AI & automation)
- [ ] SOP templates (reusable frameworks filled in per client)
- [ ] Client onboarding checklist (what we need from them before Day 1)
- [ ] Quality checklist templates (reusable across engagements)

### Priority 4: Business Model Refinement

- [x] Payment terms (50% deposit at signing, 50% at completion; 3-milestone for 40+ hr engagements)
- [ ] Paid assessment entry point ($250 applied toward engagement, first 3 free)
- [x] ~~Recurring retainer model~~ — superseded 2026-05-13 by [ADR 0004](docs/adr/0004-productized-operator-offering.md) (productized Operator SKU). Stack evaluation, pricing analysis, service contract terms, and stack build filed as follow-ons against ADR 0004.
- [ ] Client data management system (D1 or similar for assessments, quotes, engagements, invoicing)

## Domain Context

- **Geography:** Phoenix metro (Phase 1, in-person default), remote-capable
- **Target:** Established, owner-led businesses with real operational load and the ability to pay for a solution. No revenue-band gate — we work with any business that can pay and benefit, and qualification happens in conversation, not by filtering on a guessed revenue figure (the operational layer already dropped this gate — see ADR 0003 and `tests/lead-gen-revenue-gate.test.ts`). The "too big for one person, too small for a COO" framing still captures the shape of the buyer. For the Operator specifically, the target profiles are defined by the vertical packs in `operator/verticals/`.
- **Buyer:** The owner. Sometimes the office manager, but the owner writes the check.
- **Competition:** Traditional consultancies ($15-50k+ engagements, slow), fractional CTOs/COOs (ongoing cost, no bounded deliverable), EOS implementers (framework-locked), managed IT providers (technical only). Nobody does assessment + implementation + handoff as bounded, scope-priced engagements.
- **Referral sources:** Vistage, EO Arizona, fractional CFOs, local networking groups (BNI, chamber of commerce), accountants/bookkeepers, commercial insurance agents, SBA/SCORE

## Tech Stack

- **Website:** Astro SSR on Cloudflare Workers + Static Assets
- **Domain:** smd.services
- **Language:** TypeScript
- **No product/app planned** — this is a services business. Tech is for marketing and internal tools only.

## Three-Subdomain Architecture

One Astro app, one Cloudflare Worker, three custom domains. Routing is handled by `src/middleware.ts` — not by separate deployments.

| Host                  | Serves                                   | Auth role |
| --------------------- | ---------------------------------------- | --------- |
| `smd.services`        | Marketing pages                          | Public    |
| `admin.smd.services`  | Admin console (rewritten to `/admin/*`)  | `admin`   |
| `portal.smd.services` | Client portal (rewritten to `/portal/*`) | `client`  |

**How the rewrite works.** The middleware inspects `hostname`. On `admin.smd.services`, paths get `/admin` prepended unless they already start with `/admin`, `/api/admin`, `/auth`, or `/api/auth`. Same pattern for `portal.smd.services`. The admin source files still live under `src/pages/admin/*` — the subdomain is a front door.

**Cookie boundaries.** Session cookies are per-host (no `Domain` attribute). Admin cookies only live on `admin.smd.services`. Client cookies only live on `portal.smd.services`. An admin cookie that lands on the apex (from pre-migration logins) is proactively cleared on next visit.

**Backwards compat.** `smd.services/admin/*` and `smd.services/auth/login` 301 to the admin subdomain — old bookmarks still work.

**Env vars.** `APP_BASE_URL` (marketing, SignWell webhooks), `ADMIN_BASE_URL` (OAuth redirect URI, outbound admin links — strict, no fallback), `PORTAL_BASE_URL` (portal links, falls back to `APP_BASE_URL`). See `src/lib/config/app-url.ts`.

## Local Dev

`.mcp.json` is user-local config (gitignored). Create it in the repo root with at minimum the `crane` MCP entry. It is not checked in.

Subdomain-based routing keys off `hostname.startsWith('admin.')` / `portal.`. At `localhost:4321` neither fires, which is usually fine — just hit `/admin/*` and `/portal/*` paths directly.

**For full-fidelity subdomain testing**, add to `/etc/hosts`:

```
127.0.0.1 admin.localhost
127.0.0.1 portal.localhost
```

Then `http://admin.localhost:4321/` and `http://portal.localhost:4321/` exercise the rewrite. Set matching values in `.dev.vars` (e.g. `ADMIN_BASE_URL=http://admin.localhost:4321`) so outbound-URL builders emit the right origin.

## Build Commands

```bash
npm install             # Install dependencies
npm run dev             # Local dev server (astro dev)
npm run build           # Production build
npm run preview         # Local Worker preview (wrangler dev)
npm run test            # Run tests
npm run lint            # Run linter
npm run typecheck       # TypeScript validation (astro check)
npm run verify          # Full verification
npm run format          # Format with Prettier
```

## Deployment: Workers + Static Assets

SS deploys as a single Cloudflare Worker (`ss-web`) via `wrangler deploy`. The build produces two directories:

- `dist/client/` — static assets, bound to the Worker via `[assets]` in `wrangler.toml`
- `dist/server/` — the Astro SSR entrypoint (resolved from `@astrojs/cloudflare/entrypoints/server`)

`run_worker_first = true` in the `[assets]` block ensures every request flows through Astro middleware first — subdomain routing and session middleware always run, even for requests that would otherwise resolve to a prerendered asset.

**Env access in code.** Adapter v13 removed `Astro.locals.runtime`. Import env directly:

```ts
import { env } from 'cloudflare:workers'
const db = env.DB
```

Typed via augmenting `Cloudflare.Env` in `src/env.d.ts`.

**Secrets.** Workers store secrets independently of `wrangler deploy` runs — unlike the Pages-era `wrangler pages deploy` trap, secrets persist across deploys natively. Rotate from Infisical:

```bash
infisical export --env=prod --path=/ss --format=dotenv \
  | grep -vE '^(APP_|ADMIN_|PORTAL_|MEETING_|NEW_BUSINESS_|JOB_MONITOR_|REVIEW_MINING_|PUBLIC_)' \
  | npx wrangler secret bulk
```

**Historical note.** SS ran on Cloudflare Pages through April 2026. The Pages `[vars]` trap — every `wrangler pages deploy` silently wiping dashboard-set secrets — is documented enterprise-wide in `crane-console/docs/infra/secrets-management.md`. It no longer applies to SS on Workers, but the guidance stands for any future venture that adopts Pages.

## Instruction Modules

Fetch the relevant module when working in that domain.

| Module                | Key Rule                                                                                                                                | Fetch for details                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `coding-standards.md` | Parse external inputs (never cast); no floating Promises; no module-level state in Workers; 500/75/15 file/function/complexity ceilings | Portable TypeScript directives, agent-context arithmetic, per-stack notes |
| `secrets.md`          | Verify secret VALUES, not just key existence                                                                                            | Infisical, vault, API keys                                                |
| `content-policy.md`   | Never auto-save to VCMS; agents ARE the voice                                                                                           | VCMS tags, storage rules, editorial, style                                |
| `team-workflow.md`    | All changes through PRs; never push to main                                                                                             | Full workflow, escalation triggers                                        |

Fetch with: `crane_doc('global', '<module>')`

## Design System

Load the enterprise pattern + component catalog before any UI work — design briefs, wireframes, component generation, design-related PR review:

- Patterns (cross-venture UX problem/solution pairs): `crane_doc('global', 'design-system.patterns.index.md')`
- Components (per-venture catalog of atoms, molecules, organisms): `crane_doc('global', 'design-system.components.index.md')`

Then load this venture's spec for palette and tone: `crane_doc('ss', 'design-spec.md')`.

The catalog is the shared vocabulary across all eight ventures — eight named patterns (status display by context, redundancy ban, button hierarchy, heading skip ban, typography scale, spacing rhythm, shared primitives, actions and menus) plus the components map (atoms / molecules / organisms with per-venture implementations). The catalog is a map, not a library — each venture maintains its own source. Cite a pattern by its file slug (`patterns/03-button-hierarchy.md`, etc.) when referencing it in PRs and skill output.

## The Operator Thesis (load first — [ADR 0037](docs/adr/0037-operator-thesis.md))

The canonical frame for what the Operator _is_. Load this before any Operator strategy, marketing, competitive, or vertical-selection work, so it is built upon, not re-derived.

1. **Competes with a hire, not with software. (mission-critical)** Every system does a subset; the human is the connective tissue between them, and the Operator is that human. Incumbent systems (Clio, the AMS, the PSA) are **connection targets, not competitors**; more disconnected systems = more value; price against a **salary**, not a software seat.
2. **A configurable substrate, not a tool with a use case.** No fixed function; authored per engagement across skills, entitlements (initiation × exposure), voice, connectors, memory. The only hard limit is connectability — if we can connect, we can work with it.
3. **No imposed defaults.** Unconfigured is fail-closed (a safety state), not an identity. Ask "what did the engagement author?", never "what does the system assume?"
4. **The moat is the harness + the guide + the memory — never a single feature.** Not voice, not audit, not draft-for-review. Calling one feature "the moat" is a category error.
5. **Packs turn the universal into the recognizable.** "All things to all people" is the capability; "exactly your thing" is the package. Packs compose and cluster into families that compound. The magnitude is the strategy; the pack is the entry.
6. **Targeting is market-driven, on reachability × willingness-to-pay.** Pick verticals where the coordinator role is most acute/expensive, most cheaply reachable, highest-paying (vs a salary). The guide is a resource we supply, not a constraint on which market to pick.

## Operator Architecture (locked 2026-05-24)

The Phase 1 Operator SKU (productized retainer offering, per ADR 0004) runs as a per-customer Fly.io Machine hosting the Nous Research Hermes Agent runtime (`NousResearch/hermes-agent`, MIT). The architectural posture was substantially realigned on 2026-05-24 after six rounds of focused research. Three principles govern all Operator work:

1. **Hermes is the substrate. Trust it.** Skills, Honcho memory, the Curator, profiles, the tool registry, the plugin hook surface, MCP integration, and approval/guardrail machinery are all native and not reinvented. Teknium's May 2026 hard rule applies: plugins MUST NOT modify Hermes core files. Our overlay is plugin code, hosted in a separate repo (`venturecrane/hermes-smd-overlay`).
2. **Build only what Hermes won't.** Sample-driven voice transformation, compliance-grade audit emission, content-class trust ceilings, configurable send-posture routing (draft-for-review among the authored options), curated vertical skill catalogs, and the customer-facing business surface are what we build on top of Hermes — none are on its roadmap. (These are capabilities, not the moat: the moat is the harness + the guide + the memory, per [ADR 0037](docs/adr/0037-operator-thesis.md) Tenet 4. No single feature is the moat.)
3. **Mirror, don't gate.** Where Hermes' learning loop creates state (Honcho conclusions, agent-authored skills), our overlay captures a parallel record in per-customer D1 with provenance. Captain dismissal physically removes the state from Hermes. No approval queue stands between the agent and its work; safety is enforced by the authored entitlement ceilings (fail-closed when unauthored), not by an interposed gate.

Load these ADRs before any Operator architectural work:

- **ADR 0037** — The Operator Thesis (what it is / competes with a hire / configurable substrate / no defaults / moat = harness+guide+memory / packs / market-driven targeting) — load first
- **ADR 0004** — Productized Operator offering (the SKU itself)
- **ADR 0006** — Capability-adapter pattern (typed contracts as TS-side ergonomic; runtime via plugin + MCP)
- **ADR 0007** — Per-customer Machine isolation
- **ADR 0010** — Per-customer OAuth token storage on Fly volume
- **ADR 0011** — Multi-persona per customer (persona = Hermes profile)
- **ADR 0012** — customer.yaml storage (Git source of truth → D1+R2 materialized)
- **ADR 0015** — Hermes fork posture (pin-only fork, plugin-only overlay)
- **ADR 0016** — Honcho disposition (mirror, don't gate; tuned config; TTL archival)
- **ADR 0017** — Skill Curator disposition (disable autonomous curator per-customer; keep in-conversation `skill_manage`; mirror to D1 inventory; supervised `--dry-run` consolidation only)
- **ADR 0019** — customer.yaml → per-profile config translation
- **ADR 0020** — Connector strategy (MCP-first; BUILD only where no acceptable MCP)
- **ADR 0021** — Leverage Hermes native primitives (`execute_code`, `delegate_task`, no-agent cron, skill bundles, webhook gateway via `pre_gateway_dispatch`, MCP-first connector retirement)

Connectors are wired by `customer.yaml.connectors{}` backend prefix: `mcp:` (vendor or vetted-community MCP server), `build:` (Python adapter we maintain), `synthetic:` (no_pm substrate). Composio is dropped (ADR 0020, 2026-05-30 revision) — we connect to MCPs directly, and long-tail vendors with no first-party MCP get a `build:` adapter.

The 2026-05-24 realignment burial is complete. Removed: `smd.hooks.*` dual-surface scaffolding, Honcho interceptor, Curator interceptor, GEPA boot-check (ADR 0018 superseded), in-tree YAML validator, the pre-realignment MS Graph adapter, and the `clio/` / `dotloop/` / `shipstation/` connector dirs whose MCP-first decisions superseded them. New BUILD adapters land in `venturecrane/hermes-smd-overlay`, not this tree.

## Venture Handbook

The franchise operations manual lives in `docs/handbook/` and renders in the admin console at `admin.smd.services/admin/playbook`. It is the E-Myth handoff manual: what the venture is, why it exists, how it works, and where everything lives, organized so a zero-context successor could run, build, and grow the venture. Source of truth is the markdown in `docs/handbook/` (rendered by `src/content.config.ts` + `src/pages/admin/playbook/`).

**Maintenance contract:** when a change to the venture changes what a handbook page says, update that page in the same PR. The docs live next to the code so each page is edited in the same breath as the thing it documents. See `docs/handbook/README.md` for the page map and the "if you change X, update Y" table.

**Enforcement:** `tests/handbook-integrity.test.ts` runs in `npm run verify` and CI - it blocks merge on malformed frontmatter, a dead `/admin/playbook/<slug>` cross-link, a cited same-repo source file that no longer exists, a `(section, order)` collision, or an em dash. The advisory `npm run handbook:drift` reports pages whose cited sources changed after the page (git-mtime), for a periodic review pass. Both are documented in `docs/handbook/README.md`.

## Key Reference

- **Decision Stack:** `docs/adr/decision-stack.md` (29 locked decisions across 6 layers — buy box, scope, pricing, assessment, distribution, delivery. Source of truth for all collateral and processes.)
- **Operator ADRs:** `docs/adr/0004-*.md` through `docs/adr/0035-*.md`. Always cite the ADR number when referencing an architectural decision. The Operator Thesis (ADR 0037) is the positioning frame the rest hang from.
- **Package 2 Deep Dive:** `~/Desktop/services-package-2-deep-dive.md` (full problem analysis, delivery model, positioning)
- `docs/` — Venture documentation as it develops

---

_Update this file as the venture evolves. This is the primary context for AI agents._
