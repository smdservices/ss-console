---
title: Operator — Product Naming and Capability Realignment (supersedes "Operator")
date: 2026-06-01
status: accepted
captain: Scott Durgan
supersedes: 0004-productized-operator-offering.md §"Service name"
related-adr: 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0031-content-sensitivity-send-floor.md
---

# ADR 0034 — Operator: Product Naming and Capability Realignment

**Status:** Accepted (Captain decision, 2026-06-01).

**Source:** Captain directive. ADR 0004 productized the offering under the working term **"Operator"** and explicitly deferred the customer-facing name: _"'Operator' is the working term in this ADR. The customer-facing brand for the SKU may differ,"_ with a filed follow-on for the service-name decision. This ADR resolves that deferral.

---

## Context

"Operator" was the working name from the first productization (ADR 0004, 2026-05-13). It carried an implicit posture: a staffer that waits to be assigned work and drafts for a human to send. That posture was literally true under the original [ADR 0005](./0005-reviewer-as-sender.md) holding ("reviewer-as-sender is architectural, not configurable" — the agent cannot send).

The architecture has since moved past that posture:

- [ADR 0025](./0025-autonomy-ceilings-configurable-exposure-vs-initiation.md) made autonomy a **configurable per-action-class ceiling** (initiation and exposure as independent axes) and removed the hardcoded refusal of autonomous external send. [ADR 0035](./0035-no-imposed-entitlement-defaults.md) then removed any imposed default: reviewer-as-sender is **one authored option** (and a vertical-pack-lockable constraint where pinned), not a default — unauthored external actions are fail-closed.
- [ADR 0031](./0031-content-sensitivity-send-floor.md) added the **content-sensitivity send floor** (money/contract/scope/legal always drafts) that sits on top of the configurable ceiling.
- Customer-zero ("Crane") proved autonomous bidirectional email on 2026-06-01: it received an inbound message via webhook and replied in-thread, recipient-locked, with no human in the loop.

The product **acts**. It initiates, decides, and — within configured ceilings and floors — sends, on its own. "Employee" no longer describes it: an employee is staff you manage; this is something that runs operations and gets work done. The name was lagging the architecture.

## Decision

**The product is renamed from "Operator" to "Operator."** This is a capability realignment, not a marketing rebrand. "Operator" names what the product is: an agent that operates — it takes on the recurring work, acts within configured authority, and gets things done. The realignment is consistent with, and downstream of, the autonomy posture already locked in ADR 0025 and ADR 0031.

### 1. Scope of the rename

"Operator" replaces "Operator" across:

- **Customer-facing marketing** (the product page, home-page intro, nav, CTAs, intake `interest=operator`).
- **Product, portal, and admin UI** (route `/operator`, `/portal/products/operator/**`, `/admin/operator/**`, all user-visible labels and status copy).
- **Doctrine and docs** (ADRs as living references, PRDs, specs, templates, strategy, runbooks, decision-stack, CLAUDE.md).
- **Code identifiers** (route paths, `OPERATOR_PRODUCT_SLUG`, `PRODUCT_SLUG = 'operator'`, symbols, component names).
- **The portal subscription slug** (`subscriptions.product_slug` / `product_roles.product_slug` migrated `'operator'` → `'operator'`).
- **The boot substrate** (`operator/` adapter + customer-config tree, Dockerfile, bootstrap) — **deferred to a gated cutover (see Delivery)** because it is read by a separate repo and a live Fly volume.

### 2. "Operator" is the product. Humans who operate stay operators too.

The word "operator" already describes **human roles** in this product, and that usage is correct and retained:

- the **`operator` RBAC role** in the `principal | operator | compliance` triad (`product_roles.role`),
- the **"Designated Operator"** persona (the customer's day-to-day human touchpoint),
- the **"backup operator"** (SMD's bus-factor role), and the **"SMD Operator"** (Captain).

A human who gets things done is an operator; so is the product. Context disambiguates (the product is referenced by its persona name — e.g. "Crane" — and as "the Operator"; a human's role is "operator" in the access model). **This dual usage is deliberate. Do not "fix" it by renaming the human role or the RBAC enum** — the `product_roles.role` value `operator` stays. This note exists so a future agent doesn't read the overlap as a collision and break the access model.

### 3. What this ADR does to ADR 0004

- **Supersedes** the "Service name" item ADR 0004 left open. The customer-facing brand is **Operator**. Everything else in ADR 0004 (the flat-rate retainer SKU, second-front-door positioning, Hermes-leaning stack) stands unchanged.

### 4. What does NOT change

- The `operator` RBAC enum value (see §2).
- **External infrastructure resource names**, which are slug-independent and not customer-facing: the Sentry project `smd-operator`, the R2 buckets `smd-operator-skill-bodies` / `ss-operator-<customer_id>-skills`, the generic OAuth callback `/api/oauth/callback`, and the Machine heartbeat path. Renaming these is infra coordination with no positioning value; they may be migrated in a later infra step but are explicitly out of scope here.
- The legacy `interest=operator` intake alias is retained so pre-rename marketing links still resolve.

## Delivery

Comprehensive in scope; sequenced so the live customer (Crane) cannot crashloop. A path read by a separate repo plus a live Fly volume cannot be renamed in one atomic merge.

- **PR 1 (this repo):** marketing, product/portal/admin UI, docs, code identifiers, the DB `product_slug` migration, and `src/**` renames + middleware 301 redirects. Leaves the `operator/` boot substrate untouched, so it merges and deploys without touching Crane.
- **Overlay companion PR** (`venturecrane/hermes-smd-overlay`): path/config change for the substrate rename; hard predecessor to PR 2.
- **PR 2 (gated):** renames the `operator/` boot substrate, merged only after the overlay PR is in and a deliberate Fly re-bootstrap is staged and Crane verified healthy.

## Consequences

**Positive.**

- The name finally matches the product. "Operator" carries the autonomy posture (ADR 0025/0031) honestly; "employee" implied a passivity the product no longer has.
- The realignment ties the product to SMD's own identity — operations discipline applied to growing businesses.
- ADR 0004's last open item (service name) is closed.

**Negative / accepted.**

- The "operator" word now does double duty (product and human role). Mitigation: §2 records the dual usage as deliberate; the RBAC enum is untouched; UI references the product by persona name. Accepted as a contextual ambiguity, not a defect.
- A three-landing delivery (PR1 / overlay / PR2) is more coordination than one merge. Accepted: it is the only sequence that keeps the live customer up.
- Historical ADRs and review artifacts retain "Operator" in their bodies (amendment banners point here); external infra names retain the old slug. Accepted: ADRs are historical records, and infra-name churn has no positioning value.

## References

- [ADR 0004](./0004-productized-operator-offering.md) — productized SKU; its "Service name" deferral is resolved here.
- [ADR 0025](./0025-autonomy-ceilings-configurable-exposure-vs-initiation.md) — configurable autonomy ceilings (the capability this name reflects).
- [ADR 0031](./0031-content-sensitivity-send-floor.md) — content-sensitivity send floor.
- `docs/adr/decision-stack.md` — Decision #44 (Productized offering) updated to name the product Operator.
