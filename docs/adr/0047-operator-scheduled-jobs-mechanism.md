---
title: Operator Scheduled-Jobs Mechanism — Materialize persona.cron via Hermes-Native Cron
date: 2026-06-11
status: accepted
captain: Scott Durgan
related-adr: 0021-leverage-hermes-native-primitives.md, 0019-customer-yaml-config-translation.md, 0007-per-customer-machine-isolation.md, 0015-hermes-fork-posture.md, 0035-no-imposed-entitlement-defaults.md
related-issues: 1166
---

# ADR 0047 - Operator Scheduled-Jobs Mechanism

**Status: ACCEPTED. Captain decision, 2026-06-11.**

How a per-customer Operator runs work on a schedule (the hourly inbox triage,
the watcher skills) is currently undecided in code. `customer.yaml` authors a
`persona.cron[]` block, the validator accepts it, and then it is silently
dropped at materialization — nothing registers a job, so no scheduled turn ever
fires. This ADR picks the mechanism before any scheduling code is written, so we
do not accrete a third half-wired cron path nobody decided on.

## Context

1. **The authored intent exists and is inert.** `operator/customers/smd/customer.yaml`
   authors, per persona:

   ```yaml
   cron:
     - skill: inbox-triage
       schedule: '0 7-19 * * *' # hourly 0700–1900, fly_region tz
       wake_policy: always
   ```

   The customer-yaml validator accepts `persona.cron`, but the overlay
   `bootstrap/translate.py` has no `_materialize_cron` and `_persona_config`
   never reads `persona["cron"]` (verified: a grep for cron/schedule/wake in
   `translate.py` is empty). The schedule is aspirational config that never
   reaches the runtime — the exact "validation passing ≠ materialized" failure
   class we have been bitten by before.

2. **Hermes ships a native cron subsystem.** At the pinned ref:
   - `tools/cronjob_tools.py` — the `cronjob` agent tool (register / list /
     update / delete jobs), with `schedule` and an optional pre-run `script`.
   - `hermes_cli/cron.py` + `cli.py::_handle_cron_command` — CLI / config-driven
     registration, usable at boot outside the agent loop.
   - The `wakeAgent` gate (`RELEASE_v0.11.0`, PR #12373): a job's pre-run script
     can emit `{"wakeAgent": false}` to do an arithmetic-only polling pass and
     skip the LLM entirely. ADR 0021 Stream B already commits to using this for
     watcher skills (zero token cost on quiet days, with a `suppressed_wake`
     audit row).

3. **The substrate principle governs (CLAUDE.md / ADR 0015 / ADR 0021).**
   "Hermes is the substrate — trust it. Build only what Hermes won't." Plugins
   MUST NOT modify Hermes core. A scheduler is squarely something Hermes already
   provides.

4. **A scheduled wake is a security-relevant event.** It is an autonomous turn
   with no human present — the context for `OP-P0-5` (authorized-but-wrong
   actions on live data) and `OP-P0-4` (the unfenced managed-mailbox read) in
   `docs/security/operator-threat-model.md`. Whatever fires the turn, the
   taint-gate, content-floor, and per-action ceilings must still bind on it.

## Decision

**Materialize `persona.cron[]` into Hermes-native cron jobs at bootstrap. Do not
build an overlay scheduler. Do not make the agent's `cronjob` tool the source of
truth for the schedule.**

Concretely:

- Add a deterministic materialization step (overlay `bootstrap`, e.g.
  `_materialize_cron` invoked from the provisioning/boot path) that reads each
  persona's authored `cron[]` and registers one Hermes cron job per entry via
  the native CLI/config registration path (`hermes_cli/cron.py`), keyed so
  re-provisioning is idempotent (re-register replaces, never duplicates).
- Map `wake_policy` to the `wakeAgent` gate: `always` → `wakeAgent: true`; a
  polling/watcher policy → a pre-run script that decides, per ADR 0021 Stream B,
  emitting `suppressed_wake` audit rows on the silent path.
- **The authored `customer.yaml` is the single source of truth for the
  schedule.** The agent-facing `cronjob` tool stays classified `CODE_EXECUTION`
  (fail-closed unless authored, per `action_classes.py`) — the agent does not
  silently schedule itself into existence; a schedule is authored config, not
  model output (same principle as "the agent can never raise its own ceiling").
- Materialization **fails closed and loud**: an unparseable/unregisterable cron
  entry aborts provisioning with an error, never a silent drop. Verification is
  against the running Machine (`hermes … cron list`), not the artifact.

## Options considered

**A. Hermes-native cron, registered at bootstrap from `customer.yaml` — CHOSEN.**
Uses the supported primitive, inherits the `wakeAgent` optimization ADR 0021
already designed for, keeps one source of truth (authored config), and adds the
least code (a translation step, not a runtime). Consistent with ADR 0015 / 0019 / 0021.

**B. Overlay-side scheduler (a daemon in the overlay that triggers skills) —
REJECTED.** Reinvents a primitive Hermes already ships; a long-lived scheduler
process per Machine is new surface to run, monitor, and crash-recover; creates a
second scheduling source of truth diverging from native cron; contradicts the
substrate principle and ADR 0021. No capability it would add that native cron +
`wakeAgent` does not already cover.

**C. Agent self-registers via the `cronjob` tool as the primary mechanism —
REJECTED.** Makes the agent's own output the schedule's source of truth, which
inverts the authored-config model and is `CODE_EXECUTION` (fail-closed by
design). The tool remains available as an authored, entitlement-gated capability
for in-conversation scheduling; it is not how the standing schedule is
established.

## Consequences

- **Positive.** The authored schedule finally binds; the silent-drop is closed.
  Watcher skills get the zero-token quiet path for free. No new long-running
  process; nothing to maintain beyond a translation step. Schedule state is
  inspectable on the live Machine and diffable against authored config (feeds the
  materialized-state visibility work, #1328).
- **Negative / watch items.**
  - Every registered job is an autonomous, human-absent turn. The taint-gate +
    content-floor + ceilings are the controls on those turns; this ADR does not
    add a scheduling-specific gate and relies on them holding (`OP-P0-4/5`).
  - `wakeAgent: false` pre-run scripts run arithmetic-only logic; an audit-write
    failure on the silent path must fall back to `wakeAgent: true` (ADR 0021).
  - Timezone correctness depends on the Machine's `fly_region` tz; materialization
    must pin it explicitly, not assume UTC.

## Scope (follow-on build, not part of this ADR)

- `_materialize_cron` in overlay bootstrap + a boot/provision registration step;
  idempotent re-registration.
- `wake_policy` → `wakeAgent` mapping + the watcher pre-run script contract.
- Verification: assert authored `cron[]` == `hermes cron list` on the live
  Machine after reprovision.
- Customer-zero (#1166) is the first consumer.

## Non-goals

- A general job queue / arbitrary task scheduler beyond skill-on-cron.
- Cross-Machine or fleet-level scheduling (per-customer isolation stands, ADR 0007).
