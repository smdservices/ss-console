---
title: Cross-Machine Query Prohibition — No Customer's Hermes Machine Can Query Another Customer's Data
date: 2026-05-20
status: accepted
captain: Scott Durgan
supersedes: none
related-issue: https://github.com/venturecrane/ss-console/issues/828
---

# ADR 0009 — Cross-Machine Query Prohibition

**Status:** Accepted (Captain decision; embedded in the Operator PRDs since first draft; recorded here as a standalone ADR per [#828](https://github.com/venturecrane/ss-console/issues/828)).

**Source:** The safety-substrate cross-customer isolation invariant (#7) and the zero-cross-customer-incidents target. Pairs with [ADR 0007](./0007-per-customer-machine-isolation.md) (deployment-level isolation) and [ADR 0008](./0008-customer-owned-memory-artifact.md) (data-ownership posture).

---

## Context

Per [ADR 0007](./0007-per-customer-machine-isolation.md), each customer runs on a dedicated Fly.io Machine with dedicated storage bindings. The deployment topology makes cross-customer access architecturally impossible at the network and storage layer.

This ADR addresses the corollary at the runtime layer: even within a single customer's Machine, the runtime must be incapable of querying another customer's data, and the platform's mechanisms for sharing improvements across customers must not constitute runtime data propagation.

Two attack surfaces motivate this ADR:

1. **Misconfigured bindings.** A provisioning bug accidentally attaches Customer B's storage to Customer A's Machine. The Machine has the bindings; nothing else prevents it from reading them. The runtime needs an active check that refuses to operate when bindings violate the isolation rule.

2. **Shared-catalog leakage.** SMD's skill catalog is shared across customers (the universal primitives + cross-cutting skills + specialized skills + practice-area overlays). If the catalog contained learned patterns that incorporated one customer's substantive content, those patterns would propagate to other customers via the catalog's re-pin mechanism. This is a different shape of cross-customer leakage that the deployment-isolation ADR alone does not prevent.

Three patterns were available:

1. **Trust the deployment topology.** Per-Machine deployment makes cross-customer access impossible; no further runtime checks needed.
2. **Application-level scoping.** The runtime applies tenant-scoping logic to every query; correctness depends on the application code.
3. **Boot-time invariant + content review gate.** The runtime verifies its bindings at boot and refuses to start if bindings include other customers' namespaces. Separately, all platform-level catalog merges are SMD-curated, source-controlled, and reviewed against a "no customer-specific content" rule. Both layers are required.

Pattern 1 is correct on a clean deployment but does not detect a provisioning bug. The provisioning bug failure mode is rare but the cost is unbounded; the correct posture is to have the runtime fail closed.

Pattern 2 places the guarantee in code, contradicting the architectural posture of ADR 0007.

Pattern 3 makes the prohibition a runtime invariant (deployment-level guarantees verified at boot) and a process invariant (catalog merges gated on human review). It pairs cleanly with the existing safety substrate.

## Decision

**The Hermes runtime enforces two cross-customer prohibitions:**

**1. Boot-time storage-binding check (Safety substrate invariant #7).** At Machine boot, the runtime enumerates its storage bindings (D1, R2, Vectorize) and verifies that every binding's namespace matches its own customer slug. Any binding outside the customer's namespace causes the Machine to refuse to start and the control plane to alert. This check runs before any skill loads, before any connector authenticates, before any memory reads.

**2. Shared-catalog merge gate.** Platform-level skill catalog entries, capability adapter implementations, prompt templates, and platform memory patterns are SMD-curated. They are authored as source code (or source-code-equivalent reviewable artifacts), reviewed by a human reviewer, and merged through standard PR controls. The merge gate explicitly checks: no customer-specific content (no customer slugs, no firm names, no client names, no matter identifiers, no substantive content from customer drafts). Runtime data from one customer's Machine does not propagate to the shared catalog; only human-authored generalizations propagate.

Together these rules enforce that **no customer's Hermes Machine reads, infers, or learns from another customer's data, by any mechanism, at any layer.**

The shared embeddings prohibition follows directly: there is no platform-level Vectorize index that aggregates customer content. Vectorize is per-customer. Embeddings learned from one customer's drafts are not visible to another customer's runtime.

## Consequences

**Positive.**

- The "0 cross-customer incidents" target (PRD §17.4) is backed by architectural and process guarantees, not code review alone.
- Customer-owned memory (ADR 0008) is reinforced. Voice samples, person-mappings, and corrections do not flow to other customers via any pathway.
- The CI merge gate catches the subtler failure mode of well-meaning but customer-specific platform patterns. Enforcement is mechanical, not human goodwill.
- Compliance counsel has a clean answer to "could the firm next door's data ever inform ours?" — no, by these two mechanisms. Both auditable.
- Composes with reviewer-as-sender (ADR 0005), per-customer Machine isolation (ADR 0007), and customer-owned memory (ADR 0008). Together they define the cross-customer perimeter.

**Negative / accepted.**

- Cross-customer learning is not available as a feature. The platform cannot ship "we learned across our customer base that the best demand-letter opening is X" — the data path does not exist. The alternative (any cross-customer data path) is the wrong trade.
- Platform improvements must be authored, not inferred. SMD writes platform-level patterns from human-readable insights (customer feedback, audit-log review with access controls, product research), never from runtime data propagation. Institutional learning rate is bounded by SMD's human throughput.
- Boot-time check adds single-digit milliseconds to cold-start. Acceptable.
- CI gate adds review friction for platform contributors. Acceptable; the failure case it prevents is existential.

**Out of scope.**

- Within-customer isolation across users (Principal, Operator, Compliance roles per PRD §11.6). The cross-customer prohibition does not address within-customer role separation; that is governed by the multi-user role model.
- Control-plane visibility. SMD's control plane has cross-customer audit-log visibility because that is its operational job (incident response, billing reconciliation, fleet health). The prohibition applies to customer runtime Machines, not to the SMD operational layer. The control plane is operated under SMD's own audit and access controls.
- Aggregate metrics. SMD may compute aggregate, anonymized metrics (e.g., "average voice gate pass-rate across customers") for product-level reporting. These are computed in the control plane from audit-log aggregates, never propagated back to customer runtime, and never include customer-identifying detail.

## Implementation

- Platform PRD §7.5 invariant #7 records the runtime check.
- Boot-time check lives in the Hermes container's startup sequence; the check's contract is part of the Hermes runtime pin (per PRD §7.4).
- CI merge gate is a GitHub Actions workflow gating PRs to `operator/skills/*`, `operator/capabilities/*`, `operator/connectors/*`, and any platform-level prompt templates. The workflow scans diffs for: customer-slug patterns, firm-name patterns, matter-identifier patterns, and substantive-content heuristics. False positives go to human review.
- Both mechanisms are exercised in the regression test suite per PRD §17.4 (synthetic-fixture-driven cross-customer adversarial tests).

## References

- Platform PRD §7.1 Multi-tenant model
- Platform PRD §7.5 Safety substrate (invariant #7)
- Platform PRD §17.4 (0 cross-customer incidents target)
- Platform PRD §10.5 Memory isolation
- [ADR 0007 Per-customer Machine isolation](./0007-per-customer-machine-isolation.md)
- [ADR 0008 Customer-owned memory artifact](./0008-customer-owned-memory-artifact.md)
- [Issue #828](https://github.com/venturecrane/ss-console/issues/828)
