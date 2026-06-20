---
title: Roadmap & Current Phase
section: business
order: 6
summary: Where the venture is right now, what the priorities are, and what stands between here and profitability.
sources:
  - label: CLAUDE.md (Current Phase, Priorities)
    href: https://github.com/venturecrane/ss-console/blob/main/CLAUDE.md
  - label: Decision Stack
    href: https://github.com/venturecrane/ss-console/blob/main/docs/adr/decision-stack.md
---

This page reflects the venture's state as recorded in `CLAUDE.md` and the decision stack.
It is the page most likely to drift; treat the dates and statuses as a snapshot and update
it as the venture moves.

> TODO(why): This roadmap is reconstructed from CLAUDE.md's "Current Phase" section and
> session context, not from a single authored roadmap artifact. A live roadmap surface (the
> kind the enterprise factory maintains) should become the source this page mirrors.

## Current phase: Pre-Launch

The objective is to **launch the venture and reach profitability.** Nothing has been sold
to an external client yet. The platform that delivers the work (the admin console, the
Operator) is substantially built and is dogfooded on the venture's own internal Operator
seat. The gating work is go-to-market and first paid engagements, not platform capability.

## Priority tracks

These are the four pre-launch priority tracks from `CLAUDE.md`. Status is summarized; the
canonical checklist lives in CLAUDE.md.

| Track | Focus | State |
|---|---|---|
| **1 - Collateral to start selling** | Assessment script, proposal/SOW template, pricing framework, one-pager | Drafts exist in `docs/collateral/`; most await Captain sign-off |
| **2 - Go-to-market** | Vertical selection, outreach strategy, landing page, pipeline math, phased geography | Marketing site rebuilt Operator-forward and live; outreach and pipeline execution ongoing. The earlier "Outside View" lead-magnet was retired (ADR 0002 superseded) |
| **3 - Delivery readiness** | Tool/solution matrix, SOP templates, onboarding + quality checklists | Largely pending |
| **4 - Business model refinement** | Payment terms, paid assessment, recurring model, client data system | Payment terms locked; the recurring model is the productized Operator SKU (ADR 0004, superseding the old undefined retainer); paid assessment and client-data work in progress |

## What is built vs what is next

- **Built and running:** the three-subdomain web app (marketing, admin, portal) on
  Cloudflare Workers; the admin console for leads, clients, services, billing, and Operator
  management; the Operator platform on Fly + Hermes, dogfooded on the internal seat. See
  [Architecture Map](/admin/playbook/architecture-map) and
  [Operator Platform Architecture](/admin/playbook/operator-platform).
- **The leading edge:** first pilot engagements (law-firm vertical) are being pursued; the
  bottleneck to conversion is a demonstration on the prospect's own data, not the argument.
- **Next:** finish and sign off the sales collateral, execute outreach through the Phoenix
  referral network (Vistage, EO Arizona, fractional CFOs, BNI/chamber, accountants,
  commercial insurance, SBA/SCORE), and close the first paid engagements.

> TODO(why): Specific pilot statuses and named prospects evolve week to week and are kept
> in session handoffs/memory rather than this page, to avoid committing a stale or sensitive
> snapshot into the repo.

## Constraints

- Phoenix metro, in-person default for the first engagements; remote-capable after the model
  is proven.
- No dollar amounts published externally; pricing is internal (see
  [Pricing & Economics](/admin/playbook/pricing-economics)).
- The venture is run by a single Captain directing a fleet of agents; throughput scales with
  the fleet, judgment does not delegate (see [Operating Model & the Fleet](/admin/playbook/operating-model)).

## Related

- [Business Model](/admin/playbook/business-model) - the offerings these priorities serve
- [The Decision Stack](/admin/playbook/decision-stack) - the locked decisions behind the strategy
