# Code Review: SMD Services

**Date:** 2026-07-29
**Reviewer:** Claude Code (automated)
**Scope:** Full codebase
**Mode:** Full (Phase 1 — Claude-only)
**Models Used:** Claude (Sonnet review agent, Fable orchestrator)
**Golden Path Tier:** 2

> **Addendum, 2026-07-30.** Two findings below were executed in the same session that produced this report; the findings text is left as-observed on 07-29 and this note carries the outcome.
>
> - **Code Quality §3.3 (dead exports)** — remediated in PR [#2064](https://github.com/venturecrane/ss-console/pull/2064): 3 whole modules deleted, ~25 dead declarations removed, 31 exports narrowed to file-private. A follow-up scan returns zero hits (`vfy_01KYRF7Y83CFXS28KCP97D8B8N` covers the same session's verify batch).
> - **Golden Path §7 + Security §2.8 (error monitoring)** — closed. The Sentry org was upgraded to Team (ending a quota-exhaustion blind period that began 07-18), the `ss-web` project was created, `SENTRY_DSN` was wired into Infisical `/ss` prod and onto the Worker, and `captureError` depth landed in PR [#2065](https://github.com/venturecrane/ss-console/pull/2065). The middleware seam was live-fired on production and observed reaching Sentry (`vfy_01KYRH780BSMGN6JRVXPJ8NAMQ`). Issue #1626 is closed; the Tier 2 error-monitoring cell now reads met, not partial.
>
> **Dependencies §5.1 (the Astro advisory chain) is unchanged and still open** as [#1623](https://github.com/venturecrane/ss-console/issues/1623).
>
> This review graded code substantially authored by Claude in prior sessions (self-review — subject to bias; treat as signal, not measurement).

## Summary

**Overall: B−** (down from B on 2026-07-02, pulled by a Dependencies regression).

The engineering discipline that earned the B on 2026-07-02 is intact and in places stronger: webhook HMAC verification, D1 parameterization, OAuth CSRF defense, and centralized middleware auth were all re-verified by direct inspection; `any` usage remains near zero under an enforced strict ESLint config; no swallowed catch blocks exist anywhere in `src/`. Documentation improves to B on the strength of the CI-enforced handbook/ADR integrity gates. Two dimensions moved down: **Dependencies B → D** because `npm audit` now reports 8 vulnerabilities (6 high) rooted in `astro <= 7.0.9` — advisories published after the 07-02 review, fix already scheduled as #1623 (Astro 6→7 major migration) — and **Code Quality B → C** because a systematic dead-export scan (new this review) found 55 exports with zero external importers, including two fully orphaned modules (`src/lib/auth/api-key.ts`, `src/lib/portal/ledger.ts`).

Practical exploitability of the Astro advisories appears low (View Transitions and `transition:*` directives are not in heavy use), but the rubric grades on advisory severity, and the fix is a deliberate major-version migration, not a patch.

## Scorecard

| Dimension | Grade | Trend |
|-----------|-------|-------|
| Architecture | C | stable |
| Security | B | stable |
| Code Quality | C | down |
| Testing | B | stable |
| Dependencies | D | down |
| Documentation | B | up |
| Golden Path | B | stable |

**Overall: B−** (down from B)

## Detailed Findings

### 1. Architecture

1. [LOW] `src/lib/operator/customer-yaml/types.ts` (1,221 lines) — largest file in the repo; pure type definitions for the customer.yaml schema. Recommendation: acceptable as-is; if it keeps growing, mirror the `sections-*.ts` validator split.
2. [LOW] 17 files across `src/` exceed the 500-line ceiling (`src/lib/db/quotes.ts` 774, `src/lib/portal/operator/customer-yaml-editor.ts` 713, `src/lib/portal/customer-config.ts` 659, `src/lib/portal/operator/audit.ts` 645, `src/pages/api/booking/reserve.ts` 560, others). None are god objects; `reserve.ts` mixes route handling with business logic. Recommendation: continue extracting booking logic into `src/lib/booking/`.
3. [POSITIVE] Clean domain separation: `src/lib/*` bounded contexts, thin `src/pages/api/*` handlers, auth centralized in `src/middleware.ts`.
4. [POSITIVE] Web app (`src/`) and Operator fleet config (`operator/`) cleanly partitioned; TS side touches operator/ only via customer-yaml parsing/validation.
5. [MEDIUM] Request validation is fragmented: hand-rolled helpers (`src/pages/api/contact.ts`, `src/pages/api/intake.ts`) vs Zod (only 3/94 API files, concentrated in webhooks). Recommendation: standardize on Zod for public-facing request bodies.

**Grade: C.** Rationale: 17 files over the 500-line ceiling trips the rubric threshold (3+ files > 500 lines → C); boundaries and API design are otherwise strong. Same structural category as the last three reviews.

### 2. Security

1. [POSITIVE — verified] Webhook signatures correct in both integrations: `src/pages/api/webhooks/stripe.ts` (HMAC-SHA256 over `{timestamp}.{body}`, 5-min replay window, constant-time compare) and `src/pages/api/webhooks/signwell.ts` (HMAC over `{type}@{time}`, freshness check, constant-time compare, parses only verification fields pre-trust). Both fail closed if the secret is missing.
2. [POSITIVE — verified] D1 queries safe: all 462 `.prepare()` sites sampled use bound parameters; the template-literal sites (`src/lib/admin/cost-query.ts:82,99,109`, `src/lib/admin/fleet-roster.ts:105`, `src/lib/db/entities.ts:407`, `src/lib/db/services.ts:182,229`) interpolate only generated `?` placeholders or allow-listed column literals.
3. [POSITIVE — verified] `src/pages/api/oauth/callback.ts`: HMAC-signed state, 10-min TTL, state's `reviewer_id` checked against the authenticated admin session.
4. [LOW — not a vuln] Wildcard CORS on `src/lib/operator/mcp/mcp-route.ts:16-21` and `.well-known/oauth-protected-resource` is correct for a Bearer-token-only OAuth resource server (no cookies, no credentials flag). No action.
5. [MEDIUM] Input-validation inconsistency (see Architecture #5) — a maintenance risk, not a live vulnerability; current hand-rolled logic is sound.
6. [LOW] Rate limiting: fixed-window KV limiter on 8 endpoints; exclusions (`/api/booking/slots`, `/api/events`) are documented and reasoned. Accepted tradeoff documented in code.
7. [POSITIVE] No hardcoded secrets. `.env.production` contains only `PUBLIC_*` values by design; `.gitignore` correct.
8. [LOW] Zero explicit `Sentry.captureException` calls; 234 `console.error/log` sites. Caught-and-degraded errors (e.g. `src/middleware.ts:89`) never reach Sentry — only uncaught exceptions via `wrapRequestHandler`. Recommendation: add `captureException` at operationally significant catch sites (webhook processing, D1 write failures). Related: #1626 (production SENTRY_DSN unset) remains open.

**Grade: B.** Rationale: no injection/auth-bypass class findings; the one medium is a consistency/maintenance concern dual-counted with Architecture, and the remaining findings are low. Security-critical surfaces re-verified by inspection.

### 3. Code Quality

1. [POSITIVE] Strict ESLint enforced and followed: `no-explicit-any: error`, `no-floating-promises: error`, `no-misused-promises`, `await-thenable`, `switch-exhaustiveness-check`. Five `any` occurrences in ~100K lines.
2. [POSITIVE] Zero empty/swallowed catch blocks; deliberate fire-and-forget sites are commented.
3. [HIGH — verified] **55 dead exports** (functions/consts/classes with zero references outside their declaring file) across `src/lib/**` (264 files scanned against `src/`, `tests/`, `scripts/`). Spot-verified sample:
   - `src/lib/auth/api-key.ts` — entire module dead (`validateApiKey`); live machine auth uses `src/lib/auth/machine-key.ts`. Delete.
   - `src/lib/portal/ledger.ts` — entire module dead (80 lines, `getEngagementLedger`). Delete or mark staged-for-use.
   - `src/lib/db/entities.ts:379` `updateEntity`; `src/lib/booking/google-calendar.ts` `createCalendarEvent`/`getFreeBusy`/`refreshAccessToken`; `src/lib/db/integrations.ts` `getIntegrationById`/`updateAccessToken`/`updateIntegrationStatus`; `src/lib/db/context.ts` `countContext`/`getContextSize` — all unused.
   - Recommendation: cleanup pass, then add `knip` or `ts-prune` to CI to prevent reaccumulation.
4. [LOW] 17 `as unknown as` double-casts; all sampled are legitimate (Workers crypto/`request.cf` typing gaps, test mocks).
5. [LOW] Only 3 TODO/FIXME in `src/` — consistent with the `scope-deferred-todo.yml` gate.
6. [MEDIUM] Possible label-map duplication: `ENTITY_STAGES` family vs `CLIENT_STATUS_LABELS`/`CLIENT_STATUS_COLORS` (`src/lib/portal/constants.ts`) — audit whether these represent the same concept drifting in parallel.

**Grade: C.** Rationale: 55 dead exports including two orphaned modules trips the rubric (3+ dead exports → C; the orphaned modules alone argue for D, but count and the otherwise A-grade discipline pull it back). The B → C move reflects a deeper scan this review, not new rot.

### 4. Testing

1. [POSITIVE] Critical paths covered by dedicated suites: middleware, auth/session, both webhook integrations, OAuth, entitlements (`tests/entitlement-change.test.ts`, `tests/entitlement-compiler.test.ts`, `tests/operator-authority.test.ts`).
2. [MEDIUM] Coverage thresholds are a deliberate regression floor (`lines: 22, branches: 67, functions: 52, statements: 22`), diluted by uninstrumentable `.astro` SSR templates. 52% function coverage still leaves real gaps. Recommendation: per-directory thresholds (higher floor for `src/lib/**`) to make the numbers actionable.
3. [POSITIVE] 218 test files mirroring `src/`, plus 12 co-located suites; balanced unit/integration mix with a proper `cloudflare:workers` stub harness.
4. [LOW] Dead exports have no tests of their own — corroborating evidence they are unused.

**Grade: B.** Rationale: high-risk surfaces well covered; gaps are known, tracked, and explained rather than neglected.

### 5. Dependencies

1. [HIGH] `npm audit`: **8 vulnerabilities (6 high, 2 moderate)**, all rooted in `astro <= 7.0.9` (installed 6.4.8): reflected XSS via View Transition animation properties (GHSA-4g3v-8h47-v7g6), XSS via unescaped spread attribute names (GHSA-f48w-9m4c-m7f5), XSS via `transition:*` directive values (GHSA-7pw4-f3q4-r2p2); transitively `sharp < 0.35.0` (libvips CVEs, via miniflare/wrangler) and `svgo 4.0.0-4.0.1`. Fix requires `astro@7.1.6` — a major bump already scheduled as **#1623** (paired with `@astrojs/cloudflare` 13→14). Practical exploitability appears low (View Transitions / `transition:*` not in heavy use — confirm React-island usage during the upgrade). Recommendation: prioritize #1623; run non-force `npm audit fix` now for the svgo patch.
2. [MEDIUM] In-range updates pending: `wrangler` 4.107.1 → 4.115.0, `@sentry/cloudflare` 10.64.0 → 10.69.0, `eslint` 10.6.0 → 10.8.0, `jose` 6.2.3 → 6.2.4. Run `npm update`; may shrink the audit chain via miniflare.
3. [LOW] Majors behind: `@clerk/astro` 3.4.13 (latest 4.0.4 — track closely; primary auth provider), `typescript` 6.0.3 (7.0.2), `@astrojs/cloudflare` 13.5.2 (14.1.7, part of #1623).
4. [POSITIVE — Workers runtime compatibility] No eval/`new Function` dependency reachable from the deployed Worker bundle. `ajv` present only via dev-time tools (`@astrojs/check`, eslint). No Handlebars or dynamic templating. No runtime risk.
5. [LOW] Lean dependency list (13 runtime deps); no unused dependencies found.

**Grade: D.** Rationale: high-severity audit findings → D per rubric. Regression from B is driven by advisories published after 2026-07-02, not by drift; the remediation path already exists (#1623).

### 6. Documentation

1. [POSITIVE] `CLAUDE.md` (46KB): commands, deployment, auth architecture, subdomain routing, Operator architecture with 20+ cited ADRs, enforced content-policy anti-patterns with historical file:line citations.
2. [POSITIVE] 82 numbered ADRs with index; `docs/handbook/` (20+ pages, rendered at admin.smd.services/admin/playbook) with CI-enforced integrity (`tests/handbook-integrity.test.ts` blocks dead links, stale citations, frontmatter errors).
3. [POSITIVE] Branch protection documented with rationale in `docs/security/branch-protection.md`.
4. [MEDIUM] No consolidated API reference for the ~94 route files under `src/pages/api/`; strong per-route JSDoc headers (verified on signwell, stripe, heartbeat, runtime-summary) partially offset. Recommendation: lightweight `docs/api/README.md` index; full OpenAPI not warranted for an internal surface.
5. [POSITIVE] `README.md` concise, defers to CLAUDE.md rather than duplicating.

**Grade: B.** Rationale: rubric B is "useful CLAUDE.md and README, missing 1-2 sections (e.g. no API docs)" — exactly this profile, with everything else at A level. Improved from C: the handbook integrity gates and ADR discipline that matured since early July resolve the prior drift findings.

### 7. Golden Path Compliance (Tier 2)

| Requirement | Status | Evidence |
|---|---|---|
| Source control | Met | PR-only workflow, CODEOWNERS |
| CLAUDE.md | Exceeds | See Documentation #1 |
| TypeScript + ESLint | Exceeds | Strict mode, `any` banned as error |
| No hardcoded secrets | Met | Verified; `.env.production` is PUBLIC_*-only by design |
| Error monitoring (Sentry) | Partial | Wired at middleware (`src/lib/observability/sentry.ts`), but zero explicit `captureException` calls, and #1626 (prod SENTRY_DSN unset) still open |
| Full CI/CD | Met | `verify.yml`, `deploy.yml` (dry-run gate, migrations-first), `security.yml` (daily), 13 workflows incl. governance gates |
| Branch protection | Met | `docs/security/branch-protection.md` snapshot with rationale |
| Uptime monitoring | Met | healthchecks.io via heartbeat endpoints (ADR 0079) |
| API docs | Partial | Per-route JSDoc strong; no consolidated index |

**Grade: B.** Rationale: all critical Tier-2 requirements met or exceeded except error-monitoring depth, which is partial (infrastructure correct, capture depth incomplete, prod DSN gap tracked in #1626).

## Model Convergence

Single-model review (Phase 1). Codex and Gemini: skipped.

## Trend Analysis

Previous review: 2026-07-02 (Overall B, improved from C on 2026-07-01).

- **Dependencies B → D:** the 07-02 review recorded *zero* dependency vulnerabilities; the Astro XSS advisory chain (6 high) was published after it. The remediation was already scheduled as #1623 before the advisories landed — the upgrade is now security-motivated, not just currency-motivated.
- **Code Quality B → C:** driven by a new systematic dead-export scan (55 confirmed, 2 orphaned modules), not by new rot. Prior reviews did not run this check at depth.
- **Documentation C → B:** handbook integrity gates + ADR discipline resolved the drift findings that held this at C.
- **Architecture C (stable):** the 500-line-ceiling category recurs for the fourth consecutive review; count is down from 19 (07-02) to 17.
- **Issue resolution:** 45/47 all-time `source:code-review` issues resolved. From the 07-02 review batch: #1617 (file splits) and #1618 (API inventory) closed; #1623 (Astro major upgrade) and #1626 (prod Sentry DSN) remain open — both are the load-bearing fixes for this review's two regressed dimensions.

## File Manifest

2,261 tracked files. `src/` ~102.7K lines (TS/Astro), `tests/` ~47.7K, `operator/` ~60.7K (incl. 201 Python files), `scripts/` ~3K, 13 CI workflows. 649 .ts, 216 .astro, 201 .py, 137 .sql, 811 .md.

## Raw Model Outputs

### Claude Review

See Detailed Findings above — reproduced in full from the review agent, with orchestrator grading applied per the rubric.

### Codex Review

Skipped (Phase 1 — Claude-only).

### Gemini Review

Skipped (Phase 1 — Claude-only).
