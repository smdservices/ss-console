---
title: 'Vertical Spec: [VERTICAL] (Operator pack) — TEMPLATE'
date: '[YYYY-MM-DD]'
status: draft
captain: Scott Durgan
related-adr: 0022-vertical-pack-architecture.md, 0037-operator-thesis.md
---

# Vertical Spec: [VERTICAL] — TEMPLATE

Copy to `docs/specs/verticals/<slug>.md` and fill in. Worked reference: `law-firm.md`. This is the brief that drives the pack's manifest, marketing surface, N=0 proof, and delivery SOP. Per [ADR 0037](../../adr/0037-operator-thesis.md), the Operator competes with a **hire**, not software; the incumbent system of record is a **connection target, not a competitor**.

## The role we digitize

The [coordinator / intake lead / dispatcher / account manager], the person who [describe the connective seat]. Often a hard seat to keep staffed, where the connective work outgrows whoever is closest to it.

## The residual connective layer

The business already runs [system of record], email, calendar, [other systems]. Each does a slice. The human is what holds them together: [name the cross-system handoffs]. More disconnected systems means more of this work. That residual layer is what the Operator takes.

## The connective tasks (the wedge surface)

Substance-free coordination only. List the 5-7 tasks: [intake ack, scheduling, chase, status, logging, nudge, ...].

## System stack and connector plan

| Capability       | Adapter   | Backend                 | Notes                                            |
| ---------------- | --------- | ----------------------- | ------------------------------------------------ |
| [SystemOfRecord] | [adapter] | `[mcp:... / build:...]` | [MCP available? BUILD adapter = first hand-off.] |
| Email            | ...       | ...                     |                                                  |

State plainly whether the pilot needs a BUILD adapter (hard path) or rides an existing MCP (low friction).

## Compliance floor (authored, not assumed)

Per [ADR 0037](../../adr/0037-operator-thesis.md) Tenet 3, no imposed defaults; floors are fail-closed until raised. [Name the vertical's floors: send floor, privacy/regulatory boundary, routing constraints.]

## Labor-market dislocation (the demand hook)

Forced-to-cut or can't-fill. [Name the specific pressure: a regulatory/economic forcing function, or a staffing shortage.] Keep dated/political hooks in outreach and channel timing, not on the evergreen landing page.

## Competitive read (system-features excluded)

- **Connection targets (zero threat):** [incumbent systems adding AI features].
- **Employee-replacers (the real column):** [funded products selling the digitized employee, if any]. Is the connective-coordinator seat open?

## The wedge

> [One paragraph: the seat, what it connects to, the connective-only scope, and why it wins on reachability x WTP.]

## Base vs. add-on

- **`[vertical]` (base):** [the lead, lowest-friction entry].
- **`[vertical]/[addon]` (add-on):** [specialized connective skin, additive].

## Channel

[Where the buyer is reachable: clusters/aggregators, ecosystems, associations, media, warm intros.]
