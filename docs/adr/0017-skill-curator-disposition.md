---
title: Skill Curator Disposition — Disable the Autonomous Curator Per-Customer; Keep In-Conversation Skill Auto-Creation; Run Consolidation Only Under Captain Supervision
date: 2026-05-28
status: accepted
captain: Scott Durgan
supersedes: 0017-skill-curator-disposition.md (2026-05-24 version of this file; see `git log docs/adr/0017-skill-curator-disposition.md`)
related-issue: https://github.com/venturecrane/ss-console/issues/1135
---

# ADR 0017 — Skill Curator Disposition

**Status:** Accepted (Captain decision, 2026-05-28).

**Source:** Re-verification on 2026-05-28 against `NousResearch/hermes-agent@main` after a community report (r/hermesagent) that the curator "neuters" skills. The re-verification found that the **central factual claim of the 2026-05-24 version of this ADR is wrong.** That version asserted the curator "does not create, modify, or write skill content" and is purely a lifecycle manager. It does write skill content. This rewrite corrects the record and reverses the disposition: **the autonomous curator is disabled per-customer.**

## What the 2026-05-24 version got wrong

The prior version concluded, after "six rounds of first-source verification," that:

> "`agent/curator.py` is a lifecycle manager, not a skill author. Its verbs are `status, run, pause, resume, pin, unpin, archive, restore, prune, backup, rollback`. … It does **not** create, modify, or write skill content."

The verb list is correct, but the conclusion drawn from it is not. The CLI verbs are lifecycle verbs, but `run` invokes content mutation under the hood. First-source re-verification confirms:

- `agent/curator.py` contains a `_run_llm_review()` function that spawns an **auxiliary `AIAgent` fork** (default model `google/gemini-3-flash-preview`, configured under `auxiliary.curator.*`).
- The review prompt instructs that fork to, per skill, _"keep, **patch (via `skill_manage`)**, **consolidate overlapping ones**, or archive."_ It calls `skill_manage action=patch / create / write_file` to collapse multiple agent-authored skills into "umbrella" skills and to patch drift.
- This is skill authoring/mutation, not lifecycle management. It runs autonomously on a cron (`interval_hours`, default 168h / 7 days), driven by the gateway background ticker.

