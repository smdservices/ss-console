---
title: Capability-Adapter Pattern — Skills Call Capability Interfaces, Vendor Adapters Implement Them, customer.yaml Binds the Wiring
date: 2026-05-20
status: accepted
captain: Scott Durgan
supersedes: none
related-prd: docs/pm/ai-employee/platform-prd.md §7.2, §7.3, §4 (P4)
related-issue: https://github.com/venturecrane/ss-console/issues/828
---

# ADR 0006 — Capability-Adapter Pattern

**Status:** Accepted (Captain decision; embedded in the AI Employee PRDs since first draft; recorded here as a standalone ADR per [#828](https://github.com/venturecrane/ss-console/issues/828)).

**Source:** Platform PRD principle P4 ("Connectors are pluggable; skills are connector-agnostic") and Architecture §7.2 (capability-interface + adapter pattern). Reinforced by `synthesis-round-1.md` Theme 4 — the platform cannot ship without the capability interfaces being formally defined as contracts.

---

## Context

The AI Employee runs a fixed set of skills (six universal primitives, nine cross-cutting universal skills, six specialized dedicated skills, and practice-area overlays — full catalog in Platform PRD §8). Each skill needs to read and write against the customer's actual systems: practice-management software, email, calendar, document storage, e-sign, court access, payments, accounting, intake CRM, call tracking, internal comms.

The customer base will not converge on a single tool stack. PI firms vary across Filevine, SmartAdvocate, Clio, CASEpeer, Neos, and MyCase for practice management alone; some are on Microsoft Graph for email, some on Google Workspace; some on DocuSign, some on PandaDoc. The same is true for every other capability.

Two patterns were available:

1. **Per-vendor skills.** Every skill is rewritten per vendor combination. The `inbox-triage-and-draft` skill exists as `inbox-triage-and-draft-microsoft-graph` and `inbox-triage-and-draft-google-workspace` and so on. New vendor combinations require new skill builds. Skill maintenance scales with `vendors × skills`.
2. **Capability-adapter.** Skills bind to abstract capability interfaces (`Email.create_draft(thread, body)`, not `MicrosoftGraph.draft(...)`). Vendor-specific adapters implement the interfaces. Adding a new vendor means writing one adapter; the skill catalog is untouched. Skill maintenance scales with `skills + vendors`, not the product.

Pattern 1 is the path of least immediate friction but is the textbook M×N coupling problem; at four skills × three PM vendors it is manageable, at fourteen skills × six PM vendors it is unmaintainable, at the platform's twenty-plus skills × Tier-0/Tier-1/Tier-2 connector ladder it is an architecture that cannot ship.

Pattern 2 requires upfront discipline (defining the capability interfaces precisely, per `synthesis-round-1.md` Theme 4) but localizes vendor knowledge to a single layer.

## Decision

**Skills bind to abstract capability interfaces. Concrete vendor adapters implement the interfaces. `customer.yaml` declares which adapter implements which capability for each customer. This three-layer separation — capability interface, adapter, wiring — is architectural.**

The eleven capability interfaces (PRD §7.2): `PracticeManagement`, `Email`, `Calendar`, `DocumentStorage`, `ESign`, `CourtAccess`, `Payments`, `Accounting`, `IntakeCRM`, `CallTracking`, `InternalComms`.

The structure:

- **Capability interfaces** live at `ai-employee/capabilities/{name}.ts`. Each is a TypeScript interface with full method signatures, input/output shapes, error contracts, and capability-disclosure metadata (what fields the adapter can populate, for the §12 dashboard's "What Marcus used to write this" sourcing block).
- **Vendor adapters** live at `ai-employee/connectors/{capability}/{vendor}/`. Each adapter implements the interface for one vendor. Adapters do not call other adapters.
- **`customer.yaml`** declares the binding per capability for each customer (see PRD §7.3). The provisioning script reads `customer.yaml`, resolves bindings, and registers the chosen adapter for each capability at Machine boot.
- **Skill code** imports the capability interface, not the adapter. A skill written against `Email.create_draft(...)` works identically whether the customer is on Microsoft Graph or Google Workspace.

## Consequences

**Positive.**

- Skill catalog is connector-agnostic by construction. Adding the seventh PM adapter is one adapter, not seven new skill variants.
- Per-customer adapter swap is configuration, not code. A customer migrating from CASEpeer to Filevine flips the binding in `customer.yaml` and redeploys; the skill catalog is unchanged.
- The capability interface is the unit of vendor-research and vendor-due-diligence. Tier-0 (universal, every demo), Tier-1 (per-firm common), Tier-2 (per-firm adjacent) connector tiers per Law-firm PRD §7 are layered along the same axis.
- Per `synthesis-round-1.md` Theme 4, the capability interfaces must be formally typed before Phase 1 build begins. This is non-negotiable. PRD §7.2.1 (added per synthesis Theme 4) is the contract layer.
- The adapter-disclosure metadata feeds the §12 dashboard's "What Marcus used to write this" sourcing block: per draft, the dashboard shows which adapter served which field. This is a trust-building surface that is impossible without the capability layer.

**Negative / accepted.**

- Upfront discipline cost is real. Defining `PracticeManagement.create_matter(client, type, attrs)` requires deciding what `attrs` actually contains across the vendor set. The least-common-denominator trap (only expose fields every vendor supports) yields a thin product; the maximalist trap (expose every field any vendor supports) yields adapters that throw on every call. Per PRD §7.2.1, the capability interfaces declare both a core set (every adapter implements) and an optional set (adapters declare which they implement; skills check capability at draft time).
- Adapter maintenance is centralized but never zero. Vendor API breaking changes hit the adapter; the platform absorbs the cost. We accept this as the cost of vendor-pluggability.
- Some skill behavior cannot be captured at the capability layer (e.g., Filevine-specific reporting that has no equivalent in CASEpeer). For these, the skill catalog has explicit vendor-conditional branches, but the branches are at the skill layer, not the capability layer. We accept a small number of explicit vendor branches in skill code in exchange for keeping the capability layer clean.

**Out of scope.**

- Cross-adapter orchestration (e.g., an "email a document from PracticeManagement via Email" workflow) is a skill responsibility, not a capability responsibility. The capability interfaces stay vertical; cross-capability composition happens in skills.
- Vendor billing and OAuth lifecycle are separate concerns (PRD §7.9 covers OAuth token lifecycle per `synthesis-round-1.md` Theme 2). The capability-adapter pattern does not specify how adapters authenticate.

## References

- Platform PRD principle P4 (`docs/pm/ai-employee/platform-prd.md` §3)
- Platform PRD §7.2 The capability-interface + adapter pattern
- Platform PRD §7.2.1 Capability interface specifications (added per synthesis Theme 4)
- Platform PRD §7.3 `customer.yaml` as the wiring layer
- Law-firm PRD §7 Connector Strategy (Tier-0 / Tier-1 / Tier-2 ladder)
- `docs/pm/ai-employee/prd-contributions/synthesis-round-1.md` Theme 4 (capability interface contracts must be defined before Phase 1 build)
- [Issue #828](https://github.com/venturecrane/ss-console/issues/828)
