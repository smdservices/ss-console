---
title: Operator Vertical Delivery Method — Build Through Vertical-One, Wedge-Deep, Reviewer-Gated Hardening, Shared-Core Template
date: 2026-06-03
status: accepted
captain: Scott Durgan
related-adr: 0004-productized-operator-offering.md, 0005-external-send-identity.md, 0006-capability-adapter-pattern.md, 0019-customer-yaml-to-profile-config-translation.md, 0022-vertical-pack-architecture.md, 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0035-no-imposed-entitlement-defaults.md, 0037-operator-thesis.md
related-issue: '#1206, #1166, #1194'
---

# ADR 0038 — Operator Vertical Delivery Method

**Status:** Accepted (Captain decision, 2026-06-03).

**Validation status.** The decision to _proceed_ on this method is accepted. The method itself is a **hypothesis** until vertical-1 (law) ships to a real client. It carries an explicit success metric and reversal triggers below, and should be revisited — not assumed settled — until law validates it.

**Purpose.** This ADR is the citable answer to _how we take an Operator vertical from "page exists" to "deliverable to a real client,"_ without repeating the prior failure where a "demo" sprawled into misguided infrastructure that was ultimately ripped out. The pack roadmap, the overlay build (`hermes-smd-overlay`), and per-vertical onboarding all derive from this method and should cite it.

## Context

The Operator pack program's marketing and spec layer is done: twelve live `/packs/<slug>` pages (surfaced from `/operator`), twelve manifests (`operator/verticals/<slug>/vertical.yaml`), twelve N=0 deliverability proofs, addon manifests, and the delivery-SOP + handoff templates. Per [ADR 0022](./0022-vertical-pack-architecture.md), that is most of a pack — but not the runnable part.

**None of the twelve is deliverable.** The runtime lives in `hermes-smd-overlay`, which today carries only the substrate (audit plugin, contracts, webhook gate, bootstrap). There are no per-vertical skill bodies and no `build:` adapters. A prospect can find a pack and start a conversation; they cannot yet be served by one.

The goal is narrow and revenue-shaped: make the **top three** verticals deliverable, one at a time, on a foundation that holds — not breadth across twelve. The hard constraint is the venture quality bar: build smart, think ahead to inform design, implement cleanly, learn as we go, **no corners** — and specifically, do not re-enact the demo sprawl. The defenses against that recurrence are structural and are written into the method below, not left to discipline.

## Non-goals

This ADR is **not**:

- a multi-vertical framework or template engine designed up front (that is how the prior demo metastasized — see "Template");
- a commitment to deliver all ~12 skills a vertical's spec declares (see "the wedge");
- a safety guarantee for non-send or irreversible actions (draft-for-review gating does not cover them — see "Hardening model");
- a substitute for a client's own legal/compliance review of what their Operator does.

## Decision — the method

### 1. Scope and order

The top three verticals, in **friction-ascending order**: **law → marketing → insurance.** Law rides Clio's MCP (no `build:` adapter, spine skills already exist). Marketing carries the lightest compliance boundary (no professional license). Insurance needs `build:ezlynx` — the largest integration lift — so it lands last, when the shared core is most mature. One vertical at a time, start to deliverable, before the next.

### 2. The unit of work is the wedge, and the wedge names a job

The build unit is the **wedge**: the core connective loop, roughly five to six of the spec's ~12 skills — not all twelve. The remaining skills are depth, added once the loop is real and a client wants them.

A wedge is not honest until it **names the concrete, end-to-end client job the loop completes unassisted**, and each deferred skill carries a one-line justification for why it is _off that job's critical path_. This keeps "deliverable" from quietly degrading into "demonstrable."

**Deliverable** means the wedge loop: boots on a per-customer Fly Machine ([ADR 0007](./0007-per-customer-machine-isolation.md)), **completes its named job unassisted**, passes its safety evals, and runs for a real client under draft-for-review gating ([ADR 0005](./0005-external-send-identity.md)).

### 3. The per-vertical motion (seven steps)

