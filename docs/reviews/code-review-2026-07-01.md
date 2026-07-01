# Code Review: SMD Services

**Date:** 2026-07-01
**Reviewer:** Codex (automated)
**Scope:** Full codebase, `venturecrane/ss-console`
**Golden Path Tier:** 2 (Astro SSR on Cloudflare Workers, production CI/CD)

## Summary

**Overall: C** (stable against the 2026-06-30 full-codebase review).

The codebase is in substantially better operational shape than the raw size suggests: strict typecheck passes, lint has zero errors, root and worker tests pass, the production build passes, root `npm audit` is clean, and CI/deploy workflows cover the five current worker packages. The grade stays at C because the same structural categories keep recurring: oversized source files, trust-boundary casts after webhooks/LLM parsing, a portal endpoint still using the pre-Clerk session model, and handbook drift that describes workers no longer present in the tracked tree.

## Scorecard

| Dimension | Grade | Trend |
|---|---:|---|
| Architecture | C | stable |
| Security | C | improved |
| Code Quality | C | stable |
| Testing | B | improved |
| Dependencies | B | stable |
| Documentation | C | regressed |
| Golden Path | B | improved |

## Detailed Findings

Severity tags: [H]=high, [M]=medium, [L]=low, [INFO]=informational.

### 1. Architecture

1. [M] **Oversized production files remain above the portfolio ceiling.** `src/lib/operator/customer-yaml/types.ts` is 949 lines, `src/lib/db/quotes.ts` is 774, `src/lib/portal/operator/customer-yaml-editor.ts` is 683, `src/lib/db/entities.ts` is 663, `src/lib/portal/operator/audit.ts` is 624, `src/lib/sow/service-finalize.ts` is 589, `src/lib/admin/cost-query.ts` is 585, `src/lib/pdf/sow-template.tsx` is 574, and `src/lib/email/templates.ts` is 568. Recommendation: split at existing domain seams; do not move type bulk to a single file solely to keep callers short.
2. [M] **Route/page data access still leaks past the service boundary.** `src/pages/api/booking/reserve.ts` remains a 512-line orchestration route with direct DB phases, and several `.astro` admin/portal pages still query D1 in frontmatter. Recommendation: continue extracting route loaders/read models into `src/lib/db` or route-specific service modules.
3. [L] **Worker directories contain stale local artifacts.** Untracked `workers/new-business/node_modules`, `workers/scan-workflow/node_modules`, and `workers/social-listening/node_modules` exist even though those worker sources are not tracked. Recommendation: remove local artifact directories and add a hygiene check if they keep recurring.

**Grade rationale:** More than three source files exceed the 500-line ceiling, which caps Architecture at C under the rubric, even though the main app/module boundaries are otherwise coherent.

### 2. Security

1. [M] **Private consultant-photo fallback rejects normal Clerk portal sessions.** `src/pages/api/portal/consultants/photo/[...key].ts:29` reads `locals.session`, then requires `session.role === 'client'` at line 30. Middleware now allows Clerk-authenticated portal requests without populating the legacy session fallback, while the analogous document stream uses `getPortalClient`. Recommendation: resolve portal identity via `getPortalClient(env.DB, locals)`, then scope keys by the resolved `user.org_id` and `client.id`.
2. [M] **Verified webhook payloads are still trusted by TypeScript casts.** `src/pages/api/webhooks/stripe.ts:44`, `src/pages/api/webhooks/signwell.ts:68`, and `src/pages/api/webhooks/resend.ts:103` all parse JSON with `as PayloadType` after signature verification. HMAC proves sender authenticity, not payload shape. Recommendation: add Zod schemas or local narrowers for each provider event before dispatch. Existing issue #1596 already tracks this class.
3. [L] **Some public request validators remain hand-rolled and uneven.** `src/pages/api/contact.ts` has length and control-character checks; `src/pages/api/intake.ts` and `src/pages/api/booking/reserve.ts` rely more on `trimString` and ad hoc number parsing. Recommendation: standardize public endpoints on schema parsing plus explicit max lengths.

