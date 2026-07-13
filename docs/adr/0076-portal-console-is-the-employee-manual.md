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

2. **Doors regroup around client questions, not config keys.** The landing's
   map evolves from config-shaped doors to the employee-file structure:
   - **Status** — present and healthy (unchanged).
   - **The job** — the lifecycle the operator works as the organizing spine:
     phases, what it does per phase (skills grouped by phase rather than a
     flat list), and how each duty is set in motion. This is the `workflow`
     facet grown into the Role section's centerpiece, with the Skills
     inventory as its detail view.
   - **Boundaries** — one surface answering "what are the limits": what it
     can see and who it responds to (the `scope` facet) together with what it
     may do on its own (the `entitlements`/`authority` governance facets).
     Composed as one door mounting the per-facet viewers.
   - **Working together** — Persona/Voice, Connections, Team, Memory.
   - **The record** — Activity (compliance folded in, role-scoped).
   - **The arrangement** — Account.

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
