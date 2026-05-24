---
title: Skill Curator Disposition — Trust Hermes-Native, Mirror Agent-Created Skills to D1 Inventory for Captain Visibility
date: 2026-05-24
status: accepted
captain: Scott Durgan
supersedes: 0017-skill-curator-disposition.md (prior version of this file; see `git log docs/adr/0017-skill-curator-disposition.md`)
related-prd: docs/pm/ai-employee/platform-prd.md §7.4, §7.5
related-issue: TBD (filed as follow-on to the locked Hermes-alignment plan dated 2026-05-24)
---

# ADR 0017 — Skill Curator Disposition

**Status:** Accepted (Captain decision, 2026-05-24).

**Source:** The locked Hermes-alignment build plan dated 2026-05-24, following six rounds of first-source verification against `NousResearch/hermes-agent@v2026.5.16`. This rewrite replaces the prior version of this ADR which proposed an "observer-only" interception of `agent/curator.py` writes — that posture targeted the wrong code surface and conflicted with Hermes' core self-improving thesis.

## Context

Hermes Agent ships **two distinct subsystems** that touch the customer's skill catalog at runtime. The prior version of this ADR conflated them. First-source verification clarifies:

1. **`agent/curator.py`** is a **lifecycle manager**, not a skill author. Its verbs are `status, run, pause, resume, pin, unpin, archive, restore, prune, backup, rollback`. It tracks usage telemetry (`~/.hermes/skills/.usage.json`) and moves stale agent-created skills to `~/.hermes/skills/.archive/`. It does **not** create, modify, or write skill content.

2. **`skill_manage` tool** is the **skill author**. Agent invocations create skills (`create`, `patch`, `edit`, `delete`, `write_file`, `remove_file`). Per Hermes' docs, the agent "auto-creates a skill after completing a complex task (5+ tool calls) successfully." This is the runtime mutation point.

The prior ADR's "intercept Curator writes" posture caught the wrong code path. Worse, it framed Hermes' self-improving learning loop — the explicit thesis of the project, per Jeffrey Quesnelle (Nous Research) in the Practical AI podcast episode #357 — as a risk to be gated. That framing is wrong. Captain has directed (2026-05-24) that we trust the native loop and add visibility rather than gates, on the principle that:

- Reviewer-as-sender (ADR 0005) catches any single bad draft that a bad skill produces.
- Systematic-drift risk from accumulated bad skills is addressed by visibility (Captain can inspect and remove), not by upfront gating.
- A customer's AI Employee that cannot evolve with their workflow is a degraded product. Skill auto-creation is part of the value, not a defect.
- Hermes' tool registry constrains what skills can do — agent-created skills only access tools we expose. The blast radius is bounded by the connector surface in `customer.yaml`.

## Decision

**The `hermes-smd-overlay` plugin suite does not gate skill creation. The `skill_manage` tool stays enabled in customer profiles. The Curator runs natively.**

Concretely:

- **`skill_manage` enabled.** Customer profiles do not strip the tool from the loaded toolset. Agent-authored skills land in `~/.hermes/profiles/<persona-slug>/skills/` as Hermes intends.
- **Curator runs natively.** `agent/curator.py` operates with its default configuration. Usage tracking, stale-archival, pinning of important skills all behave as upstream ships.
- **Visibility via `hermes-smd-audit`.** The audit plugin emits an `AGENT_SKILL_CREATED` audit row to per-customer D1 `audit_log` when the agent successfully creates a skill (detected via `post_tool_call` hook firing on `skill_manage` with `create` or `write_file` action). The audit row carries: timestamp, customer slug, persona slug, skill name, skill content hash, source-turn reference (the conversation that triggered creation), and the agent's stated rationale (from the tool call args).
- **Per-customer skill inventory in D1.** A separate D1 table `agent_skills_inventory` mirrors the agent-authored skills as a first-class queryable surface for the admin portal. Schema: `(customer_slug, persona_slug, skill_name, skill_content_hash, created_at, source_turn_id, archived_at, archived_reason, removed_at, removed_by)`. The audit plugin or memory-mirror plugin populates this on `skill_manage` events.
- **Captain reversibility.** The admin portal surfaces the agent-skills inventory. Captain can mark a skill removed; the action triggers a physical delete from the per-profile `~/.hermes/profiles/<slug>/skills/<name>/` directory plus an `AGENT_SKILL_REMOVED` audit row. No re-creation gate — the agent may legitimately re-create a removed skill if the workflow demands it; rapid re-creation surfaces as a separate dashboard signal Captain can review.
- **No interception of `agent/curator.py`.** No `verify_curator_intercepted`, no `CuratorInterceptor`, no `skill_drafts` review queue. The prior version of this ADR specified those. They are deleted as part of the locked alignment plan.

