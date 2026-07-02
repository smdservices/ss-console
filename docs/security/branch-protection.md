# `main` branch protection snapshot

Golden Path Tier 2 requires branch protection to be documented, not only
configured (code review 2026-07-02 §7). Branch protection lives in GitHub
settings and cannot be asserted from the repo, so this file is the checked-in
record of the live configuration.

**Snapshot taken:** 2026-07-02
**Source of truth:** GitHub — `gh api repos/venturecrane/ss-console/branches/main/protection`

## Current configuration

| Control                                             | Setting                                                     |
| --------------------------------------------------- | ----------------------------------------------------------- |
| Required status checks                              | **`Typecheck, Lint, Format, Test`** (the aggregate CI gate) |
| Require branches up to date before merge (`strict`) | **true**                                                    |
| Required approving reviews                          | **0** (solo venture — CI is the gate, not human review)     |
| Dismiss stale reviews on new commits                | true                                                        |
| Require code-owner reviews                          | false                                                       |
| Require last-push approval                          | false                                                       |
| Require signed commits                              | false                                                       |
| Enforce for administrators (`enforce_admins`)       | **false**                                                   |
| Require linear history                              | false                                                       |
| Allow force pushes                                  | false                                                       |
| Allow branch deletions                              | false                                                       |
| Require conversation resolution                     | false                                                       |
| Lock branch                                         | false                                                       |

## Notes

- **The merge gate is CI, not review.** `required_approving_review_count` is 0
  by design: this is a single-operator venture, so the `Typecheck, Lint, Format,
Test` aggregate check is the merge gate. Every PR must pass it; force pushes
  and deletions of `main` are blocked.
- **`enforce_admins: false`** means repository administrators can bypass the
  up-to-date (`strict`) requirement when merging. This is why an admin can
  squash-merge a PR that is a few commits behind `main` without a manual
  branch update, provided the required check is green. Non-admins are still held
  to the full ruleset.
- **Auto-merge is disabled repo-wide**; merges are performed explicitly once the
  required check passes.

## Refreshing this snapshot

When branch protection changes, regenerate this table from the live config:

```bash
gh api repos/venturecrane/ss-console/branches/main/protection
```

Update the snapshot date and any changed rows in the same PR that changes the
protection, so the checked-in record does not drift from GitHub.