**Positive:** Admin and portal middleware is fail-closed, SQL access sampled during review used parameter binding, public forms are rate-limited, webhook signatures use constant-time checks, and root secret scanning/audit workflows are present.

**Grade rationale:** No critical or high security issue was confirmed in this pass; medium trust-boundary issues keep the dimension at C.

### 3. Code Quality

1. [M] **Lint is clean but still reports unsafe-type warnings.** `npm run lint` exits with 0 errors and 20 warnings, mainly `no-unsafe-assignment` and `no-unsafe-member-access` around `JSON.parse` and dynamic records, including `src/lib/db/quotes.ts:201`, `src/lib/db/quotes.ts:217`, `src/lib/enrichment/deep-website.ts:175`, and `src/pages/api/intake/send.ts:215`. Recommendation: convert the warning sites to `unknown` + schema/narrower patterns.
2. [M] **External/LLM JSON parsing is still cast-driven.** `src/lib/enrichment/deep-website.ts:175` returns spread parsed JSON without validating the shape; this is the same trust-boundary class as webhook casts. Recommendation: parse the expected deep-website result with Zod and return `null` on schema failure.
3. [L] **Type boundary generation does not match the global standard.** `src/env.d.ts:42` hand-declares `Cloudflare.Env` while the global coding standard says Worker `Env` should be generated by `wrangler types`. Recommendation: either adopt generated env types or document a deliberate Astro adapter exception.

**Grade rationale:** Strict TS and lint are functioning, but repeated trust-boundary casts and 20 unsafe warnings keep Code Quality at C.

### 4. Testing

1. [M] **No focused regression test covers the consultant-photo Clerk-session path.** The endpoint at `src/pages/api/portal/consultants/photo/[...key].ts` is the only portal API found still relying on `locals.session` as client auth. Recommendation: add a route test with Clerk locals and no legacy session, matching `src/pages/api/portal/documents/[...key].ts`.
2. [L] **Coverage thresholds are still baseline-oriented.** `vitest.config.ts` keeps low line/statement thresholds because Astro templates skew V8 coverage. Recommendation: add targeted route/service tests for high-risk public/API surfaces rather than treating aggregate line coverage as the main lever.

**Verification:** `npm run test` passed outside the sandbox: 202 files passed, 1 skipped; 3,316 tests passed, 2 skipped. `npm run test:workers` also passed across the five current worker packages.

**Grade rationale:** Test volume and quality are strong, with worker tests now green. Missing coverage for the newly found portal regression holds this at B instead of A.

### 5. Dependencies

1. [M] **Per-worker audit remains intentionally skipped in CI.** `.github/workflows/security.yml:52` documents the blind spot and points to issue #1588. Recommendation: finish #1588 by fixing worker advisories, then add the same `workers/*` loop used by `typecheck:workers` and `test:workers`.
2. [L] **Dependency currency is mostly minor, with a few major lanes pending.** `npm outdated --json` reports `astro` 6.4.7 -> 7.0.4, `@astrojs/cloudflare` 13.5.2 -> 14.0.2, and `typescript` 5.9.3 -> 6.0.3 as major updates; most other drift is patch/minor. Recommendation: keep majors manual and group safe patch/minor updates through Dependabot.
3. [INFO] **Local `node_modules` was stale relative to the lockfile.** `npm ls` initially showed invalid installed versions for `@formepdf/*`, while `package.json` and `package-lock.json` agree on `^0.10.4`. Clean install in CI should resolve this; local `npm install` may be needed.

**Verification:** Root `npm audit --json` reported 0 vulnerabilities. No direct runtime dependency using known Worker-hostile schema compilation was confirmed; `ajv` is dev/transitive through tooling.

**Grade rationale:** Clean root audit and current CI coverage earn B; per-worker audit gap prevents A.

### 6. Documentation

