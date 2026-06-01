---
title: GEPA Self-Evolution Disposition — SUPERSEDED, GEPA Not Present in Hermes Upstream
date: 2026-05-23
status: superseded
superseded-date: 2026-05-24
captain: Scott Durgan
supersedes: none
superseded-by: none
related-prd: docs/pm/operator/platform-prd.md §7.4, §7.5, §17.4
related-spec: docs/specs/operator/audit-log-immutability.md
related-issue: TBD (filed as follow-on to this ADR)
---

# ADR 0018 — GEPA Self-Evolution Disposition (SUPERSEDED)

**Status:** **Superseded 2026-05-24.** No replacement ADR; the subsystem this ADR proposed to disable does not exist in the Hermes upstream.

## Supersession note (2026-05-24)

This ADR was authored from a third-party blog summary ([Data Science Dojo overview](https://datasciencedojo.com/blog/hermes-agent-how-it-works-tutorial/)) that described "GEPA (Genetic Evolution of Prompt Architectures)" as a Hermes subsystem. Subsequent first-source verification against `NousResearch/hermes-agent@v2026.5.16` returned **zero matches** for any `gepa_*` module, class, function, or audit constant. The boot-time disable check the ADR specified (`verify_gepa_disabled` in `operator/adapter/boot_checks.py`) was structurally vacuous — it passed trivially because the modules it scanned for were never present in the codebase it scanned.

Verification commands run 2026-05-24:

```
gh api repos/NousResearch/hermes-agent/git/trees/main --jq '.tree[] | select(.path | test("gepa"; "i")) | .path'
# → no output

gh search code "gepa" --repo NousResearch/hermes-agent --limit 10
# → no matches in actual Hermes source; only false positives in unrelated identifiers
#   (CreateSandboxFromImageParams, messagePayload, etc.)
```

Whether GEPA represents a Nous Research research direction, a planned feature, or a misattribution in the blog post is undetermined and immaterial to our architecture: we do not need a defense against a subsystem that is not present.

## Disposition

The following artifacts are removed as part of the Hermes-alignment work (see locked build plan dated 2026-05-24):

- `operator/adapter/boot_checks.py` — entire module (GEPA was its only inhabitant per the module's own docstring)
- `operator/adapter/tests/test_boot_checks.py` — entire module
- `GEPA_AUDIT_ACTION_DISABLED_VERIFIED` constant in `operator/adapter/aie_adapter.py` and its `__all__` entry
- `GEPA_DISABLED_VERIFIED` value in `operator/adapter/audit_log.py`'s `ACCEPTED_ACTION_TYPES` set
- `GepaEnabledError`, `verify_gepa_disabled` imports/exports in `aie_adapter.py`

If, in the future, Nous Research ships an autonomous self-evolution subsystem under any name, the appropriate response is a fresh ADR grounded in first-source verification of the actual subsystem's hooks, behaviors, and write paths — not a revival of this one.

---

## Historical content (preserved for provenance)

The remainder of this file is the original ADR text as authored 2026-05-23. It is preserved unchanged so future readers can see what was decided, on what evidence, and why it no longer holds. **Do not act on the original text below.**

---

**Original status:** Accepted (Captain decision, 2026-05-23).

**Original source:** Captain prompt 2026-05-23 — third installment in the Hermes-Agent-overview evaluation pass that produced [ADR 0016](./0016-honcho-disposition.md) (Honcho disposition) and [ADR 0017](./0017-skill-curator-disposition.md) (Skill Curator disposition). The [Data Science Dojo overview](https://datasciencedojo.com/blog/hermes-agent-how-it-works-tutorial/) describes GEPA (Genetic Evolution of Prompt Architectures) as a Hermes subsystem that "applies constraint gates: tests, size limits, benchmark thresholds [to] prevent autonomous PR generation from degrading performance" and that "reads execution traces for root-cause analysis rather than blind optimization."

This ADR pins our overlay's posture toward GEPA before the first customer Machine ships. Pairs with [ADR 0015](./0015-hermes-fork-vs-upstream.md), [ADR 0016](./0016-honcho-disposition.md), [ADR 0017](./0017-skill-curator-disposition.md), and [ADR 0009](./0009-cross-machine-query-prohibition.md).

---

## Context

GEPA differs from Honcho and the Skill Curator in three structural ways that change the disposition calculus:

1. **What it mutates is the most foundational artifact in the system.** Honcho infers persona preferences (downstream config). The Skill Curator suggests skill changes (executable behavior, but bounded per-skill). GEPA evolves _prompt architecture_ — the prompts that shape agent reasoning itself. A prompt-architecture change affects every skill, every output, every customer interaction the agent has.
2. **The value proposition is autonomous PR generation, not autonomous behavior change.** Honcho and the Curator both run silently and modify state inside the customer Machine. GEPA's design is to **emit PRs against the Hermes codebase itself**, gated by constraint checks (tests, size limits, benchmarks). The artifact GEPA produces is a code change to the agent runtime.
3. **The natural scope is cross-customer.** Prompt architecture is not a per-customer concern — it lives at the fork level (`venturecrane/hermes-agent` per [ADR 0015](./0015-hermes-fork-vs-upstream.md)) and applies to every customer Machine pinning that fork ref. A per-customer prompt-arch change is conceptually incoherent; a cross-customer prompt-arch change violates [ADR 0009](./0009-cross-machine-query-prohibition.md) if it's driven by trace data from inside customer Machines.

For Honcho and the Curator, observer-only mode (proposer to a per-customer D1 table, promoted via Captain review) was the right answer because both subsystems produce per-customer-scoped observations that flow naturally into a per-customer review surface (the calibration session, [#867](https://github.com/venturecrane/ss-console/issues/867)).

GEPA has no equivalent surface. Where would a "draft prompt-architecture change" go for review? Not the calibration session — that's per-customer; prompt architecture is platform-team. Not a `customer.yaml` PR — that's per-customer config. Not a `crane-console/.agents/skills/` PR — that's the skill catalog. The natural review surface would be the Hermes fork itself, which already has its own Captain-managed rebase and PR cadence (per [ADR 0015](./0015-hermes-fork-vs-upstream.md) §_Decision_).

The architectural question this ADR resolves is: **what does our overlay do with GEPA — observer-only like Honcho/Curator, disable entirely, or something else?**

Three patterns were considered.

### Pattern A: Keep GEPA enabled as upstream ships it

Let GEPA observe execution traces, run constraint-gated analyses, and emit PRs against the agent codebase autonomously.

Cost: every commitment violated, and several new ones too. The PRs would be against — what, the SMD fork? Upstream Hermes? Per [ADR 0015](./0015-hermes-fork-vs-upstream.md), our fork's content is Captain-managed and rebase-coordinated; autonomous PRs would conflict with that discipline. Per [ADR 0009](./0009-cross-machine-query-prohibition.md), GEPA in customer A's Machine cannot legitimately learn from customer B's traces; per-customer-only optimization signal is too narrow to drive prompt-arch evolution defensibly.

Strategic risk: structurally incoherent for our deployment shape. There is no version of "autonomous PR against the agent codebase" that fits our isolation boundaries and our Hermes fork governance.

### Pattern B: Observer-only (analogous to ADR 0016 / ADR 0017)

GEPA observes traces. The overlay intercepts PR-generation paths and redirects "prompt-arch change suggestions" into a per-customer D1 table for review.

Cost: real overlay work for value we cannot land. Even if we capture per-customer prompt-arch suggestions, we have no surface to act on them. The Captain reviewing a per-customer "make this prompt-arch tweak" suggestion would be: (a) unable to apply it without breaking [ADR 0015](./0015-hermes-fork-vs-upstream.md)'s fork governance, (b) reviewing trace evidence that is necessarily one-customer-narrow, and (c) effectively translating per-customer signal into a fork-level change without any cross-customer validation.

Strategic risk: process theater. We'd be reviewing suggestions we cannot reasonably act on, in a surface we'd have to design and maintain, for a value we can't realize until cross-customer analytical tooling exists outside the per-customer isolation boundary.

### Pattern C: Disable GEPA in customer Machines; defer platform-level trace analysis

Disable GEPA in the SMD overlay. Customer Machines do not run prompt-architecture evolution, do not analyze traces for prompt-arch root-cause, do not emit prompt-arch PRs. Period.

Prompt architecture lives at the Hermes fork level and evolves through the Captain-managed rebase cadence and explicit, deliberate human edits per [ADR 0015](./0015-hermes-fork-vs-upstream.md).

If, at some future point, the platform team identifies a real need for systematic trace-based prompt-architecture analysis, that need is met through a **platform-level analytical surface** — a separate tool, running outside customer Machines, against deliberately-aggregated and anonymized trace data, with explicit human review. That tool's design and the question of whether to use GEPA-as-a-library for it are a separate decision, deferred to whenever the need actually materializes.

Cost: forfeit upstream GEPA's value entirely. We do not capture its trace-analysis primitive.

Strategic posture: aligned with the deployment shape. The per-customer Machine remains a deterministic, content-hash-pinned execution surface; prompt-arch evolution happens at the fork level under Captain control; cross-customer analytical work happens deliberately and outside the per-customer isolation boundary.

---

## Decision

**GEPA is disabled in the SMD overlay. Customer Machines do not run GEPA. The disposition is Pattern C above.**

Concretely:

### 1. The overlay disables GEPA at Machine boot

The SMD overlay's Machine-boot sequence verifies that GEPA's subsystems are not active:

- GEPA's trace-analysis loop is not started.
- GEPA's constraint-gate checking is not active (it would be a no-op anyway, since no PR generation is occurring).
- GEPA's PR-generation path is blocked at the function-call level, defensively, in case some upstream change wires it to a different entrypoint than the analysis loop.

Machine boot fails if the disable-verification check fails. This is the same shape as the Honcho interceptor's boot check ([ADR 0016](./0016-honcho-disposition.md) §_Verification_ point 2) and the Curator interceptor's boot check ([ADR 0017](./0017-skill-curator-disposition.md) §_Verification_ point 2), but stricter: there is no allowlisted write path, because there is no observer-mode equivalent.

### 2. No prompt-architecture mutation occurs inside customer Machines

The prompt architecture is loaded from the content-hash-pinned Hermes deploy ([ADR 0007](./0007-per-customer-machine-isolation.md)) and is immutable for the lifetime of that Machine pin. This is the same constraint [ADR 0017](./0017-skill-curator-disposition.md) §2 puts on the skill set, applied to the prompt architecture.

Prompt-architecture changes happen exclusively through:

- Captain-managed selection of the pinned upstream Hermes release (`hermes_ref`) per [ADR 0024](./0024-hermes-consumption-and-update-cadence.md).
- The Hermes blessed-version promotion cadence per [ADR 0024](./0024-hermes-consumption-and-update-cadence.md) (continuous tracking, deliberate promotion — not the retired quarterly-rebase model).
- Customer Machine re-pinning, which is a Captain-controlled re-deploy per [ADR 0007](./0007-per-customer-machine-isolation.md) and [ADR 0024](./0024-hermes-consumption-and-update-cadence.md).

There is no autonomous path between trace observation and prompt-architecture change. The link is deliberately broken.

### 3. No `prompt_arch_observations` table, no `prompt_arch_drafts` table

Unlike Honcho (`persona_observations`, [ADR 0016](./0016-honcho-disposition.md) §1) and the Curator (`skill_drafts`, [ADR 0017](./0017-skill-curator-disposition.md) §1), GEPA gets no D1 table for observations. The disposition is disable, not constrain. There is no observer-mode flow to support and no review surface to feed.

This is deliberate. Building a `prompt_arch_drafts` table without a defensible promotion flow would be exactly the process theater that Pattern B was rejected for.

### 4. Audit-log records the disable verification

Machine boot emits an audit-log row with `action_class = gepa_disabled_verified` confirming the boot-time disable check passed. This gives the audit corpus ([#892](https://github.com/venturecrane/ss-console/issues/892)) explicit evidence that the disable discipline is being applied — not just that no GEPA activity occurred (which is the default-on assumption upstream would otherwise satisfy passively).

If the disable verification ever fails on a Machine boot, the audit-log row records the failure mode, the Machine halts, and Captain is alerted via the existing sticky-stop escalation path ([#843](https://github.com/venturecrane/ss-console/issues/843)).

### 5. Platform-level trace-based analytical tooling is a deferred separate decision

If the platform team later identifies a real, specific need for systematic execution-trace analysis at the prompt-architecture level (e.g., "we keep seeing the same class of skill failure across customers; we need to analyze the underlying prompt-arch pattern"), that need is met through tooling that:

- Runs outside customer Machines.
- Operates on deliberately-aggregated and anonymized trace data exported through the audit-log pipeline ([#892](https://github.com/venturecrane/ss-console/issues/892)), with Captain-approved aggregation rules.
- Produces analysis output for human review, not autonomous PRs.
- May or may not use GEPA-as-a-library depending on the specific need.

The design of that tooling, and the decision to build it at all, is a separate ADR filed when the need is concrete. **This ADR explicitly does not pre-decide that question.** What it does decide is that the tooling does not live inside customer Machines and does not autonomously emit PRs against the agent codebase.

The platform-team analytical surface for cross-customer prompt-arch work is the same shape as the platform-team analytical surface for cross-customer skill-pattern work ([ADR 0017](./0017-skill-curator-disposition.md) §_Consequences_, "Cross-customer pattern discovery is a manual platform-team analytical task"). Both are deliberately outside the per-customer isolation boundary.

---

## Alternatives Considered

### Pattern A (keep GEPA enabled): ruled out

Reason for rejection: structurally incoherent with [ADR 0015](./0015-hermes-fork-vs-upstream.md) (Hermes fork governance) and [ADR 0009](./0009-cross-machine-query-prohibition.md) (cross-Machine query prohibition). Autonomous PR generation has no legitimate target repository in our deployment shape, and per-customer optimization signal is too narrow to drive fork-level changes defensibly.

### Pattern B (observer-only, like ADR 0016 / ADR 0017): ruled out

Reason for rejection: process theater. The observer-only pattern works for Honcho and the Curator because each has a natural per-customer review surface (calibration session) and a natural promotion path (`customer.yaml` PR for Honcho; `crane-console/.agents/skills/` PR for the Curator). GEPA has neither. Building a `prompt_arch_observations` table and a review UI would create the appearance of disciplined review for output we cannot legitimately act on.

Reconsider only if a future Captain decision identifies a defensible per-customer prompt-arch review path that does not conflict with [ADR 0015](./0015-hermes-fork-vs-upstream.md) fork governance. None is currently visible.

### Custom trace-analysis pipeline (running inside customer Machines): ruled out

Reason for rejection: same structural problem as Pattern A and B. Whatever the implementation, trace analysis inside a customer Machine is either single-customer-narrow (low signal) or cross-customer (forbidden by [ADR 0009](./0009-cross-machine-query-prohibition.md)). The right place for trace analysis is outside the customer Machine.

### Keep GEPA enabled but block PR generation only (allow constraint-gate analysis): ruled out

Reason for rejection: confused middle ground. GEPA's constraint-gate analysis exists to gate PR generation; with PR generation blocked, the gate analysis is decorative work consuming Machine compute for no realized output. Cleaner to disable the whole subsystem.

### Defer this decision until customer #1 ships: ruled out

Reason for rejection: a default-on subsystem that mutates prompt architecture is exactly the class of thing that needs an explicit decision _before_ the first Machine boots, not after. The boot-time disable check (§1) is the structural guarantee that makes this decision real; the guarantee has to exist in the overlay before any customer Machine pins a fork ref.

---

## Consequences

**Positive.**

- Customer Machines remain deterministic. The prompt architecture for a given Machine pin is exactly what `venturecrane/hermes-agent` contains at that pin — no autonomous evolution, no surprise mutation, no per-Machine drift.
- The [ADR 0015](./0015-hermes-fork-vs-upstream.md) fork governance discipline is preserved. Prompt-architecture changes happen through the Captain-managed rebase cadence, not through autonomous PRs whose review burden would shift to a tooling we haven't decided to build.
- [ADR 0009](./0009-cross-machine-query-prohibition.md) is preserved structurally. There is no per-customer subsystem that has a legitimate reason to want cross-customer trace data; the question doesn't even arise inside customer Machines.
- The boot-time disable check (§1) provides explicit, audited evidence that the disable discipline is being applied. This is stronger than relying on upstream's defaults — if upstream ever changes GEPA's default-on state, the boot check still fires.
- The decision does not foreclose future trace-analysis tooling. It scopes that tooling out of customer Machines, which is the only structural decision needed now.

**Negative / accepted.**

- We forfeit GEPA's trace-analysis primitive entirely in the Phase 1 product. If future work confirms that systematic prompt-arch analysis is high-leverage, we will build it from scratch (or adopt GEPA-as-a-library) in a platform-level tool. The forfeit is real but recoverable.
- One more interceptor-equivalent (the boot-time disable check) to maintain across upstream rebases. Smaller surface than the Honcho or Curator interceptors because there is no observation-redirection path — just a verification that subsystems are not active. Bounded.
- If upstream restructures GEPA significantly between releases (e.g., merges it deeper into the agent loop, or re-exposes it through a new entrypoint), the disable-verification check may need updating. This is the same maintenance shape as the Honcho and Curator interceptors and is handled by the same Hermes version-promotion agenda item ([ADR 0024](./0024-hermes-consumption-and-update-cadence.md)).

**Out of scope.**

- The design of any future platform-level trace-analysis tooling. Explicitly deferred per §5.
- Whether to use GEPA-as-a-library in that future tooling. Open question for whoever builds it, when they build it.
- The threshold of trace-analysis signal at which the platform-level tooling becomes worth building. Will be obvious from operational experience; not worth predicting now.
- Specific upstream Hermes entrypoints GEPA exposes today. Implementation detail for the boot-time disable check; documented in the follow-on issue.

---

## Verification

How we know we are following this decision:

1. **The overlay's GEPA-disable check runs at Machine boot.** Boot-time check confirms GEPA's trace-analysis loop, constraint-gate checking, and PR-generation path are all inactive. Failure halts Machine boot.
2. **No `prompt_arch_observations` or `prompt_arch_drafts` table exists in the per-customer D1 migration suite.** Grep-level CI assertion: no migration creates such a table; no code path references one.
3. **The audit log contains `gepa_disabled_verified` rows for every Machine boot.** Audit-log integrity check ([#892](https://github.com/venturecrane/ss-console/issues/892)) verifies the action class appears at expected rates (one per boot, per Machine).
4. **No code path in a customer Machine mutates the loaded prompt architecture after boot.** Grep-level CI assertion across the per-customer Machine runtime: prompt-arch mutation operations are blocked outside the (intercepted-and-no-op) GEPA path.
5. **No PR against the Hermes overlay or upstream has been authored by an automated process running inside a customer Machine.** Spot-check during Hermes version-promotion review ([ADR 0024](./0024-hermes-consumption-and-update-cadence.md)): PR authors on `venturecrane/hermes-smd-overlay` (and any upstream contribution) are exclusively human — Captain or platform-team identities — never customer-Machine service accounts.

Guards against drift:

- The disable-verification check completeness is a Hermes version-promotion agenda item ([ADR 0024](./0024-hermes-consumption-and-update-cadence.md)) alongside the Honcho and Curator interceptors ([ADR 0016](./0016-honcho-disposition.md) §_Verification_, [ADR 0017](./0017-skill-curator-disposition.md) §_Verification_). Every promotion of a new pinned Hermes release explicitly re-verifies that GEPA is disabled in the candidate base image.
- The "no `prompt_arch_observations` table" CI assertion is wired into the merge gate. A PR that introduces a prompt-arch-observation D1 table without a superseding ADR fails CI.
- The audit-log `gepa_disabled_verified` action class is monitored. A sustained absence of these rows across active customer Machines is a signal that boot-time verification has been disabled or skipped; triggers Captain review.
- If a future Captain decision authorizes a platform-level trace-analysis tool, this ADR is not amended — that tool is governed by its own ADR, scoped outside customer Machines per §5.

---

## References

- [Hermes Agent technical overview](https://datasciencedojo.com/blog/hermes-agent-how-it-works-tutorial/) (Data Science Dojo, Feb 2026) — GEPA subsystem description (genetic prompt-architecture evolution, constraint gates, autonomous PR generation, trace-based root-cause analysis)
- Platform PRD §7.4 (skill loading and pinning, content-hash SHA), §7.5 (safety substrate, eight base invariants), §17.4 (audit and compliance targets)
- [ADR 0007 Per-customer Machine isolation](./0007-per-customer-machine-isolation.md) (content-hash pinning that makes prompt-arch immutable per Machine pin)
- [ADR 0009 Cross-Machine query prohibition](./0009-cross-machine-query-prohibition.md) (the boundary that makes cross-customer trace analysis structurally illegal inside customer Machines)
- [ADR 0015 Hermes fork vs upstream-PR](./0015-hermes-fork-vs-upstream.md) (the fork governance discipline this ADR preserves)
- [ADR 0016 Honcho disposition](./0016-honcho-disposition.md) (sibling proposer-only pattern; structurally different because Honcho has a per-customer review surface and GEPA does not)
- [ADR 0017 Skill Curator disposition](./0017-skill-curator-disposition.md) (sibling observer-only pattern; same structural-difference argument applies)
- [Audit-log immutability spec](../specs/operator/audit-log-immutability.md) ([#892](https://github.com/venturecrane/ss-console/issues/892)) — `gepa_disabled_verified` action class
- [Sticky-stop spec](../specs/operator/sticky-stop.md) ([#843](https://github.com/venturecrane/ss-console/issues/843)) — escalation path for disable-verification failure

---

## Immediate follow-on issues

Named here so the decision lands with executable next steps. Each is a separate GitHub issue, not implemented in this ADR's PR.

1. **Implement GEPA boot-time disable verification in the SMD overlay.** Verifies trace-analysis loop, constraint-gate checking, and PR-generation path are all inactive. Halts Machine boot on failure. Emits `gepa_disabled_verified` audit-log row on success.
2. **Add `gepa_disabled_verified` action class to audit-log immutability spec ([#892](https://github.com/venturecrane/ss-console/issues/892))** and to the audit-log integrity check.
3. **Wire sticky-stop ([#843](https://github.com/venturecrane/ss-console/issues/843)) to GEPA disable-verification failure.** Failed boot escalates via the existing alert path.
4. **Quarterly Hermes-rebase agenda item:** re-verify GEPA disable-verification check completeness alongside the Honcho ([ADR 0016](./0016-honcho-disposition.md)) and Curator ([ADR 0017](./0017-skill-curator-disposition.md)) interceptor checks. Specifically: confirm no new GEPA entrypoints are exposed post-rebase that the disable check would miss.
5. **Document the "platform-level trace-analysis tooling is deferred" position** in the platform-team runbooks so that the open question is visible and gets a real decision the next time someone proposes building trace-analysis tooling inside a customer Machine.
