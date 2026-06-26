---
title: ADR Index
section: reference
order: 1
summary: Every Architecture Decision Record, numerically, with a one-line summary and a link to the source
sources:
  - label: docs/adr/ directory
    href: https://github.com/venturecrane/ss-console/tree/main/docs/adr
  - label: ADR index (source)
    href: https://github.com/venturecrane/ss-console/blob/main/docs/adr/index.md
---

## What this is

The map into the "why" canon. Every numbered ADR in `docs/adr/`, listed numerically with a one-line essence and a link to the file. ADRs capture narrower architectural choices, mostly about the Operator platform; the broader go-to-market decision corpus lives separately on [The Decision Stack](/admin/playbook/decision-stack).

ADRs amend and supersede each other in chains. Where an ADR is amended or superseded, the summary says so. Always cite the ADR number when referencing a decision elsewhere.

Summaries are condensed from `docs/adr/index.md` and from reading each ADR's header. Link form: `https://github.com/venturecrane/ss-console/blob/main/docs/adr/<filename>`.

## Numbering gaps and collisions

Read these before assuming the sequence is dense:

- **No file for ADR 0013, 0014, or 0050.** These numbers are absent from `docs/adr/`. ADR 0050 is referenced by [ADR 0051](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0051-operator-durable-task-execution-substrate.md) as "the Operator task-execution framework" and as the source of build item B1, but no `0050-*.md` file exists in this tree.
  > TODO(why): ADR 0051 cites `0050-operator-task-execution-framework.md` as an existing related ADR, but that file is not present in `docs/adr/`. Either it lives on another branch / in another location not checked into this worktree, or it was never committed here. The "why" of its absence is unverifiable from this tree.
- **ADR 0044 is a duplicate number.** Two distinct ADRs both claim 0044: `0044-r2-authoritative-live-reconfig.md` (accepted 2026-06-14) and `0044-static-secret-connector-contract.md` (proposed 2026-06-09). They are different decisions that collided on the number.

## The records

