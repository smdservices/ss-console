---
title: The Admin Console
section: system
order: 4
summary: The admin portal surface map - the nine top-nav sections and what each does, plus the Operator fleet pages and per-customer drill-in tabs
sources:
  - label: src/layouts/AdminLayout.astro (top nav)
    href: https://github.com/venturecrane/ss-console/blob/main/src/layouts/AdminLayout.astro
  - label: src/pages/admin/ (route tree)
    href: https://github.com/venturecrane/ss-console/tree/main/src/pages/admin
  - label: src/pages/admin/operator/ (Operator fleet)
    href: https://github.com/venturecrane/ss-console/tree/main/src/pages/admin/operator
---

## What the admin console is

The admin console is the operator-facing surface served at `admin.smd.services`. The subdomain rewrites to `/admin/*` and every route is gated on `role='admin'` at the middleware layer (`src/middleware.ts`), re-checked in the page where it matters. Today `admin` equals the Captain. The source lives under `src/pages/admin/` and the shell is `src/layouts/AdminLayout.astro`.

## Top navigation

The information architecture is flow-ordered (acquire, serve, deliver, get paid, run, measure), per ADR 0046. The nine nav items are defined in `src/layouts/AdminLayout.astro` (`navItems`):

| Section | Route | What it does |
|---|---|---|
| **Home** | `/admin` | The launchpad. Action-first: "Needs you today" leads, the two revenue shapes (one-time and recurring), then three motion cards (Acquisition / Delivery / Fleet). |
| **Leads** | `/admin/entities` | The lead working view - a unified list of all businesses across their lifecycle. Replaces the separate Lead Inbox and Clients list at the lead stage. |
| **Clients** | `/admin/clients` | The post-acceptance account directory: entities past the acceptance line (engaged, delivered, ongoing). |
| **Services** | `/admin/services` | The global, cross-client delivery list - every in-flight service across all clients, risk-sorted. |
| **Billing** | `/admin/billing` | The bi-modal money surface (ADR 0046). One-time totals derive from invoices; the recurring side shows the Operator subscription state. |
| **Operator** | `/admin/operator` | The Operator fleet - the roster and per-customer drill-ins (detailed below). |
| **Analytics** | `/admin/analytics` | Business-intelligence views, rendered server-side with no client charting library. |
| **Playbook** | `/admin/playbook` | This handbook. The Venture Handbook renders here as the admin-only operations manual. |
| **Settings** | `/admin/settings` | The utility and configuration hub. Home for surfaces demoted from the top nav: lead generators (`generators`) and follow-up cadences (`follow-ups`). |

`assessments` and `engagements` also live under `src/pages/admin/` and are reached from within the flow (a lead's assessment, a client's engagement) rather than from a dedicated top-nav tab.

## The Operator section

`/admin/operator` is itself a multi-page surface, designed per `docs/design/operator/01-admin-portal.md`. It splits into fleet-wide pages and per-customer drill-ins.

### Fleet-wide pages

- **Roster** (`operator/index.astro`) - the default landing. One row per operator, built for scanning a growing fleet: "is anything on fire across all my operators." It composes three console-side projections only (customer identity and posture, the runtime-summary mirror, and heartbeat) and never reads a Machine's runtime D1 directly or joins two customers (per ADR 0009).
- **Alerts** (`operator/alerts.astro`) - fleet alerts (§4.2).
- **Requests** (`operator/requests.astro`) - the change-request inbox (§4.4): client-originated config change requests awaiting Captain action.
- **Provision** (`operator/provision.astro`) - provisioning (§4.5): author and validate a `customer.yaml`, then record provisioning intent.
- **Costs** (`operator/costs/index.astro` and `operator/costs/[customer_slug].astro`) - the SMD-only economics surface, fleet summary and per-customer drill-down. Cost is deliberately not a roster column.
- **Config history** (`operator/config-history/[customer_slug].astro`) - the per-customer `customer.yaml` materialization history: every applied config version with its digest.

### Per-customer drill-in tabs

Each operator drills into `src/pages/admin/operator/[customer]/*`. The tabs:

| Tab | File | What it shows |
|---|---|---|
| **Overview** | `index.astro` | The per-operator drill-in hub. |
| **Authority** | `authority.astro` | The authority panel (§5.9, ADR 0041) - the per-domain client authority switches. |
| **Config** | `config.astro` | The configuration view (§5.2) - the authored `customer.yaml` rendered for reading. |
| **Connectors** | `connectors.astro` | Connectors and credentials (§5.4, ADR 0042 / 0020) - which systems the operator is wired to and their health. |
| **Governance** | `governance.astro` | Trust and governance (§5.3, ADR 0025 / 0035) - the authored entitlement ceilings. See `/admin/playbook/autonomy-governance`. |
| **People** | `people.astro` | People and access (§5.7) - who at the client can reach and configure the operator. |
| **Memory** | `memory.astro` | The relationship surface (§5.6, ADR 0048): "what I've learned about working with you." Composes the authored and learned relationship lanes, read-only and fail-closed; it never grants any capability. See `/admin/playbook/knowledge-memory`. |
| **Lifecycle** | `lifecycle.astro` | Lifecycle (§5.10) - provisioning, reprovision, and decommission state. |
| **Runtime** | `runtime.astro` | Runtime observe (§5.5, ADR 0043 path A) - live runtime detail (audit log, drafts, activity) pulled across the read seam one customer at a time. |

All per-customer runtime detail comes through the read seam in `src/lib/operator/runtime-read.ts`: single customer per call, read-only, audited, fail-closed. The console observes a running operator; it governs what the operator may do through the authored config it writes, not by querying or mutating the Machine live. The architecture behind these surfaces is at `/admin/playbook/operator-platform` and `/admin/playbook/architecture-map`; the integrations they read from are at `/admin/playbook/integrations-tooling`.
