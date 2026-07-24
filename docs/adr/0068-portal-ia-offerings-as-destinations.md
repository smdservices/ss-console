# ADR 0068: Portal IA - Offerings as Destinations

Date: 2026-07-07
Status: Accepted
Decision: Captain (structured interview, eleven locked decisions)

## Context

The client portal grew consulting-first: four engagement-function tabs (Proposals, Invoices, Documents, Progress) with product surfaces bolted on through per-page boolean props (`operatorActive`, `hostedAgentActive`). The Hosted Agent live dry-run (ADR 0067) exposed the failure modes: the tab set drifted page to page (the Agent tab vanished on Operator pages because 11 pages hardcoded `operatorActive={true}` and never learned newer products existed), a products-only subscriber saw engagement chrome full of empty states, raw runtime telemetry ("Invariant Violation") rendered on a client surface, and money lived in two unconnected worlds (engagement invoices in the portal, subscription billing only behind a hosted-agent-specific door).

## Decision

The portal's information architecture is rebuilt around what the client owns.

1. Navigation destinations are offerings: Home, Engagement, Operator, Agent, Billing.
2. Fully composed: clients see only what they own. No engagement chrome without engagement data; no product tabs without subscriptions; Billing appears once any invoice or subscription exists.
3. Home is a status dashboard: one card per owned offering with its live status and what needs the client now, plus the recent-activity log.
4. One Billing surface lists engagement invoices and product subscriptions together; subscription management hands off to the Stripe Billing Portal through one generalized door (`/api/portal/billing/manage`).
5. One Engagement destination carries the whole lifecycle: an open proposal renders as a spotlight above the active workspace (both may be true at once; follow-on proposals to active clients are a real state), documents hang off the engagement, completed engagements live in a past-work list.
6. Client surfaces render curated activity language only: the allowlist in `src/lib/portal/operator/activity-language.ts` maps raw audit actions to authored client copy; unmapped actions render nothing; an exhaustiveness test forces a deliberate mapped-or-suppressed decision for every writer-side action. Raw vocabulary stays admin-side (guard test bans `formatAuditAction` from client surfaces).
7. Concierge-first posture is unchanged; the one sanctioned addition is the Operator gaining the same Manage-Billing door the Agent already had.
8. An entity that owns nothing yet gets a warm holding page on Home, never a fake dashboard.

## Mechanism

Nav is computed from data exactly once: `resolvePortalOfferings` (src/lib/portal/offerings.ts) answers "what does this entity own," `buildPortalNav` (src/lib/portal/nav.ts) turns that into destinations, and `PortalShell` (src/layouts/PortalShell.astro) is the single chrome owner every portal page renders through. Pages carry no nav-shaping props, so per-page tab drift is structurally impossible. `PortalTabs.astro` and its boolean props are retired.

Old paths 301 permanently via the `portal-ia-redirects` rule in src/lib/routing/legacy-redirects.ts: `/portal/quotes[/:id]` to the engagement destination and proposal pages, `/portal/invoices[/:id]` to Billing, `/portal/documents` to the engagement documents page. Frozen paths that never move: `/portal/products/*` roots (email deep links), operator OAuth callback routes (registered with external providers), all `/api/*` routes.

## Consequences

- The R25 rationale that PortalTabs' fixed four-tab set encoded (task-frequency analysis of the consulting portal) is superseded for the destination set; the persistent-tabs pattern itself survives in PortalNav.
- Every future offering integrates by extending the offerings resolver and nav builder, not by threading props through pages.
- The activity-language allowlist becomes the editorial gate for what operator/agent activity clients see; new runtime actions fail the exhaustiveness test until someone decides their client language.
- `.design/NAVIGATION.md` portal sections and `docs/handbook/client-portal.md` describe the new IA; the six legacy full-page components (QuoteList, QuoteDetail, Documents, InvoicesList, InvoiceDetail, EngagementProgress) are design-preview-only and are retired with their harnesses in cleanup.
