---
title: The Client Portal
section: system
order: 5
summary: The portal.smd.services surface where a consulting client reviews and signs proposals, pays invoices, reads documents, and tracks an engagement - the auth model, every surface, and the integrations behind them
sources:
  - label: src/pages/portal/ (portal surfaces)
    href: https://github.com/venturecrane/ss-console/tree/main/src/pages/portal
  - label: src/middleware.ts (subdomain rewrite + portal auth)
    href: https://github.com/venturecrane/ss-console/blob/main/src/middleware.ts
  - label: src/lib/portal/session.ts (getPortalClient)
    href: https://github.com/venturecrane/ss-console/blob/main/src/lib/portal/session.ts
  - label: migration 0038 - portal Clerk subscriptions substrate
    href: https://github.com/venturecrane/ss-console/blob/main/migrations/0038_portal_clerk_subscriptions_substrate.sql
---

## What the portal is

The client portal is the surface a paying client sees. It is served at `portal.smd.services` and lives in source under `src/pages/portal/`. One Astro app, one Worker; the `portal.` subdomain is a front door, not a separate deployment (the rewrite mechanics live in `/admin/playbook/the-website`). Pages are marked `noindex, nofollow` - this is private client space, never a marketing surface, and it ships effectively no client JavaScript: mutations are HTML forms validated server-side.

The portal serves clients who arrive two ways: through a consulting engagement, or as an Operator subscriber. A client can have one, the other, or both. This page documents the consulting surfaces and the shared auth model. The client-facing Operator product console - a large surface in its own right - is documented separately at `/admin/playbook/operator-console`. How a business travels from lead to portal account is `/admin/playbook/customer-lifecycle`.

## The consulting surfaces

Every surface scopes to the signed-in client's own entity and renders authored data only. The surfaces, from `src/pages/portal/`:

### Home (`index.astro`)

The dashboard. Action-first above the fold (a pending invoice to pay, or the next touchpoint), with a recent-activity timeline below. The timeline is assembled from real events - a proposal sent or signed, an invoice sent or paid, a milestone completed - each in concrete past tense, capped at the most recent few, sorted newest first. It is never synthesized copy: if nothing has happened yet, the surface says so. The consultant name and next-touchpoint label appear only when authored on the engagement.

### Proposals (`quotes/index.astro`, `quotes/[id].astro`)

The conversion surface. The list shows every proposal with its status (sent, accepted, declined, expired) and, for a pending one, the time remaining. The detail page renders the scoped project in sections: the deliverables and the schedule (each rendered only from the authored fields on the quote, omitted entirely when absent), the terms (total price and the payment split), and a review-and-sign block.

Signing runs through SignWell. When an open signature request exists for the quote, the detail page presents the review-and-sign surface pointing at the SignWell document; the client signs there. SignWell calls back to the webhook handler (`src/pages/api/webhooks/signwell.ts`), which records the signed state and stores the signed PDF. The client can then download the executed SOW (`/api/portal/quotes/[id]/sow`, streamed from R2). The client never sees an hourly rate or an hours breakdown in any of this.

### Invoices (`invoices/index.astro`, `invoices/[id].astro`)

View and pay. The list leads with the money that matters (paid to date, balance due, engagement total) and lists each invoice with its type, amount, status, and date. The detail page shows the line items (from the invoice's own line-item rows, never borrowed from the engagement scope) and a Pay button when a Stripe hosted-checkout URL is present on the invoice. Payment happens on Stripe; its webhook marks the invoice paid, and the portal then shows the paid state. When no payment link is attached yet, the surface shows a pending state rather than a dead button.

### Documents (`documents/index.astro`)

The engagement document library. It lists files stored in R2 under the client's own org-and-engagement prefix, plus the signed SOW when one exists. Downloads stream through `/api/portal/documents/[...key]`, which validates that the requested key carries the client's org prefix, rejects path traversal, and confirms the key belongs to one of the client's own engagements or quotes before serving it. PDFs render inline; other types download.

### Engagement (`engagement/index.astro`)

The in-flight project tracker. It shows the active engagement overview (scope summary, start, estimated end) and the milestone list with each milestone's status and dates. It shows status and evidence, not a reassuring progress bar - there is no synthesized percent-complete.

### Tabs

The top tabs (`src/components/portal/PortalTabs.astro`) switch between the consulting set (Proposals, Invoices, Documents, Progress) and the Operator tab. The Operator tab appears only when the client has an active Operator subscription; otherwise the portal is the consulting set alone.

## The auth model

Portal auth is enforced in `src/middleware.ts`. Two paths are accepted, with Clerk primary:

1. **Clerk (primary).** `clerkMiddleware` runs first in the composed pipeline and populates `locals.auth()`. `enforcePortalAuth` lets a request through if a Clerk session is present; if not, it redirects to `/auth/sign-in` (or returns 401 on `/api/portal/*`). The bridge from a Clerk identity to the local user and business runs lazily per route via `getPortalClient()` (`src/lib/portal/session.ts`), which maps the Clerk user to the local `users` row and its `entity_id` and `org_id`. Every query is scoped to that entity, so a client sees only their own data.
2. **Legacy magic-link (fallback).** Before Clerk, the portal used emailed magic links that created a KV/D1 session. `resolveLegacyPortalSession` still accepts those cookies, but only for a session whose `role === 'client'`, and renews them on a sliding window. This path exists solely to keep in-flight invitation emails working through the Clerk transition; treat it as temporary, not a second permanent auth system.

### The role=client gate

The portal is for clients, the admin console is for staff, and the boundary is the `users.role` column (`admin` or `client`). The gate is asymmetric:

- The **admin** console requires `role === 'admin'`; a signed-in client who hits an admin path is redirected to `/portal` (`enforceAdminAuth`).
- The **portal** accepts any Clerk-authenticated user at the middleware layer, then narrows per route. The Operator surfaces narrow hardest: a request needs a Clerk session, a local user linked to an entity, an active `subscriptions` row on `(entity, 'operator')`, and at least one granted role on `(user, entity, 'operator')` in `product_roles` - the vocabulary is `principal | staff | compliance` (migration 0038). Anything less degrades to the appropriate empty state, never to fabricated content.

### Cookie boundaries

Session cookies are per-host (no `Domain` attribute), so a portal cookie lives only on `portal.smd.services` and an admin cookie only on `admin.smd.services`. The subdomain and cookie-isolation mechanics are owned by `/admin/playbook/the-website`.

## The integrations behind the portal

The consulting portal is a read-and-act surface over three external systems, all documented in `/admin/playbook/integrations-tooling`:

- **SignWell** signs proposals. The admin creates the signature request from the quote; the portal presents it; SignWell's webhook records the signed state and the executed PDF.
- **Stripe** collects payment. The admin attaches a hosted-checkout URL to the invoice; the portal links to it; Stripe's webhook marks the invoice paid.
- **R2** stores documents and the signed SOW, served only through the org-scoped, traversal-checked download endpoint.

## What the portal never does

The portal renders authored data only. Timelines, next-touchpoint copy, consultant outreach sentences, deliverables, schedules, and invoice line items come from columns a human authored, or they render nothing. This is the no-fabricated-client-facing-content policy applied at the surface that faces a real customer; the policy, its Pattern A and Pattern B failure modes, and the tests that enforce it are in `/admin/playbook/security-trust`.
