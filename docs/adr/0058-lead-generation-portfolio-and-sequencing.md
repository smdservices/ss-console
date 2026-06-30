---
title: Lead-Generation Portfolio and Sequencing
date: 2026-06-30
status: accepted
captain: Scott Durgan
related-adr: 0001-taxonomy-two-layer-model.md, 0002-outside-view-unified-diagnostic.md, 0003-lead-gen-pivot-actor-identity.md, 0004-productized-operator-offering.md, 0039-operator-led-assessment-funnel.md
related-doc: docs/marketing/lead-gen-strategy.md
---

# ADR 0058 — Lead-Generation Portfolio and Sequencing

**Status:** Accepted (Captain decision, 2026-06-30).

## Context

SMD is pre-launch and under pressure to find prospects and drive them to an assessment. The lead-gen capability had no written north star: the origin strategy doc was deleted, and authority was scattered across ADRs 0001/0003 and CLAUDE.md. A six-panel external research effort plus internal grounding (recorded in `docs/research/lead-gen/`) and a live audit of the existing engine produced the findings this decision rests on.

Two facts from that audit shape the decision. First, the signal engine is built and runs daily (357 entities, a 13-module enrichment layer, an admin CRM, ~100 enriched-and-drafted prospects), but it has **never been pointed at the market**: no real outbound conversion test has ever run. Second, two authenticated sending domains (`getsmdservices.com`, `smdurganservices.com`) exist on Google Workspace with SPF/DKIM/DMARC complete, but were never warmed and never connected to a sending tool.

## Decision

1. **Single objective.** Lead generation optimizes for one thing: **find good-fit prospects and drive them to an assessment, and produce as many good ones as we can.** This is an acquisition mandate, nothing else.

2. **Downstream capacity is out of scope as a planning constraint.** How the assessment is run (operator-led, human-led, or a blend) and how much of it we can absorb are deliberately **not** inputs to this strategy. The assessment is the destination (ADR 0039); filling it with good-fit prospects is this strategy's whole job. A prospect surplus is a future success condition, not a limit we design around.

3. **"Good" means fit, defined per offer.** The two-geography rule governs: Arizona-local consulting versus the twelve national Operator packs are reached differently, so every channel and every lead is split on that line first. Qualification is by fit, not a revenue-band gate (retired, ADR 0003).

4. **The portfolio is sequenced by speed-to-good-prospects and readiness, never by capacity.** Fast (founder network, partner-as-customer placements, the ready-inventory cold-email test); medium (acquisition measurement and deliverability, organic foundations, signal-engine completion); slow and compounding (the Operational Drag Index, organic authority, community, paid).

5. **Warm-first for proof; measurement-first to learn; paid is gated on message, not capacity.** Warm channels produce the highest-fit prospects and the first case studies. Acquisition measurement is wired before or alongside any channel so we learn which channels produce good prospects. Paid acquisition is a scale-and-optimize lever that needs a validated converting message first; it is on the radar, not the first dollar.

6. **Do not re-propose** (settled): Outside View / public-footprint diagnostic scraping (ADR 0002 superseded), the prior revenue-band gate (ADR 0003), and Phoenix-only geography.

## Consequences

- The living detail, the channel playbooks, the activation runbook, and the measurement spec live in `docs/marketing/lead-gen-strategy.md`, maintained under the handbook contract (update in the PR that changes what it says).
- The assessment's form and throughput (ADR 0039) are the destination this strategy hands off to, and are explicitly outside this decision.
- The first concrete execution step is the ready-inventory activation runbook, whose only external gate is confirming Workspace mailbox access.
