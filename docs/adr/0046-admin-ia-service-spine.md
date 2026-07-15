---
title: Admin IA & the Service Spine — Client Hub, Polymorphic Service, Universal Commercial Layer
date: 2026-06-10
status: superseded
superseded-by: docs/adr/0077-admin-portal-mirrors-client-portal.md
captain: Scott Durgan
related-adr: docs/adr/0004-productized-operator-offering.md, docs/adr/0034-operator-product-naming.md, docs/adr/0030-control-plane-human-principal-surface.md, docs/adr/0001-taxonomy-two-layer-model.md
---

# ADR 0046 — Admin IA & the Service Spine

> **Superseded by [ADR 0077](0077-admin-portal-mirrors-client-portal.md) (2026-07-14).** The **navigation and IA**
> decided here (the flow-ordered `Home · Leads · Clients · Services · Billing · Operator` nav, the standalone `Services`
> tab) are replaced by the five-destination spine that mirrors the client portal. The **data model** below — the
> polymorphic `service` spine and the client-as-hub principle — survives as the backing for per-client delivery records.
> Read the nav/IA sections as historical; read the data-model sections as current.

**Status:** Superseded (was Accepted, Captain decision 2026-06-10). The model and information architecture for the SMD
admin console now that the venture sells two kinds of service. Supersedes how Entities/pipeline are framed in the current
admin nav.

> **Implemented-note (2026-07-13).** The "IA/data-model direction only — no schema is created here" framing is now historical. The polymorphic `service` spine **shipped** as DDL in `migrations/0068_service_spine_ddl.sql` (with `src/lib/db/services.ts`), and the flow-ordered nav (`Home · Leads · Clients · Services · Billing · Operator`) shipped in `src/layouts/AdminLayout.astro`. Read the "does not exist yet" language below as the originating direction, since built.

## Context

The admin console grew up around one business: a lead-to-client consulting funnel. Its top nav is six flat tabs —
`Dashboard · Entities · Follow-ups · Generators · Analytics · Operator`. That structure has two problems now that the
venture has evolved:

1. **The flat nav lies about what the tabs are.** `Generators` (lead-gen feeds) and `Follow-ups` (a cadence layer) are
   _sub-functions of the consulting funnel_. `Operator` ([ADR 0004](0004-productized-operator-offering.md),
   [ADR 0034](0034-operator-product-naming.md)) is a whole product line. The nav presents all three as peers. They are
   not the same kind of thing.

2. **There is no post-sale account view.** Today's `entities/[id]` page is, in practice, a _lead working view_ —
   enrichment, pain observations, outreach drafts, stage transitions, "new quote." Once a prospect becomes a paying
   client, the surfaces that matter (their services, their billing, their Operator) are collapsible dumps at the bottom
   of a page built for acquisition. The admin has no screen that answers "show me everything about _this client_."

The deeper realization driving this ADR: **a consulting engagement and an Operator subscription are not two businesses.
They are two kinds of the same thing — a service a client purchased.** Both emerge from an assessment. Both have a
quote, an agreement, acceptance, invoicing. Both have implementation, stabilization, training. Both may recur (the
Operator by design more likely so). They diverge at exactly one point: the Operator has its own configuration,
monitoring, and management surface (the cockpit, [ADR 0030](0030-control-plane-human-principal-surface.md) and the
`docs/design/operator/` portal specs). Everything before that point is shared.

The admin also needs every commercial object viewable along **two axes**: globally ("all invoices," "all operators,"
"all services") and per-client ("this client's invoices, operators, services"). The current structure serves neither
axis cleanly.

## Decision

Rebuild the admin around a **client hub** and a **polymorphic `service` spine**, with a **universal commercial layer**
beneath both, and express that model as a flow-ordered top-level navigation.

### 1. The data model

- **The client is the hub.** One record per business, cradle to grave. A prospect and a client are the _same record_ at
  different points in its life; "pipeline" is a lens over that record, not a separate object. The record never migrates
  from "lead" to "client" — the _surface_ changes to match its current job (see §3, Leads vs. Clients).

- **`service` is a polymorphic spine.** A `service` row means "this client bought X." It carries shared lifecycle state
  (proposed → accepted → active → completed/churned, a recurring flag, origin assessment) and a typed delivery payload:
  `type: 'consulting' | 'operator'`. The `type` selects which delivery surface opens. A `service` is instantiated **by an
  accepted quote**, never created hand-first.

- **The commercial layer is universal, and it binds upward only.** Quote, agreement, invoice, and payment are generic —
  their shape does not depend on what is being sold. They bind to the **purchase** (the quote line), **not** to
  `service`. Delivery records (`service`, and any future `product`) point _up_ at the commercial spine; the spine never
  points _down_ at them. This one directionality rule is what lets a future actual product (downloadable software,
  shippable hardware) land as a `product` sibling to `service` with nothing renamed and no commercial-layer rewrite. We
  are **not** building `product` now; we are only refusing to foreclose it. Naming stays honest: everything sold today is
  a `service`, named `service`, not a pre-abstracted `offering`/`sellable`.

- **Money is bi-modal everywhere.** Bounded engagements bill one-time (invoiced / paid / outstanding, milestone). The
  Operator bills recurring (MRR / churn / renewals). Every surface that shows money carries both lenses, not one.

