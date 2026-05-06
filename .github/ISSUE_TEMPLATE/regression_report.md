---
name: Regression Report
about: Report a regression — something that worked before is now broken
title: 'REGRESSION: '
labels: 'type:bug, status:triage, regression'
assignees: ''
---

## Problem

<!-- What's broken now that worked before? Be specific. -->

## When did it last work?

<!-- Commit SHA / version / date / "yesterday's deploy" — anything that helps locate when the regression entered. -->

## Steps to Reproduce

1.
2.
3.

## Expected Behavior (what used to happen)

<!-- The pre-regression behavior. -->

## Actual Behavior (what happens now)

<!-- What happens instead. -->

### Affected files

<!--
REQUIRED. Repo-relative file paths, one per line, bullet format.
The regression-claim-origin workflow parses this section to look up
prior crane_verify records for these files. Without this section, you
will get a comment asking you to add it.

Example:
- packages/crane-mcp/src/tools/handoff.ts
- workers/crane-context/src/endpoints/verify-ledger.ts
- scripts/eos-gate-classify.mjs
-->

-

## Evidence

<!-- Screenshots, console errors, logs, API responses, stack traces. -->

## Priority

<!-- P0: Blocker, P1: High, P2: Medium, P3: Low -->
