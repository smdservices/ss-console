# Surface Brief: Clients (`/admin/clients` + `/admin/clients/[id]`)

Status: **LOCKED** 2026-07-15 (Captain sign-off). Governs the Part 2 build of
ADR 0077 (admin portal mirrors the client portal). Follows the Core Model
surface-brief process in `docs/style/surface-brief.md`.

## The build-vs-buy decision behind this brief

Before locking, we asked whether a flat Clients surface means "building our own
CRM," and whether an off-the-shelf CRM (HubSpot / Pipedrive / Attio / Folk)
would be the intentional choice. It would not, for one structural reason: SMD
already runs a single, non-optional system of record. The `entities` row is
what a booking writes to, what `quotes.entity_id` points at, what a signed SOW
and every invoice hang off, what the client portal authenticates a person into,
and what Operator provisioning keys on. A prospect who signs is not "converted";
the same row walks the whole lifecycle from first contact to a portal login to a
running Operator machine.

An external CRM cannot be that record (it cannot own our portal, our SOW
generation, our billing, or Operator). So a CRM would sit _beside_ the record,
not replace it, forcing re-keying at exactly the signing moment and two truths
kept in sync forever. For a business whose product _is_ a system of record, a
second system of record is the expensive mistake. Decision: keep one record;
put the thinnest honest surface over it. Revisit only if SMD runs real outbound
at volume, adds a second person on the pipeline, or wants email sequencing as a
sales motion, at which point a funnel CRM feeds _into_ the record.

## 1. Target user

The Captain, running SMD. One user. He has landed a conversation (networking,
referral) or someone booked an assessment, and he needs to see and move the
people he is working with, from first contact through signed client through
delivery.

## 2. User tasks

- "I met someone worth pursuing. Add them so I can work them toward an assessment."
- "Someone booked an assessment. I need to see them, run the call, send a quote, get them signed."
- "Show me everyone I am working with and where each stands, so I know who needs me next."
- "Open one and give me their whole story (contact, what we discussed, quotes/SOW, what they owe) so I can act without digging."

## 3. Business objective

This is the venture's book of business, cradle to grave. It must keep any booked
assessment or live client from falling through a crack, carry the
assessment to quote to SOW to signed conversion (the money path), and show what
is owed. It replaces the Leads funnel with an honest record list.

## 4. Inward paths

Nav "Clients." Booking-confirmation emails deep-link to a record. Assessment and
engagement pages hand off here. Those links point at `/admin/entities/[id]`
today; Part 2 leaves a 301 stub so in-flight emails still resolve, and repoints
the handful of user-facing breadcrumbs.

## 5. Core content

- **List:** one flat list of every business we are working with, newest first.
  Each row: name, vertical, stage badge, outstanding balance, Operator badge if
  provisioned. No funnel tabs, no buckets.
- **Record:** identity (name plus stage, honestly labeled), contact(s), the
  conversation/timeline, assessment/meeting (with live notes), quotes/SOW,
  invoices and what is owed, Operator card if present.

## 6. Forward paths

- **List:** add a client; open a record.
- **Record:** add/edit contact; log a note; schedule/run the assessment; draft a
  quote from the meeting; send for signature (existing SignWell flow); set
  Operator price. The record becomes a client automatically when a quote is
  accepted; that is the invariant, not a button.

## 7. Verdict and locked decisions

- **A. Flat list with stage badges, not two buckets.** LOCKED. A
  stage-partitioned two-section list is the funnel wearing a Clients costume.
  Badge labels map the canonical stages to honest words (`clientStageBadge` in
  `src/lib/admin/client-hub.ts`): Prospect, Assessment (`meetings`), Proposing,
  Client (`engaged`), Delivered, Ongoing, with Lost behind an optional "show
  lost" filter and `signal` never shown. Placement is a total function over all
  eight stages, so no record silently disappears.
- **B. One record cockpit.** LOCKED. Make `clients/[id]` stage-aware (it must
  stop labeling a pre-signature record "Client" — that is mislabeling under the
  no-fabricated-content rule) and retire `entities/[id]` to a 301 stub. Inventory
  field-by-field what `entities/[id]` renders that `clients/[id]` lacks before
  cutting over.
- **C. Add-a-client is minimal.** LOCKED. Name plus vertical plus optional
  contact, created as a `prospect`. Verified against a real created row, not
  types. No pipeline-intake form.
- **D. Meetings/quotes subtree stays in place.** LOCKED (floor scope). Do not
  re-home `entities/[id]/meetings/*` or `entities/[id]/quotes/*`; the 301 stub on
  the parent absorbs the path, and re-homing buys no user-visible gain for real
  churn. Repoint only the few user-facing breadcrumb hrefs inside the surviving
  pages.

## Stage enum

Keep the eight values (`signal|prospect|meetings|proposing|engaged|delivered|ongoing|lost`);
do not migrate. Retire only the dead `signal` cold-origin (new records start
`prospect`). Preserve the two invariants in `transitionStage`
(`src/lib/db/entities.ts`): `proposing to engaged` requires an accepted quote;
`delivered to ongoing` requires a paid completion invoice.

## Out of scope

Follow-ups subsystem (untouched); the deeper "is the whole booking/SOW apparatus
over-built for pre-launch" question (parked); Settings rework.

## Build sequence

1. **New front (no deletion):** Clients list flat + stage badges + add-client +
   `clients/[id]` made stage-aware. Highest value, lowest risk, ships first.
2. **Cut over + tear down:** 301 stubs at `/admin/entities` and
   `/admin/entities/[id]`; repoint user-facing breadcrumbs; delete the Leads list
   and pure-theater apparatus (dismiss/merge/reply-log/EntityListRow/list-sort),
   each deletion carrying its own test surgery.

Nothing ships against an unsigned brief. This brief is signed.
