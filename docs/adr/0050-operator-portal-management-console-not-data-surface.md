---
title: The Operator Client Portal Is a Management Console, Not a Data Surface
date: 2026-06-20
status: accepted
captain: Scott Durgan
related-adr: 0026-config-surface-is-a-security-boundary.md, 0037-operator-thesis.md, 0043-operator-runtime-read-path.md, 0030-control-plane-human-principal-surface.md, 0016-honcho-disposition.md
related-doc: docs/security/smd-services-security-overview.md
---

# ADR 0050 — The Operator Client Portal Is a Management Console, Not a Data Surface

**Status:** Accepted (Captain decision, 2026-06-20).

**Source:** A page-by-page review of the Operator client portal (`src/pages/portal/products/operator/*`, 24 pages + 47 components) found law-firm vertical concepts baked into a product sold as vertical-agnostic, several surfaces that mirror or store the client's own business data, and redundant/orphaned pages. The "Matters" surface — a per-engagement detail view rendering a statement of facts, a document/communication timeline, and deadlines (`MatterFactsSection.astro`, `MatterTimelineSection.astro`, `MatterDraftsSection.astro`) — was the trigger: it makes the portal a window into the client's system of record, which the external security overview tells partners we do not build.

This ADR fixes the boundary at the doctrine level so the question is decided once, not re-litigated per page or per vertical.

---

## Context

Two prior commitments constrain what the portal is allowed to be:

1. **The security posture (`docs/security/smd-services-security-overview.md` §2).** "SMD Services does not store, cache, or persist copies of Smokeball matter data... the Operator is a credentialed user acting on the firm's behalf — **analogous to an employee with API access — not a data repository**." §5 adds: client content passes through an LLM only when a firm user explicitly requests an AI task; pure retrieval-and-forward transmits nothing. What SMD stores is limited to **per-customer config, encrypted OAuth tokens, and an audit log of Operator actions** (§2, §4, §8).

2. **The Operator thesis (ADR 0037).** The Operator competes with a hire, not with software; it is a configurable substrate that can be tuned for many verticals; "the only hard limit is connectability — if we can connect, we can work with it." We cannot, and will not, pre-integrate against or test every system a client might connect an Operator to.

The portal as built drifted from both. It carried a typed, law-shaped reference (`matterRef`, `src/lib/portal/operator/audit.ts:222`), a hardcoded personal-injury litigation lifecycle (`MatterPhase = 'pre_suit' | 'discovery' | 'pre_trial'`, `src/lib/portal/operator/matters.ts:36`), a portal-side "Approve & Send" action that holds a draft and transmits it (`ApproveAndSendButton.astro` → `POST /api/portal/operator/drafts/:id/send`), and surfaces that present client case data. Each is a symptom of the same missing boundary.

The mental model the security doc already supplies resolves all of it: **the portal is the management layer for the AI employee.** When you hire a person you do not get a screen that re-displays your case files; you get the means to direct them, account for what they did, and administer the relationship.

## Decision

### 1. The portal is the management console for the client's AI employee — and nothing else

It does exactly three jobs, which map one-to-one onto the only three things SMD is permitted to store:

- **Direct** — the employment terms: who the Operator is and what it may do (scope, entitlements, the human-approval posture, voice, hours), which systems it connects to, which skills are active. _(Backed by: per-customer config.)_
- **Account** — the record of what the Operator did, and the governance posture under which it acted; compliance evidence on request. _(Backed by: the audit log of Operator actions.)_
- **Administer** — the relationship: team and roles, coverage, escalation contacts, subscription, notifications. _(Backed by: config + access management.)_

### 2. What the portal is NOT

- **Not a system of record.** It holds and displays no client business data — no case files, customer records, documents, deal data, or any per-engagement content. ("Matters" as a stored/rendered object is prohibited.)
- **Not a mirror of the connected systems.** We do not re-host or dashboard Clio, Smokeball, a CRM, an EHR, or any connected tool. To see your matters, open your matter system.
- **Not a workspace.** The work happens in the client's own tools, where the Operator acts as a credentialed user. The portal manages the actor; it is never where the acting happens.
- **Not vertical-specific.** No surface, label, enum, or schema field may assume a vertical. Vertical character enters only as per-customer configuration (labels, authored vocabulary), never as hardcoded product structure.

