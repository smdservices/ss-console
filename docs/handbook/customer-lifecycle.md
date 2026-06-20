---
title: Customer Lifecycle
section: operations
order: 7
summary: The end-to-end walk of a business through the system - lead to enrichment to assessment to quote to signing to delivery to billing to handoff - and which admin surface and data object owns each step
sources:
  - label: Entity stages & transitions (src/lib/db/entities.ts)
    href: https://github.com/venturecrane/ss-console/blob/main/src/lib/db/entities.ts
  - label: SOW finalize - stage transition to engaged (src/lib/sow/service-finalize.ts)
    href: https://github.com/venturecrane/ss-console/blob/main/src/lib/sow/service-finalize.ts
  - label: Quote sign - SOW to SignWell (src/pages/api/admin/quotes/[id]/sign.ts)
    href: https://github.com/venturecrane/ss-console/blob/main/src/pages/api/admin/quotes/[id]/sign.ts
  - label: Admin home launchpad (src/pages/admin/index.astro)
    href: https://github.com/venturecrane/ss-console/blob/main/src/pages/admin/index.astro
---

## The spine: one entities table, eight stages

Every business SMD touches is a row in the `entities` table. The lifecycle is that row moving through eight stages, defined in `src/lib/db/entities.ts` as `EntityStage`:

`signal -> prospect -> meetings -> proposing -> engaged -> delivered -> ongoing` (with `lost` as the off-ramp).

The same table is split across two admin surfaces by stage. Pre-acceptance records (`signal`, `prospect`, `meetings`, `proposing`) live in Leads at `/admin/entities`. Post-acceptance records (`engaged`, `delivered`, `ongoing`) live in Clients at `/admin/clients`. The surface follows the record's current job; the underlying row never moves. Stage transitions are validated at the application layer (`VALID_TRANSITIONS` in `entities.ts`), so the motion below is enforced, not just conventional.

This page walks the row from first contact to handoff. For the business meaning of the engagement itself - the five phases, the assessment-is-the-product thesis - see [The Consulting Engagement](/admin/playbook/consulting-engagement). For the surfaces themselves, see [The Admin Console](/admin/playbook/admin-console) and [The Client Portal](/admin/playbook/client-portal).

## 1. Lead capture - stage `signal`

A lead enters as a `signal`. Lead-generation pipelines feed this stage automatically; the entity list filters by `source_pipeline` across `review_mining`, `job_monitor`, `new_business`, and `social_listening` (`src/pages/admin/entities/index.astro`). Each signal carries the evidence that produced it (a latest pipeline signal context entry plus a last-activity timestamp), surfaced inline on the Signal tab so the operator can judge it without clicking through.

- **Surface:** `/admin/entities?stage=signal` (the Leads "Signal" tab). Pipelines are managed from `/admin/generators`.
- **Data objects:** `entities` row (stage `signal`), `context` entries (the signal evidence).

A signal that is not worth pursuing is dismissed. One that is gets promoted to `prospect`.

## 2. Enrichment

Before or during outreach, a prospect is enriched - public-data gathering that builds a dossier (`src/lib/enrichment/`): website analysis, reviews, tech stack, news, Google Places, and related sources synthesized into a profile. Enrichment is extractive and evidence-bound; it gathers what is publicly observable, not inferred private conditions about the owner (an enforced policy - see CLAUDE.md fabrication guardrails).

- **Surface:** the entity detail page at `/admin/entities/[id]`.
- **Data objects:** `entities` row plus enrichment `context` entries and the dossier.

> TODO(why): Enrichment runs as a workflow under src/lib/enrichment/ (dispatch.ts, workflow.ts, synthesis.ts), but I did not trace the exact trigger - whether enrichment fires automatically on promotion to prospect, on demand from the detail page, or as a scheduled pipeline step. Looked in src/lib/enrichment/dispatch.ts and the entity list/detail pages; did not read the dispatch trigger wiring.

## 3. Prospect and outreach - stage `prospect`

A promoted lead is a `prospect`. The system drafts outreach, the operator sends it (the list hydrates a latest outreach draft and a first contact-with-email per row to power "Send outreach" and "Log reply"), and replies are logged back against the entity.

- **Surface:** `/admin/entities?stage=prospect` and the entity detail page.
- **Data objects:** `entities` row (stage `prospect`), `contacts`, `context` (outreach drafts and logged replies).

When a prospect agrees to talk, a booking link is sent and the entity moves to `meetings` once the meeting is set.

## 4. Assessment - stage `meetings`

The assessment call is captured as a `meeting`. (The old `/admin/assessments/[id]` route is a permanent 301 into the entity-scoped meeting page; the `assessments` table was generalized into `meetings`, preserving IDs, in migration 0025.) The meeting page captures the outcome and has a "Complete Meeting" form with an explicit next-stage picker.

Completing the assessment meeting is the hinge that produces the proposal: it drafts a quote and moves the entity to `proposing`. The assessment call itself - structure, the objectives-first conversation, the ROI anchors - is owned by [The Consulting Engagement](/admin/playbook/consulting-engagement).

- **Surface:** `/admin/entities/[id]/meetings/[meetingId]`.
- **Data objects:** `meetings` row, `context` (capture/outcome), the drafted `quotes` row.

## 5. Quote and SOW - stage `proposing`

