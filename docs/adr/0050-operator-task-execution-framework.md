---
title: Operator Task-Execution Framework — Task Taxonomy and Strategy Portfolio
date: 2026-06-18
status: accepted
captain: Scott Durgan
related-adr: 0037-operator-thesis.md, 0021-leverage-hermes-native-primitives.md, 0049-operator-model-selection.md, 0047-operator-scheduled-jobs-mechanism.md, 0045-mediated-connector-capability-broker.md, 0016-honcho-disposition.md, 0053-author-built-mcp-connectors-per-customer-installed.md, 0051-operator-durable-task-execution-substrate.md
---

# ADR 0050 — Operator Task-Execution Framework

**Status:** Accepted (Captain decision, 2026-06-18). The **task taxonomy and strategy portfolio are locked** as doctrine. The **prioritized build sequence** (§ "What this commits us to") is recorded but **pending a detailed design review** before any implementation begins. **Amended 2026-06-23** — acceptance discipline: rails are proven by a synthetic reference-job suite, not by their first real job. **Read § Amendment (2026-06-23) before the build list.**

## Amendment (2026-06-23) — Architecture is proven by a synthetic reference-job suite, not by its first real job

A review of how the build items are framed surfaced an over-fit risk identical to the one [ADR 0053](./0053-author-built-mcp-connectors-per-customer-installed.md) corrected for connectors: each item names its proof as a **specific job** — B1 = "multi-document review," B2 = "the receipt task," B3 = "the $50 runaway." A specific job standing in for rail acceptance is the same mistake 0053's pre-implementation design made (defining the connector platform in terms of Smokeball, its first instance). It conflates the **architecture** (the generic execution rails) with the **application** (a job that rides them), and it lets the next real job retro-shape the substrate to fit itself. The connector platform's discipline is adopted here, because the shape is the same.

1. **Generalize the lifecycle, not the vocabulary.** For connectors the general thing is `author → install → activate → govern → verify`; the tool vocabulary stays connector-native (`operator/connectors/README.md`). For task execution the general thing is the **execution rails** — durable runner (B1), bulk primitive (B2 + B0), cost breaker (B3), and the `execution_class` authority (B5); the **job vocabulary** (receipts, multi-doc review, pilot tasks) stays job-native and rides the rails. Adding job #N must be **declarative** — pick a class, ride the rail — never bespoke substrate wiring, exactly as adding connector #N is declarative.

2. **A synthetic `_reference` job suite is the architecture's own acceptance.** The connector platform is declared correct when `operator/connectors/_reference/` is green — a synthetic echo / record / `surprise` connector that proves every rail including fail-closed refusal, with **no vendor involved**. Task execution gains the same: a `_reference` job suite of synthetic jobs, one per rail, exercising the substrate deterministically with **no client data**:
   - a **duration** job (loops past the synchronous reply budget, checkpoints, is killed, resumes, delivers) — proves the B1 durable rail;
   - a **runaway** job (deliberately burns tokens) — proves the B3 breaker fires; the `surprise` analog;
   - a **bulk-N** job (N synthetic items reduced at O(1) main-context cost) — proves the B2 primitive;
   - a **taint-injection** job (untrusted content attempts autonomous send/exec through a delegated child) — proves the B0 child-taint refusal; the `surprise` analog for the taint rail.

   These belong in CI wherever a non-live substitute is faithful; the one-time live machine-restart acceptance ([ADR 0051](./0051-operator-durable-task-execution-substrate.md)) is the only part that must run on a real Machine. **The framework is complete as architecture when the rails + the B5 authority + the `_reference` suite are green — provable on a bare Machine with zero client data.**

3. **`execution_class` is the literal-map analog; the lint is the authority, the frontmatter is the oracle.** 0053's governance rule is that a connector cannot self-certify trust — the overlay's hand-authored action-class map is the authority and the connector manifest is only a conformance oracle checked against it (`operator/connectors/_sdk/operator_connector_sdk/conformance.py`); an unclassified tool fails closed to `REFUSED`. B5 is the same mechanism for tasks: the merge-gate lint is the authority, a skill's `execution_class` frontmatter is the declaration checked against it, and a skill cannot self-certify cheap-or-safe. This **promotes B5 from a P1 enforcement step to the keystone** — it is what makes job authoring declarative; without it the rails exist but nothing keeps job #N on them, and the $50 loop recurs by omission.

4. **Recurrence-prevention rule.** When completing a build item, ask the connector question — _"what proven rail does this ride?"_ — never _"what does this specific job need?"_ If a real job appears to need job-shaped substrate the `_reference` suite did not already cover, that is the over-fit alarm. Two legal responses: **generalize the gap into the rail and add a `_reference` job that proves it**, or recognize the work as **skill-authoring, not architecture**. There is no third path where receipt-specific or doc-review-specific machinery lands in the substrate.

**Effect on the build list (§ "What this commits us to"):** item **scope is unchanged**; the **acceptance criteria are re-pointed.** B1/B2/B3 are accepted against their synthetic `_reference` jobs (deterministic, CI where faithful); the real jobs (receipts, multi-doc review, the Ashton & Price pilot) are reclassified as **applications that produce evidence and business value, never the definition of a rail.** One build item is added:

- **B-ref** — the synthetic `_reference` job suite (duration / runaway / bulk-N / taint-injection), built alongside the rails as their acceptance harness. It is to the task-execution framework what `operator/connectors/_reference/` is to the connector platform, and it is a **prerequisite for calling any of B1/B2/B3 "done."**

**Unchanged:** the task taxonomy (§1–§4), the strategy portfolio (§5), and the cost-method honesty (§6) all stand as written. This amendment governs **how a build item is accepted** — against a synthetic rail exerciser, not its first real job — and **what B5 is for**: the governance authority that makes authoring declarative.

---

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
