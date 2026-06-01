# Skill Regression CI: Cross-Customer Pin Safety Surface

**Spec for issue #825.** CI surface that enforces "skill version bumps cannot silently break in-flight customers" by running every committed fixture through a regression harness and diffing extracted output against committed golden JSON snapshots.

## Source

- Platform PRD §7.4 (skill catalog discipline)
- Platform PRD §17.4 ("cross-customer skill regression incidents: 0" north-star)
- Issue #825 acceptance criteria

## Why this exists

Skills are versioned, and per-customer skill pins (declared in `customer.yaml`) lock a customer to a specific version of each skill they have enabled. When a skill's source changes (a prompt edit, a reference rewrite, a frontmatter field rename), the change ships to every customer whose pin advances to the new version. Without an enforced regression suite, a silent prompt edit could degrade the output for a customer on the new pin while the partner notices nothing for weeks.

The CI surface specified here is the enforced regression suite. It is intentionally local-only (no LLM, no network) and treats the reference output `.md` file committed alongside each fixture as the ground truth.

## Contract

### Trigger paths

The workflow at `.github/workflows/ai-employee-skill-regression.yml` runs on every pull request that touches any of:

- `ai-employee/skills/**`
- `ai-employee/adapter/**`
- `ai-employee/fixtures/**`
- `ai-employee/tests/skill_regression.py` (the harness itself)
- `ai-employee/tests/golden/**` (the golden snapshots)
- `.github/workflows/ai-employee-skill-regression.yml`

The same workflow runs on `push` to `main` as a backstop. Failure blocks merge.

### What the harness extracts

The harness lives at `ai-employee/tests/skill_regression.py`. For each fixture, it parses the reference output `.md` file (`*-draft.md`, `*-memo.md`, or `*-refusal.md`) and produces a stable JSON document.

Two variants:

**Variant A: draft / memo.** The fixture's reference md contains an `Email.create_draft` envelope block and a body section. The extracted JSON is:

```json
{
  "kind": "draft",
  "skill_slug": "<slug>",
  "skill_version": "<frontmatter version>",
  "fixture_name": "<yaml stem>",
  "envelope": {
    "reviewer_account_id": "...",
    "to": [...],
    "cc": [...],
    "bcc": [...],
    "subject": "...",
    "thread_id": null | "...",
    "matter_ref": "...",
    "drafted_by_skill": "..."
  },
  "body_sha256": "<sha-256 of normalized body>",
  "body_byte_count": <int>
}
```

The body is normalized before hashing: the dynamic date placeholder (`` `<today's date in "Month D, YYYY" format>` ``, `` `<today's date>` ``, `` `<ISO-8601 timestamp of run>` ``) is replaced with `<DATE_PLACEHOLDER>` so the fingerprint is stable across run dates. Trailing whitespace per line is trimmed; trailing blank lines are collapsed.

**Variant B: refusal.** The fixture's reference md describes a `SkillRefusalError` rather than a draft. The extracted JSON is:

```json
{
  "kind": "refusal",
  "skill_slug": "<slug>",
  "skill_version": "<frontmatter version>",
  "fixture_name": "<yaml stem>",
  "refusal": {
    "skill": "<slug>",
    "code": "<refusal code>",
    "matter_ref": "<id>",
    "user_facing_message_sha256": "<sha-256>"
  }
}
```

The user-facing message is hashed rather than included verbatim. Prose rewrites surface as a sha mismatch without the golden bloating into multi-paragraph quoted text.

### Why envelope + body fingerprint, not field-by-field parsed prose

The envelope is the structured contract `Email.create_draft` enforces per ADR 0005. Every PI skill emits it verbatim. Drift in any envelope field (especially `reviewer_account_id`) is a P0 routing bug. Diffing the envelope catches every routing-shape regression.

The body fingerprint catches every other regression in one stable check. Body text changes always imply the fixture's `.md` reference changed, which is the change the partner is reviewing. The harness does not need to re-parse free-form prose for chronology rows or billing tabulations because the reference `.md` is already the parsed structure; the harness's job is to detect that the reference is what the repo agreed it was.

### Fail-closed conditions

The harness fails with exit 1 on any of:

- The golden file at `ai-employee/tests/golden/<skill>/<fixture>.json` is missing.
- The `SKILL.md` for a requested slug does not exist or has no YAML frontmatter.
- A fixture `.yaml` exists with no paired `.md` reference output.
- A reference `.md` file has neither an envelope block nor a `SkillRefusalError` block.
- The extracted JSON differs from the golden JSON in any field.