### 3. The boundary test

Every surface, field, and feature is decided by one question:

> Does it show (a) the Operator's configuration, (b) the Operator's own actions/output, or (c) account/relationship admin? → **in.**
> Does it show, store, or mirror the client's business/system data? → **out, full stop.**

### 4. The portal contains no action surface that touches client work

There is **no draft-approval, send, or any other client-work action in the portal.** The governance posture "external send requires a human" is an _entitlement_ configured under **Direct** — the Operator simply does not hold send authority. The approval itself happens where the work lives:

- in the **native system** (the Operator leaves a draft in the inbox/tool; the human reviews and sends it there), or
- over the **conversational channel** for channels with no native draft state (the Operator asks over the same pipe it talks on; the human answers there).

Supervision in the portal is therefore **a read-only lens on the audit record** ("the Operator is drafting-not-sending; here is what it drafted and what is pending a human"), never a button that releases work. The only buttons in the entire portal change the _employment_ (grant a role, flip an entitlement, connect a system, mark coverage). Everything about the Operator's actual work is read-only.

### 5. The audit log is a governance record, not an activity diary

We record **how the Operator acted**, not **what it touched**:

- **Stored at rest (all metadata about our employee's own actions, vertical-agnostic by construction):** timestamp, persona/actor, action class (our finite, authored vocabulary), the connector the action went through, the entitlement basis that permitted it, and the outcome.
- **Not stored:** bodies, facts, documents, readable PII, or any natural-language description of the work — that is client-derived content and lives in the client's system. (The Operator's own at-action summary is content; it may appear in a transient notification but is never persisted.)

The log answers "did my employee act within its bounds?" — entirely our-side metadata. It does not narrate the work. If you want the story, it is in your own tools.

### 6. References to client objects are opaque, connector-namespaced handles we never interpret

There is no typed, per-vertical reference field (no `matterRef`, `dealRef`, `ticketRef`). There is one shape:

```
ref: { connector, id }
```

- `connector` is **ours** — we authored the binding (`mcp:gmail`, `build:acme-crm`, …), so we always know it, for any system.
- `id` is the **source system's own handle**, stored as an opaque string we never parse, validate against a schema, or branch product logic on. We hand it back to the same connector if resolution is wanted.

**Consequence for testing — this is the point.** Per connector we verify exactly one thing: that we can faithfully record an opaque handle and hand it back, and that we can connect (call it, token scoped). We do **not** test that we understand any system's objects. The N-verticals × M-systems matrix never enters the correctness path. This is the audit-log corollary of ADR 0037: _if we can connect, we can reference — without understanding._

**Labels are best-effort and connector-owned.** Rendering `id` as something human is done by asking the connector to resolve it, transiently, with the viewer's scoped credentials, persisting nothing. If the connector cannot resolve it (most custom tools will not), the surface shows the opaque handle plus a click-through to the source system, or "View in «connector»." The log is always correct and complete with zero labels.

**Grouping is preserved without semantics.** "Show the Operator's actions about this object" works on opaque-ref equality (same `id` = same object) for any system, without understanding or storing the object. The one legitimate idea inside the old "Matters" surface — group the Operator's actions by the thing they pertain to — survives as _the governance log grouped by opaque ref, labeled best-effort_, and is now general to every vertical instead of being law-only.

### 7. The single carved exception: compliance evidence packets

An oversight reviewer needs a frozen artifact. That flow — and only that flow — materializes content: **transiently, on explicit human request, delivered, and not retained.** It is the §5 "only when a firm user explicitly requests" case, made an exception by name so it cannot be cited to justify any standing store.

### 8. The admin-operator surface answers to the same doctrine

