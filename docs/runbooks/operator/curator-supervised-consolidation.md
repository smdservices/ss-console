# Supervised skill consolidation (Hermes curator)

How Captain runs a one-off, supervised consolidation of a customer's agent-authored skills, given that the autonomous curator is disabled per [ADR 0017](../../adr/0017-skill-curator-disposition.md).

## Background — why the curator is off

Hermes' curator runs an autonomous LLM pass (`agent/curator.py:_run_llm_review()`, default aux model `google/gemini-3-flash-preview`) on a 7-day cron. That pass does not merely archive stale skills — it **consolidates and rewrites agent-authored skill content** via `skill_manage`, collapsing many specific skills into broader "umbrella" skills. For the SMD Operator that is undesirable by default:

- It mutates skills we mirror to per-customer D1 with content hashes and a `source_turn_id`, attributing the rewrite to a background "CURATOR" turn with no customer conversation to anchor provenance — corrupting the audit trail.
- It changes which skills exist and how they are invoked between conversations, without the customer triggering it. Reviewer-as-sender ([ADR 0005](../../adr/0005-reviewer-as-sender.md)) does not see this structural drift.

So the autonomous curator is disabled per-customer. **In-conversation skill auto-creation (`skill_manage`) stays on** — skills still evolve with the customer's workflow. Only the unsupervised background consolidation is off.

How it is enforced: `ai-employee/templates/bootstrap.sh` step 7b runs `ensure-curator-disabled.py` after profile materialization and before Hermes starts, writing `curator.enabled: false` into each `/opt/data/profiles/<slug>/config.yaml`. The boot smoke test (`ai-employee/bin/boot-smoke-test.sh`) re-verifies it with `--check`. (Real-world motivation: NousResearch/hermes-agent#18373, where the curator autonomously consolidated 54 user skills into 12 umbrellas on a fresh install.)

## When to consider a consolidation pass

This is an exception path, not a routine. Consider it only when a deployed customer's agent-authored skill catalog has grown unwieldy — many near-duplicate or overlapping skills degrading discovery or the agent's skill-selection quality. Symptoms: the agent picks the wrong skill, or `hermes curator status` (run for inspection) shows a large active-skill count with heavy overlap.

If the catalog is healthy, do nothing. Sprawl is the accepted cost of keeping the autonomous curator off (ADR 0017, Consequences).

## Procedure

All steps run inside the customer's Machine. Open a shell:

```bash
fly ssh console -a hermes-<customer-slug>
```

### 1. Snapshot first (recoverable rollback point)

```bash
hermes curator backup
```

Creates a `tar.gz` of `~/.hermes/skills/`. Confirm it landed:

```bash
hermes curator rollback --list
```

### 2. Preview with `--dry-run` (no mutations)

```bash
hermes curator run --dry-run
```

This produces the same review report the autonomous pass would, but **makes no changes** — it does not call `skill_manage`/`mv`, and does not advance `last_run_at` or `run_count`. Read the report in full. For each proposed consolidation, confirm:

- The umbrella grouping is coherent and does not merge skills that belong to different personas or different operational contexts.
- No skill carrying `references/`, `templates/`, `scripts/`, or `assets/` is being folded in a way that breaks its support files.
- The result genuinely improves discovery/invocation rather than just reducing the count.

If anything looks wrong, **stop here** — the dry run changed nothing.

### 3. Protect skills that must not be touched

Pin any skill you want to exclude from consolidation:

```bash
hermes curator pin <skill-name>
```

Pinned skills are exempt from both auto-transitions and the LLM review.

### 4. Run the real pass (only after the report is approved)

Temporarily re-enable, run once, then turn it back off so no autonomous run is scheduled:

```bash
hermes curator run            # one explicit, supervised pass
```

`hermes curator run` executes immediately regardless of the `enabled` flag; you do **not** need to flip `curator.enabled` to run it on demand. Do **not** set `curator.enabled: true` in config — that re-arms the 7-day autonomous ticker, which is exactly what ADR 0017 disables. Leave the config flag `false`.

### 5. Verify and reconcile the audit mirror

- Confirm the customer's D1 `agent_skills_inventory` reflects the consolidation (archived rows for folded skills, new rows for umbrellas). If the overlay's audit plugin did not capture the curator-driven `skill_manage` calls with provenance, note the gap on the engagement record — curator-initiated changes have no customer `source_turn_id`.
- Spot-check that the agent still selects the right (now consolidated) skills on a representative task.

### 6. Roll back if needed

```bash
hermes curator rollback            # newest snapshot
hermes curator rollback --id <ts>  # a specific snapshot from `rollback --list`
```

## Notes

- Never leave `curator.enabled: true` in a customer's profile config. The only sanctioned consolidation is a supervised, on-demand `hermes curator run` bracketed by a backup and a reviewed `--dry-run`.
- Implementation tracking: [ss-console#1135](https://github.com/venturecrane/ss-console/issues/1135). Disposition: [ADR 0017](../../adr/0017-skill-curator-disposition.md).
