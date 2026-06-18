---
title: Operator Task-Execution Framework — Task Taxonomy and Strategy Portfolio
date: 2026-06-18
status: accepted
captain: Scott Durgan
related-adr: 0037-operator-thesis.md, 0021-leverage-hermes-native-primitives.md, 0049-operator-model-selection.md, 0047-operator-scheduled-jobs-mechanism.md, 0045-mediated-connector-capability-broker.md, 0016-honcho-disposition.md
---

# ADR 0050 — Operator Task-Execution Framework

**Status:** Accepted (Captain decision, 2026-06-18). The **task taxonomy and strategy portfolio are locked** as doctrine. The **prioritized build sequence** (§ "What this commits us to") is recorded but **pending a detailed design review** before any implementation begins.

**Purpose.** Lock the classification by which the Operator's work is understood, run, costed, and verified — so the question _"how do we execute this task cheaply, reliably, at employee grade?"_ is answered by reference rather than re-derived per skill. This ADR is the **decision record**; the full archetype tables, the strategy portfolio, the match matrix, the cost model, the reliability model, and the build backlog live in the backing detail at [`docs/operator/task-execution-framework.md`](../operator/task-execution-framework.md). The framework was produced by a 17-agent research synthesis grounded in a source read of Hermes (`NousResearch/hermes-agent`), our overlay, and the vertical packs, then hardened against four adversarial reviews.

## Context

The Operator competes with a coordinator **hire**, not with software ([ADR 0037](./0037-operator-thesis.md) Tenet 1). To earn that price it must complete sustained, multi-step work **unattended** and deliver a **retrievable result**.

The canonical failure that motivated this work: "read ~40 receipt emails and sum the dollar amounts" — trivial reasoning over moderate data — **cost ~$50 and never completed.** It ran as an interactive agent loop reading one message per turn, so the conversation context grew super-linearly; the 55-second synchronous reply budget (`webhook_gate.py:264`, `_MCP_POLL_TIMEOUT_S = 55.0`) then killed each attempt and restarted it from zero with nothing checkpointed. The architecture, not the task, set the cost.

The single fact that determines economic viability:

> **Cost scales with the complexity of the reasoning, not the volume of the data — but only if the task is architected correctly.** The LLM orchestrates and reasons; it must never page raw data through its context window.

The SKILL.md schema already encodes a **governance** proto-taxonomy (`action_class`, `trust_ceiling`, `connectors`, `trigger`). The layer this ADR adds is an **execution-strategy** taxonomy: for each class of task, the most effective, efficient, and reliable way to actually run it on the Hermes substrate.

## Decision — the framework

### 1. Seven task archetypes; the archetype, not the vertical, governs execution.

Deduplicating ~70 named skills across all 12 verticals collapses to **seven archetypes** plus two cross-cutting concerns. Vertical compliance floors ride on top as trust-ceiling modifiers.

- **A1 Inbound triage & route** — `inbox-triage`, all `*-intake`, conflict/FNOL/refill routers.
- **A2 Portfolio scan & batch draft** — status/digest assemblers, recall/renewal/reactivation, deadline trackers (large-N).
- **A3 Item chaser** — `ar-chaser`, document/letter/stip/appraisal chasers (per-file open items).
- **A4 Event-triggered single-step** — schedulers, `intake-to-system-sync`, memo-on-update, money-movement coordinator.
- **A5 Authored-content delivery** — care senders, commitment/owner-report deliverers, meeting-prep, acknowledgments.
- **A6 Safety escalation router** — wire/adverse-event/money-movement routers (synchronous, fail-open, never queued).
- **A7 Status responder** — matter/borrower/claims status responders (interactive, hold the no-advice line).
- **X1 Orchestration / conversational turn** (cross-cutting) — the open `ask_operator` turn.
- **X2 Safety-guard branch** (cross-cutting) — the halt/escalate path embedded inside A1/A4 skills.

The **coordinator-vs-advisor line is the universal invariant**: across all verticals the Operator may REPORT, RELAY, SURFACE, ROUTE — never COMPUTE a legal/clinical/actuarial determination, GUARANTEE an outcome, or ADVISE on substance. A task whose correct answer requires substantive judgment is a draft/escalation task by construction.

### 2. Six execution classes (MECE for the normal path).

- **Class N — No-Model / Deterministic.** Zero inference; pure computation (field-diff, date-bucketing, sum/divide). `no_agent` cron + `pre_run.py`; LLM woken only on exception.
- **Class C — Compute-Collapsible.** Volume-bound fetch that dominates cost, then a _bounded_ model reduce that reads the aggregate to draft/classify. The class whose real cost is "low dollars/month," not cents.
- **Class R — Reason-Bounded.** Small data, judgment is the whole job.
- **Class D — Deep-Reason-over-Volume.** Large data that _must_ enter context because meaning is in the content. The one class where code-offload does not apply.
- **Class A — Authored-Assembly.** Deliver authored content with near-zero model contribution; the only failure mode is fabrication.
- **Class O — Orchestration / Conversational.** The open turn that answers directly or dispatches registered skills; governed as open-ended planning (the reliability profile that _collapses_ over duration) and therefore kept short.

