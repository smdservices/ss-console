---
title: Multi-Persona Per Customer — Schema-Locked at v1, Runtime Deferred to Phase 2
date: 2026-05-21
status: accepted
captain: Scott Durgan
supersedes: none
related-prd: docs/pm/ai-employee/platform-prd.md §2, §7.3, §9, §11, §12.1, §20
related-spec: docs/specs/ai-employee/customer-yaml-schema.md
related-issue: https://github.com/venturecrane/ss-console/issues/790
---

# ADR 0011 — Multi-Persona Per Customer

**Status:** Accepted. The data model and vocabulary commitments below land in Phase 1 (with the [#790](https://github.com/venturecrane/ss-console/issues/790) schema lock). Runtime implementation is deferred to Phase 2, gated on a paying multi-persona customer.

**Source:** Captain decision 2026-05-20 conversation. The platform PRD ([`platform-prd.md`](../pm/ai-employee/platform-prd.md)) and customer onboarding runbook ([`ai-employee-customer-onboarding.md`](../runbooks/ai-employee-customer-onboarding.md)) currently treat each customer's deployment as one Hermes process running one named persona. The customer.yaml schema spec ([`customer-yaml-schema.md`](../specs/ai-employee/customer-yaml-schema.md), the contract `provision-customer.sh` validates against) likewise has `persona:` as a singular block. Captain decided multi-persona belongs **within one customer subscription** — not as a separate engagement — and that v1 must capture this in the data model even though v1 ships with N=1 and a unified UI.

Pairs with [ADR 0004](./0004-productized-ai-employee-offering.md) (productized SKU shape), [ADR 0007](./0007-per-customer-machine-isolation.md) (deployment-level isolation), [ADR 0008](./0008-customer-owned-memory-artifact.md) (customer-owned memory artifact), and [ADR 0009](./0009-cross-machine-query-prohibition.md) (cross-Machine query prohibition).

---

## Context

A customer may eventually want more than one AI persona attached to their business — for example, an inbox-triage agent ("Marcus") and a separate intake-handling agent ("Casey") running against the same firm's connectors and memory but with distinct identities, signature blocks, voice envelopes, and skill assignments.

Three plausible shapes:

1. **One persona per customer, additional personas = separate engagement.** The current PRD and SOW posture. Each new persona is its own customer.yaml, its own Fly Machine, its own D1, its own AgentMail inbox. Cross-persona context (memory, connectors) doesn't naturally compose.

2. **Multi-persona within one Machine, one Hermes process.** Hermes' configuration would surface multiple personas inside a single runtime; routing logic decides which persona handles a given inbound. Cheapest at runtime; couples skills, voice, audit, and identity into one substrate where they need clean separation per persona.

3. **Multi-persona within one customer subscription, one Hermes process per persona.** Each persona is a separate runtime with its own profile directory (`HERMES_HOME=~/.hermes/profiles/<persona_slug>/`) and AgentMail inbox, sharing the customer's connectors, memory vault, and scope envelope. Routing rules in `customer.yaml` decide which persona receives a given inbound.

Pattern 1 is wrong for the buying experience — a customer who wants two agents is buying _more from this product_, not commissioning a separate engagement. The "additional agent = separate engagement" SOW clause was a punt, not a design decision.

Pattern 2 is wrong architecturally. Hermes' upstream issues (#476, #11922, #10376 — see _Verification_ below) document imperfect multi-persona-in-one-process support. More importantly, it fuses identity-shaped concerns (signature, voice, audit attribution) into a single state space where leakage between personas is a real risk.

Pattern 3 matches how the customer thinks about it ("two agents, both ours, both knowing our business"), composes cleanly with the existing per-customer isolation model (ADR 0007), and isolates per-persona state at the filesystem layer (`HERMES_HOME` profile path) — which is the level Hermes supports cleanly today.

The strategic question is **when** to build Pattern 3. The Phase 1 customer needs one persona. Building a custom memory provider, a per-Machine supervisor, a dashboard persona picker, and a routing-rules engine before any customer asks for the second persona is premature optimization. But locking the **shape** — the schema, the vocabulary, the column nullability — now is nearly free, and it prevents Phase 2 from being a migration project.

---

## Decision

### 1. Schema commits to multi-persona at v1; runtime ships N=1

The `customer.yaml` schema spec ([`customer-yaml-schema.md`](../specs/ai-employee/customer-yaml-schema.md)) is updated to make `personas:` an array. v1 customers ship with the array at length 1. Skills, voice overrides, escalation overrides, and channel bindings live **inside** each persona entry. Customer-scope fields (connectors, scope envelope, memory namespaces, business hours, voice library) remain at the customer level.

Sketch (the binding contract lives in the schema spec, not here):

```yaml
customer_id: smith-pi-firm
vertical: law-firm
# ---- customer scope ----
connectors: { ... }
scope: { ... }
escalation: { red_flag_recipients: [...] }   # default; per-persona override allowed
voice_library: { samples_path: r2://vaults/<slug>/voice-samples/ }
memory: { d1_namespace, r2_vault_path, vectorize_index }
business_hours: { ... }
users:                                       # humans on the portal (unchanged)
  - email: ..., role: principal | operator | compliance, full_name: ...
# ---- personas (AI agents) ----
personas:
  - slug: marcus
    status: active                           # active | archived
    name: Marcus
    title: AI Associate
    signature_html: ...
    tone: [warm-but-professional]
    send_as:
      agentmail_identity: marcus@<slug>.agents.smd.services
    skills:
      - name: inbox-triage-and-draft
        trust_ceiling: draft_for_review
      - name: pi-intake-triage
        trust_ceiling: draft_for_review
    voice_overrides: ~                       # inherits voice_library
    escalation_overrides: ~                  # inherits top-level escalation
    channel_bindings:
      - integration: ms-graph
        channels: [primary-inbox]
```

### 2. Vocabulary: `persona` internal, marketing name external

`persona` is the canonical internal term for one AI identity. `customer.yaml.personas[]`, `audit_log.persona_slug`, `HERMES_HOME=~/.hermes/profiles/<persona_slug>/`. The PRD §9 already establishes this vocabulary; this ADR extends it to plural and uses it consistently end-to-end.

`users:` retains its existing meaning — humans with portal access, roles `principal | operator | compliance` per [dashboard-roles.md](../specs/ai-employee/dashboard-roles.md). No collision.

Marketing copy may call the persona "employee," "associate," or whatever the brand voice lands on. The product surface (dashboard labels, customer-facing email) follows marketing; the data model, code, configs, and SOW Exhibit B follow `persona`.

**Side-effect:** PRD §4 currently calls the four user archetypes (Owner / Operator / Captain / Customer's clients) "personas." That's now an overloaded term. PRD §4 is renamed to "User Archetypes" (or "Audiences") in the same PR that updates the schema. `persona` is reserved exclusively for the AI configuration.

### 3. Per-customer Hermes D1: nullable `persona_slug` columns

Per [ADR 0007](./0007-per-customer-machine-isolation.md) and [d1-schema.md](../specs/ai-employee/d1-schema.md), each customer runs on a dedicated D1 database (`hermes-{customer-slug}-d1`) with plain table names. Cross-customer isolation is at the binding layer, not the row layer.

The following Hermes D1 tables get a nullable `persona_slug TEXT` column:

| Table            | Column added                 | Index                                                  | Rationale                                                                                             |
| ---------------- | ---------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `audit_log`      | `persona_slug`               | `idx_audit_persona (persona_slug, ts)`                 | Every action attributes to the persona that drafted/sent it.                                          |
| `draft_queue`    | `persona_slug`               | `idx_draft_persona (persona_slug, status, created_at)` | Drafts route through a specific persona's queue.                                                      |
| `memory_rules`   | `scope_type`, `persona_slug` | `idx_memory_rule_scope (scope_type, persona_slug)`     | `scope_type ∈ {'shared', 'persona'}`; required when `scope_type='persona'`.                           |
| Future `matters` | `persona_slug`               | `idx_matter_persona (persona_slug, created_at)`        | Added when the matters table ships per [#871](https://github.com/venturecrane/ss-console/issues/871). |

`scope_type` on `memory_rules` is orthogonal to the existing `rule_type` enum (`case_acceptance | voice | process | scope | escalation`). `rule_type` says _what kind_ of rule; `scope_type` says _whose memory_ (the whole customer, or one specific persona). Both are required at write time.

These columns are populated by writers at v1 with the customer's sole persona slug (default lookup: `personas[0].slug`). They are not surfaced in v1 UI.

**These changes land in [`d1-schema.md`](../specs/ai-employee/d1-schema.md), not in `ss-console/migrations/`.** The schema spec is the single source of truth for the Hermes D1 contract.

### 4. `subscriptions` is the entitlement gate; `customer.yaml` is the configuration source of truth

The local `subscriptions` table (migration 0038) answers exactly one question: **does this customer have an active subscription to this product?** Status: `provisioning | active | paused | cancelled`. The row's lifecycle is **source-agnostic**:

- **v1 (today)**: Captain inserts the row manually on countersign.
- **Future**: Stripe Subscriptions webhooks (tracked in [#917](https://github.com/venturecrane/ss-console/issues/917)) drive status transitions. Local `stripe_subscription_id` column added at that time.
- **Possibly later**: Clerk Billing, if we ever decide to consolidate billing into Clerk's primitive. Considered and not chosen for v1 (see #917 for rationale).

The column shape is the same in all three cases. The schema-lock work in this ADR does not depend on which lifecycle source is wired.

`subscriptions.settings_json` is **at most a display-cache** the dashboard reads to render names without round-tripping to the Hermes runtime. It is **not authoritative** for product configuration. Authoritative source for personas, connectors, voice, scope, escalation: `customer.yaml` in the configs repo. The plan's earlier proposal to read `settings_json.personas[]` for the dashboard is rejected — it would create a sync problem the moment v2 ships, where a persona added in customer.yaml might not be reflected in `settings_json`. If the dashboard needs to render persona names, it either (a) reads from a thin API backed by `customer.yaml`, or (b) waits until that read path exists. Mirroring is not the answer.

### 5. Clerk's role on access is unchanged

Clerk handles authentication (login, session) and Clerk Organization membership (who's in the customer's org). Clerk does **not** handle entitlement (does this org have AI Employee access? → `subscriptions`) and does not handle product-level roles (`principal | operator | compliance` → `product_roles`). This split matches the existing pattern in `src/lib/portal/product-access.ts:resolveProductAccess` and is not affected by multi-persona.

### 6. Phase 2 back-fill rule (decided now)

When Phase 2 ships per-persona runtime support, the first job is to back-fill `persona_slug` on every existing row in the customer's D1 where the column is currently NULL. The back-fill rule:

> For each customer, all NULL `persona_slug` values across `audit_log`, `draft_queue`, `memory_rules` (where `scope_type='persona'`), and any future per-persona table are back-filled to that customer's **sole v1 persona slug**, sourced from `customer.yaml.personas[0].slug` at the time the back-fill runs.

This is recorded now so Phase 2 doesn't need to re-derive it. The back-fill is one migration per existing customer; it runs before any second persona is provisioned.

### 7. Routing rules — not added at v1

The earlier plan proposed an empty `routing_rules: []` placeholder in customer.yaml. Rejected: a placeholder for a grammar that has not been designed is a TODO with extra steps. The field will be added in Phase 2 when (a) the second-persona use case forces a routing decision and (b) the grammar is forced by real requirements. No v1 validator needs to accept it.

### 8. SOW language — not changed at v1

The current SOW language at `docs/templates/ai-employee-sow.md §3` ("Additional AI agents beyond the one dedicated agent (each additional agent is a separate engagement)") is **not edited** in Phase 1. Captain's earlier "update SOW now" intent is reversed: editing the SOW to reference Phase 2 timing creates a contractual reliance risk that buys nothing while no customer has asked for a second persona. The SOW conversation happens when there is a working product, a real second-persona scope, and a real price to quote. Until then, the existing "separate engagement" line preserves SMD's freedom.

### 9. Constraints Phase 2 implementation must satisfy

Recorded here so Phase 2 design is bounded:

- **Memory scope.** Every memory write requires an explicit scope tag (`shared:<customer_slug>` for customer-scope rules; `persona:<customer_slug>:<persona_slug>` for persona-scope rules). Reads filter by scope. The memory provider implementation is deferred (Phase 2 spike chooses between custom CFHybridMemoryProvider, Honcho, Mem0, or evolved Hermes-default depending on upstream state and second-persona demand) — this ADR does not pin the interface signature.
- **Process model.** One Hermes process per persona, with `HERMES_HOME=~/.hermes/profiles/<persona_slug>/`. State isolation is at the filesystem layer. A per-Machine supervisor is added in Phase 2 to keep both processes alive; Hermes' internal watchdog suffices at N=1.
- **AgentMail.** Each persona has its own AgentMail identity at `<persona_slug>@<customer_slug>.agents.smd.services`. The naming convention is adopted at v1 (one inbox); the second inbox is provisioned when the second persona ships.
- **Dashboard URLs.** v1 stays flat (`/portal/products/ai-employee/...`). When a second persona ships, Phase 2 introduces `[persona_slug]/` subroute and a persona picker. The single-persona server-side resolution at v1 ([`src/pages/portal/products/ai-employee/index.astro`](../../src/pages/portal/products/ai-employee/index.astro)) provides the seam.
- **Resource budget.** At N=1, baseline is Fly `performance-1x` (1 vCPU / 1 GB RAM). At N=2, target is the same machine class if combined Hermes RSS ≤1.4 GB and combined CPU ≤80%. If the Phase 2 spike fails that budget, the decision tree is: upgrade to `performance-2x` (~$15/mo bump) **and** price the second persona as a scope-priced add-on that covers the infra delta. The pricing call is Phase 2's, not v1's.

---

## Consequences

### Positive

- **Schema lock is cheap and durable.** Adding nullable `persona_slug` columns and changing `persona:` block to `personas: []` array is a small diff. Doing it now prevents a migration project at Phase 2.
- **Vocabulary is consistent.** `persona` means one thing throughout the codebase. `users` means one thing. No more PRD §4 vs §9 collision.
- **The buying experience composes.** A customer who wants two personas is buying more of the same product, not a separate engagement. The data model now supports that path.
- **Phase 2 is implementation, not design.** The architectural decision (multi-persona within one subscription, one Hermes process per persona, filesystem isolation by HERMES_HOME profile path) is locked. Phase 2 picks a memory provider, builds the supervisor, ships the picker.
- **Composes cleanly with ADR 0007 / 0008 / 0009.** Multi-persona is a within-customer concern. Cross-customer isolation is untouched.

### Negative / accepted

- **Hermes upstream support for HERMES_HOME profile isolation is documented but imperfect.** The smoke test (see _Verification_) confirms the basic mechanic works. If a Phase 2 corner case exposes a real isolation gap, we may need to upstream a fix to Hermes or wrap profile management in a thin adapter. Accepted — the alternative architectures (one Hermes process with multi-persona config) are worse.
- **Writers must populate `persona_slug` defensively at v1.** Every audit-log emit, every draft creation, every memory write must include the active persona slug from the start. Forgetting this is a real risk — v1 has only one persona, so "forget and the default fires" looks like correct behavior. The fabrication-discipline pattern (PRD §7.5 invariant #8) extends here: writers without an explicit persona context must refuse, not default.
- **Phase 2 design work is not free.** Memory scope, supervisor, picker UI, routing rules grammar — all real work, all gated on a paying customer asking for it.

### Out of scope

- **Cross-persona learning.** A persona does not read another persona's memory by default. Whether persona-scope memory promotes to customer-scope (or to a different persona) is a Phase 2+ question and is not decided here.
- **Cross-customer features.** ADR 0009 (cross-Machine query prohibition) is untouched. Multi-persona is a within-customer model only.
- **Stripe Subscriptions wiring.** Tracked separately in [#917](https://github.com/venturecrane/ss-console/issues/917). The subscriptions table shape in this ADR is compatible with that work.
- **Clerk Billing.** Considered for billing path; not chosen for v1 (see #917 _Alternative considered_).

---

## Verification

Phase 1 validation is largely a paper exercise — Phase 2 implementation doesn't exist yet.

### Schema readiness checks

1. `docs/specs/ai-employee/customer-yaml-schema.md` reflects `personas: []` shape; existing pydantic model + validator updated; `tests/ai-employee/customer-yaml.test.ts` covers the new shape.
2. `docs/specs/ai-employee/d1-schema.md` reflects nullable `persona_slug` on `audit_log`, `draft_queue`, `memory_rules.scope_type`+`persona_slug`. Index additions specified.
3. PRD §4 renamed away from "personas" → "User Archetypes"; PRD §7.3 example matches the schema spec; PRD §9.1 references `personas[]`.
4. SOW unchanged. Cross-checked against `docs/templates/ai-employee-sow.md`.

### HERMES_HOME smoke test (≈ 2 hours)

Confirm Hermes accepts `HERMES_HOME=~/.hermes/profiles/<slug>/` and keeps state isolated. The schema lock depends on this mechanic working.

Procedure:

1. Start two Hermes processes in the dev environment with `HERMES_HOME=~/.hermes/profiles/marcus/` and `HERMES_HOME=~/.hermes/profiles/casey/`.
2. Run a stateful workload in each (a sequence that writes to Hermes' on-disk state — memory ingestion, skill execution, draft persistence, whichever Hermes-side state mechanism is load-bearing).
3. Inspect both profile directories. Each must contain only its own state. Neither may see the other's writes via the live runtime.
4. Kill and restart each process. Each must resume its own state without leakage.

Pass criterion: the two processes are operationally indistinguishable from running on separate machines, modulo the shared customer-scope connector and memory bindings.

Hermes upstream issues to consult before the smoke test: [hermes#476](https://github.com/hermes-platform/hermes/issues/476), [hermes#11922](https://github.com/hermes-platform/hermes/issues/11922), [hermes#10376](https://github.com/hermes-platform/hermes/issues/10376). _Note: issue numbers cited from internal research; verify before relying on them._

If the smoke test fails (or reveals a partial-isolation gap), the addressing convention may need to move from `~/.hermes/profiles/<slug>/` to something more aggressive (separate user accounts, container-level isolation). The schema decisions in this ADR survive that change; only the runbook §2.3 and the per-persona deployment path changes.

### Adversarial review

Hand the ADR to a fresh agent and ask: _"What does Phase 2 need to do to add persona #2 to an existing v1 customer?"_

Acceptable answer:

1. Add a row to `customer.yaml.personas[]` (slug, name, signature, skills, channel bindings)
2. Run the back-fill migration (rule §6 above) to populate NULL `persona_slug` columns for the existing customer
3. Provision a second AgentMail inbox via existing AgentMail tooling
4. Implement the chosen memory provider (interface determined by Phase 2 spike, not this ADR)
5. Implement the per-Machine supervisor (one Hermes process per persona)
6. Implement the dashboard picker + `[persona_slug]/` subroute
7. Populate `customer.yaml.routing_rules` once the grammar is designed

None of these require new schema migrations or AC rewrites on already-shipped issues. That is the Phase 1 success criterion.

---

## Implementation

The Phase 1 sequence — recorded here, executed by follow-on PRs:

1. **Days 1-2: this ADR lands** (recording the architectural commitment).
2. **Days 2-3: schema spec PR** — edits `docs/specs/ai-employee/customer-yaml-schema.md` (closes [#790](https://github.com/venturecrane/ss-console/issues/790)) and `docs/specs/ai-employee/d1-schema.md`. Updates the pydantic model and validator tests. PRD §7.3 example follows the spec.
3. **Days 3-5: HERMES_HOME smoke test.** Outcome appended to this ADR as a "Verification → Smoke test outcome" addendum.
4. **Days 4-5: PRD + runbook PR** — `platform-prd.md` §2, §4 (rename), §7.3, §9, §11, §12.1, §20; `ai-employee-customer-onboarding.md` §1.1, §2.2, §2.3, §8. SOW unchanged.
5. **Day 5: AC updates** on in-flight P0 issues that touch `persona_slug` writers. Updated ACs cite this ADR + the schema spec.

P0 issues whose ACs are updated (additive, nullable column at v1; no UI change):

- [#891](https://github.com/venturecrane/ss-console/issues/891) audit log persistence — writer accepts `persona_slug`; column nullable
- [#869](https://github.com/venturecrane/ss-console/issues/869) drafts list view — `draft_queue.persona_slug` written by skills; no UI column in v1
- [#870](https://github.com/venturecrane/ss-console/issues/870) Approve & Send — `persona_slug` recorded alongside `drafted_by_agent` in audit
- [#871](https://github.com/venturecrane/ss-console/issues/871) Matters tab — `matters.persona_slug` nullable when the table ships
- [#881](https://github.com/venturecrane/ss-console/issues/881) send-as identity — `persona_slug` carries through attribution
- [#868](https://github.com/venturecrane/ss-console/issues/868) Astro routing — flat URLs preserved at v1; `[persona_slug]/` segment deferred

P0 issues unaffected by this ADR: [#860](https://github.com/venturecrane/ss-console/issues/860) memory ingestion pipeline (memory_rules.scope_type written by the pipeline), [#861](https://github.com/venturecrane/ss-console/issues/861) per-customer namespace isolation enforcement, [#879](https://github.com/venturecrane/ss-console/issues/879) OAuth callback (customer-scope concern), [#880](https://github.com/venturecrane/ss-console/issues/880) per-user accounts (humans, not personas).

---

## References

- [Platform PRD](../pm/ai-employee/platform-prd.md) §2 (vision), §4 (user archetypes, to be renamed), §7.3 (customer.yaml example), §9 (persona & voice model), §11 (trust ceiling), §12.1 (v1 dashboard), §20 (Phase 1 deliverables)
- [`customer-yaml-schema.md`](../specs/ai-employee/customer-yaml-schema.md) — formal schema contract; closes [#790](https://github.com/venturecrane/ss-console/issues/790)
- [`d1-schema.md`](../specs/ai-employee/d1-schema.md) — per-customer Hermes D1 schema
- [`dashboard-roles.md`](../specs/ai-employee/dashboard-roles.md) — `users:` role vocabulary
- [`ai-employee-customer-onboarding.md`](../runbooks/ai-employee-customer-onboarding.md) §1.1, §2.2, §2.3, §8
- [`ai-employee-sow.md`](../templates/ai-employee-sow.md) — unchanged in Phase 1
- [ADR 0004](./0004-productized-ai-employee-offering.md) — productized SKU shape
- [ADR 0007](./0007-per-customer-machine-isolation.md) — deployment-level isolation
- [ADR 0008](./0008-customer-owned-memory-artifact.md) — customer-owned memory artifact
- [ADR 0009](./0009-cross-machine-query-prohibition.md) — cross-Machine query prohibition
- [Issue #790](https://github.com/venturecrane/ss-console/issues/790) — customer.yaml formal schema with secret-exclusion enforcement
- [Issue #917](https://github.com/venturecrane/ss-console/issues/917) — Stripe Subscriptions for recurring monthly retainer billing
