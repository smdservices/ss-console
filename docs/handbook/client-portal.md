---
title: The Client Portal
section: system
order: 5
summary: The portal.smd.services surface where a client reviews and signs proposals, tracks an engagement, and manages their Operator - gated to role=client and authenticated by Clerk
sources:
  - label: src/pages/portal/ (portal surfaces)
    href: https://github.com/venturecrane/ss-console/tree/main/src/pages/portal
  - label: src/middleware.ts (subdomain rewrite + portal auth)
    href: https://github.com/venturecrane/ss-console/blob/main/src/middleware.ts
  - label: migration 0038 - portal Clerk subscriptions substrate
    href: https://github.com/venturecrane/ss-console/blob/main/migrations/0038_portal_clerk_subscriptions_substrate.sql
---

## What the portal is

The client portal is the surface a paying client sees. It is served at `portal.smd.services` and lives in source under `src/pages/portal/`. One Astro app, one Worker; the `portal.` subdomain is a front door, not a separate deployment (the rewrite mechanics live in `/admin/playbook/the-website`). Pages are marked `noindex, nofollow` - this is private client space, never a marketing surface.

The portal serves clients who arrive two ways: through a consulting engagement, or as an Operator subscriber. A client can have one, the other, or both. See `/admin/playbook/customer-lifecycle` for how a business travels from lead to portal account.

## What a client sees and does

Derived from the surfaces in `src/pages/portal/`:

- **Home** (`index.astro`) - the dashboard. Action-first above the fold (a pending invoice to pay, or a next check-in), with a recent-activity timeline below. The timeline is assembled from real events - proposals sent or signed, invoices sent or paid, milestones completed - never synthesized copy.
- **Proposals / quotes** (`quotes/[id].astro`) - review a proposal and sign it. This is the conversion surface: the client reads the scoped project, the price, and the terms, and signs.
- **Invoices** (`invoices/`) - view and pay deposit, milestone, and completion invoices (Stripe-hosted).
- **Documents** (`documents/`) - engagement documents and deliverables.
- **Engagement** (`engagement/`) - the in-flight project: scope, consultant, next touchpoint, progress.
- **Operator product** (`products/operator/`) - the managed-Operator console, shown only when the client has an active Operator subscription. It is a large surface in its own right: matters, drafts, calendar, audit, connections, calibration, compliance, team, notifications, settings, onboarding. These are the client-facing controls over their own Operator; the autonomy and governance model behind them is in `/admin/playbook/autonomy-governance`.

The top tabs (`src/components/portal/PortalTabs.astro`) switch between the consulting set (Proposals, Invoices, Documents, Progress) and the Operator tab, depending on what the client is subscribed to.

## The auth model

Portal auth is enforced in `src/middleware.ts`. Two paths are accepted, with Clerk primary:

1. **Clerk (primary).** `clerkMiddleware` runs first in the composed pipeline and populates `locals.auth()`. `enforcePortalAuth` lets a request through if a Clerk session is present; if not, it redirects to `/auth/sign-in` (or returns 401 on `/api/portal/*`). The bridge from a Clerk identity to the local user and business runs lazily per route via `getPortalClient()`.
2. **Legacy magic-link (fallback).** Before Clerk, the portal used emailed magic links that created a KV/D1 session (set by `/auth/verify`). `resolveLegacyPortalSession` still accepts those cookies, but only for a session whose `role === 'client'`, and renews them on a sliding window. This path exists solely to keep in-flight invitation emails working through the Clerk transition; new onboarding will move to Clerk invitations (per the middleware's own header comment). Treat the legacy path as temporary, not a second permanent auth system.

### The role=client gate

The portal is for clients, the admin console is for staff, and the boundary is the `users.role` column (`admin` or `client`). The gate is asymmetric:

- The **admin** console requires `role === 'admin'`; a signed-in client who hits an admin path is redirected to `/portal` (`enforceAdminAuth`).
- The **portal** accepts any Clerk-authenticated user at the middleware layer, then narrows per route. The Operator surfaces narrow hardest: a request needs a Clerk session, a local user linked to an entity, an active `subscriptions` row on `(entity, 'operator')`, and at least one granted role on `(user, entity, 'operator')` in `product_roles` - vocabulary `principal | staff | compliance` (per migration 0038 and the access-model comment in `products/operator/index.astro`). Anything less degrades to the appropriate empty state, never to fabricated content (per `docs/style/empty-state-pattern.md`).

### Cookie boundaries

Session cookies are per-host (no `Domain` attribute), so a portal cookie lives only on `portal.smd.services` and an admin cookie only on `admin.smd.services`. The subdomain and cookie-isolation mechanics are owned by `/admin/playbook/the-website`.

## What the portal never does

The portal renders authored data only. Timelines, next-touchpoint copy, consultant outreach sentences, and invoice line items come from database columns a human authored, or they render nothing. This is the no-fabricated-client-facing-content policy applied at the surface that faces a real customer; the policy, its Pattern A/B failure modes, and the tests that enforce it are in `/admin/playbook/security-trust`.
