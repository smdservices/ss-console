---
title: The Control Plane — The Human Principal's Single Surface for Governing the Employee
date: 2026-05-29
status: accepted
captain: Scott Durgan
related-adr: 0016-honcho-disposition.md, 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0026-config-surface-is-a-security-boundary.md
related-issue: https://github.com/venturecrane/ss-console/issues/821
related-note: note_01KSS3TCTKWYVF6EZ04482X389, note_01KSTYSNC9CYPKYFJZ3TJ7F6RM
---

# ADR 0030 — The Control Plane

**Status:** Accepted (Captain decision, 2026-05-29). Names and unifies a harness stratum that exists in pieces.

**Source:** The harness has three strata (thesis note `note_01KSS3TCTKWYVF6EZ04482X389`): **Gates** (the action-path membrane — ADRs 0025/0027/0028), **Ledgers** (durable owned state — audit, memory, config), and the **Control Plane** (the human principal's surface for governing the employee). The first two have ADRs; the control plane has never been named as a thing, so its functions were built piecemeal and graded PARTIAL across the board in the 2026-05-29 audit. This ADR establishes it as a first-class stratum with one governing principle, so its remaining build is coherent rather than a pile of unrelated portal pages.

---

## Context

Everything the human principal does to _steer_ the employee — as opposed to the employee doing its work — happens through the control plane. The audit found the pieces built and disconnected:

- **Draft-for-review queue.** The `draft_queue` table exists (`ai-employee/migrations/0001_per_customer_schema.sql:94`) and the portal has send/teach endpoints (`src/pages/api/portal/ai-employee/drafts/[id]/send.ts`, `.../teach.ts`). The live bridge from the Hermes runtime that _populates_ the queue is pending on runtime scoping (#821). Graded PARTIAL.
- **Memory dismissal.** `persona_observations.dismissed_at` exists with an `active` generated column that physically excludes dismissed rows (`migrations/0007_persona_observations.sql:74,77`) — the schema embodiment of ADR 0016's "mirror, don't gate; dismissal triggers physical DELETE from Honcho." The dismissal UI and the Honcho-delete call are not wired. Graded PARTIAL.
- **Config governance.** The trust-ceiling change surface logs intent only (ADR 0026). Graded STUB.
- **Lifecycle / roster.** Provision / evolve / pause / decommission and (future) workforce roster (ADR 0029) are principal acts with no unified home.

These are not four unrelated features. They are the four ways a principal governs an employee: _review its output_, _correct its memory_, _set its authority_, _manage its existence_. Naming the stratum is what makes them one surface with one set of guarantees.

The harness membership test passes: a human principal needs a governing surface regardless of engine; the control plane is harness, not Hermes.

## Decision

**The control plane is the single, principal-authenticated surface through which a human governs the employee. Every state-changing act on it is authenticated to a principal and recorded in the immutable audit log. It exposes four functions — review, memory control, authority (config), and lifecycle — under one consistent set of guarantees.**

### 1. One surface, one owner of record

All four functions present to the human principal (ADR 0011's principal role) as one governing surface. Operators and other roles have scoped, lesser access; authority-changing acts are principal-only (consistent with ADRs 0026/0011).

### 2. Review: the draft queue is the human-in-the-loop realization

The draft-for-review queue is where `draft_for_review`-ceilinged output (ADR 0025) lands for human review, edit, and send (reviewer-as-sender default, ADR 0005). "Teach" feeds reviewer edits back as voice/behavior signal (ADR 0028 voice, ADR 0016 memory). When ADR 0025 configures an action class to autonomous, items of that class do not queue — but the queue remains the surface for everything still gated. The live populating bridge (#821) is the remaining build.

### 3. Memory control: mirror, don't gate — dismissal removes

Per ADR 0016, the principal sees mirrored conclusions and can dismiss them; dismissal is a **physical removal**, not a hidden flag — the `active` generated column already encodes this, and the Honcho-delete call must complete the loop so dismissed state is gone from the derivation engine too. The principal governs what the employee believes about their business.

### 4. Authority: config changes are governed acts

Trust-ceiling / exposure / initiation / sender-identity changes happen here and are privileged, persisted, audited, and floor-checked exactly as ADR 0026 specifies. The control plane is where the config security boundary is operated.

### 5. Lifecycle: provision / evolve / pause / decommission (and roster)

The principal can pause (immediately halt autonomous activity), evolve (config/skill changes), and decommission (per the fail-closed decommission work already shipped) an employee from one place. Workforce roster management (ADR 0029) surfaces here when multi-employee ships.

### 6. The control plane never widens authority on the agent's behalf

Nothing the agent does can drive a control-plane act. Proposals from the agent (a suggested ceiling raise, a memory it thinks matters) are presented _to_ the principal as data; the principal acts. This is the surface-level statement of the invariant shared by ADRs 0025/0026/0029.

## Alternatives Considered

### A. Leave the functions as independent portal pages, no unifying stratum

**Rejected.** Without the stratum named, each function reinvents its own auth, audit, and agent-cannot-self-act posture, and they drift. The audit's four PARTIAL/STUB grades are the symptom of exactly that. One stratum, one set of guarantees.

### B. Make the control plane an agent-accessible API (let the employee update its own state)

**Rejected.** A self-governing agent is a contradiction of the whole trust model. The control plane is _for the human_; the agent's only relationship to it is proposing items into it. (ADRs 0025/0026/0027/0029 all converge here.)

### C. Defer naming the stratum until the pieces are finished

**Rejected.** The pieces are PARTIAL precisely because there was no unifying frame; finishing them without one repeats the drift. Naming it now is what makes the remaining build coherent.

## Consequences

**Positive.**

- The four governing functions get one auth model, one audit guarantee, and one "agent cannot self-govern" invariant instead of four ad hoc implementations.
- The audit's scattered PARTIAL grades become a single coherent build target: wire the four functions onto the named stratum.
- The principal experiences governing the employee as one surface, which is also the trust story the SKU sells ("you never have to manage it — but when you want to steer it, here is the one place").

**Negative / accepted.**

- The draft-queue live bridge depends on #821 (Hermes runtime scoping) — a genuine external dependency, not deferral by preference.
- Honcho-delete on dismissal must be wired for ADR 0016's "physical removal" promise to be real end-to-end; until then dismissal is honest only at the mirror layer. This is called out as the specific remaining gap, not papered over.

## Verification

1. Review, memory control, config, and lifecycle present as one principal-authenticated surface with a shared audit guarantee.
2. Every state-changing control-plane act writes a principal-attributed entry to the immutable audit log.
3. Draft items populate from the live runtime (#821 bridge); send is reviewer-as-sender by default; teach feeds voice/memory.
4. Dismissing a memory physically removes it from both the mirror (`dismissed_at`/`active`) and Honcho.
5. No agent/tool/prompt code path performs a control-plane act; the agent can only propose items for the principal to act on.

## References

- [ADR 0005 — Reviewer-as-Sender](./0005-reviewer-as-sender.md) (draft review → send is the reviewer-as-sender realization)
- [ADR 0011 — Multi-persona per customer](./0011-multi-persona-per-customer.md) (principal role; principal-only authority acts)
- [ADR 0016 — Honcho disposition](./0016-honcho-disposition.md) (mirror, don't gate; dismissal = physical DELETE)
- [ADR 0025](./0025-autonomy-ceilings-configurable-exposure-vs-initiation.md) / [ADR 0026](./0026-config-surface-is-a-security-boundary.md) (the authority function operated here) / [ADR 0029](./0029-workforce-model-inter-employee-mediation.md) (roster surfaces here)
- `ai-employee/migrations/0001_per_customer_schema.sql` (`draft_queue`), `ai-employee/migrations/0007_persona_observations.sql` (`dismissed_at`/`active`)
- `src/pages/api/portal/ai-employee/drafts/[id]/send.ts`, `.../teach.ts` (review surface)
- [Issue #821](https://github.com/venturecrane/ss-console/issues/821) (Hermes runtime scoping → draft-queue populating bridge)
- Strategy notes: `note_01KSS3TCTKWYVF6EZ04482X389`, `note_01KSTYSNC9CYPKYFJZ3TJ7F6RM`
