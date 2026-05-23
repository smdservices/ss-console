---
title: Autonomous Skill Curator Disposition — Observer-Only, PR-Gated Promotion, Never Self-Promoting
date: 2026-05-23
status: accepted
captain: Scott Durgan
supersedes: none
related-prd: docs/pm/ai-employee/platform-prd.md §7.4, §7.5, §17.4
related-spec: docs/specs/ai-employee/calibration-session.md, docs/specs/ai-employee/audit-log-immutability.md
related-issue: TBD (filed as follow-on to this ADR)
---

# ADR 0017 — Autonomous Skill Curator Disposition

**Status:** Accepted (Captain decision, 2026-05-23).

**Source:** Captain prompt 2026-05-23 — continuation of the Hermes-Agent-overview evaluation pass that produced [ADR 0016](./0016-honcho-disposition.md). The [Data Science Dojo overview](https://datasciencedojo.com/blog/hermes-agent-how-it-works-tutorial/) describes Hermes upstream's skill subsystem as autonomously generating skills "after complex multi-step tasks," storing them as plain-text markdown with YAML frontmatter at `~/.hermes/skills/`, and running a "seven-day autonomous Curator process [that] grades skills on execution outcomes, consolidates overlapping definitions, and prunes underperformers."

This ADR pins our overlay's posture toward the autonomous Skill Curator before the first customer Machine ships. It pairs with [ADR 0015](./0015-hermes-fork-vs-upstream.md) (Hermes fork strategy), [ADR 0016](./0016-honcho-disposition.md) (Honcho disposition — proposer-only), and the established skill-governance model documented in `reference_agents_skills_source_of_truth.md`.

---

## Context

Hermes upstream treats skills as a living, self-evolving artifact set. The runtime generates skill candidates from execution traces, scores them on outcomes over a seven-day window, consolidates overlapping definitions, and prunes underperformers — all autonomously. For the upstream single-user local-deployment use case where the operator IS the developer and skill drift is self-experienced, this is a productivity feature.

For SMD's per-customer AI Employee, the same subsystem is structurally incompatible with three commitments already locked:

1. **Skill governance lives in crane-console, not in customer Machines.** Per `reference_agents_skills_source_of_truth.md` (memory pointer; issue [#573](https://github.com/venturecrane/ss-console/issues/573)), skills are gitignored in `ss-console` and source-of-truth-maintained in `crane-console/.agents/skills/`. Every skill change is a PR-reviewed artifact in a centralized repository. A subsystem that generates and mutates skills inside a per-customer Fly Machine bypasses this governance entirely.
2. **PRD §7.5 invariant #8 (fabrication discipline) and the calibration discipline ([calibration-session spec](../specs/ai-employee/calibration-session.md), [#867](https://github.com/venturecrane/ss-console/issues/867)).** Behavior change in a customer AI Employee is supposed to happen through Captain-supervised calibration, not through autonomous-and-silent skill evolution. A Curator that prunes "underperforming" skills based on execution outcomes is — from the partner's perspective — the system silently deciding what Marcus does and does not know how to do.
3. **The malpractice surface that justifies the entire safety substrate.** PI work is regulated by state bar rules and is signed under partner identity per [ADR 0005](./0005-reviewer-as-sender.md). A skill that auto-promotes itself into a customer's Marcus and then handles opposing counsel correspondence — or worse, an existing skill that the Curator prunes as "underperforming" because outcome signal is noisy — is not a productivity issue; it is a malpractice exposure. The reviewer-as-sender architecture means the partner is on the hook for whatever the AI Employee does. Autonomous skill mutation makes that liability uninsurable.

The architectural difference between this ADR and [ADR 0016](./0016-honcho-disposition.md) (Honcho) is meaningful: Honcho infers **preferences** that downstream become config changes. The Curator generates and mutates **executable behavior**. The bar for "promotion of an autonomous signal into runtime" should be even higher here than for Honcho, not lower.

The architectural question this ADR resolves is: **what does our overlay do with the Hermes upstream autonomous Skill Curator — keep it as upstream ships it, strip it, or constrain it?**

Four patterns were available.

### Pattern A: Keep the Curator as upstream ships it

Enable autonomous skill generation, scoring, consolidation, and pruning. Trust upstream's grading heuristic. Let each customer's Marcus evolve its own skill catalog.

Cost: every governance, fabrication-discipline, and malpractice failure mode enumerated above. A partner who notices "Marcus used to handle these intake calls and now he punts them" has no audit trail to explain what happened — the Curator decided.

Strategic risk: catastrophic and uninsurable. The first time a pruned skill produces a bad client outcome, the venture cannot defend the engineering posture. PI-firm sensitivity to this is higher than for any other class of inferred behavior — bar regulators have categorical opinions about non-human autonomous decisions affecting client matters.

### Pattern B: Strip the Curator entirely

Disable autonomous skill generation. Disable autonomous skill mutation. Disable autonomous pruning. Skills are exactly the set crane-console publishes, content-hash-pinned per customer per [ADR 0007](./0007-per-customer-machine-isolation.md).

Cost: forfeit the discovery value of execution-trace-based skill suggestion. Real patterns the runtime might surface — "Marcus tried this approach 12 times and it worked" — never get captured.

Strategic risk: bounded. We ship a more rigid catalog than upstream, in exchange for a compliance posture that survives bar scrutiny. The lost capability is real but recoverable through deliberate observation tooling.

This is the safe option. As with Honcho, it is not the right option.

### Pattern C: Curator as observer, never as authority

Keep the Curator's observation engine enabled (execution-trace analysis, outcome scoring, overlap detection). Neuter every write path. The Curator writes to a dedicated per-customer D1 table (`skill_drafts`) instead of generating or mutating skill files. Promotion of a draft requires Captain review and creates a PR against `crane-console/.agents/skills/`. Pruning is even more constrained: the Curator can flag "this skill produced poor outcomes," but the actual removal is a Captain decision rendered as a crane-console PR.

Cost: overlay work, structurally similar to [ADR 0016](./0016-honcho-disposition.md)'s Honcho interceptor.

Strategic posture: the right shape. We capture upstream's discovery value while preserving every governance and compliance commitment. The system observes; the human decides; every behavior change is PR-trailed.

### Pattern D: Replace the Curator with custom skill-suggestion pipeline

Strip the Curator. Build our own execution-trace observer that emits skill-draft candidates into the calibration flow.

Cost: more engineering for the same outcome as Pattern C. Loses the upstream rebase inheritance ([ADR 0015](./0015-hermes-fork-vs-upstream.md)) on the observation engine.

Strategic posture: same as C in terms of safety. Reconsider only if Pattern C's interceptor proves too fragile to maintain.

---

## Decision

**The Hermes autonomous Skill Curator runs in observer-only mode in the SMD overlay. The Curator's observations land in a dedicated per-customer `skill_drafts` D1 table. No skill is created, modified, consolidated, or pruned inside a customer Machine. Every skill-catalog change is a PR against `crane-console/.agents/skills/`, reviewed and merged per established skill governance, and only reaches customer Machines through the next content-hash-pinned Hermes deploy.**

Concretely:

### 1. The Curator writes only to `skill_drafts`

A new per-customer D1 table on each Hermes Machine:

```sql
CREATE TABLE skill_drafts (
  draft_id              TEXT PRIMARY KEY,
  draft_type            TEXT NOT NULL,         -- enum: new_skill, consolidation, prune_recommendation, scope_adjustment
  target_skill_slug     TEXT,                  -- existing skill slug for consolidation/prune/scope; null for new_skill
  draft_body            TEXT NOT NULL,         -- proposed skill markdown (for new_skill, consolidation) or rationale (for prune)
  source_evidence_json  TEXT NOT NULL,         -- execution-trace row IDs, audit_log row IDs, outcome scores
  curator_score         REAL,                  -- Curator's own grading value
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  promoted_at           TEXT,                  -- timestamp of Captain promotion, null if pending
  promoted_by           TEXT,                  -- Captain identifier who promoted
  promoted_pr_url       TEXT,                  -- URL of the crane-console PR the promotion generated
  dismissed_at          TEXT,
  dismissed_by          TEXT,
  dismissed_reason      TEXT
);
CREATE INDEX skill_drafts_pending ON skill_drafts (created_at) WHERE promoted_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX skill_drafts_by_type ON skill_drafts (draft_type, created_at);
```

The overlay implements an interceptor over the Curator's write paths that:

- Blocks every native skill file write (`~/.hermes/skills/*.md` creation, modification, deletion).
- Blocks every in-memory skill-set mutation (skill registration, deregistration, consolidation).
- Redirects observation output (proposed skill, consolidation suggestion, prune recommendation, scope adjustment) into rows in this table.

The interceptor is mandatory; the Curator's native write paths are blocked at overlay boot. Machine boot fails if the interception surface check fails.

### 2. The runtime skill set is read-only at the per-customer Machine

Customer Machines load their skill set from the content-hash-pinned Hermes deploy (per [ADR 0007](./0007-per-customer-machine-isolation.md)) and treat it as immutable for the lifetime of that Machine pin. No code path in a customer Machine mutates the loaded skill set — not the Curator, not adapters, not any operator action.

This is the architectural commitment that makes "observer-only" real: even if a buggy Curator writes a wildly wrong draft, no skill behavior changes until a human merges a PR against crane-console and the customer Machine is re-pinned.

### 3. Promotion is a `crane-console` PR, not a database mutation

When the Captain promotes a `skill_drafts` row, the system:

1. For `new_skill`: generates a new file at `crane-console/.agents/skills/<proposed-slug>/SKILL.md` with the draft body, the source-evidence pointers in the PR description, and the originating customer slug (for context, not for scope — promoted skills land in the central catalog and apply to all customers using that skill).
2. For `consolidation`: generates a diff that merges the named skills per the draft body.
3. For `prune_recommendation`: generates a PR that deletes or deprecates the target skill, with the prune rationale and outcome evidence in the PR description.
4. For `scope_adjustment`: generates a diff that narrows or widens the target skill's scope per the draft body.
5. The PR is reviewed and merged per `crane-console`'s established skill review cadence — not per any new SMD-specific process.
6. On merge, the next Hermes content-hash deploy picks up the change; customer Machines re-pin during the next scheduled re-deploy or Captain-triggered re-pin.
7. The `skill_drafts` row gets its `promoted_at`, `promoted_by`, and `promoted_pr_url` stamped.

No code path in the system mutates a customer Machine's skill set without this PR-and-redeploy step. The PR-and-merge requirement is the audit trail; the content-hash re-pin is the gate that prevents Curator output from amplifying its own errors over time.

### 4. Dismissal is recorded

Dismissed drafts get `dismissed_at`, `dismissed_by`, `dismissed_reason` stamped. They remain in the table. The dismissal corpus is the signal we need to tune Curator extraction over time — silent deletion hides systematic over-firing.

### 5. Pruning is the most-constrained Curator output

A Curator-suggested prune means "this skill produced poor outcomes in this customer's execution traces over the scoring window." It does not mean "this skill should be removed from the catalog." A prune draft requires Captain review precisely because the local outcome signal is necessarily narrower than the cross-customer catalog perspective.

Specifically: Captain may legitimately reject a prune draft on the basis that the skill is essential for other customers, that the outcome signal is noisy, that the local poor outcome reflects calibration drift (handled by [ADR 0016](./0016-honcho-disposition.md) calibration sessions, not by removing the skill), or that the skill is provisional and the customer needs more time on it. The Curator does not get visibility into the cross-customer catalog; the Captain does. Asymmetric authority is correct here.

### 6. Source-evidence requirement (fabrication discipline)

PRD §7.5 invariant #8 applies. Every `skill_drafts` row must include source-evidence pointers in `source_evidence_json` — execution-trace row IDs from the per-customer audit log, outcome scores, and the trace window the Curator analyzed. Drafts with empty or null evidence pointers fail the write. "The Curator thinks this is a good skill" without "here are the 47 execution traces it analyzed" is not a valid draft.

The Curator's `curator_score` value is surfaced for Captain review but never serves as an auto-promotion gate.

### 7. Draft volume is bounded by sticky-stop

Sticky-stop ([#843](https://github.com/venturecrane/ss-console/issues/843)) gains a new threshold for `skill_drafts` writes: 10 drafts per 24h triggers WARN, 50 per 24h triggers SOFT. Sustained over-firing of skill drafts is a misconfiguration signal we want detected within hours.

The threshold is lower than the Honcho observation threshold (50/200 in [ADR 0016](./0016-honcho-disposition.md) §6) because skill drafts are inherently lower-volume and higher-significance than preference observations.

### 8. Audit-log emission per draft

Every write to `skill_drafts` emits a row to the per-customer audit log ([audit-log-immutability spec](../specs/ai-employee/audit-log-immutability.md), [#892](https://github.com/venturecrane/ss-console/issues/892)) with `action_class = curator_draft`, the draft ID, draft type, target skill slug (if applicable), and Curator score. Same for promotion (`action_class = curator_promotion`) and dismissal (`action_class = curator_dismissal`). Audit-log immutability discipline applies.

### 9. Decommission export includes `skill_drafts`

The per-customer decommission pipeline ([#820](https://github.com/venturecrane/ss-console/issues/820)) exports `skill_drafts` alongside the persona_observations corpus ([ADR 0016](./0016-honcho-disposition.md) §8), skill memory, audit log, and canonical `customer.yaml`, per [ADR 0008](./0008-customer-owned-memory-artifact.md). The customer leaves with the full Curator-observation corpus, in the same portable format as the rest of memory.

### 10. No Phase 2 self-promotion escape valve

This is the explicit departure from [ADR 0016](./0016-honcho-disposition.md) §_Alternatives Considered_ (which left a Phase 2 question open for low-risk Honcho observations).

**The Curator never self-promotes.** Not in Phase 1, not in Phase 2, not after any calibration-history threshold, not for any "low-risk" subclass of drafts. Skills are executable behavior; the bar is absolute. If a future ADR ever wants to relax this, it does so by superseding this ADR with explicit reasoning — not by quietly tuning a threshold.

The reason is the structural difference between Honcho and the Curator: Honcho observations inform config that humans then audit-trail-promote; the Curator's outputs are themselves the artifact-of-record. There is no equivalent of "low-risk preference" for an executable skill.

### 11. The Curator cannot read across the customer boundary

Per [ADR 0009](./0009-cross-machine-query-prohibition.md), the Curator running in customer A's Machine cannot observe customer B's execution traces. Cross-customer skill-pattern discovery — "this skill works well for 8 of 12 customers" — is necessarily a Captain-and-platform-team analytical pass, not a Curator function. The Curator stays inside the per-customer isolation boundary.

This is mentioned explicitly because the upstream Curator's design assumes single-user scope; the cross-customer prohibition is an SMD overlay constraint that must be enforced regardless of any upstream evolution.

---

## Alternatives Considered

### Pattern A (keep Curator as upstream ships it): ruled out

Reason for rejection: structurally uninsurable for a regulated-vertical product where the reviewer is a bar-licensed partner. The malpractice surface is categorical, not quantitative.

### Pattern B (strip Curator entirely): ruled out

Reason for rejection: forfeits real discovery value. The Curator's observation of execution-trace patterns is exactly the signal a centralized skill governance team needs to maintain and evolve the catalog. Pattern C captures the value while preserving safety.

Reconsider only if Pattern C's interceptor proves too fragile to maintain across upstream rebases.

### Pattern D (custom skill-suggestion pipeline): deferred, not rejected

Same shape as [ADR 0016](./0016-honcho-disposition.md)'s Pattern D treatment. Promoted to a future ADR if Pattern C interceptor breakage exceeds the quarterly-rebase cost budget.

### Per-customer skill catalogs (each customer has their own skill set): ruled out

Reason for rejection: not what `reference_agents_skills_source_of_truth.md` and issue [#573](https://github.com/venturecrane/ss-console/issues/573) committed. Skills are centralized in `crane-console`. Per-customer skill variation is handled at the catalog level (different customers enable different subsets via `customer.yaml`), not at the customer-Machine level. This ADR does not re-open that decision.

### Auto-promotion of consolidation drafts only (low-risk subclass): ruled out

Reason for rejection: §10 above. There is no Curator output class that is low-risk enough to bypass review. Consolidation merges may unify two skills the catalog deliberately kept separate; the Curator does not have the catalog-level context to make that call autonomously.

---

## Consequences

**Positive.**

- Upstream's discovery engine contributes to catalog evolution without putting any customer Machine's skill set at risk of silent mutation.
- Every skill-catalog change has a `crane-console` PR trail per established governance — no new review process to maintain.
- The calibration session ([#867](https://github.com/venturecrane/ss-console/issues/867)) gains a skill-draft review surface alongside the persona_observations surface ([ADR 0016](./0016-honcho-disposition.md) §3) — both flow through the same human-supervised promotion pattern.
- The decommission export ([ADR 0008](./0008-customer-owned-memory-artifact.md)) becomes richer — customers leave with their full Curator observation corpus, useful as a signal for any future Captain-driven catalog work.
- The structural asymmetry (per-customer observation, central catalog authority) is exactly the asymmetry the platform's governance model expects.

**Negative / accepted.**

- Two interceptors to maintain across upstream rebases — Honcho's ([ADR 0016](./0016-honcho-disposition.md)) and the Curator's. Doubles the rebase-time interception-completeness check. We accept this as the cost of running upstream Hermes with non-trivial safety substrate.
- The calibration-session UI takes on a second observation-review surface (skill drafts in addition to persona observations). Slight surface-area increase; bounded.
- The Curator's draft queue can stall if the Captain does not review on cadence. The product runs unaffected (the skill set is exactly what's pinned), but the value of upstream's observation engine accrues silently. Mitigated by a calibration-session reminder when pending-draft count exceeds a threshold.
- Cross-customer pattern discovery is a manual platform-team analytical task, not a Curator function. We pay this cost deliberately because it preserves the per-customer isolation boundary that [ADR 0009](./0009-cross-machine-query-prohibition.md) commits to.

**Out of scope.**

- Specific UI design for the skill-draft review surface inside the calibration session.
- The Curator's specific grading heuristic and extraction signal — upstream concern; the overlay does not constrain extraction beyond the source-evidence requirement.
- Cross-customer skill-pattern analytics tooling for the platform team. Useful but distinct concern; not a Curator function.
- Frequency of customer Machine re-pinning after `crane-console` skill PRs merge. Operational scheduling question, not a decision the ADR pins.

---

## Verification

How we know we are following this decision:

1. **`skill_drafts` table exists on every per-customer Hermes Machine.** Migration applied; schema matches §1; CI assertion in the per-customer migration suite.
2. **The Curator interceptor is active at Machine boot.** Boot-time check confirms native Curator write paths (skill file mutation, in-memory skill-set mutation) are blocked and the interceptor is the only write surface. Failure halts Machine boot.
3. **No code path in a customer Machine mutates the loaded skill set after boot.** Grep-level CI assertion across the per-customer Machine runtime: skill-set mutation operations are blocked outside the (intercepted) Curator path.
4. **Every draft carries source-evidence pointers.** Database-level CHECK constraint plus runtime assertion in the interceptor.
5. **Every draft, promotion, and dismissal emits an audit-log row.** Audit-log integrity check ([#892](https://github.com/venturecrane/ss-console/issues/892)) verifies the three `action_class` values appear at expected rates.
6. **Promotions create real PRs against `crane-console/.agents/skills/`.** The calibration-session promotion handler is the only code path that initiates a skill-catalog change driven by Curator input, and it does so via PR — not by direct mutation of any catalog projection.
7. **Sticky-stop fires on draft flooding.** Synthetic test: 15 drafts in 1 hour triggers WARN; 60 in 1 hour triggers SOFT.
8. **Decommission export contains the skill-draft corpus** in the documented portable format.

Guards against drift:

- The interceptor's completeness is a quarterly-rebase agenda item alongside the Honcho interceptor (per [ADR 0016](./0016-honcho-disposition.md) §_Verification_). Every Hermes upstream rebase explicitly re-verifies both interception surfaces; new Curator write paths surfaced by the rebase are intercepted before the rebase merges.
- The skill-set-immutability assertion is wired into the merge gate. A PR introducing skill-set mutation outside the Curator interceptor path fails CI; bypassing the restriction requires an explicit ADR amendment superseding this one.
- The "no self-promotion" rule (§10) is structural — the calibration-session promotion handler is the only `crane-console`-PR-opening surface; auto-promotion code paths fail review.
- If at any future review the dismissal rate of Curator drafts exceeds 60% across a representative cohort, the Curator's extraction signal is misfiring at scale — escalate to a Pattern B (strip) or Pattern D (replace) re-evaluation. The higher dismissal-rate threshold than Honcho's (50%) reflects the higher inherent uncertainty of skill suggestions vs. preference observations.

---

## References

- [Hermes Agent technical overview](https://datasciencedojo.com/blog/hermes-agent-how-it-works-tutorial/) (Data Science Dojo, Feb 2026) — Curator subsystem description (skill generation, seven-day grading, consolidation, pruning)
- Platform PRD §7.4 (skill loading and pinning, content-hash SHA), §7.5 (safety substrate, eight base invariants), §17.4 (audit and compliance targets)
- [ADR 0005 Reviewer-as-sender](./0005-reviewer-as-sender.md) (partner liability surface that justifies the §10 absolute "no self-promotion" rule)
- [ADR 0007 Per-customer Machine isolation](./0007-per-customer-machine-isolation.md) (content-hash pinning that makes skill sets immutable per Machine pin)
- [ADR 0008 Customer-owned memory artifact](./0008-customer-owned-memory-artifact.md) (decommission export includes `skill_drafts`)
- [ADR 0009 Cross-Machine query prohibition](./0009-cross-machine-query-prohibition.md) (Curator cannot observe across customer boundary, §11)
- [ADR 0015 Hermes fork vs upstream-PR](./0015-hermes-fork-vs-upstream.md) (the overlay this ADR's interceptor lives in)
- [ADR 0016 Honcho disposition](./0016-honcho-disposition.md) (sibling proposer-only pattern; structurally similar but with relaxation valves this ADR explicitly refuses in §10)
- [Calibration session spec](../specs/ai-employee/calibration-session.md) ([#867](https://github.com/venturecrane/ss-console/issues/867)) — the surface that consumes `skill_drafts`
- [Audit-log immutability spec](../specs/ai-employee/audit-log-immutability.md) ([#892](https://github.com/venturecrane/ss-console/issues/892))
- [Sticky-stop spec](../specs/ai-employee/sticky-stop.md) ([#843](https://github.com/venturecrane/ss-console/issues/843)) — gains the draft-flood threshold
- [Decommission-customer spec](../specs/ai-employee/decommission-customer.md) ([#820](https://github.com/venturecrane/ss-console/issues/820))
- Skill governance reference: `reference_agents_skills_source_of_truth.md` (memory pointer), issue [#573](https://github.com/venturecrane/ss-console/issues/573) — `crane-console/.agents/skills/` as source of truth, gitignored in `ss-console`

---

## Immediate follow-on issues

Named here so the decision lands with executable next steps. Each is a separate GitHub issue, not implemented in this ADR's PR.

1. **Implement Curator write-path interceptor in the SMD overlay** ([ADR 0015](./0015-hermes-fork-vs-upstream.md) overlay layer). Blocks native skill-file mutation and in-memory skill-set mutation at Machine boot; redirects observation output to `skill_drafts`. Includes boot-time completeness check and a runtime assertion that the loaded skill set is immutable after boot.
2. **Add `skill_drafts` table to the per-customer D1 migration suite.** Schema per §1; indexes; CHECK constraint enforcing non-null `source_evidence_json`.
3. **Extend calibration-session UI ([#867](https://github.com/venturecrane/ss-console/issues/867)) with skill-draft review.** Pending drafts surface; promote / dismiss actions; promotion generates `crane-console/.agents/skills/` PR. Lives alongside the persona-observation review surface from [ADR 0016](./0016-honcho-disposition.md).
4. **Extend sticky-stop ([#843](https://github.com/venturecrane/ss-console/issues/843)) with draft-flood threshold.** Default 10/24h WARN, 50/24h SOFT.
5. **Extend decommission pipeline ([#820](https://github.com/venturecrane/ss-console/issues/820)) to export `skill_drafts`** in the documented portable format.
6. **Update audit-log immutability spec ([#892](https://github.com/venturecrane/ss-console/issues/892))** to reference `curator_draft`, `curator_promotion`, `curator_dismissal` action classes.
7. **Document the `crane-console/.agents/skills/` promotion handler** in the calibration-session spec, including the four draft-type promotion shapes (new_skill, consolidation, prune_recommendation, scope_adjustment).
8. **Quarterly Hermes-rebase agenda item:** re-verify Curator interceptor surface completeness alongside the Honcho interceptor check from [ADR 0016](./0016-honcho-disposition.md) §_Verification_.
