---
title: PI Vertical Adapter Build Priority — Filevine First, CASEpeer Second, SmartAdvocate Third
date: 2026-05-21
status: accepted
captain: Scott Durgan
supersedes: none
related-prd: docs/pm/ai-employee/platform-prd.md §7.2; docs/pm/ai-employee/law-firm-prd.md §7
related-issue: https://github.com/venturecrane/ss-console/issues/828
---

# ADR 0013 — PI Vertical Adapter Build Priority

**Status:** Accepted. Locks the practice-management capability-adapter build sequence for the PI law-firm vertical in v1. The capability-adapter pattern itself is locked separately in [ADR 0006](./0006-capability-adapter-pattern.md); this ADR sequences which `PracticeManagement` adapter ships first, second, and third for the PI vertical.

**Source:** Round-2 and round-3 deliverables from the external competitive analysis engagement (May 2026), filed at [`docs/pm/ai-employee/prd-contributions/round-2/`](../pm/ai-employee/prd-contributions/round-2/) and [`docs/pm/ai-employee/prd-contributions/round-3/`](../pm/ai-employee/prd-contributions/round-3/). Phoenix-specific public signals (job listings, staff profiles, regional implementation consultant commentary) reinforce the same ordering.

---

## Context

Per [ADR 0006](./0006-capability-adapter-pattern.md), the AI Employee skill catalog binds to abstract capability interfaces. The `PracticeManagement` capability is one of the eleven defined interfaces (Platform PRD §7.2), and PI plaintiff firms run on a fragmented set of practice-management systems: Filevine, CASEpeer, SmartAdvocate, Clio Manage, MyCase, Neos, Litify, and a handful of smaller PI-specific platforms.

The first paying customer (beta-1, June 2026, Phoenix metro PI plaintiff firm) will be on exactly one of these systems. Which adapter we build first dictates which firms we can demo and sign in the first six months. Building the wrong adapter first delays revenue.

Three sequencing strategies were available:

1. **Build for beta-1's actual stack only.** Wait until beta-1 is signed, then build the adapter for that customer's system. Lowest waste. Highest delay risk: no demos possible until the customer is already committed, which inverts the sales motion for prospects who need to see the product before signing.
2. **Build the most common PI practice-management system first based on national market share.** Optimize for the biggest TAM. Risks misalignment with beta-1 if Phoenix has a different distribution than the national average.
3. **Build the most likely beta-1 stack first based on local Phoenix signal, with the second and third adapters sequenced by overlap with PI specialization.** Optimize for the actual buyer. Highest signal-to-noise ratio at the cost of formal market-share data that does not publicly exist for the Phoenix PI segment.

Strategy 3 is the only one that aligns engineering scope with the actual sales motion. Public market-share data for 3-20 attorney PI plaintiff firms in Phoenix is not available at quote-grade quality, so the sequencing relies on aggregated signal: Phoenix-specific job listings, PI-specific vendor positioning, regional implementation consultant commentary, and Reuters reporting on PI AI investment.

---

## Decision

The PI vertical `PracticeManagement` capability adapter build sequence is:

### Build first: Filevine

Filevine is the v1 adapter. It is the first one built, the first one wired into beta-1 demos, and the first one used in production.

Rationale:

- **PI AI momentum.** Reuters reported in 2025 that Filevine raised $400M and that more of its revenue now comes from AI products than from traditional case-management software. Their AI product set (medical chronologies, deposition analysis, drafting) is specifically aimed at the PI plaintiff workflow. Filevine is investing where our beta-1 buyer is buying.
- **Phoenix-local signal.** Phoenix PI job postings and public legal-support job listings explicitly reference Filevine usage in PI litigation support workflows. Kelly Law Team, a likely beta-1 target, has public staff profile signals tied to Filevine. This is anecdotal rather than market-share-grade, but it converges with the national signal.
- **Flexibility across PI sub-verticals.** A 2026 PI software comparison (cited in the round-3 deliverable) characterized CASEpeer and SmartAdvocate as purpose-built for PI, Filevine as most flexible across practice areas, Litify as enterprise plaintiff, and Clio and MyCase as general-practice systems that work for PI but are not PI-specific. Filevine's flexibility matters because the v1 customer base will include PI-heavy firms that also handle workers' comp, mass tort, or wrongful death matters. A Filevine-first adapter covers those firms without forcing a vendor switch.
- **AI-vendor parity check.** Filevine's own AI product set creates a coherent comparison ground. When a beta-1 prospect asks "why not just use Filevine AI?", the answer is the locked Eve wedge applied to Filevine: Filevine AI helps inside Filevine. AI Employee works across inbox, calendar, documents, client follow-up, case system, and firm voice with a human reviewer in the loop. The cross-surface architecture is the wedge.

