---
title: The Admin Portal is the Mirror of the Client Portal — the Five-Destination Spine
date: 2026-07-14
status: accepted
captain: Scott Durgan
supersedes: docs/adr/0046-admin-ia-service-spine.md
related-adr: docs/adr/0068-portal-ia-offerings-as-destinations.md, docs/adr/0060-retire-automated-lead-gen-machine.md, docs/adr/0004-productized-operator-offering.md, docs/adr/0067-hosted-agent-sku.md
---

# ADR 0077 — The Admin Portal is the Mirror of the Client Portal

**Status:** Accepted (Captain decision, 2026-07-14). Establishes the first-principles model and information
architecture for the admin console, replacing the flow-ordered nav that grew by accretion. Supersedes the navigation
and IA of [ADR 0046](0046-admin-ia-service-spine.md); the polymorphic `service` data spine that ADR shipped survives
as the backing for per-client delivery records (see §5).

## Context

The admin console grew by accretion. Every feature that shipped got a word bolted onto the top nav, and the nav became
a nine-word hodgepodge — `Home · Leads · Clients · Services · Billing · Operator · Analytics · Playbook · Settings` —
with an `ADMIN` badge stamped on the logo that no other surface has. A first-principles review on 2026-07-14 (Captain,
walking every surface) found:

1. **The nav lies about what the venture is.** `Leads`, `Analytics`, and `Settings → Follow-ups` are the corpse of the
   automated lead-generation machine that [ADR 0060](0060-retire-automated-lead-gen-machine.md) retired on 2026-07-01.
   We do not harvest leads. These surfaces present dead machinery as live product lines.
2. **`Services` is trying to be two things at once** — delivery status and the commercial spine — and its own page
   admits it with a "SERVICE SPINE DRIFT / these need manual reconciliation" banner. It reconciles nothing.
3. **`Billing` encodes a false assumption** — every operator worth the same hardcoded amount, summed to a hardcoded MRR —
   because there is no real per-engagement pricing behind it.
4. **The core surfaces are half-built.** `Clients` has no way to add a client and columns that mean nothing.
   `Provision operator` is unexplained. There is no screen that reads as "run the venture today."
5. **There is no parity with the client portal.** In July we rebuilt the client portal on a real principle
   ([ADR 0068](0068-portal-ia-offerings-as-destinations.md)): its nav is _derived_ from what the client owns, rendered
   in a dedicated band with section anchors and an active tile. The admin nav is a hand-maintained list crammed into the
   header row. One side is principled; the other is sediment.

## Decision

**The admin portal is the same object graph as the client portal, viewed from the guide's side.**

A client logs in and sees _their_ engagement, _their_ operator, _their_ billing. The Captain logs in and sees _the same
things across every client_ — plus the operational "is it alive" view a client never needs. That is the parity we are
building. It is not cosmetic. The admin nav is built from the same category model as the client's, aggregated up.

### 1. The five-destination spine

The admin console has exactly one user — the Captain, running the venture. Every destination earns its place by being
a thing he manages. The spine mirrors the client's five (`Home / Engagement / Operator / Agent / Billing`):

| Admin destination | Mirrors client's     | What it is for                                                                                                                                 |
| ----------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home**          | Home                 | The cockpit: what needs him today, across the whole venture.                                                                                   |
| **Clients**       | (their whole portal) | The roster. Each client drills into _their_ delivery + operators + billing — the admin view of what the client sees.                           |
| **Fleet**         | Operator / Agent     | The running products across all clients: health, alerts, provisioning. The real-time operational lens over the Operator and Hosted Agent SKUs. |
| **Billing**       | Billing              | Money across all clients: invoices, recurring, quotes.                                                                                         |
| **Playbook**      | —                    | The venture handbook. Reference. Untouched.                                                                                                    |

Nine words become five. `Settings` stops being a nav word and becomes an account affordance in the header (alongside
sign-out), where the Captain's own configuration lives — not a product line.

### 2. Delivery lives inside a client, never in the abstract

There is no top-level `Services` / `Work` tab. You do not manage "an engagement" in the abstract; you manage _this
client's_ engagement. A consulting engagement, an Operator subscription, and a Hosted Agent subscription are all things
_a specific client bought_, and they are managed from that client's drill-in. The one exception is operational health,
which the Captain scans as a cross-client batch — that is **Fleet**, and it is the only reason a running product appears
above the client level.

### 3. Fleet covers both products

The Operator and the Hosted Agent are both real products as of 2026-07-14 (Captain). **Fleet** is the operational lens
over _both_ — every running instance of either SKU, its health, alerts, and provisioning. "Operator" as a nav word is
retired; a single "Operator" tab cannot represent two product lines any more than the client portal's does.

### 4. The dead lead machine is removed

`Leads`, `Entities`, `Analytics` (the pipeline funnel and follow-up compliance), and `Settings → Follow-ups` are the
retired lead-gen machine ([ADR 0060](0060-retire-automated-lead-gen-machine.md)). They leave the nav in this change and
their code is deleted in a fast-follow once dependency-traced. Analytics is scrapped now and rebuilt small later, when we
know what we actually want to measure — not carried as a funnel over a pipeline that no longer exists.

### 5. What survives from ADR 0046

ADR 0046's **navigation and IA** are superseded. Its **data model** is not: the polymorphic `service` spine
(`migrations/0068_service_spine_ddl.sql`, `src/lib/db/services.ts`) survives as the backing record for what renders
_inside_ a client's drill-in. The client stays the hub; a `service` row still means "this client bought X." What changes
is that this model is expressed as a per-client surface, not as a standalone top-level `Services` tab with a global
service table the Captain never asked to read.

## Disposition of every current surface

| Surface                   | Disposition                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Home                      | **Rework** — keep "Needs you today"; rebuild on real data.                                                      |
| Clients                   | **Rework** — becomes the spine; fix the add-a-client gap; meaningful columns; delivery folds into the drill-in. |
| Services                  | **Dissolve** — delivery status → inside each client; commercial/pricing → Billing; health → Fleet.              |
| Billing                   | **Rework** — replace the hardcoded MRR assumption with real per-engagement pricing.                             |
| Operator                  | **Keep as the seed of Fleet** — extend to cover Hosted Agent; explain provisioning.                             |
| Leads / Entities          | **Scrap** — retired lead machine.                                                                               |
| Analytics                 | **Scrap now, rebuild small later.**                                                                             |
| Settings → Follow-ups     | **Scrap** — lead-cadence machinery.                                                                             |
| Settings → Google connect | **Investigate** — trace consumers before removing.                                                              |
| Playbook                  | **Keep, untouched** — improvements are a separate effort.                                                       |

## Consequences

- **This change (chrome + spine).** Drop the `ADMIN` badge; lift the nav into a dedicated band that mirrors `PortalNav`
  (section anchors, active tile); cut the nav to the five-destination spine; demote Settings to an account affordance.
  Removed words unlink their routes; the routes stay reachable by URL until the scrap PR deletes them.
- **Fast-follow: scrap PR.** Delete the dead lead-machine pages and APIs after a dependency trace. Investigate
  Google-connect.
- **Next real surface: Clients.** Built one surface at a time behind the spine, via a Surface Brief locked with the
  Captain, starting with the add-a-client gap.
- **Later: Fleet unification** (fold Hosted Agent into the operator fleet view) and **Billing** (real pricing).

The rebuild proceeds one surface at a time. This ADR locks the spine; it does not rebuild the surfaces.
