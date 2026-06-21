---
title: The Operator Console
section: system
order: 6
summary: The client-facing Operator product console inside the portal - the authority-domain model that governs every settable surface, the work, governance, team, and configuration surfaces, and how the surfaces stay honest before the runtime bridge is wired
sources:
  - label: src/pages/portal/products/operator/ (console surfaces)
    href: https://github.com/venturecrane/ss-console/tree/main/src/pages/portal/products/operator
  - label: src/pages/api/portal/operator/ and .../products/operator/ (actions)
    href: https://github.com/venturecrane/ss-console/tree/main/src/pages/api/portal/operator
  - label: migration 0038 - portal Clerk subscriptions substrate (roles)
    href: https://github.com/venturecrane/ss-console/blob/main/migrations/0038_portal_clerk_subscriptions_substrate.sql
  - label: docs/design/operator/ (portal-management design)
    href: https://github.com/venturecrane/ss-console/tree/main/docs/design/operator
---

## What the Operator console is

When a client subscribes to the Operator, the portal grows a second, larger surface: the client-facing console for their own managed Operator, served under `/portal/products/operator/`. It is where the people at the client read what the Operator has done, act on the work it routes to them, and - to the extent SMD has handed them the controls - configure how it works. The product itself (what the Operator is, the runtime, the governance model) is documented across `/admin/playbook/operator-platform`, `/admin/playbook/autonomy-governance`, and `/admin/playbook/knowledge-memory`; this page documents the console a client clicks.

The console ships effectively no client JavaScript. Every mutation is an HTML form that posts to an endpoint under `src/pages/api/portal/operator/` or `.../products/operator/`, which validates the actor, the role, and the authority posture server-side, writes, and redirects back with a status param.

## Two things govern every surface

### Who you are: the three roles

Reaching the console at all requires a Clerk session, a local user linked to the client entity, an active Operator subscription on that entity, and at least one granted product role. The roles (migration 0038) are `principal`, `staff`, and `compliance`, and they gate what you see and can do:

- **principal** - the firm's owner of the relationship; the only role that can manage users, raise trust ceilings, and run calibration.
- **staff** - day-to-day operators who act on the Operator's work (review and send drafts, work matters).
- **compliance** - read and oversight: audit, retention, separation-of-duties, without the ability to act on work or change people.

A user with no granted role on an active subscription sees an access-pending state, not the dashboard.

### What is delegated: authority domains

This is the load-bearing idea of the whole console. Every settable surface operates through a named **authority domain**, and each domain has a switch (on `customer_configs.authority`) that SMD controls. The default at launch is **off (managed)**: SMD operates that part of the Operator on the client's behalf. The surface still renders, but in **Read and Request** mode - the client sees the current state read-only and can file a change request rather than change it directly. When SMD flips a domain **on (operable)**, the same surface becomes **Read and Operable** and the appropriate role can mutate it directly.

This dual-mode rendering is provided by `DomainSurface` and `RequestChangeForm`; a request posts to `/api/portal/operator/change-request` and lands in the admin change-request inbox (`/admin/playbook/admin-console`, the Operator fleet cockpit). The domains:

| Domain | Governs | Operable by |
|---|---|---|
| `configuration` | Skills, voice, scope, business hours, escalation contacts | principal |
| `trust` | Governance ceilings (action-class floors plus per-skill ceilings) | principal |
| `connectors` | Credential custody, connector re-consent and secrets | principal |
| `people_access` | Roster, role grants, PTO and coverage | principal |
| `provisioning` | The subscription itself | SMD only, never client-operable |
| `compliance` | Audit retention and evidence export | principal / compliance |
| `runtime` | Whether the work queue is operable or read-only | principal / staff |

The design behind this model is in `docs/design/operator/` and ADR 0041; the governance it expresses is `/admin/playbook/autonomy-governance`.

## Honest before it is wired

Many surfaces read live runtime state - drafts, matters, calendar items, the activity log, the "where is the agent right now" header - through the runtime read seam (ADR 0043, `/admin/playbook/architecture-map`). That seam is built and the surfaces are built, but the per-customer runtime bridge that fills them is staged work; until it is wired for a given customer, those surfaces render honest empty states rather than fabricated content. This is the same no-fabrication discipline the rest of the product holds (`/admin/playbook/security-trust`): an empty queue says "nothing needs a person," never invents one.

## Home

`/portal/products/operator` is the landing. It renders one of several states - not subscribed, provisioning, paused (audit history stays available), access pending (no role), or active. The active dashboard shows an aliveness header (idle / running / sticky-stop / offline plus the last action), a "what needs you" count that renders only when there is actually something routed to a human, a recent-activity list, any escalations, principal-only promotion cards (recommendations such as a trust-ceiling raise), and a grid of cards into the surfaces below, with a sidebar listing the user's roles and quick links.

