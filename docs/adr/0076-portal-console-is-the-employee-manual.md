---
title: The operator console is the employee manual, rendered — client-question IA over the facet system
date: 2026-07-13
status: accepted
captain: Scott Durgan
related: 0037-operator-thesis.md, 0055-operator-is-an-employee.md, 0068-portal-ia-offerings-as-destinations.md, 0069-operator-legibility-progressive-configurability.md
---

# ADR 0076 — The operator console is the employee manual, rendered

## Context

The facet-by-facet build under ADR 0069 (landing, then Skills) surfaced a
structural question during the Scope brief: the Captain expected the
pilot-smokeball operator's litigation lifecycle to appear under "Scope,"
because to a client, _the shape of the job_ is the natural meaning of that
word. The `scope:` config block, however, is narrowly the visibility
boundaries (folders, roster, blocks) — and the lifecycle has no structured
home at all yet (the registry's `workflow` facet, plane `no_schema`).

The mismatch generalizes. The landing's Role section presents five parallel
doors (Persona · Scope · Skills · Schedule · Workflows) because those are
five `customer.yaml` blocks — an engineer's decomposition. The client's
questions are fewer and bigger:

1. **Is it OK?** (present, healthy, needs me?)
2. **What is its job?** (the work it participates in, stage by stage; what it
   does at each stage; when it acts)
3. **What are its limits?** (what it can see, who it talks to, what it may do
   on its own vs. draft vs. never)
4. **How do we work together?** (how it sounds, what it's connected to, who's
   on the team, what it remembers, what it did, what I pay)

ADR 0055 already names the governing concept: the operator acts "governed by
its **employee manual** (the per-customer authored config — `customer.yaml`,
skills, entitlements)." The manual exists. What was missing is the
recognition that **the client portal's operator console is that manual,
rendered legibly** — not a dashboard _about_ the operator, but the readable
edition of the same authored document that governs it.

## Decision

1. **The console is the employee manual, rendered.** Every operator surface
   in the client portal presents a chapter of the authored per-customer
   config, translated into client language. Nothing on the console may claim
   more than the manual authors (the ADR 0069 honesty rules are unchanged);
   "eventually configurable" means the client amending their operator's
   manual through governed paths (ADR 0069 Tier 0 write-back when real,
   Request-a-change until then).

2. **Doors regroup around client questions, not config keys.**
   _(Amended 2026-07-14, second revision: the table of contents below is
   superseded by the console blueprint
   [docs/design/operator/05-console-blueprint.md](../design/operator/05-console-blueprint.md),
   which is now the governing design document for the console. The blueprint
   reframes the console's job as rendering the current authored configuration,
   comprehensively, in client language — driven by falsifiable visit-occasion
   tests rather than a governing metaphor; the employee-manual frame survives
   as the honesty rule (every sentence traces to the authored config). An
   intermediate structure document, 04-console-structure.md, held this pointer
   earlier the same day and is preserved as history; the blueprint dispositions
   its locked resolutions in its §1. The doctrine of this decision — client
   questions over config keys — is unchanged.)_

   The console's six chapters, each corresponding to a standard employment
   document (see the structure doc §2b for the full mapping and sources):
   - **Status** — present and healthy (unchanged).
   - **The work** — the rendered routine grid, grouped by lifecycle section:
     every routine with what it does, where, when it starts, and how much it
     does alone (its Delegation-of-Authority tier, in plain sentences). This
     absorbs Skills, Schedule, Governance, and Workflows _as pages_; the
     Skills inventory survives as the grid's detail view and the gridless
     fallback. The earlier "Boundaries" composition is superseded: autonomy
     lives per-routine on the grid, not on a separate limits page.
   - **Access** — the systems and accounts it holds keys to, per system
     (mailbox identity + folder visibility, connected systems, web search).
   - **People** — who it responds to (inbound roster), who it writes to for
     the firm (outbound roster classes), escalation, team, and blocks.
   - **The record** — Activity (compliance folded in, role-scoped).
   - **The arrangement** — Account.

   A further Captain directive is structural: **configurability is the
   substrate** — every rendered fact declares its change-path from day one
   (request-a-change today, governed self-service write-back when a domain's
   authority flips), so client configurability is a permission change, never
   a rebuild. See the structure doc §5b.

3. **The facet system underneath is unchanged.** The facet registry remains
   the closed truth; Lock 4 (one shared viewer per facet, mounted by both
   portals) holds. This ADR changes the _composition layer only_ — which
   doors exist and what each page mounts — never the one-viewer-per-facet
   discipline. A composed surface (Boundaries) mounts multiple facet viewers;
   it does not merge facets.

4. **The workflow schema is designed from the field, not the whiteboard.**
   The lifecycle's structured home is the `workflow` facet, and its generic,
   vertical-neutral schema (phases → duties → how each is set in motion) is
   designed **from the Ashton & Price routine-settings matrix** (the
   correspondence file-07 reconciliation target: the firm's lifecycle
   duties, each with a per-routine autonomy dial) — the first real instance,
   discovered by a paying-vertical engagement. The pack supplies the
   vocabulary (law: matter phases; home services: job stages); the schema
   carries none of it. ADR 0069's open question on the schema's home
   (`vertical.yaml` vs `customer.yaml` vs both) is decided during that
   design exercise, not here.

5. **Sequencing.** (a) Boundaries chapters first, they are projected and real
   today: the Scope viewer, then the Governance viewer, then the composed
   Boundaries surface. (b) The workflow schema design runs alongside the A&P
   lifecycle rework rather than after it, so the pilot-smokeball instance is
   authored from the post-rework truth. (c) The job page (lifecycle spine,
   skills by phase) builds once the schema is agreed and the first instance
   is authored. (d) Voice and the remaining chapters continue one at a time
   under the Surface Brief loop; the door regroup itself ships as its own
   small slice (it is a data-file change).

## Consequences

- The landing's door copy stops promising what a facet cannot deliver: the
  Scope door reads as boundaries ("what it can see, who it responds to, and
  what's off limits"); "the shape of its job" language belongs to the job
  door.
- Skills as built survives unchanged; it gains phase grouping when the
  workflow schema exists.
- The Scope viewer built under its signed-off brief is the first Boundaries
  chapter; no rework when the composed surface lands.
- The employee-manual frame gives the console a falsifiable test any new
  surface must pass: _which chapter of the manual is this, and does the
  authored config back every sentence?_
- Marketing language is unaffected (this is a product-surface doctrine, not
  copy); the ADR 0037 competes-with-a-hire frame gains a concrete artifact —
  the client can literally read their employee's manual.