1. **Define the wedge** — its skills and its named job.
2. **Build skill bodies + fixtures** — canned inputs, including adversarial/boundary inputs.
3. **Harden logic and safety on fixtures, with evals — no infrastructure.** The skill earns the right to touch a system before any machine exists.
4. **Pull infra** — stand up the Machine, deploy skills, wire connectors. (First pass through, this _builds_ the platform layer; see §4.)
5. **Connect** via a vendor sandbox (preferred) or a contract-bounded stub (see "Disposable stand-ins").
6. **Harden the loop end-to-end in our environment** — it boots, connects, runs, and entitlement fail-closed holds. This step includes a mandatory **contract-conformance checkpoint**: at least one real vendor-sandbox (or one-time throwaway real-API) round-trip, diffed against the stub/fixtures' assumed behavior. Any divergence is a **Phase-1 defect**, not a Phase-2 "fit" issue. A real-vendor round-trip is a **precondition of "deliverable."**
7. **Ship to first client** — finish hardening _fit_ on real data in the client's environment, under reviewer gating and within the safety bounds in §5.

Infra is **pulled by need**, never pushed ahead of it — you never stand up a Machine for a skill still failing its fixture evals.

### 4. Infra built through vertical-one — mostly demand-pull, with one carve-out

The platform layer (Set 1) is built _through_ vertical-1, hardened against law's real skills rather than in the abstract.

