---
title: Work-liveness monitoring — process-liveness alone is never green
date: 2026-07-24
status: accepted
captain: Scott Durgan
related: 0023-operator-per-customer-observability.md, 0043-operator-runtime-read-path.md, 0062-operator-cost-plane.md, 0076-portal-console-is-the-employee-manual.md
---

# ADR 0079 — Work-liveness monitoring: process-liveness alone is never green

Amends ADR 0023 (observability substrate, Wave 1).

## The incident that forced this

On 2026-07-16 a probe `hermes cron run` executed as root left
`profiles/operator/cron/jobs.json` root-owned 0600 on pilot-smokeball. The
hermes-uid gateway scheduler could not read its own job DB, so **nothing
scheduled fired for 8 days** — while every monitoring surface stayed green,
because the webhook-gate process (which hosts the heartbeat emitter) was
alive and _process-liveness was the only pulse anything evaluated_. Captain
found the outage by noticing the absence of operator email.

The post-incident audit found the monitoring system was **built but never
wired, four layers deep**: (1) `last_skill_ts` was pushed to the console
every 60s and stored, but nothing evaluated it; (2) the healthchecks.io
dead-man integration was fully coded but never provisioned (no API key
vaulted), and it pings from the same gate thread — the wrong pulse; (3) the
agentic `health-monitor` cron skill was never scheduled (customer-zero's
cron is deliberately all-disabled); (4) its `ALERT_REQUIRED` output had no
delivery path anyway. A fifth instance surfaced during the fix: the
`ss-fleet-alerts` Worker itself had been unable to evaluate pilot-smokeball
since **2026-07-08**, because `fleet_status` was keyed `entity_id PRIMARY
KEY` and the multi-operator model (one entity, many seats) collapsed smd +
pilot into a single row — one seat's green masked the other's death.

## Doctrine

1. **Process-liveness alone is never green.** A pulse that proves "a process
   is running" says nothing about whether the product is doing its job. Every
   seat now self-checks its scheduler on every heartbeat and reports
   work-liveness (`scheduler_ok`, `scheduler_job_count`,
   `scheduler_max_overdue_seconds`); the console evaluates it and pages.
2. **Absence of work is only detectable by an external observer that knows
   work was expected** (dead-man's-switch doctrine). The observer is the
   console + ss-fleet-alerts Worker, outside the seat's failure domain.
3. **Monitoring is deterministic end to end.** No LLM sits in the alert
   path. The agentic health-monitor skill is ripped, with its endpoint
   (`/api/admin/fleet/health`), its middleware carve-out, and
   `OPERATOR_HEALTH_READ_KEY` (deleted from the seat, Infisical, and ss-web —
   secret-rotation would otherwise re-install it).
4. **A signal that is stored must be evaluated, and an alert that fires must
   reach a human.** "Built" without the activation path live-fire proven is
   theater (the P1 built-not-wired pattern). The definition of done for this
   system was a staging kill test: break the scheduler the way the incident
   broke it, receive the alert email; repair it, receive the recovery email.
5. **Never emit an all-clear from an unreported signal.** The alerter holds
   (pushes no condition state) when a work-liveness field is NULL — a false
   RECOVERED to an ops inbox cancels human urgency. Alert state transitions
   are marked only after the email actually sent, so a failed send retries on
   the next cron instead of being silenced forever.

## The condition set and its complementarity

| Condition                           | Detects                                                                                                            | Blind to                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `scheduler_error`                   | cron store unreadable/corrupt, error-state jobs, authored-but-unmaterialized — while the gate lives (THE incident) | gate death                                                                  |
| `work_overdue`                      | readable store whose jobs stopped firing (wedged scheduler)                                                        | gate death (values freeze — no false growth)                                |
| `heartbeat_red`                     | gate/machine death (seat has reported before, went quiet ≥300s)                                                    | work death behind a live gate                                               |
| healthchecks.io (seat ping)         | machine/gate death seen from OUTSIDE our infra                                                                     | scheduler death (pings from the gate thread — explicitly NOT a work signal) |
| healthchecks.io (alerter self-ping) | the watcher itself dying (Worker cron dead, runOnce throwing)                                                      | —                                                                           |

`fleet_status` is re-keyed on `customer_slug` (migration 0093) so seats
sharing an entity can never mask each other again. `operator_runtime_summary`
shares the old entity-keyed defect but is receiver-only with no pusher; it is
named here and gets the same re-key if a pusher is ever built.

## Rejected alternatives

- **Console-side `last_skill_ts` staleness alerting** — ambiguous on
  legitimately-quiet seats (customer-zero deliberately runs zero cron);
  overdue-vs-schedule is exact.
- **Auto-restart on red** — Fly does not restart machines on failed HTTP
  checks, and a restart controller for a four-seat fleet is disproportionate.
  Alert-a-human-in-minutes plus the entrypoint's boot-time ownership self-heal
  is right-sized. Revisit at fleet scale.
- **A portal work/health surface** — the console stays config-only (ADR
  0076); operator _health_ renders in the admin fleet roster, and a
  customer-facing "your operator's scheduled work is current" line is a
  future Status-chapter candidate, not part of this change.

## Accepted gaps (named, not hidden)

- The seat self-check enumerates `profiles/*/cron/jobs.json` by filesystem
  scan: stale profile directories left by hand could trip `scheduler_error`
  falsely. Accepted — a false page beats a silent death, and cruft cleanup is
  the fix.
- A job that fires and _fails_ every run (execution errors, `last_status`
  error) is work-liveness-green: the scheduler is doing its job; the job
  itself is broken. That class belongs to runtime summaries/Sentry, not this
  system.
- ~~Both healthchecks.io layers stay unarmed until `HEALTHCHECKS_API_KEY` is
  vaulted (Captain action); the in-console layers function without them.~~
  **Closed 2026-07-25:** key vaulted at Infisical `/ss`; per-seat checks
  (`hermes-<slug>`, 60s timeout / 300s grace) and the alerter self-ping
  (`ss-fleet-alerts`, 120s) created and confirmed pinging. Future provisions
  arm automatically from the vault (provision step 6c). healthchecks.io
  down-alerts currently deliver to the account email, not `team@smd.services`.
- Connector failures (Smokeball API outage, broken Graph token) fail every
  tool call while all liveness signals stay green — a subclass of the
  failing-job gap above, tracked as
  [#1990](https://github.com/venturecrane/ss-console/issues/1990) (gates A&P
  go-live per the Q9 diligence commitment).

## Prevention

`operator/bin/seat-probe.sh` is the blessed way to run probe commands on a
seat: it resolves the gateway pid inline, extracts its env, and always drops
to the hermes uid — making the root-run mistake that caused the incident
hard to make. Bare `fly ssh console -C` for seat probes is an anti-pattern.