1. [M] **Handbook worker inventory is stale.** `docs/handbook/repository-map.md:23` and `docs/handbook/architecture-map.md:49` say seven sibling workers exist and name `new-business` and `social-listening`; tracked sources show five worker packages. `docs/handbook/deployment-release.md:51` also instructs deploying removed workers. Recommendation: update handbook worker inventory to the five tracked/deployed workers and move removed pipelines to historical context.
2. [L] **CI comments still say seven worker suites.** `.github/workflows/verify.yml:57` says seven worker suites, but the script runs the five packages with `package.json`. Recommendation: update comment-only drift so future agents do not chase removed workers.

**Positive:** `CLAUDE.md` and `README.md` are high-signal and current on scripts, stack, and the Clerk auth model; docs are broad and handbook integrity is tested.

**Grade rationale:** Documentation is generally strong, but active handbook pages describing non-existent deploy units are enough to cap this at C.

### 7. Golden Path Compliance

1. [M] **Worker env typing still appears hand-maintained.** The global coding standard requires generated Worker env typing; this repo uses an augmented `Cloudflare.Env` declaration in `src/env.d.ts`. Recommendation: adopt `wrangler types` parity or capture an explicit exception in the repo standard.
2. [L] **CI security coverage has a known worker-audit exception.** Same underlying issue as Dependencies #1; tracked in #1588.

**Verification:** `npm run typecheck`, `npm run typecheck:workers`, `npm run lint`, `npm run build`, `npm run test`, and `npm run test:workers` all passed after rerunning Wrangler/npm-cache-sensitive commands outside the sandbox where required.

**Grade rationale:** Tier 2 CI/CD, deploy, secret scanning, typecheck, lint, build, root audit, and tests are present and passing. Known worker-audit and env-type-generation gaps keep this at B.

## Trend Analysis

Previous full review: **2026-06-30, Overall C**.

- **Security improved:** the prior review reported critical live findings; this pass confirmed no new critical/high security finding, only medium trust-boundary and portal-session issues.
- **Testing improved:** root and worker suites pass; the previously noted CI worker-test gap appears closed for current workers.
- **Documentation regressed:** handbook pages still describe removed worker packages, creating active operational drift.
- **Architecture/Code Quality/Dependencies remain stable:** the same structural ceilings, parsing warnings, and worker-audit follow-up remain.

**Prior code-review issue resolution:** 38 of 42 `source:code-review` issues are closed. Four remain open: #1597 architecture polish, #1596 webhook payload validation, #1588 worker audit/dependabot, and #765 Phoenix-to-Arizona prompt copy.

## File Manifest

- 1,640 non-generated tracked files; approximately 259,860 non-generated lines.
- File mix: 610 `.ts`, 195 `.astro`, 1 `.tsx`, 470 `.md`, 105 `.sql`, 40 `.json`, 33 `.yaml`.
- Current tracked worker packages: `cost-anomaly`, `cost-telemetry`, `enrichment-workflow`, `job-monitor`, `review-mining`.
- Stack: Astro 6 SSR on Cloudflare Workers + Static Assets, TypeScript strict, React islands, D1, R2, KV, Clerk, Vitest, ESLint flat config.

## Verification Notes

Commands run:

- `npm audit --json` -> 0 vulnerabilities.
- `npm run lint` -> 0 errors, 20 warnings.
- `npm run typecheck` -> 0 errors, 14 hints after sandbox escalation for Wrangler log writes.
- `npm run test` -> 202 passed, 1 skipped; 3,316 passed, 2 skipped after sandbox escalation for npm cache access.
- `npm run typecheck:workers` -> passed all five current worker packages.
- `npm run test:workers` -> passed all five current worker packages.
- `npm run build` -> passed after sandbox escalation for Wrangler log writes.

## Issue Tracking

No new GitHub issues were created during this review. The confirmed high-value findings overlap existing open issues:

- Webhook payload parsing -> #1596.
- Architecture polish / oversized files / route extraction -> #1597.
- Per-worker audit / dependency hygiene -> #1588.

The new portal consultant-photo fallback regression is not covered by those issues and should either be fixed directly or tracked as a small bug.
