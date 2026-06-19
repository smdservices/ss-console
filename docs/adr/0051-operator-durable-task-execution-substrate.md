---
title: Operator Durable Task-Execution Substrate (B1)
date: 2026-06-18
status: accepted
captain: Scott Durgan
related-adr: 0050-operator-task-execution-framework.md, 0037-operator-thesis.md, 0021-leverage-hermes-native-primitives.md, 0045-mediated-connector-capability-broker.md, 0049-operator-model-selection.md, 0043-operator-runtime-read-path.md, 0007-per-customer-machine-isolation.md, 0016-honcho-disposition.md
---

# ADR 0051 — Operator Durable Task-Execution Substrate (B1)

**Status:** Accepted (Captain decision, 2026-06-18; plan rev. 2, hardened against three critique rounds + a source-level Phase-0 verification). This ADR is the **decision record**; the full design (decisions, lifecycle, file map, verification) lives in [`docs/design/operator/durable-task-execution-substrate.md`](../design/operator/durable-task-execution-substrate.md).

**Purpose.** Lock how the Operator runs a job that is too big for one synchronous turn: take it, run it **unattended** to completion, survive compaction / crashes / Machine restarts, and deliver a **retrievable result** — while keeping cost on reasoning (not data volume) and honoring the safety floors. This is build item **B1** from [ADR 0050](./0050-operator-task-execution-framework.md). The receipts failure that motivated the work is **B2** (process-in-code), separate; this substrate is for genuinely long **Class-D / multi-step** work.

## Context

Today a long task runs in one synchronous turn against a hard 55s reply budget (`hermes-smd-overlay/webhook_gate.py:264`), times out, and restarts from zero. The design is grounded in a source-level audit (every claim carries a file:line in the design doc). The load-bearing verified facts:

- **V1 — resume needs the session _lineage_, not a pinned id.** `state.db` is append-only; on compaction Hermes **forks a new `session_id`** (`run_agent.py:10732-10761`) and never deletes rows; reload via `get_messages_as_conversation(tip, include_ancestors=True)`. `run_job` is callable but _fire-fresh_ (mints `cron_<id>_<ts>`, no `conversation_history`) so it cannot resume. The dangerous guardrails (taint/entitlement/outbound) are **process-global plugin hooks**, not per-agent wiring.
- **V2 — real provider-reported usage + cost already exist** (`agent/usage_pricing.py`; the agent accumulates `session_*_tokens`). No tokenizer guessing.
- **V3 — delivery is standalone-capable** (`_deliver_result` falls back to a standalone send when no live adapter is passed); managed mail routes through the broker.
- **V4 — a long in-gateway job does not block the event loop** _iff it runs as a thread_: the gateway already runs cron on a separate `threading.Thread` + `ThreadPoolExecutor` (`gateway/run.py:16572,16991`; `cron/scheduler.py:1669-1743`), off the asyncio loop that services inbound/MCP; `run_conversation` is synchronous and I/O-bound (GIL released on LLM/tool waits).
- **Blueprint exists:** the broker-owned audit ledger (uid-gated socket, bind-mounted past Hermes' boot-time `chmod 0700`) + the `entrypoint.sh` supervisor pattern.

## Decision — the tenets

1. **Leverage `state.db` lineage for durable resume; build no persistence engine.** A job is a **lean control row** in the broker-owned ledger + a Hermes run whose conversation lives in `state.db`. The ledger stores `root_session_id` and a transactionally-updated `current_tip_session_id`; resume prefers the recorded tip (the lineage can be a _tree_ after abandoned branches) and **repairs a trailing `tool_call` with no `tool_result`** with a synthetic "interrupted" result before resuming.

2. **The worker is an in-gateway background _thread_ (V1 + V4), not an asyncio task and not a separate replicated process.** It reuses the `config→AIAgent` construction `run_job` uses; the net-new surface is the _resume invocation_ (`run_conversation(conversation_history=…)`, tip selection, partial-pair repair, cross-segment usage accumulation). Guardrails come from the process-global plugins, so they are inherited, not replicated. Conformance asserts **concrete invariants** on the net-new surface, not "behaves like cron."

3. **Fold the ledger into the existing broker DB/socket; restart-survival via a boot-sweep behind a readiness barrier.** No new uid / mount / supervisor for MVP. On boot, jobs are re-claimed only after the broker socket pings, plugins are registered, and the delivery adapter (if needed) is connected — so a startup race can never construct a half-wired worker.

4. **Lease fencing.** Each claim mints a monotonic `lease_epoch`; every privileged broker write carries it; the broker rejects stale-epoch writes (defeats the respawn-produces-two-workers double-spend/double-deliver).

5. **Cost is enforced, pre-spend, from real usage.** Wire the existing `sticky_stop` (built but unwired today) plus a per-job `budget_cents`. Pre-flight skip via `estimate_request_tokens_rough()`; the **authoritative guard is real accumulated tokens at the per-tool-iteration boundary** (catches mid-segment input blowups). Reuse `agent/usage_pricing.py`. This is also the first real per-job cost measurement (feeds B6).

6. **Safety floors hold inside the runner.** Taint-mark the worker session **at construction, fail-closed** (a new untrusted-by-default origin); validate `deliver_to` against a `customer.yaml` channel allowlist (broker-enforced, anti-exfiltration); record idempotency keys (logical-effect keyed) **before** the effect; on broker-socket failure, never proceed past an un-journaled effect → park to `needs_review`.

7. **Delivery is a first-class, retried, fenced state** (`complete → delivering → delivered`); the result artifact persists to **per-customer R2** before `delivering` so a Fly host reschedule can't orphan it. Leverage `_deliver_result` for gateway channels; managed mail via the broker.

8. **Operational invariants.** Worker identity (`customer_slug`, `persona_id`, `model`) is captured at intake and loaded from the row, never defaulted (boot assertion → `needs_review` on mismatch). A `job_cancel` kill switch ships in MVP, checked at the per-iteration boundary. Work _inside_ a background turn still obeys its execution class (process-in-code) — the runner provides duration + delivery only.

## Consequences

- **MVP is read-mostly:** the broker ledger (folded), the in-gateway worker thread, the `hermes-smd-jobs` plugin (`start_background_job` / `job_status` / `job_cancel`), pre-spend cost, taint-at-construction, the `deliver_to` allowlist, the delivery state machine, the R2 result store, and the `jobs` runtime-read observability seam (`GET /runtime/jobs` + `job_status`/`job_cancel` MCP verbs). Proof is a long **Class-D** job (multi-document review), not receipts.
- **Deferred (sequenced, not a 20-phase build):** send-capable jobs (full idempotency enforcement + the dedicated `smd-jobs` uid/isolation), concurrency >1, progress streaming, the console D1 mirror, TTL/archival.
- **Hard prerequisites:** a **broker respawn-supervisor** (for the broker-down protocol); **B0 generalized** to taint the worker session (MVP's read-mostly + fail-closed taint lets it proceed alongside).
- **CI is the durability guard:** a deterministic crash test (`os._exit` after a journaled effect, before completion → no re-execution), a fencing test, a pre-spend + mid-segment cost test, a readiness-barrier test, and an identity test. The real Fly machine-restart is a documented one-time staging acceptance, not a CI claim.

## Honesty banner — what is NOT yet true

- The substrate is **not built**; this ADR + the design doc are the spec.
- It does **not** make the receipts task cheap — that is B2 (process-in-code), independent.
- The global `sticky_stop` breaker is still unwired on the main turn path; this substrate enforces cost in the worker loop and does not depend on the global wiring (which remains its own fix).