### 3. A design-time decision procedure sets each skill's `execution_class`.

A five-question classifier (full tree in the backing doc §3.3) runs at authoring time: Open turn → O; no inference → N; deliver authored content → A; aggregate over records (not read for meaning) → C; meaning-bearing content that fits one sub-4-minute pass → R, else → D. Mixed skills are classified by the **dominant cost driver** (whenever large-N data is present, the data-volume phase wins → C). Multi-mode skills carry **one `execution_class` per mode**. The R/D boundary is a **reliability threshold** (does it fit one reliable pass without compaction?), not a record count.

### 4. The safety guard is a cross-cutting runtime concern, not a class.

A confirmed high-risk signal (wire instruction, adverse event, emergency, money movement) is an **embedded branch** inside otherwise-ordinary skills. Its posture is non-raisable: **synchronous escalation, fail-open, never queued.** Whether it fires is a **runtime property of the input**, unknowable at authoring time — so a skill's `execution_class` describes its normal path, and the presence + synchronicity of the S-guard is asserted **separately**. This split resolves the previously-undecidable "is this skill a safety task?" question: you can only ask that of an _input_, never a _skill_.

### 5. Each class maps to a strategy from a tagged portfolio.

The strategy portfolio (backing doc §4, match matrix §5) tags every technique **substrate-provided** (the platform provides/enforces it) vs **author-discipline** (the skill author must implement it; unenforced until the B5 lint exists). The backbone strategies: **process-in-code** (`execute_code`) for Class C; **`no_agent` cron + `pre_run`** for Class N and quiet watchers; **sub-agent isolation** (`delegate_task`) for Class D; the **durable async runner** (not yet built) for interactively-initiated heavy work; **two-tier model routing** per [ADR 0049](./0049-operator-model-selection.md); and **verification loops** + **idempotency** as author-discipline disciplines. The forbidden anti-pattern: running any Class C/D/volume task through the synchronous channel — that is the $50 failure by construction.

### 6. Cost is a measured method, not a quoted number.

The cost model (backing doc §6) is an estimation _method_. We have **zero metered datapoints**; the figures in the repo are hand-estimates. **No dollar figure other than published model rates may go in front of a client** until the measurement rollup (build item B6) produces a per-seat number from metered billing against real fixtures. The honest verdict on viability is **favorable but unproven**: the substrate supports the principle, and the task universe is dominated by the gracefully-degrading extraction/classification/draft class — but "favorable" is a design bias, not a measured P&L.

## What this commits us to

- **New skills carry an `execution_class`**, and a merge-gate lint (build item **B5**) enforces the right strategy per class — so the next skill cannot be authored as the $50 loop.
- **The prioritized build backlog lives in the framework doc §8** and is recorded here, **not yet scheduled**. A detailed design review precedes any build:
  - **B0** — propagate taint into `delegate_task` children (P0; a _verified_ governance hole — the taint gate keys on `session_id` and a delegated child runs under a fresh, never-tainted session, so it could read untrusted content and then autonomously send/destroy/execute). Fixed first; blocks B2.
  - **B1** — durable async runner that completes a multi-step job and delivers a retrievable result (the actual "unattended employee" capability; `operator_handoff_task` is wired but dead-ends because no `handoff` route is materialized).
  - **B2** — bulk mailbox processing in code (`execute_code` cannot reach the managed mailbox today; the receipt task is primarily _this_, not B1).
  - **B3** — confirm the sticky-stop cost cap is wired live in the dispatch path (no verified financial circuit-breaker on the live Machine today).
  - **B5** — encode the taxonomy in SKILL.md frontmatter + the author-time lint.
  - **B6** — the measurement rollup that produces our first defensible client cost number.
- **Coordination.** The long-running-task workstream is a **subset** of this framework (B0 → B1 → B2), not a parallel effort. This ADR + the backing doc are the **shared spec** both workstreams navigate by. Notably, the $50 receipt task is mostly a **B2 ("do it in code")** problem, not a **B1 ("survive a long job")** problem — done right it is fast and cheap, never long-running.

## Honesty banner — what is NOT yet true

1. The "unattended employee that delivers a retrievable result" claim is **blocked on the unbuilt durable runner (B1)**.
2. A **verified taint-gate bypass (B0)** sits inside the recommended bulk-data strategy and must be fixed before `delegate_task` touches untrusted data.
3. There is **no verified live cost circuit-breaker (B3)**.
4. We have **zero metered cost numbers (B6)**; no client quote is defensible until the rollup runs.

The framework's shape is sound; its gaps are named, not hidden.