- **Operator is the lone divergence.** Commercially an Operator is just a `service` — it appears under its client and in
  the global service list like anything else. Operationally its management surface (runtime, config, personas,
  entitlements, alerts) is unlike any other service and keeps its own cockpit. The same object is seen through two
  legitimate lenses: the commercial lens (Clients / Services) and the runtime lens (Operator). This is not duplication;
  the _jobs_ differ.

### 2. Two pivots

Every commercial object is reachable two ways, and the IA provides a home for each:

- **Per-client (the hub):** drill into one business and see all of it — its services, billing, activity, Operator.
- **Global per-object:** "all leads," "all services," "all money" — cross-client worklists for operating the book of
  business by object type.

### 3. The navigation

The flat six tabs become a flow-ordered top level that reads as the business itself:

```
HOME · LEADS · CLIENTS · SERVICES · BILLING · OPERATOR · ANALYTICS        ⚙ Settings
        └ acquire ┘  └ serve ┘  └ deliver ┘ └ get paid ┘  └ product ┘   └ measure ┘
```

| Surface        | Job       | Shape                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home**       | orient    | action queue ("needs you today", deep-links into every surface) · the two revenue shapes · three motion cards (Acquisition / Delivery / Fleet). A **launchpad, not a workspace** — every tile summarizes a surface and jumps to it; you never work _on_ Home.                                                                                               |
| **Leads**      | acquire   | the pre-acceptance workflow (its own surface). Board `Triage → Contacted → Assessment → Quoted → Won/Lost`; a Triage column fed by generator output. Drills to the lead working view that exists today as `entities/[id]`.                                                                                                                                  |
| **Clients**    | serve     | the per-business **hub** — the only per-entity drill-in. Anatomy: Identity · At-a-glance · **Services** · Billing · Activity · What's-next (+ Contacts) · Background. The surface flips emphasis at the acceptance line; lead-gen evidence recedes into **Background** (reference material, structured so it _can_ be mined later — a seam, not an engine). |
| **Services**   | deliver   | global in-flight services across all clients, both types, filtered by `type` × lifecycle stage, sorted by risk. Consulting row → engagement delivery; operator row → into the cockpit; client name → hub.                                                                                                                                                   |
| **Billing**    | get paid  | global money, built bi-modal: tabs `Quotes` (money-in-waiting) · `Invoices` (one-time) · `Recurring` (MRR, renewals, churn). The full-detail home of the revenue Home only summarizes.                                                                                                                                                                      |
| **Operator**   | run       | the runtime cockpit (already built). Roster · runtime · provisioning · alerts. Gains inbound links from Services/Clients.                                                                                                                                                                                                                                   |
| **Analytics**  | measure   | cross-cutting BI, extended to span both revenue shapes.                                                                                                                                                                                                                                                                                                     |
| **⚙ Settings** | configure | generator **config** (enable/disable pipelines, last-run) moves here; connectors; Google connect.                                                                                                                                                                                                                                                           |

The lifecycle thread that stitches the surfaces — one record, the surface matching its current job:

```
signal → LEADS (triage → quote) → ✓accept ⇒ service ⟶ CLIENTS (serve)
                                                     ⟶ SERVICES (deliver)
                                                     ⟶ BILLING (collect)
                                                     ⟶ [if operator] → OPERATOR cockpit
```

## What this supersedes

- **The flat six-tab nav.** `Dashboard` becomes **Home** (re-scoped from a pipeline summary to a venture summary across
  both revenue shapes). `Entities` splits by job into **Leads** (the working/acquisition surface — the current
  `entities/[id]` view lands here) and **Clients** (the new post-sale hub); the pipeline becomes a lens, not a separate
  noun. `Follow-ups` is absorbed (per-client in the hub, global queue on Home/Services). `Generators` is demoted to
  Settings (config) with its output worked in Leads (triage). Nothing is deleted — the framing changes.

- It does **not** touch the Operator's authority posture ([ADR 0041](0041-operator-authority-posture.md)) or entitlement
  model ([ADR 0035](0035-no-imposed-entitlement-defaults.md)). Those govern who-may-operate and what-the-operator-may-do;
  this ADR governs how SMD's own admin console is organized.

## Consequences & non-goals

- **This ADR is IA + data-model direction, not an implementation.** No schema is created here. The `service` spine does
  not exist yet; today there are separate `engagements`, `quotes`, `invoices`, and (Operator-side)
  `operator_provisioning_intent` / `customer_configs`. Generalizing `engagement` into a typed `service`, and reconciling
  the current Operator provisioning path (customer.yaml-first, [ADR 0012](0012-customer-yaml-storage.md)) with the
  "accepted quote instantiates a service" commercial flow, are **follow-on work to be filed as issues**, not done in this
  ADR. Scope discipline applies.

- **The client hub design is held at anatomy/structure level.** A fidelity mock and the component build are deferred. The
  per-surface designs for Leads / Services / Billing / Home are sketched here at IA level only.

- **`product` is explicitly out of scope.** The upward-binding rule (§1) is the _only_ accommodation made for it; no
  product machinery is built or planned here.

- **Background is shaped, not mined.** The reference bucket on the client hub is named and structured so future
  opportunity-mining can slot in; no opportunity-derivation, draft-from-reviews, or upsell engine is built now. Getting
  the first clients comes first. Any future client-facing output from Background stays extractive and evidence-bound
  (the enrichment-prompt contracts) and follows the objectives-first / collaborative voice standard.