| # | Title | Summary | Source |
|---|---|---|---|
| 0001 | Taxonomy two-layer model | Two distinct taxonomies: 6-category delivery (marketing/doctrine) vs 5-category observation (lead-gen extraction). Deliberately not merged. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0001-taxonomy-two-layer-model.md) |
| 0002 | Outside View unified diagnostic | One lead-magnet product at three input depths, portal-resident. **Superseded 2026-05-04**; product retired in PR #702/#703. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0002-outside-view-unified-diagnostic.md) |
| 0003 | Lead-gen pivot: actor identity | Actor identity, drafting decoupled, statewide reach, no revenue gate. Retires the $750k-$5M qualification band. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0003-lead-gen-pivot-actor-identity.md) |
| 0004 | Productized Operator offering | Flat-rate monthly retainer SKU as a second front door; Hermes-leaning stack. Supersedes Decision #12 (retainer model). | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0004-productized-operator-offering.md) |
| 0005 | External-send identity | Persona has no external sending identity; drafts go to a reviewer. **Amended by 0025 + 0035** into one authored option, not a default. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0005-external-send-identity.md) |
| 0006 | Capability-adapter pattern | Skills bind to abstract capability interfaces; vendor adapters implement; customer.yaml wires. TS-side ergonomic, runtime via tool registry + MCP. **Rewritten 2026-05-24.** | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0006-capability-adapter-pattern.md) |
| 0007 | Per-customer Machine isolation | One Fly.io Machine per customer; multi-tenancy via deployment isolation, not runtime tenancy. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0007-per-customer-machine-isolation.md) |
| 0008 | Customer-owned memory artifact | Customer memory in per-customer D1/R2/Vectorize namespaces; portable export, verifiable deletion. **Superseded 2026-05-24** (decomposed; principles preserved). | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0008-customer-owned-memory-artifact.md) |
| 0009 | Cross-Machine query prohibition | No customer Machine can query another's data; boot-time binding check + shared-catalog merge gate. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0009-cross-machine-query-prohibition.md) |
| 0010 | Per-customer OAuth token storage | Where per-customer OAuth tokens live (Infisical vs Fly volume). | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0010-per-customer-oauth-token-storage.md) |
| 0011 | Multi-persona per customer | Persona = Hermes profile; v1 ships one persona; multi-profile switching via Hermes `/handoff`. **Rewritten 2026-05-24.** | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0011-multi-persona-per-customer.md) |
| 0012 | customer.yaml storage | Git is source of truth; portal D1 + per-customer R2 are materialized replicas. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0012-customer-yaml-storage.md) |
| 0013 | *(no file)* | Number absent from `docs/adr/`. | - |
| 0014 | *(no file)* | Number absent from `docs/adr/`. | - |
| 0015 | Hermes fork vs upstream | Pin-only fork + plugin-only overlay; no core-file mods. **Fork half superseded 2026-05-28 by 0024**; plugin-only-overlay half stands. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0015-hermes-fork-vs-upstream.md) |
| 0016 | Honcho disposition | Mirror, don't gate; tuned native config; conclusions mirrored to D1 with provenance; TTL archival; Captain dismissal triggers physical DELETE. **Rewritten 2026-05-24.** | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0016-honcho-disposition.md) |
| 0017 | Skill Curator disposition | Trust Hermes-native skill creation; `skill_manage` enabled; mirror to D1 inventory for Captain visibility. **Rewritten 2026-05-24.** | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0017-skill-curator-disposition.md) |
| 0018 | GEPA disposition | **Superseded 2026-05-24** - GEPA not present in Hermes upstream; original boot-check verified a non-existent subsystem. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0018-gepa-disposition.md) |
| 0019 | customer.yaml to profile-config translation | `hermes-smd bootstrap` CLI; deterministic, idempotent; customer-sync sidecar polls R2, classifies structural vs non-structural change. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0019-customer-yaml-to-profile-config-translation.md) |
| 0020 | Connector strategy | MCP-first where a vendor or vetted-community server exists; BUILD only when no acceptable MCP. Composio retired 2026-05-30. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0020-connector-strategy.md) |
| 0021 | Leverage Hermes native primitives | Use `execute_code`, `delegate_task`, no-agent cron, skill bundles, webhook gateway via `pre_gateway_dispatch`; retire BUILD adapters to MCP. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0021-leverage-hermes-native-primitives.md) |
| 0022 | Vertical pack architecture | Vertical manifest schema, customer.yaml extension fields, skill body persistence, materialization history (time-machine substrate). | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0022-vertical-pack-architecture.md) |
| 0023 | Operator per-customer observability | Compose existing specs + add Sentry, heartbeat, fleet view, alert routing. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0023-operator-per-customer-observability.md) |
| 0024 | Hermes consumption and update cadence | Upstream SHA-pin, golden base image in GHCR, track-vs-deploy with one blessed fleet version, two clocks. **Supersedes the fork half of 0015.** | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0024-hermes-consumption-and-update-cadence.md) |
| 0025 | Autonomy ceilings configurable | Split initiation from exposure, per action-class, code-enforced, audited, agent-never-self-raises; vertical-pack-lockable floor. **Amends 0005; amended by 0035.** | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md) |
| 0026 | Config surface is a security boundary | Every autonomy-affecting config change is principal-authenticated, durably persisted, immutably audited, floor-checked. Companion to 0025. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0026-config-surface-is-a-security-boundary.md) |
| 0027 | Inbound trust boundary | Untrusted external content is provenance-attributed and structurally separated from the instruction channel; can never drive a privileged action; adversarial-injection corpus in CI. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0027-inbound-trust-boundary.md) |
| 0028 | Outbound integrity gates | Provenance (no-fabrication) and voice-fidelity gates run on live output, fail-closed. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0028-outbound-integrity-gates-provenance-and-voice.md) |
| 0029 | Workforce model: inter-employee mediation | Ceilings transitive and monotonically non-increasing under delegation; accountability preserved; isolation-by-default. Implementation deferred to multi-employee SKU. Extends 0011. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0029-workforce-model-inter-employee-mediation.md) |
| 0030 | Control plane: human principal surface | The principal's single governing surface (review, memory control, authority/config, lifecycle) under one auth + audit guarantee; the agent can only propose. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0030-control-plane-human-principal-surface.md) |
| 0031 | Content-sensitivity send floor | Under an autonomous send ceiling, bodies touching money/contract/scope/legal downgrade to draft-for-review. Content-derived floor atop the 0025 ceiling. **Amends 0025.** | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0031-content-sensitivity-send-floor.md) |
| 0032 | Inbound webhook architecture | Front-door gate (Svix signature verification), native-adapter routing into the Hermes webhook adapter, deferred hardening. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0032-inbound-webhook-architecture.md) |
| 0033 | Telegram channel native polling | Hermes native polling adapter; env-enabled, mandatory user allowlist (fails closed on empty), DM-only. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0033-telegram-channel-native-polling.md) |
| 0034 | Operator product naming | Renames the product to "Operator" to match the autonomy posture; humans-as-operators and the `operator` RBAC enum retained. **Supersedes 0004's service-name section.** | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0034-operator-product-naming.md) |
| 0035 | No imposed entitlement defaults | The harness assumes no posture; unauthored entitled actions are fail-closed (no send, no draft); draft-for-review is one authored option. **Amends 0025 + 0005** (removes the `draft_for_review` default). | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0035-no-imposed-entitlement-defaults.md) |
| 0036 | OAuth token relay: Fly secret + restart | Portal sets the customer app's Fly secret + restarts the Machine on connect/re-consent; refresh self-maintains on-volume. **Amends 0010.** | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0036-oauth-token-relay-fly-secret-restart.md) |
| 0037 | The Operator Thesis | Canonical positioning frame: competes with a hire not software; configurable substrate, no defaults; moat = harness + guide + memory; packs; market-driven targeting. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0037-operator-thesis.md) |
| 0038 | Operator vertical delivery method | Top-3 verticals delivered one at a time (law to marketing to insurance); the unit is the "wedge"; harden on fixtures+evals before infra; shared core + thin delta earned by rule-of-three. Provisional. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0038-operator-vertical-delivery-method.md) |
| 0039 | Operator-led assessment funnel | A voice-capable web-widget operator runs the assessment, drafts evidence-bound findings, withholds the read to entice a human-owned closing call. Bottleneck is the human close. Provisional. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0039-operator-led-assessment-funnel.md) |
| 0040 | Operator positioning and why-us (law-first) | The citable "why you, why this": runs on the firm's expertise and gets better every week; configurable, vendor-blind, customer-controlled, the firm's voice. **Amends 0037.** | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0040-operator-positioning-and-why-us.md) |
| 0041 | Operator authority posture | Per-domain client self-serve switches; SMD always retains full control; default-off, read-all day one. Accepted 2026-06-08. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0041-operator-authority-posture.md) |
| 0042 | Operator credential custody | Delegated by default, self-held for privacy, per connector. Accepted 2026-06-08. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0042-operator-credential-custody.md) |
| 0043 | Operator runtime read path | Mirror summaries + live per-customer reads (A+B); the shared component both Operator portals depend on, built first. Accepted 2026-06-08. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0043-operator-runtime-read-path.md) |
| 0044 | R2-authoritative live reconfiguration | Apply a customer.yaml change to a running Operator without a reboot, durably and reversibly; broker-owned apply. Accepted 2026-06-14. **Duplicate number** with the static-secret ADR below. **Amends 0012.** | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0044-r2-authoritative-live-reconfig.md) |
| 0044 | Static-secret connector contract | Per-connector descriptor for relaying a client-entered static secret (raw API key) to a per-customer Machine; multi-field, custody-enforced. **Proposed**, not launch-blocking. **Duplicate number** with the R2-reconfig ADR above. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0044-static-secret-connector-contract.md) |
| 0045 | Mediated connector capability broker | Connector credentials outside the agent runtime; first-class classified operations; operation-bound grants. Accepted 2026-06-10 (Option 2: isolated Workspace proxy as first increment). | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0045-mediated-connector-capability-broker.md) |
| 0046 | Admin IA and the service spine | The client is the hub; `service` is a polymorphic spine (consulting / operator); commercial layer is universal; flow-ordered nav. **Supersedes the flat six-tab nav.** | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0046-admin-ia-service-spine.md) |
| 0047 | Operator scheduled-jobs mechanism | Materialize the authored `persona.cron[]` block into Hermes-native cron at bootstrap; customer.yaml is the single source of truth; fails closed and loud. Accepted 2026-06-11. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0047-operator-scheduled-jobs-mechanism.md) |
| 0048 | Operator relationship model | Per-person working-preference memory on Hermes' native memory loop; deterministic foundation + legible surface. The voice-correction "live-edit" lane was retracted by a 2026-06-16 amendment. Accepted 2026-06-14. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0048-operator-relationship-model.md) |
| 0049 | Operator model selection | Native two-tier seam: light-main / escalate-up. The canonical answer to how the Operator chooses which LLM does a piece of work; no custom router. Accepted 2026-06-16. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0049-operator-model-selection.md) |
| 0050 | *(no file)* | Number absent from `docs/adr/`; referenced by 0051 as "Operator task-execution framework" (build item B1's source). See the gap note above. | - |
| 0051 | Operator durable task-execution substrate (B1) | How the Operator runs a job too big for one synchronous turn: take it, run unattended to completion, survive crashes/restarts, deliver a retrievable result. Accepted 2026-06-18. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0051-operator-durable-task-execution-substrate.md) |
| 0056 | Persona exposure + skill initiation entitlements | Replaces scalar `trust_ceiling`, skill `action_ceilings`, scope entitlement fields, and mailbox entitlement overrides with sparse persona exposure plus explicit skill initiation. | [link](https://github.com/venturecrane/ss-console/blob/main/docs/adr/0056-persona-exposure-skill-initiation-entitlements.md) |

## Related

- The go-to-market decision corpus these ADRs sit alongside: [The Decision Stack](/admin/playbook/decision-stack)
- Vocabulary used throughout: [Glossary](/admin/playbook/glossary)
- Where every doc lives: [Docs Map](/admin/playbook/docs-map)