## Alternatives Considered

### Pattern 1: Strip `skill_manage` from customer profiles (proposer-only equivalent)

Replace runtime skill authoring with a Captain-driven catalog. Customers get only the skills we publish.

**Rejected.** This breaks the differentiating property of Hermes — that the agent evolves with the customer's workflow. Captain direction (2026-05-24): "any client will need skills to continue to evolve with their workflow and business processes over time. If we don't trust the native system, we have to build it ourselves." Building it ourselves replaces Hermes' learning loop with a worse one we maintain.

### Pattern 2: Intercept `skill_manage` for review-queue gating (prior ADR version)

Each `skill_manage` invocation routes to a Captain review queue in D1; skills land only after Captain approval.

**Rejected.** This is the same theater pattern that prior synthesis stripped from Honcho (see ADR 0016). The one-shot harm path is closed by reviewer-as-sender. The systematic-drift risk is real but is addressed cheaper by visibility-plus-reversibility than by an approval queue. An approval queue also breaks the workflow ergonomics — agents won't auto-create skills if doing so blocks the conversation.

### Pattern 3: Intercept `agent/curator.py` (original ADR target)

The prior ADR specified blocking the Curator's `generate_skill`, `consolidate`, `prune` write paths.

**Rejected.** First-source verification confirms the Curator does not have those write paths. It manages lifecycle (archive/restore/pin), not authoring. The interception targets the wrong surface.

### Pattern 4: Trust native + visibility + reversibility (this decision)

Selected.

## Consequences

**Positive.**

- Hermes' self-improving thesis is honored — the agent gets better at the customer's business over time without ceremony.
- The substrate is smaller and more durable. No interceptor to maintain across Hermes rebases. No review queue to staff.
- The audit trail captures all skill mutations with provenance — Captain has full visibility without holding a gate.
- Reversibility is preserved through physical deletion, which is the same pattern as Honcho conclusion dismissal (ADR 0016). Symmetric across the two learning subsystems.

**Negative / accepted.**

- Systematic drift across many auto-created skills is detectable only by inspection. We accept this; the inspection surface in the admin portal is the mitigation. If drift becomes a real pattern in deployed customers, we revisit with concrete evidence.
- An auto-created skill could call a tool in a way that produces a bad draft. Reviewer-as-sender catches the draft. We accept this cost.
- The `agent_skills_inventory` table grows monotonically per customer. Archival (the symmetric counterpart to Honcho TTL archival in ADR 0016) is a follow-on if a customer's inventory grows past operational reasonability — not anticipated for Phase 1 customers.

## Verification

How we know we are following this decision:

1. **`skill_manage` is in the customer-profile toolset** at boot. The bootstrap translation step (forthcoming ADR 0019) does not strip it from the per-profile config.
2. **The Curator runs natively.** No `curator_interceptor.py` exists in the codebase. No `verify_curator_intercepted` boot check exists. Searching the codebase: `rg -i "CuratorInterceptor|curator_interceptor|verify_curator_intercepted" ai-employee/` returns zero matches.
3. **`hermes-smd-audit` emits `AGENT_SKILL_CREATED` rows** on agent `skill_manage` invocations. The smoke test in `tests/test_audit_emit.py` against the overlay plugin confirms emission.
4. **The admin portal surfaces the inventory.** A Captain-accessible view at `/admin/ai-employee/<customer>/skills` lists agent-created skills with timestamps, source-turn references, and a remove action.
5. **Removal physically deletes.** Triggering remove in the admin portal removes the skill directory from the customer's Fly volume and emits `AGENT_SKILL_REMOVED`. Re-creation is not blocked.

## References

- Practical AI Podcast episode #357 (2026-05-21), Jeffrey Quesnelle on Hermes' self-improving thesis: "the agent ought to get better the more you use it"
- `NousResearch/hermes-agent@v2026.5.16` — `agent/curator.py` (lifecycle manager, not author) and the `skill_manage` tool (the actual author surface)
- [ADR 0005](./0005-reviewer-as-sender.md) — reviewer-as-sender closes the one-shot harm path for any single bad draft
- [ADR 0015 (rewrite)](./0015-hermes-fork-vs-upstream.md) — plugin-only overlay; this disposition is implemented in `hermes-smd-audit` via the documented Hermes hook surface, not by modifying core
- [ADR 0016 (rewrite)](./0016-honcho-disposition.md) — symmetric "mirror, don't gate" posture for Honcho memory
- Locked Hermes-alignment build plan dated 2026-05-24 (in Captain's local `~/.claude/plans/` working directory)