### Build second: CASEpeer

CASEpeer is the v2 adapter. Built after Filevine ships in production and before any prospect on CASEpeer is signed.

Rationale:

- **PI-specific positioning.** CASEpeer is purpose-built for PI plaintiff firms and is attractive to 3-20 attorney firms because it requires less custom implementation than Filevine. For a small PI firm that wants ready-to-use software, CASEpeer is the natural choice.
- **Walk-in-cold demo probability.** For Phoenix prospects we have not pre-screened, CASEpeer is a plausible practice-management system. Building the adapter second hedges against beta-2 or beta-3 being a CASEpeer firm.
- **PI-only scope limits adapter complexity.** CASEpeer's PI-only design means the adapter surface area is narrower than Filevine's. The build cost is lower per skill covered.

### Build third: SmartAdvocate

SmartAdvocate is the v3 adapter. Built after CASEpeer ships and before SmartAdvocate-firm demos become common in the pipeline.

Rationale:

- **Higher-volume PI signal.** SmartAdvocate is consistently named among PI-specific platforms and is more likely in higher-volume PI and mass-tort operations. If a beta-1 or beta-2 prospect has 50-150 active matters and 3-20 attorneys, SmartAdvocate is plausible but probably behind Filevine and CASEpeer as first adapter bet.
- **Mass-tort tailwind.** As beta-1 stabilizes and we begin targeting larger PI firms (10-20 attorneys, mass-tort-adjacent), SmartAdvocate becomes more important. Building third positions us to address that segment without forcing it ahead of the 3-10 attorney sweet spot.

### Not built in v1: Clio Manage, MyCase, Litify, Neos

Clio Manage is intentionally deprioritized despite high overall law-firm market share. The PI-specific signal consistently characterizes Clio as built around billable-hour practices and trailing Filevine and SmartAdvocate for PI. A Reddit PI software discussion (low-confidence source, directionally consistent with other signal) characterized Filevine and SmartAdvocate as the PI winners and Clio as the trailing option. If a Clio firm enters the pipeline, we build the adapter then; we do not build it speculatively.

MyCase, Litify, and Neos are in the same posture: build on demand, not speculatively.

### Capability-adapter pattern compliance

This sequencing decision does not modify [ADR 0006](./0006-capability-adapter-pattern.md). The capability interface (`PracticeManagement`) is the contract; adapters implement it; `customer.yaml` binds the wiring. The build order is the order in which we ship vendor adapters, not the order in which we ship the capability interface itself. The capability interface ships before the first adapter and accommodates all three (and any future) implementations.

The doctrine "the persona is decoupled from the practice-management system" stays true regardless of sequencing. The locked demo answer to "what practice-management systems do you integrate with?" is:

> The persona is decoupled from the practice-management system. We build one adapter for your stack in v1, but the skill model is not hard-coded to Filevine, CASEpeer, or SmartAdvocate.

That line is approved cross-vertical and matches the architecture.

---

## Consequences

### Positive

- **Engineering scope aligned to sales motion.** Filevine first means the first paying customer's most likely stack is supported on day one. CASEpeer and SmartAdvocate follow as the pipeline broadens.
- **Adapter build cost is bounded.** Three adapters, in priority order, sized to the actual buyer set. We do not speculatively build for Clio, MyCase, Litify, or Neos.
- **Demo coherence.** The "we integrate with your system" question has a confident answer for the three most likely PI prospects in Phoenix. For other systems, the capability-adapter pattern answer (the persona is decoupled) is honest and accurate.
- **Composes with positioning doctrine.** [ADR 0012](./0012-ai-employee-positioning-doctrine.md) makes "portable, firm-owned, human-reviewed AI staffer" the brand position. The adapter-priority decision reinforces it: the persona is portable across the three most likely PI practice-management systems, with the capability layer ensuring that portability scales beyond v1.

