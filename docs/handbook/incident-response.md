---
title: Incident Response
section: operations
order: 9
summary: The severity ladder, the detection surfaces, the escalation path, and the client-communication commitments for Operator incidents - ADR 0064 as a runbook.
sources:
  - label: ADR 0064 - Operator service commitments
    href: https://github.com/venturecrane/ss-console/blob/main/docs/adr/0064-operator-service-commitments.md
  - label: docs/security/smd-services-security-overview.md
    href: https://github.com/venturecrane/ss-console/blob/main/docs/security/smd-services-security-overview.md
  - label: docs/legal/operator-dpa-template.md
    href: https://github.com/venturecrane/ss-console/blob/main/docs/legal/operator-dpa-template.md
---

## The commitment shape

ADR 0064 (Captain decision, 2026-07-04) locked the service commitment as a severity ladder over detection, response, and communication. No uptime percentage, no service credits at launch. The reasoning: a founder-led firm with continuous automated monitoring but business-hours humans commits to what it can underwrite, in the same register as an employee's sick day - we fix it fast and communicate honestly.

## The ladder

| Severity | Definition | Response | Client communication |
| --- | --- | --- | --- |
| SEV1 | Operator down (heartbeat past threshold) or acted outside authorized entitlements | Work begins immediately on detection, any day | Within 24 hours; at least daily updates until resolved |
| SEV2 | Degraded: connector broken, skills failing, drafts not flowing, breaker tripped | Same business day | If client-visible; updates as facts change |
| SEV3 | Questions, cosmetic issues, configuration requests | Next business day | In the same thread |

Business hours are Monday through Friday, Arizona time. Incident notification windows for security incidents are 24 hours (client data or access affected) and 72 hours (platform-level), matching the standing partner-review commitment and DPA §6.

## Detection surfaces

1. **Heartbeats** - every Machine reports every 60 seconds into `fleet_status`; staleness renders on the admin fleet dashboard and the client-portal aliveness chip.
2. **Cost breaker** - WARN, SOFT_STOP, HARD_STOP ride the heartbeat; HARD_STOP parks inbound at the gate.
3. **Automated alerts** - retainer payment failures email team@smd.services; Sentry errors sync to the fleet view.
4. **Client reports** - the portal change-request path and direct channels.

**The pager (#1709):** the `ss-fleet-alerts` Worker evaluates `fleet_status` every 2 minutes and emails team@smd.services on heartbeat-red (last heartbeat older than the period+grace envelope) and cost-breaker HARD_STOP transitions. Edge-triggered: one alert when a seat goes red, one recovery notice when it comes back, silence in between. Seats that have never heartbeated are provisioning-gray and never page. Worst-case detection-to-email is the red threshold plus one cron interval, about 7 minutes. The Worker only observes and emails; the response ladder stays human.

## Running an incident

1. **Classify** against the ladder. When in doubt between two severities, take the higher.
2. **Stabilize** - for a down Machine: `flyctl status`, then the deploy/rollback runbooks (never root SSH on a live Machine; it crash-loops bootstrap). For out-of-authorization behavior: pause the seat first, investigate second; the audit log is the record.
3. **Communicate** - first client message inside the window with what is known, what is being done, and when the next update comes. Plain language, no hedging, no blame.
4. **Track to resolution** - updates at the committed cadence; the incident is over when the client agrees it is.
5. **Record** - a dated post-incident note in `docs/runbooks/operator/` covering what broke, detection-to-resolution timeline, and what changed to prevent recurrence. Recurring patterns become memory lessons or executable gates.

## Escalation

Everything escalates to Captain (scott@smd.services); operational alerts land at team@smd.services. There is no second tier at this stage, and the runbook says so rather than implying an on-call rotation that does not exist.
