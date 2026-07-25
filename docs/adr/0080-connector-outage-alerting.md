# ADR 0080: Connector-outage alerting — generic call-site observation, deterministic paging

- **Status:** Accepted
- **Date:** 2026-07-25
- **Issue:** [#1990](https://github.com/venturecrane/ss-console/issues/1990)
- **Builds on:** ADR 0079 (work-liveness monitoring — doctrine and delivery loop), ADR 0078 (client-custody email), ADR 0020 (MCP-first connectors)

## Context

The A&P diligence response (Christa's Q9) commits: "Connection and process
failures alert us." ADR 0079 covers uptime and stuck processes; **broken
connections were its named accepted gap**. A Smokeball API outage or a dead
Graph token fails every tool call while every liveness signal stays green —
scheduler firing, heartbeats green, machine up. Before this ADR that failure
class surfaced only in the agent log.

Captain's scope ruling (recorded on #1990): the requirement is
**connector-generic** — any connector authored in `customer.yaml.connectors{}`
on any seat is covered by default, with zero per-vendor monitoring work when a
new connector lands. Smokeball and the ADR 0078 Graph mail channel are the two
kill-test instances, not the scope boundary.

## Decision

Observe connector health at the **call site**, ship it on the existing 60s
heartbeat, and evaluate it with the same deterministic, edge-triggered alerter
ADR 0079 built. No LLM anywhere in the path.

```
agent process: post_tool_call plugin ──ledger file (tmpfs)──▶ gate: connector_check
  ──60s heartbeat `connectors` map──▶ console ingest (fleet_status.connectors_json)
  ──▶ ss-fleet-alerts: connector_down:<server> / connector_check_error conditions
  ──▶ edge-triggered email to team@ / RECOVERED only on proven success
```

**Two observation seams, one ledger** (`shared/connector_ledger.py`, tmpfs,
atomic rename — the `mcp_result_store` two-process bridge shape):

1. **MCP tool path** (overlay#179): the `hermes-smd-connector-health` plugin
   observes every `post_tool_call` (status/error_type/error_message), resolves
   the server via Hermes' authoritative `tools.mcp_tool._mcp_tool_server_names`
   mapping, and records the outcome. There is deliberately **no prefix-parse
   fallback** — sanitized server names contain underscores, so parsing
   `mcp_{server}_{tool}` is ambiguous and a misparse would mint a phantom-key
   alert with no path to RECOVERED. Unmapped tools are not counted (undercount
   is the doctrinally safe failure); a broken mapping import flags the ledger
   (`mapping_ok=false`) so the dark window **pages** instead of the class dying
   silently.
2. **Channel transports that bypass the tool path** (overlay#181): the ADR 0078
   Graph mail channel (gate-side delta poller, plugin-side transports) flows
   through the single `MsGraphClient.request()` chokepoint, which records every
   outcome under `msgraph_mail` with conn-class computed **structurally from
   the real status code** — no message matching. Any future direct-transport
   channel must instrument its client the same way; this is the one per-channel
   obligation the generic design cannot remove.

**Failure semantics.** Per server: `consecutive_failures` (the only alert
input), the current run's `first_error_ts` (set on 0→1), last-ok/last-error
timestamps, conn-class evidence, truncated last message. A success resets the
count but **keeps the key** — the console resolves an alert only on a proven
success, never on key-absence.

**What pages** (Worker-side, on stored values only):

- `connector_down:<server>` opens on either path:
  - **Conn-class**: ≥3 consecutive failures (Hermes'-own-breaker parity) with
    connection-class evidence in the current run, run age ≥ 300s (a burst that
    self-heals inside the breaker's 60s cooldown never reaches an inbox).
    Conn-class evidence = pinned Hermes transport strings, anchored
    typed-client `-> HTTP <status>` formats, auth-mint markers
    (`shared/connector_signatures.py`, fixture-tested, ONE module — the
    pin-bump checklist's re-grep target). Hermes' derivative breaker string
    ("unreachable after N consecutive failures") is **excluded**: the breaker
    bumps on ANY error result, so three business errors manufacture it.
  - **Signature-free backstop**: ≥10 consecutive with zero successes and run
    age ≥ 900s pages regardless of what the errors look like — a vendor MCP
    whose auth death presents as business-text errors pages late rather than
    never. This is what makes paging genuinely connector-generic; signatures
    only make it faster.
- `connector_check_error` when the seat reports `connector_check_ok=0`: the
  seat's own check is broken (ledger unreadable, mapping gone) and nothing is
  being counted — which must page, not silently disable the class.
- Resolve **only** at `consecutive_failures == 0`. Counts 1-2 are ambiguous
  (failing again, not yet proven down) and push no state — pushing inactive
  would emit a false RECOVERED on the way INTO a new outage.

**ADR 0079 doctrine carried over, mechanically:** every age is stamped
**writer-side** on the seat (`run_age_seconds`), so the Worker never computes
against wall-clock — a frozen row from a dead seat can never self-activate a
connector page on top of its correct `heartbeat_red`. NULL map = whole-map
hold; absent server key = per-server hold (`getStaleHolds` surfaces both);
alert state marked only after the email actually sent.

**Storage:** `fleet_status.connectors_json` (TEXT) + `connector_check_ok`
(migration 0094), overwrite-including-NULL. Ingest parses three-tier:
structurally-invalid map → whole column NULL (trust nothing; everything
holds); invalid entry → dropped alone, valid siblings kept; fields inside a
kept entry never individually nulled (entries are atomic). The
`fleet_alert_state` CHECK is rebuilt to `IN (…, 'connector_check_error') OR
condition LIKE 'connector_down:%'` — the composite `(customer_slug,
condition)` PK gives one alert row per failing server.

## Accepted gaps (named, not hidden)

- **Idle-connector blind spot.** Passive call-site observation cannot see the
  outage of a connector with zero traffic; detection latency equals natural
  call cadence. Mitigation is structural — seats exist to run scheduled work,
  which is what calls connectors — plus the informational last-ok/last-error
  ages in the map. Synthetic probes were rejected outright: a probe is a write
  path into vendor APIs, the incident class this monitoring family exists to
  prevent.
- **Restart mid-outage** wipes the tmpfs ledger and re-counts from zero (the
  open alert HOLDS throughout; bounded re-detection latency). Tmpfs is chosen
  deliberately: stale pre-restart counts must not survive a boot.
- **Concurrent one-shot agent processes** can lose an increment to
  last-writer-wins on the ledger file — undercount only, never a false page.
- **While Hermes' breaker is open**, calls short-circuit without touching the
  vendor; ledger counts in that window count Hermes, not the vendor (harmless
  for the ≥3 predicate).
- **Creds-restored-but-idle** keeps the alert open until the next real call
  proves recovery — the email says so ("auto-resolves on the next successful
  call"). An unproven recovery is exactly what the no-false-RECOVERED clause
  exists to prevent.
- **A seat crash-looping before any tool call** leaves the ledger empty —
  that is heartbeat/scheduler monitoring's job (ADR 0079), not this system's.
- **AgentMail's plugin-side REST transports** (reply channel, confirm
  dispatch) bypass the tool path like Graph does and are NOT yet
  chokepoint-instrumented; agentmail coverage today is via its MCP tool calls
  only. Instrument `plugins/hermes-smd-reply`/`outbound_send` transports the
  Graph way if the reply channel becomes load-bearing for a client
  commitment.

## Pin-bump obligations

On every Hermes pin change: (1) re-grep the three transport strings named in
`shared/connector_signatures.py`; (2) the unit test asserting
`tools.mcp_tool._mcp_tool_server_names` exists fails loudly if the mapping
moves — the plugin then counts nothing and the ledger flags `mapping_ok=false`
(which pages) until fixed.

## Amends

ADR 0079's accepted-gaps list: the "job fires and fails every run" class is
now partially closed — the connector subclass (this ADR) pages; pure
business-logic job failures remain Sentry/runtime-summary territory.

## Verification

Overlay: 4 test modules (signatures fixtures, ledger semantics, check reader,
plugin handler) + heartbeat debounce additions + Graph chokepoint tests.
Console: worker unit tests (tri-state, NULL-hold, backstop, burst
suppression), real-D1 integration (`tests/connector-observability.test.ts`:
migration row-preservation + CHECK accept/reject, ingest three-tier, runOnce
open→hold→resolve lifecycle, stale-hold on key vanish), roster tests.
**Definition of done is the live kill test** (recorded on #1990): break the
Smokeball token on pilot-smokeball (hermes-uid config scramble, no root
mutation, checksum-verified restore) → ALERT email; restore + one successful
call → RECOVERED email; agentmail green throughout. Graph instance follows
the same shape on smd-staging when the channel is live on a seat.
