---
title: Retire the Automated Lead-Gen Machine
date: 2026-07-01
status: accepted
captain: Scott Durgan
supersedes: 0058-lead-generation-portfolio-and-sequencing.md, 0059-cold-email-posture-mode-b.md
related-adr: 0001-taxonomy-two-layer-model.md, 0003-lead-gen-pivot-actor-identity.md, 0046-admin-ia-service-spine.md
---

# ADR 0060 — Retire the Automated Lead-Gen Machine

**Status:** Accepted (Captain decision, 2026-07-01).

## Context

The venture built an automated lead-generation "scrape-score-enrich machine": two crawler workers (`job-monitor`, `review-mining`) discovering businesses and inferring operational pain, a 13-module enrichment pipeline, a Claude scoring/qualification layer, machine-drafted outreach, and an admin cockpit to run and tune it.

It never produced a validated result. A live audit (2026-07-01) found ~358 entity rows that were overwhelmingly noise: 198 machine `lost` rows, ~140 machine `signal` rows (mostly junk), only ~10 of 92 job-monitor leads reachable by email, and **zero real outbound conversion signal ever** (the 141 `outreach_events` are synthetic). The structural failure was inference: a "lead" was an algorithm's guess about invisible operational pain, unverified against what the business actually was — the canonical failure being a "hot lead ordering signs" that was a commercial sign-maker advertising its craft. Every time the leads were inspected closely, there was nothing there. The machine generated false confidence on each look and carried ongoing maintenance and third-party API cost.

The venture is going forward, mission-critical, pivoting to a founder-run, law-focused motion anchored on the A&P pilot — where prospect selection is categorical (a real firm of the right type from an authoritative roster) rather than inferred. The machine does not serve that motion.

## Decision

1. **Retire the automated lead-gen machine entirely — keep nothing "just in case."** Remove the two producer workers and the enrichment-workflow worker, the enrichment pipeline (`src/lib/enrichment/`), the producer/scoring source (`src/lead-gen/`, `src/lib/generators/`), the machine DALs, machine-drafted outreach, the generator/pipeline admin surfaces, their config/secrets/CI, the standalone machine tables, and the machine's junk data.

2. **Keep the shared client-record spine.** Per ADR 0046, `entities` is the universal client record (a prospect and a client are the same row at different stages); quotes, engagements, invoices, the portal, billing, and the A&P pilot all key off it. The machine _wrote_ to `entities`/`context`/`contacts`/`outreach_events` but did not own them. These survive untouched. Signal-origin provenance (`signal-attribution`) survives because the commercial quote/engagement/SOW layer reads it.

3. **The lead board becomes a manual worklist.** The `signal` stage is retained as a manual "reaching out" bucket; the admin board is stripped of all scoring/enrichment/triage chrome. Prospects are hand-added and moved along the existing commercial lifecycle. (A product-led redesign of that worklist is deferred to its own issue.)

4. **The inbound `/book` → assessment funnel is out of scope and survives** — it is the front door (ADR 0039), not the outbound machine.

## Consequences

- Supersedes **ADR 0058** (lead-gen portfolio/sequencing) and **ADR 0059** (cold-email Mode B): both assumed the machine and its ready-inventory as live assets. The go-forward posture (founder-run, law-first, prospect selection by authoritative roster rather than inference; paid acquisition sequenced after a validated message) will be recorded in a forward-looking ADR when locked; this ADR records only the retirement.
- **ADR 0001** (two-layer taxonomy): the 5-category _observation_ taxonomy and its boundary test are retired with the machine; the 6-category _delivery_ taxonomy (marketing/doctrine) is unaffected.
- The living strategy doc `docs/marketing/lead-gen-strategy.md` and the six-panel research under `docs/research/lead-gen/` are archived — they describe the retired machine and its strategy.
- Delivered in two PRs: a reversible code/config/CI/tests/docs rip plus a standalone-machine-table drop (PR1), then an isolated destructive migration (junk-row purge + inert machine-column drop on the shared tables) rehearsed on a backup (PR2). The two `cost-*` Operator workers are unaffected.
- Follow-ups filed: de-stale the venture handbook pages that describe the machine, and design the manual prospect worklist.
