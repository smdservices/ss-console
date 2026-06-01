---
title: Workforce Model — How Multiple Operators Relate, Delegate, and Stay Accountable
date: 2026-05-29
status: accepted
captain: Scott Durgan
related-adr: 0007-per-customer-machine-isolation.md, 0009-cross-machine-query-prohibition.md, 0011-multi-persona-per-customer.md, 0021-leverage-hermes-native-primitives.md, 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md
related-note: note_01KSS3TCTKWYVF6EZ04482X389, note_01KSTYSNC9CYPKYFJZ3TJ7F6RM
---

# ADR 0029 — Workforce Model

**Status:** Accepted as **direction** (Captain decision, 2026-05-29). This ADR locks the _principles_ that govern more-than-one Operator; the relationship/delegation _implementation_ is deferred to when the SKU sells past a single agent. The audit graded this function **SCHEMA ONLY** — the principles need to be settled now so that when the code lands it lands correctly, not retrofitted.

**Source:** ADR 0004's SKU sells across a range — "single agent → multiple → teams/groups" (thesis note `note_01KSS3TCTKWYVF6EZ04482X389`). v1 ships one persona (ADR 0011 caps `personas[]` at length 1). The 2026-05-29 audit found "zero inter-employee relationship/delegation code." That is correct and fine for v1 — but the _doctrine_ for the multi-employee end of the range is unwritten, which means the first multi-employee build would invent it ad hoc. This ADR prevents that.

---

## Context

"Workforce" is the harness function that governs what happens when a customer has more than one Operator, or one employee that fields a team of sub-agents. The questions are not engine questions — they are product guarantees that must hold no matter which runtime delegates the work:

- **What is the unit of an "employee"?** ADR 0011 establishes persona = Hermes profile. An employee may be one persona; a "team" is several. The workforce model needs a stable noun.
- **How does work move between employees?** Hermes provides `delegate_task` (ADR 0021) for compound workflows _within_ an agent. Inter-_employee_ handoff is a different relationship and needs its own rules.
- **Do the safety guarantees survive delegation?** ADR 0025's ceiling enforcement and "named human principal of record," and ADR 0026's config boundary, must hold _transitively_. A delegating employee must not be able to launder a privileged action through a sub-agent that has a looser ceiling.
- **What do employees share?** ADR 0007 isolates _customers_ (one Machine each) and ADR 0009 forbids cross-_customer_ data paths. Within one customer with several employees, memory-sharing is an open question with a security default to set.
- **Who governs the workforce?** The principal (ADR 0026 / control plane ADR 0030) governs the whole set, not each employee in isolation.

The harness membership test passes: every one of these guarantees would have to exist under any engine, so the workforce model is harness doctrine, not Hermes mechanics.

## Decision

The following **principles are locked now**; the implementation is deferred (see "What is deferred").

### 1. The employee is the unit; a workforce is a governed set of employees

An _employee_ is one or more personas presenting as a single accountable worker. A _workforce_ is the set of a customer's employees. Both live inside the customer's single isolation boundary (ADR 0007); the workforce is never a cross-customer construct (ADR 0009 is unaffected and unweakened).

### 2. Ceilings are transitive and monotonically non-increasing under delegation

A delegated sub-task inherits a ceiling **no higher** than the delegator's, and never above the applicable vertical floor (ADR 0025). Delegation can only narrow authority, never widen it. There is no path by which employee A, capped at `draft_for_review` for `EXTERNAL_SEND`, gets the action performed autonomously by delegating to employee B. The floor is computed over the whole delegation chain.

### 3. Accountability is preserved end-to-end

Every action, however many delegation hops deep, remains attributable to a named human principal of record (ADR 0025) and is recorded in the audit log with the full delegation chain. "The other agent did it" is never an accountability gap; the chain is always reconstructable.

### 4. Isolation-by-default _within_ a workforce

Employees within a customer do not share memory or credentials by default. Sharing (a shared memory pool, a shared connector token) is an explicit, principal-governed configuration act (ADR 0026), audited, and need-to-know. The default is least-privilege between employees, not a common pool. This keeps a compromised or misled employee from being a lateral path to everything the customer owns.

### 5. The principal governs the workforce as a whole

Roster changes (adding/retiring an employee), delegation grants, and cross-employee sharing are principal-authenticated config acts under ADR 0026, surfaced in the control plane (ADR 0030). The workforce has one human owner of record.