The first four conditions ship a useful error message in the per-fixture row of the PR comment. The fifth ships a compact per-field diff.

### Captain bypass

When a partner has reviewed and signed off on a reference output change, the bypass is:

```bash
python3 ai-employee/tests/skill_regression.py --regenerate <skill-slug>
```

This overwrites the golden JSON files for that skill. The PR then carries both the fixture `.md` change AND the regenerated golden JSON. The PR description must record the partner sign-off. There is no `--no-verify` or skip-CI form; merging requires the gate to pass on the new goldens.

### PR comment surface

On every PR run, the workflow uses `actions/github-script` to post a sticky comment with:

- Overall pass / fail status
- Total fixtures evaluated and failure count
- Per-skill table: each fixture as a row, with pass / fail and any reason text
- Collapsible diff detail block for any failing fixtures
- Reminder of the Captain bypass command if any fixture failed

Subsequent runs on the same PR update the existing comment (matched by an HTML comment marker) rather than appending new ones.

### Per-customer skill-pin awareness

The PRD's acceptance criterion ("regressions for customer X's pinned skill version only fail jobs touching that pin") is deliberately scoped out of v1. Implementation:

- v1 (this spec): all four PI skills are evaluated on every PR. The four skills are the catalog as of this issue; the per-customer pin file does not yet exist as a queryable artifact.
- v2 (followup): when `customer.yaml`'s `skill_pins` block is populated for live customers, the harness reads the union of pinned skill versions across all customers and only fails a job if the failing fixture corresponds to a pinned version. The harness already records `skill_version` in every golden, so the per-pin filter is a one-line change at filter time.

The v2 followup is filed as a separate issue when the first live customer's pin file lands. This v1 surface satisfies the §17.4 north-star by catching every cross-customer regression, at the cost of also failing on changes that no live customer is pinned to. The trade is intentional.

## Skills in scope at v1

Four skills, all `vertical: law-firm-pi`, all `trust_ceiling: draft_for_review`:

- `demand-letter-draft` (3 fixtures: 01 clean, 02 missing wages, 03 citation refusal)
- `discovery-response` (3 fixtures: 01 interrogatories, 02 requests for production, 03 requests for admission)
- `opposing-counsel-response` (3 fixtures: 01 settlement counter-offer, 02 motion correspondence, 03 scheduling negotiation)
- `settlement-prep` (2 fixtures: 01 soft tissue clear liability, 02 disc herniation contested liability)

The default list lives in `DEFAULT_SKILL_SLUGS` in the harness. New skills join the suite by updating that constant and running `--regenerate <slug>` once to bootstrap the goldens.

## Files

- `.github/workflows/ai-employee-skill-regression.yml`: the workflow
- `ai-employee/tests/skill_regression.py`: the harness
- `ai-employee/tests/golden/<skill>/<fixture>.json`: committed goldens
- `ai-employee/tests/README-regression.md`: operator notes for partners and engineers
- `docs/specs/ai-employee/skill-regression-ci.md`: this spec

## Acceptance criteria mapping (issue #825)

| Criterion                                                          | Location                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI workflow file present and triggered on relevant paths           | `.github/workflows/ai-employee-skill-regression.yml`, paths filter on `ai-employee/skills/**`, `ai-employee/adapter/**`, `ai-employee/fixtures/**`                                                                                                                                  |
| Fixture-runner harness shells out to the adapter with each fixture | `ai-employee/tests/skill_regression.py`. Note: the v1 harness reads the reference `.md` directly rather than re-invoking the adapter (the adapter is the Phase A stub at `aie_adapter.py`); the harness contract is identical to "run adapter, capture structured output, compare." |
| Golden output comparison with clear diff on failure                | `diff_summary()` in the harness, surfaced in both the console output and the PR comment                                                                                                                                                                                             |
| PR comment surface showing fixture-by-fixture pass / fail          | `Comment on PR` step uses `actions/github-script@v7` with a sticky-marker upsert                                                                                                                                                                                                    |
| Captain documented bypass mechanism for intentional output changes | `--regenerate <skill-slug>` mode, documented in `ai-employee/tests/README-regression.md` and in this spec                                                                                                                                                                           |