This behavior is not new — it predates our pin. Upstream [issue #18373](https://github.com/NousResearch/hermes-agent/issues/18373), filed against **v2026.4.30** (earlier than the v2026.5.16 the prior ADR claimed to verify), documents a user's agent-created library going **87 → 45 skills (54 consolidated into 12 umbrellas)** autonomously, with no dry-run and no approval, because the gateway ticker fired the curator on a fresh install. The fix ([PR #18389](https://github.com/NousResearch/hermes-agent/pull/18389)) added a first-run deferral, a `--dry-run` preview, and a post-update notice — it did **not** make consolidation opt-in or supervised; the autonomous pass still runs after the deferral window.

## Context

Hermes touches the customer skill catalog through two separable subsystems. Keeping them separate is the key to this decision:

1. **`skill_manage` tool (in-conversation authoring).** The agent auto-creates a skill after completing a complex task (5+ tool calls). This is triggered by the customer's real work, is anchored to a specific conversation turn, and is the substance of Hermes' self-improving thesis. **This is the value.**

2. **The curator (background consolidation).** An autonomous LLM pass on a 7-day cron that rewrites and consolidates the agent-authored catalog without a triggering conversation. Touches **only** agent-created skills (never bundled or hub-installed skills); exempts pinned skills; never hard-deletes (worst case is recoverable archival, with tar.gz backup/rollback). **This is an unsupervised sprawl-reducer.**

The 2026-05-24 ADR conflated these two under "trust the native loop." Disabling the curator does **not** disable `skill_manage`. We can keep the value and remove the unsupervised rewrite.

Why the autonomous curator is wrong **for this product specifically** (the generic Hermes user calculus differs):

- **It corrupts the audit/provenance moat.** This ADR (retained below) mirrors agent skill creation to per-customer D1 with content hashes and a `source_turn_id`. A cron-driven LLM rewrite mutates the artifacts we attest to, attributed to a background "CURATOR" turn with no customer conversation to anchor provenance. For a compliance-grade product, an unsupervised background rewrite of audited artifacts is the wrong default.
- **Reviewer-as-sender (ADR 0005) does not cover it.** That gate catches a single bad outbound draft. Curator consolidation changes _which skills exist and how they are invoked_ — structural behavioral drift between conversations that the per-draft reviewer never sees and the customer never triggered. The #18373 reporter's words: consolidation "fundamentally changes discovery, invocation, profile behavior, and operational assumptions."
- **Hermes offers no partial control.** There is no flag to keep auto-archival while skipping the LLM consolidation pass. `curator.enabled: false` (or `hermes curator pause`) is the only lever.

## Decision

**Disable the autonomous curator per-customer (`curator.enabled: false`). Keep `skill_manage` enabled. Run consolidation only on-demand under Captain supervision via `hermes curator run --dry-run` → review → approve.**

Concretely:

- **`skill_manage` enabled.** Unchanged from the prior decision. Customer profiles do not strip the tool. Agent-authored skills land in `~/.hermes/profiles/<persona-slug>/skills/` and evolve with the customer's workflow.
- **Curator disabled.** The bootstrap config-translation step (ADR 0019) emits `curator.enabled: false` into the surface the curator reads (per-profile `config.yaml` and/or global Hermes config — to be confirmed in implementation, see [#1135](https://github.com/venturecrane/ss-console/issues/1135)). The Machine entrypoint also disables it before Hermes starts, so the fresh-install ticker footgun cannot fire.
- **Supervised consolidation only.** If a deployed customer's agent-skill catalog grows unwieldy, Captain runs `hermes curator run --dry-run`, reviews the consolidation report, and approves an explicit one-off run. No autonomous runs in Phase 1.
- **Visibility via `hermes-smd-audit` (retained).** The audit plugin emits `AGENT_SKILL_CREATED` to per-customer D1 `audit_log` on agent `skill_manage` create/write_file events, carrying: timestamp, customer slug, persona slug, skill name, content hash, source-turn reference, and the agent's stated rationale.
- **Per-customer skill inventory in D1 (retained).** `agent_skills_inventory` `(customer_slug, persona_slug, skill_name, skill_content_hash, created_at, source_turn_id, archived_at, archived_reason, removed_at, removed_by)` mirrors agent-authored skills for the admin portal. With the curator disabled, the 1:1 mapping (skill → content hash → source turn) this table assumes stays intact — no out-of-band consolidation rewrites it.
- **Captain reversibility (retained).** The admin portal surfaces the inventory; Captain can mark a skill removed, triggering physical delete from the Fly volume plus an `AGENT_SKILL_REMOVED` row. Re-creation is not gated.

## Alternatives Considered

### Pattern 1: Trust the native curator loop (2026-05-24 decision)

Leave the curator running natively; rely on reviewer-as-sender for harm and visibility for drift.

**Rejected.** Its premise — the curator does not write content — is false. The autonomous LLM rewrite corrupts provenance and produces unsupervised structural drift that reviewer-as-sender does not catch. The #18373 incident is concrete evidence the risk is real, not hypothetical.

### Pattern 2: Strip `skill_manage` from customer profiles

Replace runtime skill authoring with a Captain-driven catalog only.

**Rejected (unchanged from prior ADR).** This breaks the differentiating property — the agent evolving with the customer's workflow. Disabling the _curator_ achieves the safety goal without touching `skill_manage`, so this heavier option is unnecessary.

### Pattern 3: Intercept `skill_manage` for review-queue gating

Route each `skill_manage` invocation to a Captain approval queue.

**Rejected (unchanged from prior ADR).** Breaks workflow ergonomics; the one-shot harm path is closed by reviewer-as-sender. Disabling the autonomous curator removes the systematic-drift vector more cheaply than gating every authoring call.

### Pattern 4: Disable the curator, keep `skill_manage`, supervise consolidation (this decision)

Selected. Removes the unsupervised structural-rewrite risk and preserves provenance while keeping the self-improvement loop. Consolidation remains available as a supervised, on-demand tool if sprawl ever becomes a real problem in a deployed customer.

## Consequences

**Positive.**

- The self-improving thesis is honored where it has value — in-conversation skill auto-creation continues.
- The audit trail stays trustworthy: no autonomous process rewrites audited artifacts; the D1 inventory's skill → hash → source-turn mapping holds.
- No structural behavioral drift between conversations that the customer did not trigger.
- Smaller runtime risk surface; consolidation is available but gated behind Captain review.

**Negative / accepted.**

- Agent-authored skill catalogs can accumulate overlap and staleness over time without the background sweep. Mitigation: the supervised `--dry-run` → approve flow. We accept manual sprawl management for Phase 1; revisit with evidence if it becomes burdensome.
- We diverge from a Hermes default. Mitigation: the divergence is a single config flag on the documented surface, not a core modification (ADR 0015 posture preserved). It survives rebases trivially.

## Verification

How we know we are following this decision:

1. **Curator disabled in a provisioned Machine.** `hermes curator status` reports the curator is not scheduled to run autonomously; bootstrap-emitted config contains `curator.enabled: false`.
2. **`skill_manage` is in the customer-profile toolset** at boot. The ADR 0019 translation does not strip it.
3. **`hermes-smd-audit` emits `AGENT_SKILL_CREATED`** on agent `skill_manage` invocations (smoke test in the overlay).
4. **The admin portal surfaces the inventory** at `/admin/operator/<customer>/skills` with timestamps, source-turn references, and a remove action.
5. **Removal physically deletes** and emits `AGENT_SKILL_REMOVED`; re-creation is not blocked.
6. **A supervised-consolidation runbook exists** for Captain-driven `hermes curator run --dry-run`.

Implementation tracked in [#1135](https://github.com/venturecrane/ss-console/issues/1135).

## References

- r/hermesagent community report (2026-05-28) prompting re-verification — curator "neuters" skills
- `NousResearch/hermes-agent@main` — `agent/curator.py` `_run_llm_review()` spawns an auxiliary `AIAgent` that calls `skill_manage` to patch/consolidate agent-authored skill content; `auxiliary.curator.*` config
- Upstream [issue #18373](https://github.com/NousResearch/hermes-agent/issues/18373) — autonomous consolidation of 54 user skills into 12 umbrellas (v2026.4.30)
- Upstream [PR #18389](https://github.com/NousResearch/hermes-agent/pull/18389) — first-run deferral + `--dry-run`; does not make consolidation supervised
- [Curator docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/curator) and [CLI commands](https://hermes-agent.nousresearch.com/docs/reference/cli-commands)
- [ADR 0005](./0005-reviewer-as-sender.md) — reviewer-as-sender (closes the one-shot draft path, not structural skill drift)
- [ADR 0015](./0015-hermes-fork-vs-upstream.md) — plugin-only overlay; this disposition is a config flag, not a core modification
- [ADR 0016](./0016-honcho-disposition.md) — Honcho disposition (sibling learning subsystem)
- [ADR 0019](./0019-customer-yaml-to-profile-config-translation.md) — the config-translation seam that emits `curator.enabled: false`