In `proposing`, the entity has an active quote. A quote carries line items, total hours, rate, total price, deposit terms, schedule, and deliverables, and moves through `draft -> sent -> accepted` (with `declined`, `expired`, `superseded` as terminal states) per `QuoteStatus` in `src/lib/db/quotes.ts`. A `sent` quote expires five days after `sent_at`, so the Proposing tab orders rows oldest-sent-first to surface quotes about to lapse.

The quote is the internal pricing object; the SOW is its client-facing rendering. A SOW revision is rendered to a PDF (stored in R2) and goes through `rendered -> sent -> signed` (`SOWRevision` in `src/lib/sow/store.ts`).

- **Surface:** `/admin/entities?stage=proposing`, the entity quote page `/admin/entities/[id]/quotes/[quoteId]`, and Billing's Quotes tab (`/admin/billing`).
- **Data objects:** `quotes`, `sow_revisions`.

## 6. Signing

Signing is the acceptance line. `POST /api/admin/quotes/[id]/sign` retrieves the SOW PDF from R2, snapshots the signer, records a send authorization, and creates a signature request in **SignWell** (the live e-signature provider; `provider: 'signwell'` in the store). When the customer countersigns, the SignWell webhook (`src/pages/api/webhooks/signwell.ts`) finalizes the SOW.

Finalization is what crosses the acceptance line. `src/lib/sow/service-finalize.ts` updates the entity to `stage = 'engaged'`, writes a `stage_change` context entry ("Stage: proposing -> engaged. SOW signed via SignWell."), and provisions the client side. From this point the record lives in Clients, not Leads.

- **Surface:** triggered from the admin quote page; completed by the SignWell webhook.
- **Data objects:** `signature_requests`, `sow_revisions` (status `signed`), `entities` (stage `engaged`), `context` (stage-change record).

> TODO(why): The drafting-template runbook docs/templates/operator/signing-flow.md documents a DocuSign-based flow, while the live consulting-quote code path uses SignWell. These are not the same surface - signing-flow.md governs the Operator service contracts (master agreement + DPA), and the SignWell path governs consulting SOWs - but I did not find a document that states this split explicitly, so the relationship between the two signing pipelines is inferred from code, not confirmed in a source.

## 7. Client and engagement - stage `engaged`

An accepted SOW produces an `engagement` - the delivery container. The engagement holds scope summary, status, estimated and actual hours, milestones, contacts, files, and a parking lot for out-of-scope items surfaced during delivery (`src/pages/admin/engagements/[id].astro`). Delivery runs the implementation, training, and handoff phases of [The Consulting Engagement](/admin/playbook/consulting-engagement). The global view of work-in-motion is the Services surface (`/admin/services`), which the admin home summarizes as the "Delivery" motion card.

- **Surface:** `/admin/clients`, the entity detail page, the engagement detail page `/admin/engagements/[id]`, and `/admin/services`.
- **Data objects:** `engagements`, `engagement_milestones`, the bound `quotes` row, `context`.

## 8. Billing and invoicing

Payment follows the structure set in the SOW (50/50 under 40 hours; 40/30/30 for larger engagements). Invoices are one-time money objects, summarized on the admin home and Billing's "One-time" side as invoiced / paid / outstanding (`oneTimeTotals` in `src/lib/admin/billing-view.ts`). Overdue invoices surface in the home "Needs you today" action queue. The recurring side of Billing is Operator MRR, a separate money shape that does not apply to a consulting engagement.

- **Surface:** `/admin/billing` (Invoices and Recurring tabs).
- **Data objects:** `invoices` (and, for the Operator front door, `services` with `recurring_price`).

## 9. Portal access

The client sees their own engagement through the [Client Portal](/admin/playbook/client-portal) at `portal.smd.services`. Portal identity is owned by Clerk; the local entity is bound on first login and is never just-in-time created - a Clerk user with no binding gets no portal (`src/lib/portal/session.ts`). The portal home is action-centric: the next invoice or next touchpoint pins above the fold, with a timeline of recent activity below. Portal-visible quote statuses are limited to `sent`, `accepted`, `declined`, `expired` (`PORTAL_VISIBLE_STATUSES` in `quotes.ts`) - drafts and superseded quotes never reach the client.

- **Surface:** `portal.smd.services` (`/portal/*`): home, quotes, invoices, engagement, documents.
- **Data objects:** the same `entities` row (as the portal `client`), `quotes`, `invoices`, `engagements`.

## 10. Handoff and what comes after - stages `delivered`, `ongoing`

At final handoff the engagement moves the entity to `delivered`, which the system treats as stabilization (the two-week included support window - see [The Consulting Engagement](/admin/playbook/consulting-engagement)). After stabilization, a delivered engagement can be flagged for ongoing support to move it to `ongoing`, or the relationship converts to an Operator subscription if the fit is right.

- **Surface:** `/admin/clients` (Delivered and Ongoing), the engagement detail page.
- **Data objects:** `entities` (stage `delivered` then `ongoing`), `engagements`.

A prospect that does not convert at any pre-acceptance stage is marked `lost` with a structured reason, which the Lost tab surfaces inline so the operator can scan why deals fall out without clicking through.

> TODO(why): The transition from `delivered` to `ongoing` is described in the entity list empty-state copy as "Flag a delivered engagement for ongoing support," but I did not find the action wiring that performs that flag, nor confirmation that the two-week stabilization window is what gates the delivered->ongoing move. Looked in src/pages/admin/entities/index.astro (empty-state copy) and entities.ts (transitions); did not trace the delivered->ongoing trigger.
