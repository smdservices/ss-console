---
title: The Operator Console
section: system
order: 6
summary: The client-facing Operator product console inside the portal - a management console for the client's AI employee (Direct / Account / Administer, per ADR 0052), the authority-domain model that governs every settable surface, and how the surfaces stay honest before the runtime bridge is wired
sources:
  - label: src/pages/portal/products/operator/ (console surfaces)
    href: https://github.com/venturecrane/ss-console/tree/main/src/pages/portal/products/operator
  - label: src/pages/api/portal/operator/ and .../products/operator/ (actions)
    href: https://github.com/venturecrane/ss-console/tree/main/src/pages/api/portal/operator
  - label: ADR 0052 - the portal is a management console, not a data surface
    href: https://github.com/venturecrane/ss-console/blob/main/docs/adr/0052-operator-portal-management-console-not-data-surface.md
  - label: migration 0038 - portal Clerk subscriptions substrate (roles)
    href: https://github.com/venturecrane/ss-console/blob/main/migrations/0038_portal_clerk_subscriptions_substrate.sql
  - label: docs/design/operator/ (portal-management design)
    href: https://github.com/venturecrane/ss-console/tree/main/docs/design/operator
---

## What the Operator console is

When a client subscribes to the Operator, the portal grows a second, larger surface: the client-facing console for their own managed Operator, served under `/portal/products/operator/`. What that console is allowed to be was fixed at the doctrine level by ADR 0052 (accepted 2026-06-20): **the portal is the management console for the client's AI employee, and nothing else.** It does exactly three jobs, which map one-to-one onto the only three things SMD is permitted to store:

- **Direct** - the employment terms: what the Operator may do (scope, entitlements, the human-approval posture, voice, hours), which systems it connects to, which skills are active. Backed by per-customer config.
- **Account** - the record of what the Operator did and the governance posture under which it acted; compliance evidence on request. Backed by the audit log of Operator actions.
- **Administer** - the relationship: team and roles, coverage, escalation contacts, subscription. Backed by config plus access management.

Just as important is what the console is **not** (ADR 0052 §2): not a system of record, not a mirror of the connected systems (to see your matters, open your matter system), not a workspace, and not vertical-specific. It holds and displays no client business data. **No portal action touches client work** (§4): there is no draft-approval, send, or any other client-work action anywhere in the console. The posture "external send requires a human" is an entitlement configured under Direct; the approval itself happens where the work lives, in the native system (the Operator leaves a draft in the inbox or tool and the human sends it there) or over the conversational channel. Supervision in the portal is a read-only lens on the audit record. The only buttons in the entire console change the employment: grant a role, flip an entitlement, connect a system, mark coverage.

References to client objects follow the same rule (§6): there is no typed, per-vertical reference field. The one shape is an opaque, connector-namespaced handle, `ref: { connector, id }`, where `id` is the source system's own identifier stored as a string we never parse or branch on.

The product itself (what the Operator is, the runtime, the governance model) is documented across `/admin/playbook/operator-platform`, `/admin/playbook/autonomy-governance`, and `/admin/playbook/knowledge-memory`; this page documents the console a client clicks.

The console ships effectively no client JavaScript. Every mutation is an HTML form that posts to an endpoint under `src/pages/api/portal/operator/` or `.../products/operator/`, which validates the actor, the role, and the authority posture server-side, writes, and redirects back with a status param.

## Two things govern every surface

### Who you are: the three roles

Reaching the console at all requires a Clerk session, a local user linked to the client entity, an active Operator subscription on that entity, and at least one granted product role. The roles (migration 0038; canonical vocabulary in `src/lib/portal/operator-access.ts`) are `principal`, `staff`, and `compliance`, and they gate what you see and can do:

- **principal** - the firm's owner of the relationship; the only role that can manage users and operate the settable configuration surfaces.
- **staff** - day-to-day members; they read the Operator's record, status, and connections without administrative control.
- **compliance** - read and oversight: audit, retention, separation-of-duties, without the ability to change configuration or people.

A user with no granted role on an active subscription sees an access-pending state, not the dashboard.

### What is delegated: authority domains

This is the load-bearing idea of the whole console. Every settable surface operates through a named **authority domain**, and each switchable domain has a switch (on `customer_configs.authority`) that SMD controls. The default at launch is **off (managed)**: SMD operates that part of the Operator on the client's behalf. The surface still renders, but in **Read and Request** mode - the client sees the current state read-only and can file a change request rather than change it directly. When SMD flips a domain **on (operable)**, the same surface becomes **Read and Operable** and the appropriate role can mutate it directly.

This dual-mode rendering is provided by `DomainSurface` and `RequestChangeForm`; a request posts to `/api/portal/operator/change-request` and lands in the admin change-request inbox (`/admin/playbook/admin-console`, the Operator fleet cockpit). The switchable domains (`src/lib/operator/authority.ts`):

| Domain | Governs |
|---|---|
| `configuration` | Persona, skill, scope, and business-hours authoring |
| `trust` | Entitlement ceilings within authored floors (persona exposure and skill initiation, ADR 0056) |
| `connectors` | Connect, reconnect, and credential custody |
| `runtime` | Whatever controls the authored entitlements expose |
| `memory` | Review and dismiss observations and agent-authored skills |
| `people_access` | Users, roles, PTO, voice profiles |
| `compliance` | Evidence packets, retention posture, holds |
| `observability` | The health, connector, and sticky-stop action subset |

Two domains are never a client switch and are SMD-operated in every state: `provisioning` (stand up, pin, resize, pause, decommission) and `cost` (the one domain the client never even reads - our cost basis is ours by nature, not by posture).

