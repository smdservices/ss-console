---
title: Operator Service Commitments — Severity Ladder, No Nines, No Credits
date: 2026-07-04
status: accepted
captain: Scott Durgan
related-adr: 0004-productized-operator-offering.md, 0023-operator-per-customer-observability.md, 0062-operator-cost-plane.md, 0063-operator-launch-pricing.md
related-issues: 1683
---

# ADR 0064 — Operator Service Commitments

**Status:** Accepted (Captain decision, 2026-07-04, issue [#1683](https://github.com/venturecrane/ss-console/issues/1683)). Closes the "downtime SLA shape" and "incident-response patterns before the first paid customer" follow-ons that ADR 0004 filed on 2026-05-13 and that stayed open through the first pilot.

## Context

The Operator is sold against a salary, and an employee who silently stops showing up is a fireable offense — so the service needs an availability-and-response story a buyer can read. The constraint is honesty at our size: a founder-led firm with continuous automated monitoring (per-Machine heartbeats every 60 seconds, ADR 0023; the cost breaker, ADR 0062; Sentry error sync) but business-hours humans. An uptime percentage we cannot underwrite, or service credits we are too small to litigate, would be theater. The 2026-07-04 strategic review graded commercial operations D+ specifically for gaps like this one.

Two commitments already exist and constrain the shape: the Smokeball security review carries **24-hour notification** for incidents affecting client data or API access and **72-hour** for platform-level incidents, and the DPA template (#1680) carries a blank at §6 waiting for this decision.

## Decision

**The Operator's service commitment is a severity ladder over detection, response, and communication. No uptime nines. No service credits at launch.**

### The ladder

| Severity | Definition                                                                                             | Response commitment                           | Client communication                                            |
| -------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------- |
| **SEV1** | Operator down (no heartbeat past threshold), or the Operator acted outside its authorized entitlements | Work begins immediately on detection, any day | Notified within 24 hours; updates at least daily until resolved |
| **SEV2** | Degraded: a connector broken, skills failing, drafts not flowing, breaker tripped                      | Acknowledged and worked the same business day | Notified if client-visible; updates as material facts change    |
| **SEV3** | Questions, cosmetic issues, configuration requests                                                     | Next business day                             | Response in the same thread                                     |

- **Business hours** are Monday through Friday, Arizona time. Automated monitoring runs continuously; the ladder governs when a human engages.
- **Incident notification windows** (data or access affected: 24 hours; platform-level: 72 hours) match the standing Smokeball commitment. The DPA §6 standard term is **24 hours**.
- **No service credits.** The remedy for a failure is that we fix it fast and communicate honestly, in the same register as an employee's sick day. Credits are revisited if the client book or the incident history ever argues for them.
- **Security incidents** additionally follow the DPA: cooperation with the client's own notification obligations, information as it becomes available, tracked to resolution.

### Detection surfaces (what actually raises an incident today)

1. **Heartbeats** — every Machine reports every 60 seconds into `fleet_status`; staleness renders on the admin fleet dashboard and the client-portal aliveness chip (#1695).
2. **Cost breaker** — WARN/SOFT/HARD levels ride the heartbeat; HARD_STOP parks inbound at the gate (ADR 0062).
3. **Payment/webhook alerts** — billing failures email team@smd.services (#1679); Sentry errors sync to the fleet view.
4. **Client reports** — the portal change-request path and direct channels.

## Honesty banner — what is NOT yet true

**Heartbeat-red does not page a human.** A down Machine is visible on dashboards within minutes but generates no email or push today; detection-to-human-awareness currently depends on someone looking. That gap is named here rather than hidden, and closing it (a heartbeat-red alerter emailing team@smd.services) is filed as a follow-up issue referenced from #1683. Until it lands, SEV1 "on detection" honestly means "on dashboard observation or client report."

**Update (2026-07-04, same day):** closed by #1709 — the `ss-fleet-alerts` Worker evaluates `fleet_status` every 2 minutes and emails team@smd.services on heartbeat-red and HARD_STOP transitions (edge-triggered, one alert per incident, recovery notice on green), live-verified by stopping and restarting a real Machine. SEV1 "on detection" now means the pager, worst case red-threshold plus one cron interval (~7 minutes).

## Consequences

- The incident-response runbook lives in the handbook (`/admin/playbook/incident-response`): the ladder, the detection surfaces, the escalation path, and communication templates.
- The DPA template's §6 blank is filled with the 24-hour standard term; per-engagement overrides remain possible at signing but need a reason.
- Public surfaces (smd.services/security) continue to state the mechanism and point to the agreement for numbers — this ADR is the source those numbers come from.
- Marketing never publishes response times; the tone rules on timeframes stand.