- **Demand-pull (build minimal, swap later):** the skill→R2 deploy pipeline ([#1206](https://github.com/venturecrane/ss-console/issues/1206)) and customer-zero boot/wiring ([#1166](https://github.com/venturecrane/ss-console/issues/1166)). These are mechanical and replaceable; size them to vertical-1.
- **Carved out — NOT minimal-for-law:** the **entitlement/safety layer** ([#1194](https://github.com/venturecrane/ss-console/issues/1194)). It is the substrate the §5 safety argument rests on, and law (vendor-MCP, lightest action surface) exercises the _least_ of it. The entitlement model must therefore be designed against the **action-class taxonomy of all three top verticals** (send + irreversible-non-send + read-boundary) from the start. It may be _implemented_ incrementally, but the _model_ must not be sized to law alone. A future agent must not "simplify" the safety layer down to what law needs.

Everything beyond this floor — signed evidence packets ([#1171](https://github.com/venturecrane/ss-console/issues/1171)), the full entitlement breadth, the MS-Graph adapter ([#1055](https://github.com/venturecrane/ss-console/issues/1055)) — is deferred until a vertical demands it.

### 5. The hardening model — a principled split, with an honest safety claim

**Phase 1, our environment — correctness and safety on known inputs.** Fixtures + evals + (vendor sandbox | contract-stub), riding Hermes' native skill testing and the overlay's existing test infrastructure. We _use_ the substrate ([ADR 0015](./0015-hermes-fork-vs-upstream.md)); we do not build a hardening platform. Fixtures may model _logic_, but they are **not** sole evidence for connector-seam correctness (hence the §3.6 conformance checkpoint).

**Phase 2, the client's environment — fit and real edge cases.** This is the part the prior framing got wrong, and the correction is load-bearing:

> **Draft-for-review gating ([ADR 0005](./0005-external-send-identity.md)) covers outbound _sends_ only. It is not a blanket production-safety guarantee.**

It does **not** cover three residual risk classes:

- **(a) Read-side exposure** — before any draft exists, the agent has ingested real client data (matter files, PII, privileged content) into context, memory, and tool calls. A mis-scoped connector or skill can mis-store or exfiltrate it with zero send to review.
- **(b) Irreversible non-send actions** — record edits, deletions, `execute_code`, calendar/CRM mutations. None are outbound messages; none pass under the reviewer's eyes; several are irreversible.
- **(c) Reviewer fatigue / rubber-stamping** — the model's effectiveness decays with volume. "The reviewer is the hardening harness" is exactly the framing that produces a tired human approving draft #47.

Phase 2 is "safe in production" **only with** all of: (i) entitlement **fail-closed on every action class, not just send** — no irreversible non-send capability ships in a wedge without explicit per-capability authoring ([ADR 0025](./0025-autonomy-ceilings-configurable-exposure-vs-initiation.md), [ADR 0035](./0035-no-imposed-entitlement-defaults.md)); (ii) a defined **read-data boundary** (what the agent may ingest in a client env, and where memory persists it); (iii) a **reviewer-fatigue tripwire**. If a wedge needs a non-send or irreversible capability, it does not ship in Phase 2 until that capability is separately authored and gated. Within these bounds, the reviewer-gated client environment is a legitimate — and safe — place to finish hardening fit, and every approval or correction is a real-data test case that feeds the agent's memory.

### 6. Disposable stand-ins

Vendor sandbox first — Clio, Qualia, EZLynx and the like maintain developer environments; that is the disposable, real-fidelity system, maintained by the vendor, not us. A **contract-bounded stub** ([ADR 0006](./0006-capability-adapter-pattern.md) typed capability contract) is used **only where no sandbox exists**, scoped to the wedge's capabilities, and **deleted** when the sandbox or the client arrives. The typed contract is what caps the stub's surface — the discipline the prior demo lacked.

### 7. The template — shared core plus thin delta, earned by rule-of-three

A vertical is **not** a copy-paste clone (which drifts and decays, and reproduces the very outcome the template exists to prevent). It is a versioned **shared core** every vertical inherits — spine skills, capability-adapter contracts ([ADR 0006](./0006-capability-adapter-pattern.md)), the boundary/entitlement machinery, the eval+fixture harness, the `customer.yaml` schema ([ADR 0019](./0019-customer-yaml-to-profile-config-translation.md)), the deploy pipeline — plus a thin **per-vertical delta** (its non-spine skills, fixtures, connector bindings, boundary config, voice).

But the core is **earned, not designed up front.** Build law and marketing concretely; extract the shared core from the duplication you actually see at vertical-2; stabilize at vertical-3. Rule-of-three.

To keep "earn it later" from becoming "never converge," **extraction is a gate on vertical-2's deliverable, not an aspiration**: marketing is not shipped until each unit of law↔marketing duplication is either pulled into the core or explicitly logged as "intentionally not shared, because X."

There are **two clone operations**, both wanting a thin delta on a stable core: cloning a **new vertical** (rare, deliberate) and cloning a **new client within a vertical** (`customer.yaml` config + that client's credentials + Phase-2 hardening — _the revenue engine_).

### 8. Learning routing

Every lesson sorts into one of two layers: a **core** learning (a better reviewer-gate, a sharper eval shape, a connector-contract fix) lands in the shared core and reaches all verticals; a **vertical** learning lands in that vertical's delta. Asking "core or vertical?" each time is what keeps the system improving instead of accreting.

## Sprawl tripwires — stop if any of these appears

The demo recurrence is detected, not just feared. Stop and reassess if:

- a stub grows a database, persistent state, or a UI;
- a stub serves a capability the wedge does not touch;
- fixtures become code that _simulates behavior_ instead of supplying inputs;
- infra is stood up before the evals pass;
- the stub-vs-real-vendor diff (§3.6) is non-trivial → Phase-1 defect, re-harden;
- a human must manually bridge a step a deferred skill would have done → the wedge is mis-cut; re-scope, don't paper over;
- vertical-2 ships with un-triaged duplication against vertical-1 → template debt; convergence is overdue, not deferred.

## Success metric

Falsifiable, stated directionally (concrete thresholds get set once vertical-1 yields data, not invented now): vertical-1 (law) reaches a real client under reviewer gating; the §3.6 contract-conformance diff at connect is small (the seam model held); and the shared core extracted at vertical-2 absorbs most of vertical-3 without rework. If any of these fails badly, the **method** is wrong — not merely the execution.

## Reversal triggers — conditions that reopen this ADR

- The stub-to-real-vendor divergence is non-trivial on vertical-1 (the fixtures-first model under-fits reality).
- A deferred skill proves load-bearing at the first client (the wedge cut was wishful).
- Draft-for-review gating misses a harm in production — read-side, irreversible non-send, or fatigue (the §5 bounds were insufficient).
- Vertical-2 cannot extract a shared core (rule-of-three became rule-of-never).
- The entitlement model cannot express insurance's constraints (the §4 carve-out was still under-modeled).

## Consequences

- **Enables** repeatable delivery and a path to first revenue: once a vertical is a template, onboarding the next client in it is mostly config plus reviewer-gated Phase-2 hardening.
- **Accepts** that full hardening cannot happen alone — fit is finished in the client's environment, by design, within the §5 safety bounds. "We can only do so much on our own" is the design, not a compromise.
- **Defers** the broader infra vision, the addon packs (manifests exist; no skills/marketing yet), and the unbuilt registry verticals (`real-estate`, `manufacturing` — registered without specs).
- **Depends on** `hermes-smd-overlay`, where the skill bodies and `build:` adapters live; this ADR is the decision of record in `ss-console`, cited from the overlay.

## Quality bar

Captain's standard governs every step above: build smart, think ahead to inform design, implement cleanly, learn as we go, no corners. The method exists to serve that bar — not to add ceremony. Where the method and the bar ever conflict, the bar wins.