## Work surfaces

Where people act on what the Operator produces.

- **Work** (`work/`) - the queue of items the Operator has routed to a human. It is entirely entitlement-conditional: it shows only what the authored governance routes to a person, imposes no review stage of its own, and when nothing is routed it says so.
- **Drafts** (`drafts/`, `drafts/[id]`) - the review-and-send queue. A draft carries its sender, recipient, skill, the trust-ceiling decision that produced it, age, and sources. From the detail page a principal or staff member approves and sends it (`drafts/[id]/send`), which validates the reviewer, sends through the connector, emits a `send_approved` audit event, and honours a short configurable undo window. A teach action (`drafts/[id]/teach`) feeds correction back. Compliance can read but not send.
- **Matters** (`matters/`, `matters/[id]`) - the case or account view (for the law vertical, legal matters). The list scopes to "mine" or "all," the detail page shows the Operator's stated facts, the assignment, a material-event timeline, drafts in flight, and audit history. A principal or staff member assigns or unassigns a matter to a team member (`matter-assignment`), which checks the target has a role and emits an audit event.
- **Calendar** (`calendar/`) - the items the Operator has scheduled or proposed, with server-side conflict detection, filling once a calendar connector is active.
- **Activity** (`activity/`) - the full audit log: every action the Operator took, filterable and paginated. For principal and compliance it also carries the retention window and the evidence-export entry point.

## Governance and configuration surfaces

- **Configure** (`configure/`) - the consolidated configuration view across the `configuration` and `trust` domains: skills (per-skill on/off), voice (tone samples and calibration), scope (which folders and systems the Operator can see), business hours, and the governance ceilings (the non-raisable per-vertical action-class floors shown for reference, and the per-skill ceilings of `autonomous`, `draft_for_review`, or `refused`). At launch these render Read-and-Request; when a domain is operable, the principal changes them directly.
- **Settings** (`settings/`) - the principal's operable dashboard for the same controls: trust ceiling per skill (`settings/trust-ceiling`, floor-checked against the vertical floor and recorded to an immutable change-audit, never mutating live config in place), voice samples (`settings/voice-samples`), skill toggles (`settings/skill-toggle`), and connector re-consent (`settings/connector-reconsent`). Sub-pages cover users, notifications, PTO, and advanced (custom configuration).
- **Compliance** (`compliance/`) - principal and compliance only, and itself opt-in: when the compliance view is not enabled it says so plainly; when enabled it shows separation-of-duties, audit history, the retention posture, and evidence-packet generation.
- **Calibration** (`calibration/`) - principal only: the calibration cycle (a set of working sessions over a couple of weeks) that tunes the Operator to the firm, with a session schedule and a start-cycle action.

## Connections, team, and account

- **Connections** (`connections/`) - the systems the Operator is wired to, each with status, health, and credential custody (SMD-managed or customer-held). When the `connectors` domain is operable, a principal re-authorizes OAuth connectors and enters static secrets through a write-only field whose value never appears in a URL, a log, or the database (`connectors/[connector]/secret`); ADR 0042.
- **Team** (`team/`) and **Users** (`settings/users`) - the roster and access. Team is the readable roster (names, roles, last login, who is away, coverage). Users is the principal-only management surface where roles are granted and revoked (`role-action`) and people are invited through Clerk Organizations (`invitations`); a principal cannot revoke their own last principal role, which would lock the firm out. PTO and backup coverage are set on the PTO page (`pto`). All of these run through the `people_access` domain, so when SMD manages the roster the surface is read-and-request and direct mutation returns a not-permitted result.
- **Account** (`account/`) - the subscription status (provisioning-only, SMD-managed, read-only) and the escalation contacts (who to alert on a red flag or a failure, and the acknowledgment window).
- **Onboarding** (`onboarding/`) - the get-started hub: invite the team, connect systems, calibrate, with each step's done/to-do status computed from the same readers the destinations use, so the status is honest by construction.

## Everything is audited

Acting on the Operator emits audit events: `send_approved` on every draft send, an RBAC event on every role grant, revoke, assignment, and PTO change, and an immutable config-change-audit row on every governance change. Governance changes are recorded as intent and applied to the running Operator through the apply path, never by editing the live Machine in place. The data model behind these tables (`product_roles`, `matter_assignments`, `pto`, `escalation_contacts`, `operator_change_requests`, the audit ledgers) is in `/admin/playbook/data-model`, and the trust model the audits exist to prove is in `/admin/playbook/security-trust`.