### Negative / accepted

- **Locked-in cost if Phoenix signal turns out wrong.** If beta-1 is on a system we did not build (MyCase, Litify, Clio), we have to either build the adapter on demand (delaying the engagement by 2-6 weeks) or pass on the customer. We accept this risk because the Phoenix signal is strong enough to bet on, and the consequence of being wrong is delay, not catastrophic failure.
- **No quote-grade market-share data.** Public data for Phoenix PI 3-20 attorney firms does not exist at the granularity that would let us derive sequencing from a market-share table. The decision is based on directional signal. If quote-grade data becomes available (e.g., through paid market research or a survey of Arizona AAJ members), we revisit.
- **Three adapters is not "every PI firm in the market."** Firms on MyCase, Litify, Neos, or smaller PI-specific platforms are not addressable in v1 without a custom adapter build. We accept this scope limit and prioritize depth-on-three over breadth-on-six for the v1 product surface.

### Out of scope

- **Capability interface design.** The `PracticeManagement` capability interface itself (method signatures, error contracts, optional-field declarations) is locked in Platform PRD §7.2.1 and is not modified by this ADR.
- **Non-PI vertical adapter ordering.** This ADR is PI-specific. Home-services, professional-services, retail, and other verticals will have their own adapter-priority ADRs as the verticals come online.
- **Capability adapters other than `PracticeManagement`.** Email, calendar, document storage, e-sign, court access, payments, accounting, intake CRM, call tracking, and internal comms adapters are sequenced separately. Email and calendar adapters (Microsoft Graph + Google Workspace) ship before any practice-management adapter because they are tier-0 universal connectors.

---

## Verification

Build sequence is enforced through three mechanisms:

### Issue and milestone ordering

The P0 AI Employee backlog issues for `PracticeManagement` adapter work are filed in sequence: Filevine adapter first, CASEpeer second, SmartAdvocate third. Issues for non-prioritized vendors (Clio, MyCase, Litify, Neos) are filed as "speculative" and not pulled into a sprint until a real customer pipeline justifies them.

### customer.yaml schema enforcement

The `customer.yaml` schema (`docs/specs/ai-employee/customer-yaml-schema.md`) declares which `PracticeManagement` adapter values are valid. v1 ships with `filevine` only. v2 adds `casepeer`. v3 adds `smartadvocate`. A provisioning attempt against an unsupported adapter fails at schema validation, not at runtime.

### Sales playbook

The beta-1 outreach playbook screens for Filevine first, CASEpeer second, SmartAdvocate third when qualifying Phoenix PI prospects. Prospects on other systems are not disqualified but are deferred until the adapter for their stack ships.

---

## References

- [ADR 0006](./0006-capability-adapter-pattern.md) — capability-adapter pattern (the architectural pattern this ADR sequences within)
- [ADR 0012](./0012-ai-employee-positioning-doctrine.md) — AI Employee positioning doctrine (the brand-level frame this sequencing supports)
- [Platform PRD §7.2](../pm/ai-employee/platform-prd.md) — capability interface + adapter pattern
- [Law-firm PRD §7](../pm/ai-employee/law-firm-prd.md) — connector strategy (Tier-0/Tier-1/Tier-2 ladder)
- [Round-2 competitive analysis](../pm/ai-employee/prd-contributions/round-2/competitive-analysis.md) — competitive landscape context
- [Round-3 ethics architecture](../pm/ai-employee/prd-contributions/round-3/ethics-architecture.md) — combined moat framing
- [Round-3 vendor demo capture template](../pm/ai-employee/prd-contributions/round-3/vendor-demo-capture-template.md) — buyer-side intelligence collection plan
- Reuters reporting on Filevine raise and AI revenue mix (cited in round-3 deliverable)
- [Issue #828](https://github.com/venturecrane/ss-console/issues/828)
