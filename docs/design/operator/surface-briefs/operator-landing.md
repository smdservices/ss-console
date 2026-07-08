# Surface Brief — Operator landing (`/portal/products/operator`)

Signed off 2026-07-08. The first brief run under the
[Surface Brief](../../../style/surface-brief.md) process. This is the operator's
front door in the client portal.

## 1. Target user

A client at a firm that runs an Operator (SMD's AI employee on a retainer). Three
roles land here — **principal** (bought it, holds the decisions), **staff** (whose
work it touches), **compliance** (oversight). All arrive already subscribed; this
is a returning, exception-driven visit, not first-run.

## 2. User tasks

- "When I open my operator, I want to know it's healthy or something needs me —
  at a glance, without hunting."
- "I want to understand what this thing actually does — its role, its jobs, what
  it can do."
- "When I need to change a setting, or retrieve my data, I want an obvious way in."

The client hopes never to _have_ to come here; they come when they suspect a
problem, or to understand or adjust the operator.

## 3. Business objective

Make the retainer feel legible and trustworthy every time they look: prove the
operator is alive and in-bounds, make its role and capabilities visible, and be
the calm front door to every configuration and data facet. It kills "is this
thing even working / what does it even do?" support pings.

## 4. Inward paths

The portal "Operator" nav tab; an escalation email; a returning bookmark. Rarely
a first visit (onboarding owns that).

## 5. Core content — the three questions

This console is about the **operator itself**, not the work it produces. Business
work (a draft to review) flows through the real channels — the mailbox, the alert
— **not here**. The surface answers three questions and nothing else:

- **Status** — is it OK? Operator health only: running / paused / offline, and
  operator-level problems surfaced right here (never a business-work queue).
- **Role** — what does it do? Persona · Scope · Skills · Schedule · Workflows.
- **Management** — fix, change, or retrieve. Governance · Voice · Connections ·
  Team · Memory · Activity. Account (the commercial layer) sits last.

Every client-facing facet in the registry has a home above; the folds:
Skills absorbs bundles + agent-authored skills; Schedule absorbs business hours;
Connections absorbs channels + webhook triggers; Team absorbs escalation contacts;
Memory absorbs the relationship lane; Activity absorbs compliance (role-scoped).

## 6. Forward paths

Each facet is a door to its own page (each page is its own future Surface Brief).
Status surfaces a fix action when there's an operator problem (e.g. reconnect,
contact consultant). Account holds subscription, data/memory export, cancellation.

## 7. Verdict

Reshape, not re-skin. The landing is **health-at-a-glance + a complete, legible
map of the operator**, organized as Status / Role / Management, with Account last.
The prior "identity masthead + activity preview + management directory" is
replaced. No work-queue. "Configure" is dissolved — its contents (Scope, Skills,
Governance, Voice) become top-level facets.

## Build notes (honesty)

- Status is wired to the real aliveness signal; when the runtime bridge has no
  data the block says so honestly, never a fabricated "healthy."
- Live connection health is not yet a real probe, so it is not asserted on the
  landing.
- Facet pages that don't exist yet (Persona, Schedule, Workflows, Memory) show in
  the map as present-but-not-yet-built (honest, never "coming soon"); Scope,
  Skills, Governance, Voice deep-link to today's Configure page until each is
  built as its own briefed surface.