This doctrine governs **every surface on which the Operator is presented** — the client portal _and_ SMD's internal **admin-operator** area (`src/pages/admin/operator/**`, the surface SMD staff use to operate and support a customer's Operator). The same boundary test applies: it may show operator config, the operator's own actions (governance record), and ops/relationship admin; it may **not** store, mirror, or render the client's business/system data.

The admin side has one legitimate difference and one hard limit:

- **Observe-to-operate is legitimate.** SMD must be able to see whether a customer's Operator is healthy, in-bounds, and correctly configured — fleet health, cost, alerts, provisioning, governance posture, the audit/governance record. That operational observability is the admin area's job and is in-bounds.
- **Observe-to-operate is not store-the-client's-data.** Seeing _that_ the Operator acted, under what authority, with what outcome — metadata — is permitted. Seeing _what the matter was about_ — case facts, documents, business content — is not. The audit record stays metadata-only, references stay opaque handles (§5/§6), and any "what the operator is doing" admin view renders the governance log, never a mirror of the connected system. SMD staff are bound by the same no-data-surface rule as the client; the admin console is not a privileged window into client business data.

The broader admin console (leads, clients, billing, assessments, services, analytics, entities) is a different surface with its own doctrine (ADR 0046) and is out of scope here.

## Amends / relationship to prior ADRs

- **Amends [ADR 0030](0030-control-plane-human-principal-surface.md)** (control plane): the draft-review queue and send/teach are reframed as a **read-only audit lens**, not portal-side work actions — approval happens in the native system or the conversational channel (§4).
- **Amends [ADR 0043](0043-operator-runtime-read-path.md)** (runtime read path): the "matter timeline" drill-in is reframed as the governance log grouped by opaque ref (§2/§6); the read path serves the governance record, not client-data surfaces.

## Consequences

Doctrine set above; the following follow-on work is **Captain-directed** by this ADR and tracked as separate issues per scope discipline (this ADR changes no code):

- **Remove the client-data surfaces.** The "Matters" detail view and any surface that renders client case facts, documents, or timelines is out (violates §2 of this ADR). The useful "actions grouped by object" view is rebuilt per §6 on opaque refs.
- **Replace `matterRef` with the opaque `ref { connector, id }` shape** (`src/lib/portal/operator/audit.ts:222`) and audit `target` / `reason` to confirm they carry no recipient, subject, or other content; constrain them to IDs and bounded entitlement bases. Verify against the live ledger and the overlay emit point (`operator/adapter/audit_log.py`) before codifying — a content value flowing today is a live leak, not just doctrine.
- **De-hardcode `MatterPhase`** (`src/lib/portal/operator/matters.ts:36`): no vertical lifecycle enum ships in product structure; phase vocabulary, if any, is authored config.
- **Remove the portal-side work action.** "Approve & Send" (`ApproveAndSendButton.astro` → `POST /api/portal/operator/drafts/:id/send`) violates §4; approval moves to the native system / conversational channel, and the portal draft view becomes a read-only audit lens.
- **Resolve the redundant and orphaned surfaces** surfaced by the review (Audit vs Activity; Work vs Drafts; Configure/Settings/Account/advanced-editor; Team/Users/PTO/Operators; the two Notifications surfaces) against the three-jobs model — one surface per job, no duplicates.
- **Scrub vertical residue** (persona-named components `TeachMarcus*`, the shipped "Susan-readable zip" string at `compliance/index.astro:270`, law examples in copy and doc comments, the law-only `VERTICAL_FLOORS`).

## Non-goals and open question

- This ADR does not define the connector resolution interface for best-effort labels (§6); that is a follow-on design.
- **Open boundary (audit granularity).** §5 stores action metadata, but some metadata sits near content (e.g. a recipient handle that is itself PII versus the connector's opaque contact ID). The rule: where the natural referent is PII, store the system's opaque ID, or tokenize/hash; store a content hash, never content, where proof-of-action is needed. The precise field-by-field line is to be settled when §6's reference shape is implemented, grounded in what the live ledger actually carries.
