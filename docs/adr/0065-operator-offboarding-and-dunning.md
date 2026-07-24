---
title: Operator Offboarding and Dunning — Notice, Ladder, Return and Destruction
date: 2026-07-04
status: accepted
captain: Scott Durgan
related-adr: 0004-productized-operator-offering.md, 0037-operator-thesis.md, 0057-operator-claude-connector-access-model.md, 0062-operator-cost-plane.md, 0063-operator-launch-pricing.md
related-issues: 1684, 1679
---

# ADR 0065 — Operator Offboarding and Dunning

**Status:** Accepted (Captain decision, 2026-07-04, issue [#1684](https://github.com/venturecrane/ss-console/issues/1684)). Closes ADR 0004's "notice period, escalation" follow-ons and supplies the ladder the billing engine (#1679) deliberately alerts-and-waits for.

## Context

The exit path was unwritten while every other lifecycle stage was built: decommission tooling exists (pull-before-destroy exports of the audit record and operational memory, then Machine destruction), access offboarding exists (ADR 0057 grant revocation), pause machinery exists, and the billing engine's payment-failure posture is explicitly "alert team@smd.services and take no automatic action." What was missing is the commercial doctrine connecting them — and it matters doubly because the operational memory IS the switching cost (ADR 0037 Tenet 4): "what happens to months of memory and audit history if we leave?" arrives in the first contract review.

## Decision

### 1. Voluntary cancellation

**30 days written notice, effective at the end of the then-current billing cycle.** The retainer is otherwise month to month (ADR 0063 sets the launch price; this sets the exit). Pause is available as an alternative to cancellation: billing collection is paused (cycle invoices void — a paused seat is never charged), audit access remains, and a pause running past 60 days triggers a conversation about whether this is actually an offboarding.

### 2. Dunning ladder (payment failure)

Every step is a **human action by Captain — never a webhook side effect**. The automated system's only role is the alert (#1679).

| Day past due | Action                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0            | Automated alert to team@smd.services; personal outreach the same business day                                                                       |
| 14           | **Pause the seat**: Stripe collection paused, subscription status `paused`, portal shows paused with audit access retained, Operator work suspended |
| 30           | **Treat as cancellation notice**: begin the offboarding sequence below                                                                              |

`past_due` in Stripe never reduces access by itself; the webhook mirror keeps the seat active and the human ladder governs (the code already encodes this posture).

### 3. Offboarding sequence (any termination: voluntary, dunning, or ours)

1. **Final export** — the customer receives their audit record and the Operator's operational memory in exportable form (the runtime-read `audit_export` / `memory_export` kinds the decommission pipeline already serves), delivered within **14 days** of the termination effective date.
2. **Access revocation** — all MCP grants revoked (ADR 0057 kill switch), connector credentials revoked or returned per custody posture (ADR 0042), managed mailbox closed.
3. **Destruction** — the dedicated Machine, volume, and per-customer stores destroyed via the decommission tooling; residual control-plane data deleted except records required for legal, tax, or accounting purposes.
4. **Attestation** — destruction confirmed in writing on request.

**The complete return-and-destruction window is 30 days from termination.** That number fills the DPA §7 blank as the standard term.

### 4. Sub-processor change notice

**30 days** advance notice before adding or replacing a sub-processor that touches client data (fills the DPA §4.1 blank).

## Consequences

- The offboarding runbook lives in the handbook customer-lifecycle page: notice intake, the dunning ladder, the four-step sequence wrapping the existing `decommission-customer.sh` tooling, and the attestation template.
- The DPA template's §4.1 and §7 blanks are filled with the standard terms (30 days each); per-engagement overrides remain possible at signing.
- A dry run of the full sequence against the staging seat is the verification step before the first paid customer's contract carries these terms (tracked on #1684's thread).
- Service-contract language derives from this ADR; nothing here publishes externally beyond what smd.services/security already states as mechanism.