The design behind this model is in `docs/design/operator/` and ADR 0041; the governance it expresses is `/admin/playbook/autonomy-governance`.

## Honest before it is wired

Several surfaces read live runtime state - the activity log, calendar items, the "where is the agent right now" header, the home feeds - through the runtime read seam (ADR 0043, `/admin/playbook/architecture-map`). That seam is built and the surfaces are built, but the per-customer runtime bridge that fills them is staged work; until it is wired for a given customer, those surfaces render honest empty states rather than fabricated content. This is the same no-fabrication discipline the rest of the product holds (`/admin/playbook/security-trust`): an empty feed says "nothing needs a person," never invents one.

## Home

`/portal/products/operator` is the landing. It renders one of several states - not subscribed, provisioning, paused (audit history stays available), access pending (no role), or active. The active dashboard shows an aliveness header (idle / running / sticky-stop / offline plus the last action), a "what needs you" count that renders only when something is genuinely routed to a human by the authored entitlements, a recent-activity list, any escalations, principal-only promotion recommendation cards (surfaced when a reviewed skill has sustained a high approval rate), and a grid of cards into the surfaces below, with a sidebar listing the user's roles and quick links.

## Account: the record of what the Operator did

Per ADR 0052 §4, there is no work queue, no drafts queue, no matters view, and no calibration surface in the console; the prior Work, Drafts, Matters, and Calibration pages were removed when the doctrine landed. What remains is the read-only record:

- **Activity** (`activity/`) - the full audit surface: everything the Operator did, filterable and paginated; for principal and compliance it also carries the retention window and the evidence-export entry point. The log is a governance record, not an activity diary (ADR 0052 §5): it stores metadata about the Operator's own actions (actor, action class, connector, entitlement basis, outcome), never bodies, documents, or client content.
- **Calendar** (`calendar/`) - the items the Operator has scheduled or proposed: `ai_scheduled` items already on the customer's external calendar via the connector, and `ai_proposed` items waiting on a reviewer, with server-side conflict detection.

## Direct: configuration surfaces

- **Configure** (`configure/`) - the consolidated configuration view across the `configuration` and `trust` domains: skills (per-skill on/off), governance (the non-raisable per-vertical action-class floors, and the authored persona exposure ceilings when the projection carries them), voice, scope, and business hours. An action class with no configured ceiling is refused by default - fail-closed, never "drafts for review." At launch these render Read and Request; when a domain is operable, the principal changes them directly.
- **Settings** (`settings/`) - the settings hub (PR #1649): the landing surface for Operator settings and the redirect target for the customer-facing OAuth connect flow (`?status=connected` on success, `?status=failed&reason=<short>` on failure, rendered as a banner with actionable copy per failure reason). The hub owns no mutations; it links to Connections, Team access, and Advanced.
- **Users** (`settings/users`) - the principal-only management surface: every member with a non-revoked role, with per-row grant and revoke for each of the three roles, and invitations through Clerk Organizations (`invitations`). A principal cannot revoke their own last principal role, which would lock the firm out.
- **Advanced** (`settings/advanced`) - the typed `customer.yaml` editor: form-based (not a raw YAML textarea) editing of persona, escalation, business-hours, connector, and scope fields, validated through the shared `src/lib/operator/customer-yaml/` validator. Captain-managed fields (connector `token_ref`, sticky-stop safety, persona count, schema and runtime fields) render read-only with a badge, and the server-side validator rejects mutations to them even if the form is bypassed.
- **Compliance** (`compliance/`) - principal and compliance only, and itself opt-in: when the compliance view is not enabled it says so plainly; when enabled it shows the separation-of-duties surface - audit entry, evidence-packet generation entry, and the retention posture. Evidence packets are the single carved exception to the no-content rule (ADR 0052 §7): materialized transiently on explicit human request, delivered, not retained.

## Administer: connections, team, account, onboarding

- **Connections** (`connections/`) - the systems the Operator is wired to, each with status, health, and credential custody (SMD-managed or customer-held). When the `connectors` domain is operable, a principal re-authorizes OAuth connectors and enters static secrets through a write-only field whose value never appears in a URL, a log, or the database (`connectors/[connector]/secret`); ADR 0042. The customer-facing OAuth connect flow itself lives at `oauth/[connector]` (initiate) and `oauth/[connector]/callback`: a signed HMAC state with a 10-minute TTL binds customer, provider, and reviewer, the callback verifies the state against the authenticated portal user, relays the token toward the per-customer Machine, audit-logs the outcome (never token material), and redirects to the settings hub with the status banner.
- **Team** (`team/`) - the readable roster: names, roles, last login, who is away. Read access is on for every role; the operable people controls live in `settings/users`, gated by the same `people_access` domain, so when SMD manages the roster the surface is read-and-request and direct mutation returns a not-permitted result.
- **Account** (`account/`) - the subscription status (the `provisioning` domain: SMD-only, read-only, with no request form because there is no client switch to request) and the escalation contacts (who to alert on a red flag or a failure), which are authored config under the `configuration` domain.
- **Onboarding** (`onboarding/`) - the get-started hub: invite the team, connect systems, calibrate, with each step's done/to-do status computed from the same readers the destination surfaces use, so the status is honest by construction.

## Everything is audited

Acting on the console emits audit events: an RBAC event on every role grant, revoke, and invitation; a customer-yaml audit event on every advanced-editor save (including rejected ones, recorded with their status); and a connector-secret audit on every secret write. Governance changes are recorded as intent and applied to the running Operator through the apply path, never by editing the live Machine in place. The data model behind these tables (`product_roles`, `operator_change_requests`, `customer_configs`, the audit ledgers) is in `/admin/playbook/data-model`, and the trust model the audits exist to prove is in `/admin/playbook/security-trust`.
