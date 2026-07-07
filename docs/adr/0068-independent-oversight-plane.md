---
title: Independent Oversight Plane — Active Watchdog vs. Passive Audit (Captain decision)
date: 2026-07-07
status: proposed
captain: Scott Durgan
related-adr: 0009-cross-machine-query-prohibition.md, 0015-hermes-fork-vs-upstream.md, 0023-operator-per-customer-observability.md, 0030-control-plane-human-principal-surface.md, 0043-operator-runtime-read-path.md, 0062-operator-cost-plane.md, 0067-hosted-agent-self-serve-sku.md
related-issue: TBD
---

# ADR 0068 — Independent Oversight Plane

**Status:** Proposed — build deferred (Captain decision 2026-07-07). This ADR scopes a decision; it does **not** presume the answer is yes. The recommendation below (a narrow console-side tracer bullet) is **accepted in principle**, but the build is **deferred** behind an explicit trigger — see [Decision (2026-07-07)](#decision-2026-07-07). The full "second always-on agent per customer" framing is rejected for now.

**Source:** A peer's oversight-plane sketch — a "CISO watchdog" with its own read-only MCP and its own alert channel to the owner, drawn as a separate box wrapping the build box — plus our own recurring anti-pattern `rotating-stale-operator-chat-sessions`, caught live in the 2026-07-05 L2 watch run (defect F4a: an Operator turn reported a memo write as denied by quoting a _prior_ session's HTTP 403 "verbatim from the prior session record" and never attempted this run's write; the stale platform session rotates only at the next reprovision). The question this ADR forces: do we make oversight **active and independent** — a distinct thing that watches the working Operator and can alert the principal on its own channel — or do we keep oversight **passive** (the tamper-evident audit ledger, verified on export and on demand)?

## Decision (2026-07-07)

Captain decision, recorded so the analysis below is banked rather than re-litigated:

- **Recommendation accepted in principle.** Option B — a console-side, read-only, deterministic watchdog consuming the existing [ADR 0043](./0043-operator-runtime-read-path.md)-A read seam and audit export — is the right shape. The other options (in-process hook; co-resident process; second Fly Machine per seat) and any LLM-in-the-loop watchdog are **not** adopted.
- **Build deferred.** We are pre-launch. The priority is getting the A&P Operator live and selling seats, not building oversight infrastructure ahead of demand. No build cycle is spent now; this ADR is the banked decision record.
- **Build trigger.** Revisit and build the tracer bullet when the A&P Operator is **live and stable** _and_ **either**:
  - **(a)** a compliance buyer names independent oversight as a requirement, **or**
  - **(b)** the stale-session defect (F4a) recurs on a **paid** seat.
- **Open questions stay open.** The five Captain-only questions at the end are unresolved by design; they are to be answered if and when the trigger fires and the build is scheduled.

The remainder of this ADR is the supporting analysis that the decision above rests on.

## Context

Our current oversight is strong but passive, and it is spread across three already-accepted decisions:

1. **The audit ledger is tamper-evident and single-writer.** Every Machine keeps a hash-chained SQLite audit ledger (`operator/workspace_broker/chain.py`): `row_hash = sha256(prev_hash ‖ canonical_row)`, so a deleted, reordered, or inserted row breaks the chain at a verifiable point. The write side runs **only** in the capability broker's `LedgerWriter.append` — the single process holding the ledger's RW handle — and **the agent uid cannot reach it**. `operator/bin/verify-audit-chain.py` already walks a ledger (or an `audit_export` JSON pulled over the runtime-read seam) and proves the chain intact. This is genuine tamper-evidence, but it is **verified on demand**, not continuously, and it detects _ledger tampering_, not _behavioral drift_ (a stale-session reply is a perfectly well-formed, correctly-chained audit row).

2. **A read-only, per-customer read surface exists.** [ADR 0043](./0043-operator-runtime-read-path.md) fixes an A+B split: a thin, authenticated, **read-only** endpoint on each Machine for deep per-customer drill-in (A), plus mirrored summaries to a console-side per-customer store (B). Reads are read-only, single-customer-scoped, and audited at the console. This is exactly the seam an oversight consumer would read from — it already exists and is already the right shape.

3. **Active in-band controls exist, but they live _inside_ the trust boundary.** [ADR 0062](./0062-operator-cost-plane.md) added the cost breaker (`sticky_stop`), the interactive per-turn cents meter, the inbound wake-cap gate, and the `INVARIANT_VIOLATION` alarm. [ADR 0023](./0023-operator-per-customer-observability.md) added Sentry (tenant-tagged), healthchecks.io liveness (deliberately **outside the trust boundary**), the central `fleet_status` table, and source-tagged `cost_anomaly_alerts` with a Captain Resend escalation path. These are real, and some already alert. But the cost meter, the invariant guards, and the wake gate all run _as overlay code in the same process as the working agent_ ([ADR 0015](./0015-hermes-fork-vs-upstream.md): plugin-only overlay). A control co-resident with the thing it controls shares that thing's blast radius. Healthchecks.io is the one piece today that is genuinely out-of-band — and all it watches is "is the process alive."

The gap, stated precisely: **we have passive tamper-evidence + in-band active controls + one out-of-band liveness check. We do not have an out-of-band process that continuously reads the working Operator's own actions and independently judges them for drift.** The stale-session case is the sharpest instance — a correctly-audited action that is _semantically stale_ (answering from obsolete session/identity/connector context after a deploy). No existing control catches it, because every existing control trusts the same runtime context the Operator is answering from.

**What "independent oversight" would add.** A watchdog that (a) reads only — over the ADR 0043-A read seam and the audit export, never mutating — so it cannot be co-opted into acting; (b) runs _outside_ the working Operator's process (and ideally outside its Machine), so a compromised or confused Operator cannot silence it; (c) has its **own** alert channel to the principal, distinct from anything the Operator controls. This is the peer's "separate box wrapping the build box."

## Which SKU this serves

- **Operator (per-customer Fly Machine), compliance-tier first — yes, this is the target.** The value of a second, independent set of eyes that _the employee cannot silence_ is a compliance-and-trust story, and it maps directly to willingness-to-pay against a regulated-vertical salary ([ADR 0037](./0037-operator-thesis.md) Tenet 6). The **A&P (Ashton & Price) law-firm build** is the natural first seat: 7-year audit retention, a real compliance floor, and the exact anti-pattern (`rotating-stale-operator-chat-sessions`) already observed on the pilot. Oversight-as-a-named-capability is most legible where the buyer already reasons about supervision and audit.
- **Hosted Agent ($79/mo self-serve, [ADR 0067](./0067-hosted-agent-self-serve-sku.md)) — no.** BYO-key, self-serve, cost-sensitive; it cannot economically carry a second always-on process per seat, and its buyer isn't buying a compliance posture. If anything, Hosted Agent inherits only the _cheapest_ slice (a console-side liveness/anomaly check on shared infra), never a co-resident watchdog.
- **This is a capability, not the moat.** Per ADR 0037 Tenet 4, naming an independent watchdog "the moat" would be a category error. It composes into the harness (the moat is harness + guide + memory); it is not sold as the thing.
- **Doctrine placement.** The watchdog is an **integrity control protecting correctness** — same class as the cost breaker and the taint gate, not a client entitlement — so a platform default is doctrine-consistent per [ADR 0035](./0035-no-imposed-entitlement-defaults.md)/[ADR 0062 §5](./0062-operator-cost-plane.md). It is emphatically **not** the control plane ([ADR 0030](./0030-control-plane-human-principal-surface.md)): the control plane is where the _human_ governs the employee; the watchdog is an automated oversight layer that _feeds_ the human. It never acts, never widens authority, never governs — it observes and alerts.

## What it watches, and what it alerts on

Four watch classes, in priority order (the motivating case first):

1. **Session / identity drift (the motivating case).** The console knows each seat's current provisioning epoch (last reprovision / last `customer.yaml` hash / last connector-token refresh). The watchdog flags an Operator action that answers from a session older than that epoch — concretely, the F4a shape: a `REPLY_SENT` / memo action whose `input_digest` or quoted error matches a _prior_ session's failure with no fresh attempt in the current session window. **Alert:** "seat X is answering from a stale session (epoch N < current N+1)."
2. **Connector staleness.** A connector token/grant known-revoked or rotated at the control plane ([ADR 0057](./0057-operator-claude-connector-access-model.md) `mcp_issued_grants`, the kill switch) but still being cited or used in audited actions. **Alert:** "seat X acted on connector Y after Y was revoked/rotated."
3. **Entitlement-ceiling violations.** Any audited action whose persona-exposure / skill-initiation entitlement ([ADR 0056](./0056-persona-exposure-skill-initiation-entitlements.md)) does not permit it — an independent recomputation of the ceiling against the audit row, _outside_ the process that enforced (or failed to enforce) it in-band. **Alert:** "seat X emitted an action its authored ceiling forbids."
4. **Audit-stream integrity + silence.** Continuous (not on-demand) chain verification via the existing `verify-audit-chain.py` over the read seam, plus a _semantic_ liveness check the current healthchecks.io ping cannot make: "the ledger head has not advanced but the seat claims to be working," or "an `INVARIANT_VIOLATION` was emitted and not cleared." **Alert:** chain break, head-pin mismatch (tail truncation), or unresolved invariant alarm.

All four write to the existing source-tagged `cost_anomaly_alerts` table (new `source='watchdog'`) so they surface in the admin dashboard banner and the Captain Resend path with zero new alert plumbing — _except_ that the tracer bullet deliberately proves an **independent** channel (see below), because reusing the Operator's own infrastructure for the alert would undercut the "cannot be silenced" property.

## How "read-only + separate" is enforced — options and tradeoffs

The key design tension: the _more_ separate the watchdog, the stronger the "cannot be co-opted / cannot be silenced" property — but the higher the cost and the more surface to build. Four options, weakest-but-cheapest to strongest-but-costliest:

| Option                                                                                            | Separation                                                                                      | "Cannot be silenced"                                                                                                                                               | Cost                                                                                 | Read mechanism              |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------- |
| **A. Overlay plugin hook** (in-process on the Machine)                                            | None — same process, same Fly volume, same trust boundary as the agent                          | **Fails.** A confused/compromised Operator shares its blast radius. Also risks tripping ADR 0015 (no core mods) and re-creating an in-band control we already have | ~zero marginal                                                                       | direct                      |
| **B. Console-side cron consumer** (control plane, pulls over ADR 0043-A read seam + audit export) | Strong — runs entirely outside every Machine, on infra the Operator cannot touch                | **Strong.** The Operator has no write path to the console; the read seam is read-only by construction (ADR 0043 invariant)                                         | low — reuses existing console + workers; no per-seat process                         | pull over the existing seam |
| **C. Separate co-resident process** on the Machine (own uid, read-only creds, own socket)         | Medium — separate process, but same Machine/volume; a Machine-level compromise still reaches it | Medium                                                                                                                                                             | a second always-on process **per seat** — real Fly cost (see below)                  | local read-only             |
| **D. Separate Fly Machine per customer** (own app, read-only MCP, own alert channel)              | Strongest — the peer's literal "separate box"                                                   | **Strongest**                                                                                                                                                      | a second always-on **Machine per seat** — roughly doubles the per-seat Fly footprint | read seam over private net  |

**Read-only enforcement**, whichever option: the watchdog consumes the ADR 0043-A endpoint (read-only by invariant, rejects any mutation) and the `audit_export` payload (`verify-audit-chain.py --json`). It holds **no** capability-broker socket, **no** write handle to the ledger (the single-writer property in `chain.py` already guarantees only the broker writes), and **no** connector credentials. Per-customer scoping is mandatory: [ADR 0009](./0009-cross-machine-query-prohibition.md) prohibits cross-Machine runtime queries; a fleet-wide watchdog reads the per-customer _summary_ store (one row per seat) for breadth and the per-customer read seam for depth — it never joins two seats' runtime state. This is the same carve-out `fleet_status` already uses.

**Alert-channel separation:** the "cannot be silenced" property requires the alert path to _not_ depend on anything the Operator controls. Option B on the console already satisfies this (Resend from `workers/cost-anomaly`, a path no Machine can reach). The one thing the tracer bullet must prove is that a _totally dark Machine_ (crashed, or lying about its own health) still produces a watchdog alert — i.e., the watchdog's judgment is driven by the console's knowledge of expected state, not solely by what the Machine reports.

## Cost implication

Grounding facts (verified, per the cost-plane forensics): an **idle** Operator fleet costs approximately nothing (audit-ledger-proven); an **always-on** Machine carries real Fly cost (seats already run `min_machines_running=1` to receive inbound webhooks, [ADR 0032](./0032-inbound-webhook-architecture.md)); an **active** build/verify session runs $8-30/day in token spend. A watchdog that is itself an _agent_ (LLM-in-the-loop judgment) would add active-session-class token spend per seat — the expensive end. A watchdog that is _deterministic_ (rule checks over audit rows: epoch compare, ceiling recompute, chain verify) adds only compute, not tokens.

- **Option A:** ~zero marginal, but fails the separation test — rejected on principle, not cost.
- **Option B:** low — one console-side cron/worker consuming an existing seam; no per-seat process; deterministic checks, no per-seat token spend. This is the cheap _and_ separate option.
- **Option C/D:** a second always-on process or Machine **per customer**. At the current fleet size this is affordable; at scale it roughly adds a second per-seat Fly line item, and if the watchdog reasons with an LLM it adds active-session token spend per seat. The COGS/MRR kill gate (>40% two consecutive months, ADR 0062/0063) would feel it.

The recommendation exploits the fact that **the audit ledger is already the independent, tamper-evident, single-writer read surface**, so the strong-separation property (Option B) is available at low cost _without_ a second agent — the peer's "separate box" is satisfied by putting the watchdog on the control plane, which is _more_ out-of-band than a co-resident process, not less.

## Tracer bullet (per "tracer bullet before architecture")

Do **not** build an oversight framework. Build **one watchdog, one real audit stream, one anomaly, one independent alert**, on the live substrate:

1. **One seat:** `pilot-smokeball` (never a paid seat first — standing rule; fixtures then pilot-smokeball then ashton-price).
2. **One real stream:** pull that seat's `audit_export` over the existing ADR 0043-A read seam and run the existing `verify-audit-chain.py` continuously (a console-side cron, Option B). No new read surface.
3. **One anomaly:** the stale-session detector — compare the seat's session epoch (control-plane knowledge of last reprovision) against the session cited in its most recent audited actions; flag F4a-shaped stale reuse. This is the exact defect already observed, so success is falsifiable against a known event.
4. **One independent alert:** write a `source='watchdog'` row and fire the _console_ Resend path — and prove the alert still fires when the Machine is dark or lying (drive the judgment from console-side expected state, not from the Machine's self-report).

Success criterion: reproduce the 2026-07-05 stale-session event (or a synthetic replay of it) on the live pilot and have the watchdog raise the alert **without** the working Operator being able to suppress it. If that single loop doesn't hold on the real substrate, no framework should be built on top of it.

## Recommendation

**Accept the tracer bullet as Option B (console-side, read-only, deterministic), scoped to the Operator SKU, piloted on `pilot-smokeball`, targeted at A&P compliance-tier as the first paid context. Reject — for now — Options C and D (co-resident process / second Machine per seat) and reject any LLM-in-the-loop watchdog.**

Rationale: the strong separation the idea wants ("cannot be co-opted, cannot be silenced") is _already available_ on the control plane at low cost, because the audit ledger is already single-writer and agent-unreachable and the read seam is already read-only. A second always-on agent per customer buys marginal additional separation at real recurring cost and real token spend, and risks re-implementing in-band controls we already have (ADR 0062) one boundary over. Start where the leverage is highest and the cost is lowest; escalate to C/D only if a concrete threat model shows the console-side watchdog is insufficient. Frame it as an integrity capability that composes into the harness — never as "the moat."

Per the [Decision (2026-07-07)](#decision-2026-07-07) above, this recommendation is accepted in principle but **not scheduled**; it builds only when the trigger fires.

## Open questions (Captain only)

1. **Is out-of-band separation on the control plane (Option B) "separate enough,"** or does the trust story specifically require a second box _per customer_ (C/D) that is visibly, physically distinct — even at the added cost — because that is what a compliance buyer will want to _see_?
2. **Deterministic vs. reasoning watchdog.** Rule-checks over audit rows are cheap and legible but only catch what we can specify. An LLM-judged watchdog could catch drift we didn't anticipate — at active-session token cost per seat, per ADR 0062 economics. Deterministic-first, or is reasoning-judgment part of what makes it worth selling?
3. **Is oversight a _named, sold_ capability** (a line in the A&P compliance story / a portal surface) or an _internal_ integrity control the customer never sees (like the cost breaker)? This changes whether it needs a customer-facing alert channel and audit surface, or only a Captain-facing one.
4. **Does Hosted Agent get anything** (a stripped console-side liveness/anomaly check on shared infra), or is oversight Operator-only, full stop?
5. **What is the authoritative "current session epoch"** the stale-session detector compares against — reprovision timestamp, `customer.yaml` hash, connector-token refresh, or a composite — and who owns writing it? (This is the one piece of new state the tracer bullet needs; everything else reuses existing surfaces.)

## References

- [ADR 0009](./0009-cross-machine-query-prohibition.md) — cross-Machine query prohibition; control-plane fleet-health carve-out (the per-customer scoping the watchdog must honor)
- [ADR 0015](./0015-hermes-fork-vs-upstream.md) — plugin-only overlay, no core mods (why an in-process hook, Option A, is the wrong home)
- [ADR 0023](./0023-operator-per-customer-observability.md) — observability stack; `cost_anomaly_alerts` source-tagging, Resend escalation, healthchecks.io-outside-the-trust-boundary precedent
- [ADR 0030](./0030-control-plane-human-principal-surface.md) — the control plane governs via the _human_; the watchdog feeds it, is not it, and never acts
- [ADR 0035](./0035-no-imposed-entitlement-defaults.md) / [ADR 0056](./0056-persona-exposure-skill-initiation-entitlements.md) — integrity-control vs. entitlement; the ceilings the watchdog recomputes independently
- [ADR 0043](./0043-operator-runtime-read-path.md) — the read-only per-customer read seam the watchdog consumes (A) + summary mirror (B)
- [ADR 0057](./0057-operator-claude-connector-access-model.md) — `mcp_issued_grants` kill switch (the revocation state the connector-staleness watch reads)
- [ADR 0062](./0062-operator-cost-plane.md) — existing active in-band controls (`sticky_stop`, interactive meter, `INVARIANT_VIOLATION`); COGS/MRR gate the per-seat cost must respect
- [ADR 0067](./0067-hosted-agent-self-serve-sku.md) — the SKU explicitly out of scope for a co-resident watchdog
- `operator/workspace_broker/chain.py` — hash-chained ledger; single-writer, agent-uid-unreachable (the tamper-evidence the watchdog builds on)
- `operator/bin/verify-audit-chain.py` — the independent chain verifier the tracer bullet runs continuously
- `operator/grading/runs/l2-pilot-smokeball/2026-07-05-watch-1-run-01.md` — defect F4a, the `rotating-stale-operator-chat-sessions` anti-pattern (the motivating case)
