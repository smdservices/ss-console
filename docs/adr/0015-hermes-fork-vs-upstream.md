---
title: Hermes Fork vs Upstream-PR. Thin Vendored Fork With Upstream Contribution, Not a Hard Fork and Not Upstream-Only
date: 2026-05-21
status: accepted
captain: Scott Durgan
supersedes: none
related-prd: docs/pm/ai-employee/platform-prd.md §7.1, §7.4, §7.5
related-issue: https://github.com/venturecrane/ss-console/issues/844
---

# ADR 0015. Hermes Fork vs Upstream-PR

**Status:** Accepted (Captain decision, 2026-05-21).

**Source:** Issue [#844](https://github.com/venturecrane/ss-console/issues/844) decision spike. PR [#829](https://github.com/venturecrane/ss-console/issues/829) "Hermes runtime status report" surfaced that the SMD `aie_adapter.py` `register()` stub references an upstream `agent/tool_router.py` seam that does not exist at `v2026.5.7`. Upstream ships `agent/tool_guardrails.py`, `agent/tool_executor.py`, `agent/tool_dispatch_helpers.py`, and `agent/tool_result_classification.py` instead. The integration question (paste the adapter against the real surface, fork to add a missing seam, or upstream a PR) blocks the Phase A.5 work that the productized AI Employee SKU ([ADR 0004](./0004-productized-ai-employee-offering.md)) is built on.

---

## Context

The Phase 1 productized AI Employee SKU runs the [Hermes agent runtime](https://github.com/NousResearch/hermes-agent) (MIT-licensed, maintained by Nous Research) as the per-customer Machine workload, pinned by content-hash SHA per customer (Platform PRD §7.4, [ADR 0007](./0007-per-customer-machine-isolation.md)). SMD does not own Hermes. SMD owns the persona system, the skill catalog, the capability-adapter layer ([ADR 0006](./0006-capability-adapter-pattern.md)), the customer-owned memory artifact ([ADR 0008](./0008-customer-owned-memory-artifact.md)), the cross-Machine query prohibition ([ADR 0009](./0009-cross-machine-query-prohibition.md)), and the trust-ceiling discipline.

Four upcoming work packages need integration seams in the Hermes runtime that may or may not exist in the upstream surface SMD inherits:

1. **Per-tool audit emission ([#842](https://github.com/venturecrane/ss-console/issues/842)).** Every tool dispatch must emit `timestamp, customer, skill, tool, action class, ceiling decision, outcome` to the per-customer D1 audit table at <5ms p99 overhead. Requires a dispatch-time emission point.
2. **Sticky-stop integration ([#843](https://github.com/venturecrane/ss-console/issues/843), closed and integrated SMD-side).** The state-machine implementation has already landed on main. A Hermes-side hook surface still helps the soft-stop and hard-stop transitions actually intercept dispatch.
3. **Capability-adapter dispatch ([ADR 0006](./0006-capability-adapter-pattern.md)).** Skills bind to abstract capability interfaces; vendor adapters implement them; `customer.yaml` wires them. The wiring happens at Machine boot through Hermes' adapter loader.
4. **Per-customer Machine isolation guarantees ([ADR 0007](./0007-per-customer-machine-isolation.md)).** Boot-time storage-binding verification, namespace pinning, and the runtime-side half of the cross-Machine query prohibition ([ADR 0009](./0009-cross-machine-query-prohibition.md)) need places to plug in.
5. **Trust-ceiling enforce/refuse decision points** (PRD §7.5 invariants #1, #2, #5; live work on main per [#864](https://github.com/venturecrane/ss-console/issues/864), [#948](https://github.com/venturecrane/ss-console/issues/948), [#953](https://github.com/venturecrane/ss-console/issues/953)). Tool calls must be intercepted, classified, and either allowed, draft-routed, or refused before execution. Requires a wrap point inside the tool dispatch loop.

The architectural question this ADR resolves is: **how does SMD get the integration seams it needs into Hermes, given that upstream ships a related but non-identical surface, and SMD has no merge authority?**

Three patterns were available.

### Pattern 1: Upstream-only, no fork

Track upstream `NousResearch/hermes-agent` at a pinned ref. For every seam SMD needs, file an upstream PR and wait. Use whatever extension surface upstream already exposes (the adapter loader, the guardrails module) for the parts that fit; defer everything else until merged.

Time-to-customer cost: each missing seam stalls Phase A.5 until upstream merges or until SMD invents a brittle workaround. Upstream activity is healthy (v0.14.0 shipped 2026-05-16, 9k+ commits on main, 5k+ PRs accepted historically), but PR merge latency for an external contributor on a project of this scale and visibility is a real coin-flip. The platform cannot ship its core safety substrate behind a coin-flip.

Maintenance cost: minimal, by design.

Strategic risk: SMD's product differentiators (reviewer-as-sender, trust-ceiling enforcement, per-customer Machine isolation, capability-adapter pattern, customer-owned memory artifact) end up partially-implemented in upstream and partially-implemented in SMD's overlay. The asymmetry (SMD needs upstream more than upstream needs SMD) means upstream's roadmap drives SMD's roadmap. That is the wrong dependency direction for a venture whose architectural distinctiveness IS the product.

### Pattern 2: Hard fork

Fork `NousResearch/hermes-agent` to `venturecrane/hermes-agent`. Pull upstream occasionally as a manual merge exercise. Make every change SMD needs without waiting on anyone.

Time-to-customer cost: zero blocking on upstream. SMD ships when SMD is ready.

Maintenance cost: high and growing. Every upstream change becomes a merge conflict to be resolved by SMD, including security patches and bug fixes SMD would have gotten for free. A project the size of Hermes (4.5k open issues, 5k+ PRs in flight, weekly release cadence) generates merge debt fast. The Hermes upstream is exactly the wrong shape to fork wholesale: too active to ignore, too large to track manually.

Strategic risk: divergence over time. The "Hermes" that customer Machines run becomes increasingly unrelated to the Hermes the broader community is building on. Upstream improvements (skill loader fixes, multi-persona support, new gateway integrations, performance work) require deliberate backporting. The "Hermes-leaning" Phase 1 posture ([ADR 0004](./0004-productized-ai-employee-offering.md)) was chosen specifically to inherit upstream's roadmap; a hard fork forfeits that inheritance.

Bus-factor risk: the SMD fork's maintenance burden lands on a single Captain. The pricing analysis for [ADR 0004](./0004-productized-ai-employee-offering.md) did not budget for ongoing runtime maintenance of an agent harness at this scale.

### Pattern 3: Thin vendored fork plus active upstream contribution

Maintain a small SMD fork (`venturecrane/hermes-agent`, MIT-licensed) that contains:

1. A pinned content-hash SHA tracking upstream main, rebased on a quarterly cadence (or sooner when a security patch lands).
2. A small overlay layer (`smd/` directory or sibling package, not modifications to upstream files where avoidable) implementing SMD-specific hooks: per-tool audit emission, sticky-stop dispatch interception, trust-ceiling enforce/refuse, capability-adapter registration, boot-time storage-binding verification.
3. Where the overlay layer is not sufficient and SMD must modify upstream files directly, the modifications are kept minimal, isolated to a small number of files, documented per change, and contributed back as upstream PRs.

The SMD adapter (`ai-employee/adapter/aie_adapter.py`) registers against whatever surface the fork exposes: ideally the upstream-merged seam once a PR lands, or the SMD overlay surface in the meantime. The adapter's `register()` semantics are stable; the underlying seam can migrate from overlay to upstream without changing the adapter contract.

Time-to-customer cost: zero blocking. SMD ships against the overlay surface immediately.

Maintenance cost: moderate. Upstream rebase happens on a known cadence with known scope (the overlay surface is small and isolated). Most upstream changes do not touch the files SMD has modified; merges are clean.

Strategic risk: bounded. SMD inherits upstream's roadmap by default, contributes upstream where the change is genuinely upstream-shaped, and keeps SMD-specific safety substrate work in the overlay layer where it does not require upstream cooperation. The two patterns SMD is most likely to want upstreamed (a generic tool-dispatch hook surface, a generic adapter-side audit emission point) are exactly the kind of changes Hermes' contribution model already accepts.

## Decision

**SMD maintains a thin vendored fork of `NousResearch/hermes-agent` at `venturecrane/hermes-agent`, with an SMD overlay layer for safety-substrate hooks, and contributes generic improvements back upstream as PRs.**

Concretely:

- The Hermes fork lives at `venturecrane/hermes-agent` (MIT-licensed, inheriting upstream's license).
- The fork tracks upstream main at a pinned content-hash SHA per customer (matching the per-customer-pin model in Platform PRD §7.4 and [ADR 0007](./0007-per-customer-machine-isolation.md)).
- Upstream rebase cadence: quarterly by default, immediately on any upstream security patch. The rebase is a tracked work item with a named owner per cycle.
- SMD-specific code lives in a clearly-separated overlay (`smd/` subpackage or sibling directory; exact layout decided in the follow-on implementation issue, not in this ADR). Modifications to upstream-owned files are kept to the minimum that the seam genuinely requires, and every such modification is filed as an upstream PR within one week of landing in the SMD fork.
- The SMD adapter (`ai-employee/adapter/aie_adapter.py`) registers against the fork's hook surface. The adapter contract is stable across upstream rebase and across overlay-to-upstream migration.
- `customer.yaml` pins the fork ref (existing `hermes_ref` field), not the upstream ref. The fork's tag scheme makes the upstream ref discoverable from the fork ref (e.g., `v2026.5.7-smd.1` derives from upstream `v2026.5.7`).
- Upstream contribution is a first-class activity. SMD-specific code that is genuinely generalizable (a tool-dispatch hook API, an adapter-side audit emission point) goes up as PRs. SMD-specific code that is genuinely SMD-specific (capability-adapter registration, customer.yaml wiring, per-customer Machine boot invariants) stays in the overlay.

This is the durable answer to the "fork or upstream" dichotomy: both, in proportion. The fork is the integration substrate; upstream contribution is the long-term maintenance lever.

## Alternatives Considered

### Upstream-only, no fork: ruled out

Reason for rejection: Phase A.5 cannot ship behind upstream PR merge latency. Trust-ceiling enforcement, sticky-stop dispatch hooks, and per-tool audit emission are the safety substrate the productized SKU is sold on; they cannot ship "when upstream gets around to it." Additionally, several SMD-specific hooks (capability-adapter registration, per-customer Machine boot invariants, customer.yaml wiring) are not upstream-shaped at all; upstream would correctly reject them as scope-creep. There is no version of this option where SMD ships in 2026.

### Hard fork: ruled out

Reason for rejection: the maintenance cost on a project Hermes' size is too high for a single-Captain venture to sustain. Quarterly upstream rebase on the thin-fork option is bounded scope; full-fork ongoing merge resolution against 9k+ commits of upstream activity is not. The hard fork also forfeits the inheritance of upstream's roadmap that the Phase 1 "Hermes-leaning" posture (ADR 0004) was explicitly chosen to capture. Reconsider only if upstream maintenance velocity collapses or upstream takes a strategic direction incompatible with SMD's product.

### Custom runtime (rebuild on Cloudflare Agents + Claude Agent SDK): ruled out for Phase 1

Reason for rejection: out of scope for this ADR. The "build vs. buy the harness" call was already made in [ADR 0004](./0004-productized-ai-employee-offering.md) and the stack evaluation. ADR 0015 is downstream of that decision and assumes Hermes as Phase 1 substrate. Phase 2 re-evaluation against CF-native rebuild is on the bench per the stack-evaluation criteria; nothing in this ADR forecloses that future migration.

### Fork inside `ss-console` monorepo: ruled out

Reason for rejection: Hermes is a separate Python package with its own test suite, release cadence, dependency surface, and license file. Vendoring it into `ss-console` (TypeScript / Astro / Cloudflare Workers) would conflate two codebases with no shared tooling and would make upstream rebase mechanically harder. The fork lives in its own repository (`venturecrane/hermes-agent`), referenced by `customer.yaml` ref and pinned per customer.

## Consequences

**Positive.**

- Phase A.5 is unblocked. Every safety-substrate hook the productized SKU depends on (per-tool audit emission, sticky-stop dispatch interception, trust-ceiling enforce/refuse, capability-adapter registration, boot-time storage-binding verification) can land in the overlay layer immediately, without waiting on upstream merge.
- Upstream inheritance is preserved. Rebase cadence is bounded and predictable; the overlay layer is small and isolated; most upstream improvements (skill loader fixes, multi-persona support, new gateway integrations) come in for free at the next rebase.
- The adapter contract is stable. `aie_adapter.register()` registers against the fork's hook surface, which can migrate from overlay to upstream-merged without changing what the adapter does. This means SMD can upstream successfully without breaking its own integration.
- Upstream contribution becomes a deliberate, durable activity. SMD ships features through the overlay, validates them against real customer load, and then proposes the genuinely-generalizable parts back to upstream from a position of working evidence rather than speculation. This is the contribution shape upstream maintainers actually accept.
- The decision composes cleanly with [ADR 0007](./0007-per-customer-machine-isolation.md) (per-customer Machine isolation): each customer's Machine pins a fork ref; rebasing the fork affects customers only on re-pin, which is a Captain-controlled re-deploy.

**Negative / accepted.**

- The SMD fork is a real maintenance commitment. Quarterly rebase, security-patch tracking, and overlay-layer code review all land on Captain (or future engineering). The cost is bounded but nonzero. We accept this as the price of avoiding the worse failure modes (blocked on upstream, or hard-fork divergence).
- The overlay layer requires discipline. Every modification to upstream-owned files is a future merge risk; the overlay should absorb as much as possible, and direct modifications should be minimized, documented, and contributed back. Sloppy overlay implementation (touching upstream files unnecessarily, or letting overlay grow to mirror upstream's scope) degrades the option toward hard-fork over time. The follow-on implementation issue must specify overlay structure precisely.
- The fork tag scheme adds a small amount of cognitive overhead. `customer.yaml` pins the fork ref; reading "current upstream ref" requires one indirection through the fork's tag scheme (e.g., `v2026.5.7-smd.1` → upstream `v2026.5.7`). The tag-scheme convention must be documented; the cost is paid once.
- Upstream-PR acceptance is not guaranteed. Some of the contributions SMD proposes will be rejected, accepted with modification, or accepted only after long review. The fork insulates SMD from this latency, but the long-term maintenance argument depends on contributions actually landing upstream over time. If upstream rejection rate is very high, the overlay-direct-modification surface grows, and the option degrades toward hard-fork. We accept this risk and gate against it at the quarterly re-evaluation.

**Out of scope.**

- Specific overlay structure. Whether the SMD-specific code lives in a `smd/` subpackage, a sibling repository imported as a dependency, or scattered as patch files is an implementation detail decided in the follow-on issue. The ADR locks the strategy (thin fork plus overlay plus upstream contribution); the layout follows.
- Specific upstream-PR roadmap. Which seams SMD upstreams first, in what order, with what cadence is decided by the platform team based on overlay maturity and upstream maintainer signals. The ADR locks that upstream contribution is a first-class activity; it does not enumerate the PR backlog.
- Phase 2 harness migration. If Hermes evolves in a direction incompatible with SMD's product (license change, abandonment, breaking architectural shift), the fork insulates SMD short-term and gives time to migrate. The migration target (CF Agents + Claude Agent SDK, Mastra, custom) is the Phase 2 question; this ADR is Phase 1.
- Hermes' own roadmap and contribution policies. Captured here only as inputs (active maintenance, MIT license, accepts external PRs). SMD does not control upstream and does not assume it will accept any specific contribution.

## Verification

How we know we are following this decision:

1. **The fork exists at `venturecrane/hermes-agent`** with a current upstream ref and a clear overlay layer. Quarterly rebase is a tracked work item.
2. **`customer.yaml` `hermes_ref` values point to fork tags**, not upstream tags. The customer-yaml validator (per [ADR 0012](./0012-customer-yaml-storage.md)) enforces the fork-tag pattern.
3. **The `aie_adapter.register()` implementation hooks into the fork's documented surface**, not into upstream-only files where avoidable. Overlay-versus-upstream-touched changes are tracked in the fork's CHANGELOG.
4. **Upstream PRs are filed for generalizable overlay code** within one week of the overlay change landing. Upstream PR state (open, merged, rejected) is tracked in the fork's README or equivalent.
5. **Quarterly re-evaluation** of upstream maintenance velocity, upstream PR acceptance rate, overlay size as a fraction of fork size, and rebase cost. If overlay size grows past 20% of fork size, or if upstream rejection rate exceeds 50% of filed PRs, the option is degrading; reconsider per the consequences above.

Guards against drift:

- The overlay layer's existence is a structural commitment, not a coding convention. If a PR adds SMD-specific logic to an upstream-owned file without a corresponding overlay-layer entry and a planned upstream PR, the change is rejected at review.
- Upstream rebase cadence is on the platform roadmap, not optional. Skipping rebase compounds merge cost geometrically.
- The fork is not allowed to add features upstream has not been asked about. If SMD wants a new gateway or a new memory backend or a new model provider, the first step is filing an upstream issue, not writing it in the fork.

## References

- [Hermes upstream repository](https://github.com/NousResearch/hermes-agent) (MIT-licensed, Nous Research, v0.14.0 released 2026-05-16, accepts external contributions)
- Platform PRD §7.1 (multi-tenant model, one Machine per customer), §7.4 (skill loading and pinning, content-hash SHA), §7.5 (safety substrate, eight base invariants), §17.4 (audit and compliance targets)
- [`docs/strategy/ai-employee-stack-evaluation-2026-05-13.md`](../strategy/ai-employee-stack-evaluation-2026-05-13.md) (Hermes selection, Phase 2 re-evaluation criteria, pluggable adapter posture)
- [ADR 0004 Productized AI Employee offering](./0004-productized-ai-employee-offering.md) (the SKU this ADR's substrate enables)
- [ADR 0006 Capability-adapter pattern](./0006-capability-adapter-pattern.md) (overlay hosts the capability-adapter registration)
- [ADR 0007 Per-customer Machine isolation](./0007-per-customer-machine-isolation.md) (overlay hosts boot-time storage-binding verification)
- [ADR 0009 Cross-Machine query prohibition](./0009-cross-machine-query-prohibition.md) (overlay hosts the runtime-side enforcement)
- [ADR 0012 customer.yaml storage](./0012-customer-yaml-storage.md) (`hermes_ref` validation expanded to fork-tag pattern)
- [Issue #844](https://github.com/venturecrane/ss-console/issues/844) (this decision spike)
- [Issue #829 / PR #829](https://github.com/venturecrane/ss-console/issues/829) (Hermes runtime status report, hook-surface discovery)
- [Issue #842](https://github.com/venturecrane/ss-console/issues/842) (per-tool audit emission, first overlay consumer)
- [Issue #843](https://github.com/venturecrane/ss-console/issues/843) (sticky-stop integration, second overlay consumer)

## Immediate follow-on issues

Named here so the decision lands with executable next steps. These are created as separate GitHub issues, not implemented in this ADR's PR.

1. **Create `venturecrane/hermes-agent` fork** with current upstream ref pinned, overlay layer scaffolded, CHANGELOG and tag-scheme convention documented in fork README.
2. **Update `customer.yaml` validator** to accept and enforce the fork-tag pattern (`v{upstream}-smd.{n}`) for the `hermes_ref` field.
3. **Implement overlay hook surface** for the four named consumers ([#842](https://github.com/venturecrane/ss-console/issues/842) audit emission, [#843](https://github.com/venturecrane/ss-console/issues/843) sticky-stop, trust-ceiling enforce/refuse, capability-adapter registration). One issue per consumer.
4. **Rewrite `aie_adapter.py` `register()`** against the overlay surface; remove the Phase A stub language.
5. **File first upstream PR** for the most clearly-generalizable seam (likely the tool-dispatch hook API). Track upstream review state.
6. **Schedule first quarterly rebase** on the platform roadmap.
