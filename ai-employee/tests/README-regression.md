# Skill regression: operator notes

Per issue #825 and Platform PRD §17.4 ("cross-customer skill regression incidents: 0"), every PR that touches a skill, the adapter, or fixtures must show that the four PI skills in the catalog still produce the reference outputs committed alongside their fixtures.

The harness lives at `ai-employee/tests/skill_regression.py`. The full design contract is at `docs/specs/ai-employee/skill-regression-ci.md`.

## What the harness does

For each skill in scope, the harness:

1. Loads the skill's `SKILL.md` frontmatter (`name`, `version`, `client_facing_fields`).
2. Walks `ai-employee/skills/<skill>/fixtures/` for every `.yaml` input fixture and its paired reference output `.md` (`*-draft.md`, `*-memo.md`, or `*-refusal.md`).
3. Extracts a stable JSON shape from the reference `.md`:
   - For draft / memo outputs: the `Email.create_draft` envelope (`reviewer_account_id`, `to`, `cc`, `bcc`, `subject`, `thread_id`, `matter_ref`, `drafted_by_skill`) plus a sha-256 fingerprint of the normalized body text.
   - For refusal outputs: the `SkillRefusalError` code, skill, matter_ref, and a sha-256 of the user-facing message.
4. Diffs the extracted JSON against the golden at `ai-employee/tests/golden/<skill>/<fixture>.json`.

A diff is a fail. Missing golden, unloadable skill, or unloadable fixture is also a fail (fail-closed).

The harness uses Python stdlib only. No external LLM, no network calls. The reference `.md` file is treated as the ground truth.

## In scope

Four skills currently bootstrapped:

- `law-pi-demand-letter-draft` (3 fixtures)
- `law-pi-discovery-response` (3 fixtures)
- `law-pi-opposing-counsel-response` (3 fixtures)
- `law-pi-settlement-prep` (2 fixtures)

The default set lives in `DEFAULT_SKILL_SLUGS` in the harness. Pass `--skill <slug>` to narrow.

## Running locally

From the repo root:

```bash
python3 ai-employee/tests/skill_regression.py
```

From inside `ai-employee/` (matches the form in the issue):

```bash
cd ai-employee
python3 -m tests.skill_regression
```

For a single skill:

```bash
python3 ai-employee/tests/skill_regression.py --skill law-pi-demand-letter-draft
```

For a PR-comment-shaped markdown report:

```bash
python3 ai-employee/tests/skill_regression.py --markdown-out /tmp/report.md
```

## Captain bypass: regenerating goldens

When a fixture's reference `.md` legitimately changes (a partner reviewed the new shape and signed off), regenerate the goldens for that skill:

```bash
python3 ai-employee/tests/skill_regression.py --regenerate law-pi-demand-letter-draft
npx prettier --write ai-employee/tests/golden/
```

Multiple skills:

```bash
python3 ai-employee/tests/skill_regression.py \
  --regenerate law-pi-demand-letter-draft \
  --regenerate law-pi-discovery-response
npx prettier --write ai-employee/tests/golden/
```

The `prettier --write` step is required because the repo's format check runs over JSON, and Python's `json.dumps` and Prettier disagree on how to wrap single-element arrays. Prettier wins; the harness output is functionally identical and Prettier reformats it idempotently.

Then commit the updated `ai-employee/tests/golden/<skill>/*.json` files alongside the fixture change in the same PR. The PR description must record the partner sign-off on the reference output change. Per the PRD this is the only path to changing client-facing draft shape on an in-flight customer pin.

Bypassing the gate via `--no-verify` on the PR push is prohibited.

## Adding a new skill to the suite

1. Confirm the skill has at least one `<stem>.yaml` + `<stem>-draft.md` (or `-memo.md` / `-refusal.md`) pair under `ai-employee/skills/<slug>/fixtures/`.
2. Add the slug to `DEFAULT_SKILL_SLUGS` in `ai-employee/tests/skill_regression.py`.
3. Bootstrap goldens: `python3 ai-employee/tests/skill_regression.py --regenerate <slug>`.
4. Commit the harness change, the fixture, and the golden JSON in the same PR.

## CI integration

The workflow at `.github/workflows/ai-employee-skill-regression.yml` runs on every PR touching `ai-employee/skills/**`, `ai-employee/adapter/**`, `ai-employee/fixtures/**`, the harness, or the goldens. The workflow posts a sticky PR comment with the per-fixture pass / fail table and uploads the full markdown report as an artifact. A non-zero harness exit blocks merge.
