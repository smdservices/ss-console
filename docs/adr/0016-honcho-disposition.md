---
title: Honcho Disposition — Proposer-Only, Never Authoritative, Never Disabled
date: 2026-05-23
status: accepted
captain: Scott Durgan
supersedes: none
related-prd: docs/pm/ai-employee/platform-prd.md §7.5, §9, §17.4
related-spec: docs/specs/ai-employee/customer-yaml-schema.md, docs/specs/ai-employee/calibration-session.md, docs/specs/ai-employee/audit-log-immutability.md
related-issue: TBD (filed as follow-on to this ADR)
---

# ADR 0016 — Honcho Disposition

**Status:** Accepted (Captain decision, 2026-05-23).

**Source:** Captain prompt 2026-05-23 — _"draft the Honcho disposition ADR"_ — in response to the [Hermes Agent technical overview](https://datasciencedojo.com/blog/hermes-agent-how-it-works-tutorial/) (Data Science Dojo, Feb 2026) surfacing Honcho as an upstream subsystem we had not yet decided how to handle. The overview describes Honcho as a "dialectic system [that] builds persistent cross-session user representation" tracking "communication preferences, project relationships, prior decisions, and topical relevance," which "continuously updates and shapes both reactive responses and proactive task detection."

This ADR pins our overlay's posture toward Honcho before the first customer Machine ships. It pairs with [ADR 0015](./0015-hermes-fork-vs-upstream.md) (Hermes fork strategy), [ADR 0012](./0012-customer-yaml-storage.md) (customer.yaml as the authoritative configuration source), and [ADR 0008](./0008-customer-owned-memory-artifact.md) (customer-owned memory artifact).

---

## Context

Hermes upstream ships Honcho enabled by default. As a learning subsystem, it observes session interactions and silently evolves a per-user model that influences both response shaping and proactive behavior. For the upstream single-user local-deployment use case, this is a feature. For SMD's per-customer AI Employee — where the customer is a law firm, the operator is a partner, and every output is potentially work-product under a partner's signature — Honcho's default mode is incompatible with three commitments already locked:

1. **[ADR 0012](./0012-customer-yaml-storage.md) — customer.yaml as authoritative configuration.** The file is git-resident, PR-reviewed, and the only source of truth for personas, voice references, escalation rules, channel bindings, and scope envelope. A subsystem that silently mutates persona-influencing state outside `customer.yaml` is a second authority — the failure mode ADR 0012 was written to prevent.
2. **[ADR 0011](./0011-multi-persona-per-customer.md) — multi-persona discipline.** Personas are explicit, named, PR-reviewed artifacts. A Honcho-shaped "evolved user model" that drifts persona behavior without an authoring step erodes the persona contract that ADR 0011 locks.
3. **PRD §7.5 invariant #8 — fabrication discipline; [calibration session spec](../specs/ai-employee/calibration-session.md) (#867).** Voice and preference evolution is supposed to happen in the four 90-minute Captain-supervised calibration sessions, with every change rooted in a reviewed transcript span or a named partner directive. A subsystem that infers preferences from execution traces and applies them without review is fabrication discipline turned inside out: it is the system inferring what the partner means, rather than the system being told what the partner means.

The architectural question this ADR resolves is: **what does our overlay do with Honcho — keep it as upstream ships it, strip it, or constrain it?**

A note on naming. [ADR 0011](./0011-multi-persona-per-customer.md) §5 mentions "Honcho" once, as one of four candidates for the **skill-memory provider** (the scoped key-value store that skills read from and write to). That decision is still deferred to a Phase 2 spike. This ADR is about a different concern: Hermes upstream's **user-modeling subsystem named Honcho**, which is enabled by default and runs whether or not we select it as the skill-memory provider. If the Phase 2 spike later selects Honcho as the skill-memory provider too, the constraints in this ADR apply to that role as well.

Four patterns were available.

### Pattern A: Keep Honcho upstream as-is

Enable Honcho with default behavior. Trust the upstream design. Let the per-customer user model evolve silently and feed back into response shaping and proactive behavior.

Cost: every ADR-0012, ADR-0011, and PRD §7.5 violation enumerated above. No audit trail of what the model learned or when. No way to surface model state to the partner for review. No way to roll back a bad inference. Calibration session (#867) becomes a charade — partner reviews voice samples while a separate subsystem silently re-shapes voice behavior between sessions.

Strategic risk: catastrophic. The first time a partner notices the AI "talking differently" without anyone having changed anything, the product loses trust irrecoverably. PI firms are sensitive to this in a way single-developer-local-deployment users are not.

### Pattern B: Strip Honcho entirely

Disable Honcho in the overlay. `customer.yaml` is the only persona-influencing state. Calibration session (#867) is the only path for voice/preference evolution.

Cost: forfeit the adaptation value Honcho's design captures. Every customer's persona stays exactly what the calibration session pinned, with no detection of voice drift, recurring partner corrections, or implicit pattern signals that ought to inform the next calibration session.

Strategic risk: bounded. We ship a more rigid product than upstream, in exchange for a defensible compliance posture. The lost capability is a real lost capability, but it's one we can rebuild ourselves later if it proves valuable.

This is the safe option. It is not the right option.

### Pattern C: Honcho as proposer, never as authority

Keep Honcho's observation engine enabled, but neuter its write paths. Honcho writes to a dedicated per-customer D1 table (`persona_observations`) — never to `customer.yaml`, never to runtime persona state, never to any signal a skill reads at dispatch time. The calibration session surfaces accumulated observations as proposals for partner-and-Captain review. Promotion of an observation creates a PR against `customer-configs/<slug>.yaml` per ADR 0012.

Cost: overlay work. We have to intercept Honcho's write paths, redirect them to `persona_observations`, surface the observations in the calibration UI, and build the promotion flow.

Strategic posture: the right shape. We get the value of Honcho's adaptation engine (detection of drift, recurring corrections, voice signals) while preserving every commitment locked in ADR 0011, ADR 0012, and PRD §7.5. The system learns; the customer stays in control; every change is audit-trail-grade.

### Pattern D: Replace Honcho with a custom observation pipeline

Strip Honcho. Build our own voice-drift detector and preference-inference layer that emits structured observations into the calibration flow.

Cost: more engineering for the same outcome as Pattern C. We lose the upstream rebase inheritance ([ADR 0015](./0015-hermes-fork-vs-upstream.md) §_Consequences_) on the entire observation engine.

Strategic posture: same as C in terms of safety, weaker in terms of upstream inheritance. Reconsider only if Pattern C proves infeasible — i.e., if Honcho's internals are too tangled with the dispatch loop to cleanly intercept.

---

## Decision

**Honcho stays enabled in the SMD overlay, but runs in proposer-only mode. Observations land in a dedicated per-customer D1 table; nothing Honcho infers reaches runtime persona state or `customer.yaml` without an explicit, audit-trailed promotion through the calibration session.**

Concretely:

### 1. Honcho writes only to `persona_observations`

A new per-customer D1 table on each customer's Hermes Machine:

```sql
CREATE TABLE persona_observations (
  observation_id        TEXT PRIMARY KEY,
  persona_slug          TEXT,                  -- nullable: customer-scope observations possible
  observation_type      TEXT NOT NULL,         -- enum: voice_drift, recurring_correction, preference_signal, etc.
  observation_body      TEXT NOT NULL,         -- Honcho's inference, structured JSON
  source_evidence_json  TEXT NOT NULL,         -- transcript span IDs, message IDs, or audit_log row IDs
  confidence            REAL,                  -- Honcho's own confidence value, surfaced for review
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  promoted_at           TEXT,                  -- timestamp of calibration-session promotion, null if pending
  promoted_by           TEXT,                  -- principal user ID who promoted, null if pending
  promoted_pr_url       TEXT,                  -- URL of the customer.yaml PR the promotion generated
  dismissed_at          TEXT,                  -- timestamp of dismissal (also a recorded action)
  dismissed_by          TEXT,
  dismissed_reason      TEXT
);
CREATE INDEX persona_observations_pending ON persona_observations (created_at) WHERE promoted_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX persona_observations_by_persona ON persona_observations (persona_slug, created_at);
```

The overlay implements an interceptor over Honcho's write path that redirects every would-be persona-state mutation into a row in this table. The interceptor is mandatory; Honcho's native write paths are blocked at overlay boot.

### 2. Skills never read from `persona_observations`

Persona-influencing reads at dispatch time go to the materialized projection of `customer.yaml` (per [ADR 0012](./0012-customer-yaml-storage.md)), exactly as they would if Honcho did not exist. `persona_observations` is read **only** by the calibration-session surface and by the decommission export. No skill, no capability adapter, no signature renderer, no voice gate reads from this table.

This is the architectural commitment that makes "proposer-only" real: even if a buggy Honcho writes a wildly wrong observation, no customer-bound output changes until a human promotes it.

### 3. Promotion is a PR, not a database mutation

When a partner or Captain promotes an observation in the calibration session UI, the system:

1. Generates a diff against `customer-configs/<customer-slug>.yaml` that expresses the observation as a config change.
2. Opens a PR against the `customer-configs` source-of-truth repository ([ADR 0012](./0012-customer-yaml-storage.md) §1) with the observation ID, source-evidence pointers, and the promoting user in the PR body.
3. The PR is reviewed and merged per the normal `customer.yaml` review cadence ([ADR 0012](./0012-customer-yaml-storage.md) §2).
4. On merge, the CI projection pipeline rewrites portal D1 and per-customer R2 ([ADR 0012](./0012-customer-yaml-storage.md) §2 steps 4–5), at which point runtime behavior shifts.
5. The `persona_observations` row gets its `promoted_at`, `promoted_by`, and `promoted_pr_url` stamped.

No surface in the system mutates `customer.yaml` from a Honcho observation without this PR step. The PR-and-merge requirement is the audit trail; it is also the gate that prevents Honcho from amplifying its own errors over time.

### 4. Dismissal is also recorded

When a partner or Captain dismisses an observation as wrong, irrelevant, or noisy, the dismissal is stamped on the row (`dismissed_at`, `dismissed_by`, `dismissed_reason`). Dismissed observations remain in the table. We need the dismissal corpus to tune Honcho's signal extraction over time — silent deletion would hide systematic over-firing.

### 5. Observation generation is gated by fabrication discipline

PRD §7.5 invariant #8 (fabrication discipline) applies to Honcho observations exactly as it applies to client-facing fact-bearing fields. Every observation written to `persona_observations` must include source-evidence pointers (`source_evidence_json` — transcript span IDs, message IDs, audit-log row IDs). The overlay rejects any Honcho write that lacks evidence pointers. "Honcho thinks the partner prefers shorter intro paragraphs" without "here are the three messages where that pattern shows up" is not a valid observation.

Invariant #6 (citation enforcement on fact-bearing client-facing fields) does **not** apply directly — observations are internal proposals, not client output. But the spirit of #6 — "every claim has a source" — is enforced through the evidence-pointer requirement here.

### 6. Observation volume is bounded by sticky-stop

The sticky-stop circuit breaker ([#843](https://github.com/venturecrane/ss-console/issues/843)) gains a new threshold: if Honcho writes more than `N` observations per `T` window for a single customer (default: 50 observations / 24h, tunable in `customer.yaml`), sticky-stop fires in WARN mode. Sustained over-firing escalates to SOFT (halt new observations until Captain review). A misconfigured Honcho extraction signal that floods the table is a misconfiguration we want to detect within hours, not weeks.

### 7. Audit-log emission per observation

Every write to `persona_observations` emits a row to the per-customer audit log ([audit-log-immutability spec](../specs/ai-employee/audit-log-immutability.md), [#892](https://github.com/venturecrane/ss-console/issues/892)) with `action_class = honcho_observation`, the observation ID, observation type, and confidence value. Same for promotion (`action_class = honcho_promotion`) and dismissal (`action_class = honcho_dismissal`). The audit-log immutability discipline (Worker-layer enforcement, Logpush mirror, integrity check) applies.

### 8. Decommission export includes `persona_observations`

The per-customer decommission pipeline ([#820](https://github.com/venturecrane/ss-console/issues/820)) exports `persona_observations` alongside skill memory, audit log, and the canonical `customer.yaml`, per [ADR 0008](./0008-customer-owned-memory-artifact.md). The customer leaves with the full observation corpus their AI Employee accumulated, in the same portable format as the rest of memory.

### 9. Trust-ceiling does not gate observation writes

The trust-ceiling discipline (`trust_ceiling.enforce()`, [refusal-handling spec](../specs/ai-employee/refusal-handling.md) [#866](https://github.com/venturecrane/ss-console/issues/866)) gates customer-bound output and skill dispatch. Honcho observations are internal proposals downstream of skill execution, not customer-bound output. Trust-ceiling does not run on observation writes; the fabrication-evidence requirement (§5 above) and the sticky-stop volume cap (§6 above) are the two guards that apply.

This is explicit so the trust-ceiling implementation does not accumulate scope it does not need: it is not Honcho's gate.

### 10. The IDE ACP server (port 8642) stays disabled

Tangentially related: the article notes Hermes upstream exposes a local LLM endpoint on port 8642 for IDE integration (VS Code, Zed, JetBrains). Customer Fly Machines have no IDE workload and no legitimate reason to expose this surface. The overlay confirms it is disabled at Machine boot. Mentioned here because it surfaced in the same article and the same evaluation pass; tracked as a one-line follow-on issue, not a separate ADR.

---

## Alternatives Considered

### Pattern A (keep Honcho as upstream ships it): ruled out

Reason for rejection: violates ADR 0012, ADR 0011, and PRD §7.5 invariant #8 simultaneously. The first partner who notices unannounced voice drift in their AI Employee is a churn event; the second is a referenceable PI-firm story we cannot recover from. The compliance posture of the productized SKU ([ADR 0004](./0004-productized-ai-employee-offering.md)) does not survive this option.

### Pattern B (strip Honcho entirely): ruled out

Reason for rejection: forfeits real adaptation value for a defensible-but-rigid product. Calibration sessions become poorer because they have no observation feed to ground partner discussions. We rebuild what Honcho already does, badly, over time — or we ship a less responsive product than upstream Hermes does. Pattern C captures the safety properties of B without the capability loss.

Reconsider only if Pattern C's interceptor implementation proves too fragile to maintain — i.e., if every upstream rebase breaks the interception surface and we end up effectively maintaining a hard fork of Honcho. The quarterly rebase cadence in ADR 0015 §_Decision_ is the early warning signal.

### Pattern D (replace Honcho with custom observation pipeline): deferred, not rejected

Reason for deferral: same safety properties as Pattern C, weaker upstream inheritance. The right shape if Pattern C proves infeasible, but more engineering than we should pay until we know we need to.

Promoted to a future ADR if: (a) Pattern C interceptor breakage exceeds the quarterly-rebase cost budget, or (b) Honcho's upstream direction shifts incompatibly (e.g., write paths become deeply entangled with dispatch in a way that cannot be cleanly intercepted).

### Phase 2 question: self-promotion of low-risk observations

Out of scope for this ADR. After a sufficient calibration history exists for a customer (proposed gate: ≥4 completed calibration sessions, ≥30 promoted observations, dismissal rate <20%), it may be reasonable to let Honcho auto-promote a narrow class of low-risk observations (e.g., signature-block formatting preferences, time-of-day routing) without partner review.

Not now. Phase 1 commits to human-in-the-loop promotion for every observation, with no exceptions. Phase 2 may relax this; this ADR does not foreclose that, but it does not authorize it either.

---

## Consequences

**Positive.**

- Honcho's adaptation engine contributes to product quality without violating ADR 0011, ADR 0012, or PRD §7.5. Drift detection, recurring-correction signals, and voice-pattern observations flow into calibration sessions where they belong.
- Every persona-influencing change has a PR trail. The "the AI started talking differently and nobody changed anything" failure mode is structurally impossible.
- The decommission export ([ADR 0008](./0008-customer-owned-memory-artifact.md)) becomes richer — the customer leaves with their observation corpus, not just their skill memory.
- The calibration session ([#867](https://github.com/venturecrane/ss-console/issues/867)) becomes a more effective surface because it has structured observations to ground discussion in, rather than only Captain-prompted reflection.
- Upstream Hermes rebase ([ADR 0015](./0015-hermes-fork-vs-upstream.md)) inherits Honcho improvements (extraction quality, signal types) without inheriting Honcho's authority. Best of both directions.

**Negative / accepted.**

- The interceptor over Honcho's write paths is a real overlay-maintenance commitment. Every upstream rebase has to confirm the interception surface is still intact and still complete. The CI smoke test must include "no observation reaches anywhere except `persona_observations`" as a hard assertion.
- The calibration-session UI takes on a new responsibility (observation review and promotion) that adds surface area. The day-1 onboarding spec ([#803](https://github.com/venturecrane/ss-console/issues/803)) and the calibration spec ([#867](https://github.com/venturecrane/ss-console/issues/867)) both need updating; both are tracked as follow-ons.
- The observation queue can stall. If a customer goes weeks without a calibration session, `persona_observations` grows and no observations get promoted. The product runs unaffected (skills still read `customer.yaml`), but the value of Honcho's adaptation engine accrues silently. Mitigated by a calibration-session reminder when pending-observation count exceeds a threshold; not a hard failure mode.
- We pay engineering cost for an option upstream does not need. Pattern C's interceptor is purely an SMD safety-substrate concern; it is unlikely to be upstreamable (per [ADR 0015](./0015-hermes-fork-vs-upstream.md) §_Decision_, this is the kind of SMD-specific overlay code that stays in the overlay).

**Out of scope.**

- Specific UI design for the calibration-session observation-review surface. Tracked as a follow-on; the ADR locks the data model and the promotion flow, not the visual design.
- Honcho's specific signal extractors (which transcript patterns become which observation types). Upstream concern; the overlay does not constrain extraction beyond the source-evidence requirement in §5.
- The Phase 2 skill-memory-provider selection that [ADR 0011](./0011-multi-persona-per-customer.md) §5 deferred. Independent decision; if it later selects Honcho, the constraints in this ADR apply to that role as well.
- Self-promotion of low-risk observations after sufficient calibration history. Phase 2 question, noted in _Alternatives Considered_ above.

---

## Verification

How we know we are following this decision:

1. **`persona_observations` table exists on every per-customer Hermes Machine.** Migration applied; schema matches §1 above; CI assertion in the per-customer migration suite.
2. **The overlay's Honcho interceptor is active at Machine boot.** Boot-time check confirms native Honcho write paths are blocked and the interceptor is the only write surface. Failure of this check halts Machine boot.
3. **No skill, capability adapter, or signature renderer references `persona_observations` in a read path.** Grep-level CI assertion: `persona_observations` appears only in the calibration-session module, the decommission-export module, and the overlay's interceptor itself.
4. **Every observation row carries source-evidence pointers.** Database-level CHECK constraint plus runtime assertion in the interceptor. Observations with empty or null `source_evidence_json` fail the write.
5. **Every observation, promotion, and dismissal emits an audit-log row.** Audit-log integrity check ([#892](https://github.com/venturecrane/ss-console/issues/892)) verifies the three `action_class` values appear in the audit corpus at expected rates.
6. **Promotions create real PRs against `customer-configs/`.** The calibration-session promotion handler is the only code path that mutates a customer's configuration via Honcho input, and it does so via PR — not by direct D1 write to the projection table.
7. **Sticky-stop fires on observation flooding.** Synthetic test: 60 observations in 1 hour for a test customer triggers WARN; 200 in 1 hour triggers SOFT.
8. **Decommission export contains the observation corpus.** End-to-end test on a test customer: decommission produces an archive that includes `persona_observations` in the documented format ([ADR 0008](./0008-customer-owned-memory-artifact.md)).

Guards against drift:

- The interceptor's completeness is a quarterly-rebase agenda item. Every Hermes upstream rebase explicitly re-verifies the interception surface; new Honcho write paths surfaced by the rebase are intercepted before the rebase merges.
- The `persona_observations`-read-restriction CI assertion is wired into the merge gate. A PR that introduces a read of `persona_observations` from a forbidden module fails CI; bypassing the restriction requires an explicit ADR amendment.
- The sticky-stop volume threshold defaults are reviewed annually against real customer data. If real promotion rates suggest the threshold is too low (legitimate observations getting throttled) or too high (misconfigurations going undetected), the default moves.
- If at any future calibration the dismissal rate of Honcho observations exceeds 50% across a representative cohort, Honcho's extraction signal is misfiring at scale — escalate to a Pattern B (strip) or Pattern D (replace) re-evaluation.

---

## References

- [Hermes Agent technical overview](https://datasciencedojo.com/blog/hermes-agent-how-it-works-tutorial/) (Data Science Dojo, Feb 2026) — the article that surfaced this question
- Platform PRD §7.5 (eight safety invariants, especially #8 fabrication discipline), §9 (calibration cadence), §17.4 (audit and compliance targets)
- [ADR 0008 Customer-owned memory artifact](./0008-customer-owned-memory-artifact.md) (decommission export includes `persona_observations`)
- [ADR 0011 Multi-persona per customer](./0011-multi-persona-per-customer.md) (persona discipline; §5 deferred skill-memory-provider note re: name disambiguation)
- [ADR 0012 customer.yaml storage](./0012-customer-yaml-storage.md) (customer.yaml as the only authoritative configuration source; PR-and-merge as the audit trail)
- [ADR 0015 Hermes fork vs upstream-PR](./0015-hermes-fork-vs-upstream.md) (the overlay this ADR's interceptor lives in)
- [Calibration session spec](../specs/ai-employee/calibration-session.md) ([#867](https://github.com/venturecrane/ss-console/issues/867)) — the surface that consumes `persona_observations`
- [Audit-log immutability spec](../specs/ai-employee/audit-log-immutability.md) ([#892](https://github.com/venturecrane/ss-console/issues/892)) — applies to Honcho action-class rows
- [Sticky-stop spec](../specs/ai-employee/sticky-stop.md) ([#843](https://github.com/venturecrane/ss-console/issues/843)) — gains the observation-flood threshold
- [Decommission-customer spec](../specs/ai-employee/decommission-customer.md) ([#820](https://github.com/venturecrane/ss-console/issues/820)) — exports the observation corpus

---

## Immediate follow-on issues

Named here so the decision lands with executable next steps. Each is a separate GitHub issue, not implemented in this ADR's PR.

1. **Implement Honcho write-path interceptor in the SMD overlay** ([ADR 0015](./0015-hermes-fork-vs-upstream.md) overlay layer). Blocks native Honcho write paths at Machine boot; redirects all observation writes to `persona_observations`. Includes boot-time completeness check.
2. **Add `persona_observations` table to the per-customer D1 migration suite.** Schema per §1 above; indexes; CHECK constraint enforcing non-null `source_evidence_json`.
3. **Extend calibration-session UI ([#867](https://github.com/venturecrane/ss-console/issues/867)) with observation review.** Pending observations surface; promote / dismiss actions; promotion generates `customer.yaml` PR.
4. **Extend sticky-stop ([#843](https://github.com/venturecrane/ss-console/issues/843)) with observation-flood threshold.** Configurable in `customer.yaml`; default 50/24h WARN, 200/24h SOFT.
5. **Extend decommission pipeline ([#820](https://github.com/venturecrane/ss-console/issues/820)) to export `persona_observations`** in the documented portable format.
6. **Update calibration-session spec, day-1 onboarding spec, and audit-log immutability spec** to reference Honcho action classes and the observation-review surface.
7. **Disable IDE ACP server (port 8642) at Machine boot** with a one-line boot assertion (related-but-distinct cleanup surfaced in the same evaluation pass).
8. **Quarterly Hermes-rebase agenda item:** re-verify Honcho interceptor surface completeness before merging upstream changes.