### 6. Inbound trust class travels across delegation

Per ADR 0027, content's trust class follows it; a delegated sub-task acting on `unknown_external` content is bound by the same trust-class-gated ceiling as the originating employee. Delegation does not launder untrusted provenance into trusted instruction.

## What is deferred (and why it is safe to defer)

- The relationship/delegation **code** (inter-employee handoff, shared-memory plumbing, roster management). Deferred because v1 ships one persona (ADR 0011); there is no multi-employee customer to serve yet. The principles above are the constraints that code must satisfy when it is built.
- The **org-shape vocabulary** (manager/report, peer/peer, specialist pool) — whether the product models hierarchy or a flat pool of specialists. Deferred to first real multi-employee engagement, where the customer's actual org will inform it rather than a guess.

This is a legitimate phase boundary (no multi-employee customer exists), not scope avoidance: the decision that _had_ to be made now — that safety guarantees are transitive and isolation is default-on — is made.

## Alternatives Considered

### A. Don't write this until multi-employee ships

**Rejected.** The transitivity and isolation-default decisions are cheap to state now and expensive to retrofit. If the first multi-employee build assumes shared memory and additive delegation (the path of least resistance), unwinding it after a customer relies on it is a breaking change to a safety property. Lock the principles before the code exists.

### B. Model the workforce as one mega-agent with many skills

**Rejected.** A single agent with the union of all skills and connectors has the union of all blast radius and no internal isolation — the opposite of decision 4. Distinct employees with least-privilege boundaries contain failure; one mega-agent concentrates it.

### C. Allow delegation to widen authority with principal pre-grant

**Rejected** for the same reason as ADR 0026 alternative C: a standing "B may exceed A" grant is exploitable via injection (ADR 0027) and breaks the monotonic-narrowing guarantee that makes delegation reasoning tractable.

## Consequences

**Positive.**

- The multi-employee end of the SKU has settled safety doctrine before any code, so the build will be correct-by-construction on the properties that are expensive to fix later.
- ADR 0025/0026/0027 guarantees are explicitly made transitive, closing the "delegate to launder" hole before it can exist.
- Isolation-by-default within a workforce extends the enterprise's isolation posture (ADRs 0007/0009) inward, consistently.

**Negative / accepted.**

- This ADR is deliberately thinner on implementation than its siblings, because the implementation is genuinely future work. It is a direction ADR by design; its job is to constrain, not to specify.
- Monotonic-narrowing delegation forecloses some convenient patterns (a low-trust employee asking a high-trust one to "just do it"). That foreclosure is the point.

## Verification

When multi-employee implementation begins, it is conformant iff:

1. A delegated action's effective ceiling is ≤ the delegator's and ≤ the vertical floor, across the full chain.
2. The audit log records the full delegation chain and a named principal for every action.
3. Employees within a customer share no memory/credentials absent an explicit, audited, principal-authored sharing config.
4. Roster/delegation/sharing changes are principal-authenticated config acts (ADR 0026) visible in the control plane (ADR 0030).
5. Trust class (ADR 0027) is preserved across delegation hops.

## References

- [ADR 0004 — Productized Operator offering](./0004-productized-operator-offering.md) (the single→team SKU range)
- [ADR 0007 — Per-customer Machine isolation](./0007-per-customer-machine-isolation.md) / [ADR 0009 — Cross-Machine query prohibition](./0009-cross-machine-query-prohibition.md) (the customer isolation boundary the workforce lives inside)
- [ADR 0011 — Multi-persona per customer](./0011-multi-persona-per-customer.md) (persona = profile; v1 capped at 1 — this ADR is the multi-employee direction)
- [ADR 0021 — Leverage Hermes native primitives](./0021-leverage-hermes-native-primitives.md) (`delegate_task` — intra-agent delegation primitive)
- [ADR 0025](./0025-autonomy-ceilings-configurable-exposure-vs-initiation.md) / [ADR 0026](./0026-config-surface-is-a-security-boundary.md) / [ADR 0027](./0027-inbound-trust-boundary.md) (the guarantees made transitive here)
- [ADR 0030 — The Control Plane](./0030-control-plane-human-principal-surface.md) (where workforce governance surfaces)
- Strategy notes: `note_01KSS3TCTKWYVF6EZ04482X389`, `note_01KSTYSNC9CYPKYFJZ3TJ7F6RM`
