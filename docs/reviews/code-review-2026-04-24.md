# Code Review: SMD Services

**Date:** 2026-04-24
**Reviewer:** Claude Code (automated)
**Scope:** Full codebase
**Mode:** Full (Phase 1 — Claude-only)
**Models Used:** Claude (Sonnet)
**Golden Path Tier:** 1 (default; not enrolled in compliance dashboard)

## Summary

**Overall Grade: C+** (stable vs C on 2026-04-16)

The codebase is in materially better shape than at the prior review. Every one of the six critical CLAUDE.md Pattern A/B violations from the 2026-04-15 audit has been remediated, and the multi-layer defense around the no-fabrication rule (forbidden-strings test, send-gate, contact-name guard, authored-content PDF gate) is genuinely exemplary work. The prior critical milestone DAL gap (#399) is now mitigated and tested cross-org. The remaining gaps are workmanlike: rate limiting on auth/contact endpoints, zero test coverage in the workers/ tree, an unused `pdf-lib` dependency, the README stub, and admin Astro pages that have grown into 1000+ LOC monoliths mixing concerns.

## Scorecard

| Dimension     | Grade | Trend     |
| ------------- | ----- | --------- |
| Architecture  | B     | stable    |
| Security      | D     | stable\*  |
| Code Quality  | B     | improved  |
| Testing       | B     | stable    |
| Dependencies  | B     | stable    |
| Documentation | C     | regressed |
| Golden Path   | B     | stable    |

\*Security stayed at D by letter (high findings present) but improved within bucket: prior critical (#399 milestone DAL) is resolved.

## Detailed Findings

### 1. Architecture

Findings:

1. [medium] `src/lib/db/context.ts:181` — `getContextEntry()` and related read helpers (`listContext`, `assembleEntityContext`) take only entity/id, not `orgId`. All other DAL modules require org scoping. Risk is latent (callers currently validate ownership upstream) but the inconsistency is a future footgun. Recommendation: add `orgId` parameter to match the rest of the DAL.
2. [medium] 23 files exceed 500 LOC. The largest admin Astro pages (`src/pages/admin/entities/[id].astro` at 1347, `src/pages/admin/entities/[id]/quotes/[quoteId].astro` at 1059, `src/pages/admin/engagements/[id].astro` at 968) inline data fetching, business rules, and rendering — including DOM-via-`innerHTML` template literals at lines 926–999 of `[quoteId].astro`. Recommendation: extract data-fetch into `src/lib/db/` helpers; move client-side row-builder logic into a TS module using `document.createElement`.
3. [low] `src/middleware.ts:71` — backwards-compat redirect uses `pathname.startsWith('/auth/login')` while the parallel admin redirect on line 64 documents strict equality as the invariant. Recommendation: tighten to `pathname === '/auth/login'` for consistency.
4. [low] `src/lib/sow/service.ts:241` — hardcoded `"If you have any questions, reply directly to this email."` in SignWell send payload. Not a Pattern A/B violation (generic support instruction, no commitment) but also not authored per-engagement. Recommendation: move to a configurable template or annotate intent.
5. [positive control] Three-subdomain routing in `src/middleware.ts` is correctly implemented: per-host cookie isolation (no `Domain=` attribute), backwards-compat 301s, rewrite logic, host-match refresh. No finding.

Grade: **B**
Rationale: Structure is coherent (middleware + subdomains + DAL are the right shape). 23 oversize files is the trend that prevents an A; the admin detail pages mixing concerns is the architectural cost. No regression vs prior review.

### 2. Security

Findings:

1. [high] `src/pages/api/auth/login.ts` and `src/pages/api/auth/magic-link.ts` — no rate limiting. Booking and intake endpoints already use `rateLimitByIp` from `src/lib/booking/rate-limit.ts`; auth endpoints conspicuously do not. An attacker can brute-force admin passwords or enumerate client emails. Recommendation: apply the existing `rateLimitByIp` pattern, or add a Cloudflare rate-limit rule at the edge.
2. [high] `src/pages/api/contact.ts` — no rate limiting on the public contact form (only honeypot). Each valid POST triggers `sendEmail` via Resend. Recommendation: add `rateLimitByIp` or Turnstile.
3. [medium] `src/lib/db/context.ts:233–246` — `countContext()` and `getContextSize()` take only `entityId`, no `orgId`. Same pattern issue as Architecture #1. Recommendation: add `orgId` parameter.
4. [medium] `src/lib/booking/signed-link.ts:117` — `as unknown as ArrayBuffer` cast on `Uint8Array` for `crypto.subtle.verify`. Safe at runtime but a type escape. Recommendation: use `sigBytes.buffer` directly.
5. [low] `src/pages/contact.astro:124` — `innerHTML` injection of error messages from API response. Currently safe (errors are hardcoded strings server-side, not user-reflected) but fragile if `body.fields` ever reflects user input. Recommendation: switch to `textContent` for user-visible error messages.
6. [positive control] Cookie configuration is correct. `buildSessionCookie()` sets `HttpOnly; Secure; SameSite=Lax; Path=/` with no `Domain=`, correctly implementing host-scoped cookies per CLAUDE.md.
7. [positive control] SignWell webhook (`src/pages/api/webhooks/signwell.ts`) and Stripe webhook are well-implemented: HMAC-SHA256 with constant-time comparison, 300s replay window, signature verified before any payload action.
8. [positive control] All 12 DAL modules use D1 prepared statements with `bind()`. No string-interpolated SQL. All primary keys via `crypto.randomUUID()`.
9. [verified resolved] Prior critical (#399 milestone DAL cross-tenant exposure) — fix is in code AND tested via `tests/admin/milestones.cross-org.test.ts`. The GitHub issue remains open but is a close candidate.

Grade: **D**
Rationale: Per rubric, any high-severity finding lands at D. Two exploitable rate-limit gaps (auth, contact) are the reason. Stable vs prior in letter grade, improved within bucket (critical → high) because the milestone gap is resolved.

### 3. Code Quality

Findings:

1. [medium] `src/lib/enrichment/index.ts:241–605` — `as unknown as Record<string, unknown>` used 9 times to push typed enrichment results into the `appendContext` `metadata` field. Defeats type checking on metadata content. Recommendation: widen `metadata` to a typed union or to `object | null`, eliminating the casts.
2. [medium] `src/lib/booking/intake-core.ts:146` — open TODO with no GitHub issue reference. Recommendation: link to a tracked issue.
3. [medium] Large admin Astro pages build DOM via `innerHTML` template strings (e.g., `[quoteId].astro:926–999`). Admin-only surface with no user-controlled reflection, but pattern is hard to audit. Recommendation: extract row-builders to a TS module using `createElement`.
4. [low] TypeScript is strict throughout. Zero explicit `: any`, zero `@ts-ignore`/`@ts-nocheck` in `src/`. The only escapes are the enrichment casts (above) and one in `signed-link.ts` (flagged in Security).
5. [low] Error handling across API routes is consistent — structured JSON, appropriate status codes, graceful degradation on non-critical side effects.
6. [low] Dead-export risk in context module: `getContextEntry()` is exported but only called internally. Tracked under Architecture #1.
7. [verified resolved] All six prior critical Pattern A/B violations from the 2026-04-15 audit are remediated. See No-Fabrication Audit section below.

Grade: **B** (improved from D)
Rationale: Strict TS, consistent error handling, no `any` leakage. Remaining issues are medium (cast patterns, DOM-via-innerHTML in admin). No critical findings. The B is a recovery from D driven entirely by closing all Pattern A/B violations from the prior review.

### 4. Testing

Findings:

1. [high] `workers/job-monitor/`, `workers/new-business/`, `workers/review-mining/`, `workers/social-listening/` — zero `.test.ts` files across all four. These workers form the top of the lead-enrichment pipeline. Recommendation: add at minimum smoke tests covering happy path, invalid API key, malformed body, and enrichment failure for each deployed worker.
2. [medium] 59 tests for ~63K LOC (~0.94 tests / 1000 LOC). Test quality is high where tests exist (cross-org, webhook integration, forbidden-strings regression guard) but large surfaces are untested at the unit level: `src/lib/enrichment/index.ts` (709 LOC), `src/lib/sow/service.ts` (857 LOC), most admin pages. Recommendation: prioritize unit tests for the SOW service and enrichment pipeline orchestration.
3. [low] `src/lib/webhooks/signwell-handler.test.ts` (533 LOC) — thorough integration tests with D1 migrations, fake R2, mocked SignWell/Resend. Strong.
4. [low] `tests/portal/tenant-scoping.cross-org.test.ts`, `tests/admin/milestones.cross-org.test.ts`, `tests/admin/resend-invitation.cross-org.test.ts` — verify cross-tenant data is inaccessible. Milestones test documents resolution of #399. Strong.
5. [low] `tests/forbidden-strings.test.ts` — best-in-class regression guard. Scans all source files for Pattern A/B violations including structural regexes. This is exemplary infrastructure.

Grade: **B**
Rationale: Test count is thin but quality is high where applied. Worker test gap is the single biggest miss but doesn't affect the production website code path. The forbidden-strings test is unusually good defensive infrastructure.

### 5. Dependencies

Findings:

1. [medium] `pdf-lib ^1.17.1` declared in devDependencies but `grep -r 'pdf-lib' src/` returns zero results. `@formepdf/core` and `@formepdf/react` are the active PDF libraries. Recommendation: remove `pdf-lib` from `package.json` and verify `npm run verify` still passes.
2. [medium] 6 moderate `npm audit` findings, all chaining through `@astrojs/check → volar-service-yaml → yaml`. The yaml CVE is in devDependency tooling (typecheck), not runtime. Fix requires downgrading `@astrojs/check` to 0.9.2 (major-version downgrade). Recommendation: downgrade and verify `npm run typecheck` passes; document if deferred.
3. [low] No `eval`-adjacent dependencies. No Ajv, Handlebars, JSON Schema validators. WASM in `@formepdf/core/pkg/forme_bg.wasm` uses the correct Workers pattern.
4. [low] `wrangler 4.78.0` listed under `dependencies` not `devDependencies`. Wrangler is only needed for deploy/dev. Low risk (Workers bundle size measured separately) but worth moving for hygiene.
5. [low] React 19, Astro 6, Vitest 3, ESLint 9 are all current major versions.

Grade: **B**
Rationale: All findings are in dev tooling, not production runtime. 6 moderate audits is a borderline call (strict rubric reading would be C) but the practical attack surface is zero.

### 6. Documentation

Findings:

1. [high] `README.md` (674 bytes) is misdirecting. References slash commands `/sod` and `/eod` that no longer exist; describes a directory structure that doesn't match the current repo. Recommendation: rewrite to reflect Astro + Workers stack, the `npm run` script catalog, the three-subdomain routing model, and a pointer to `CLAUDE.md`.
2. [medium] No aggregated documentation for 54 REST endpoints in `src/pages/api/`. Some routes (`/api/booking/reserve`, `/api/ingest/signals`) have good header comments; most do not. Recommendation: add `docs/api/routes.md` listing each endpoint with auth requirement (admin / client / API key / public) and one-line description.
3. [low] `CLAUDE.md` (21KB) is comprehensive and current. Three-subdomain architecture, Workers migration, no-fabrication rule with file paths, tone standard, and business model are all accurate. The historical Pattern A/B violation examples it cites have been remediated; consider annotating them as "historical examples" so new agents don't waste time grepping for absent strings.
4. [low] `src/lib/sow/service.ts` (857 LOC) — module-level docs are good but the `finalizeCompletedSOWSignature` orchestration function lacks per-step inline comments comparable to the 7-step flow already documented in `completeMilestoneWithInvoicing`.
5. [low] SS not enrolled in the Crane compliance dashboard; this review and the prior three serve as the de facto baseline.

Grade: **C**
Rationale: README stub is the determining factor — misdirecting docs are worse than missing docs. CLAUDE.md is excellent and is the only thing keeping this from being a D.

### 7. Golden Path Compliance (Tier 1)

Findings:

1. [low] SS not enrolled in the Crane compliance dashboard; defaulted to Tier 1.
2. [pass] All Tier 1 requirements met: source-control standards (PRs to main + `verify.yml`), CLAUDE.md present and useful, TypeScript + ESLint 9 (flat config), no hardcoded secrets in source (`wrangler.toml` `[vars]` is public env only; secrets via `wrangler secret put` / Infisical bulk-load), basic CI passing.
3. [medium] `wrangler.toml` staging environment reuses prod D1/R2/KV bindings. The comment acknowledges the gap ("flip to separate resources when we need data isolation"). Any staging deploy writes to production data. Recommendation: provision separate staging bindings; until then, add a CLAUDE.md warning.

Grade: **B**
Rationale: All critical Tier 1 requirements pass. Staging-binding overlap is the single non-critical gap.

## CRITICAL — No-Fabrication Audit

This audit verifies that the six P0 Pattern A/B violations cited in CLAUDE.md (from the 2026-04-15 audit) have been remediated.

**All six violations: REMEDIATED.** Verified via grep across `src/`:

| Prior violation                                                                | Status | Verification                                                                                                                                                                                   |
| ------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'We'll reach out to schedule kickoff.'`                                       | absent | grep returns 0 hits                                                                                                                                                                            |
| `'Work begins within two weeks of signing.'`                                   | absent | grep returns 0 hits                                                                                                                                                                            |
| `'Replies within 1 business day.'`                                             | absent | grep returns 0 hits                                                                                                                                                                            |
| `'A 2-week stabilization period follows the final handoff.'` (marketing)       | absent | grep returns 0 hits in marketing surfaces; only present in SOW PDF template (signed-contract context, exempt per CLAUDE.md Rule 3) and as historical comment in `src/lib/portal/status.ts:119` |
| `'We shadow and observe.' / 'We redesign together.' / 'Training and handoff.'` | absent | grep returns 0 hits                                                                                                                                                                            |
| `'Operations cleanup engagement as discussed during assessment.'`              | absent | grep returns 0 hits                                                                                                                                                                            |
| `contactName: primaryContact?.name ?? 'Business Owner'`                        | absent | replaced with hard guard at `src/pages/api/admin/quotes/[id].ts:67–86` that blocks PDF generation when contact name is missing                                                                 |
| `?? 'Scott'` consultant fallback                                               | absent | replaced with `string \| null` plumbing through PortalHeader                                                                                                                                   |

**Defensive infrastructure verified:**

1. `tests/forbidden-strings.test.ts` — scans all source files for Pattern A/B regression. Comprehensive pattern list including structural regexes (quantified time-savings, stabilization windows). Exemplary.
2. `src/pages/api/admin/quotes/[id].ts:67–86` — blocks SOW PDF generation when authored data (contact name, engagement overview) is missing.
3. `src/pages/portal/quotes/[id].astro:108–133` — `consultantName` and `nextStepText` are pulled exclusively from authored DB columns; null-to-null with no fabricated fallback.

**Borderline items (no action required):**

1. `src/lib/pdf/sow-template.tsx:539–570` — SOW terms include "5 business days," "We will confirm the start date," "stabilization period," "3 business days' written notice." Per CLAUDE.md Rule 3, these are exempt because they appear in signed contractual documents, not marketing. The inline comment (lines 514–527) cites the policy correctly. No change required, but if the no-fabrication rule is ever extended to signed documents, these are the first lines to revisit.
2. `src/lib/portal/status.ts:119, 136` — `safety_net` engagement status renders as "Stabilization" to clients. The label itself names no duration; Decision #27's 2-week default is not surfaced. Clean.
3. `src/pages/portal/quotes/[id].astro:72–76` — `engagementTitle = deliverables[0]?.title ?? 'Engagement'`. Generic word, not a commitment. Monitor for drift toward commitment language.

## Model Convergence

Single-model review (Claude only). Phase 2 will add Codex and Gemini for convergence reporting.

## Trend Analysis

| Dimension     | 2026-04-07 | 2026-04-16 | 2026-04-24 | Direction                                                          |
| ------------- | ---------- | ---------- | ---------- | ------------------------------------------------------------------ |
| Architecture  | (n/a)      | B          | B          | stable                                                             |
| Security      | (n/a)      | D          | D          | stable in letter; improved in bucket (critical→high)               |
| Code Quality  | (n/a)      | D          | B          | improved (all 6 critical Pattern A/B violations remediated)        |
| Testing       | (n/a)      | B          | B          | stable                                                             |
| Dependencies  | (n/a)      | B          | B          | stable                                                             |
| Documentation | (n/a)      | B          | C          | regressed (README stub more visible after compliance debt cleared) |
| Golden Path   | (n/a)      | B          | B          | stable                                                             |
| **Overall**   | D          | C          | C+         | improved                                                           |

**Issue resolution since 2026-04-16:**

- 8 of 13 source:code-review labeled issues CLOSED: #172, #173, #174, #179, #400, #401, #402, #403
- 5 OPEN:
  - **#398** ([Code Review] Pattern A/B violations) — substantively resolved per this audit; **close candidate**
  - **#399** ([Code Review] milestones DAL org_id) — fix in code + tested cross-org; **close candidate**
  - **#404** ([Code Review] workers CI typecheck + deps alignment) — open
  - **#409** (build break: react explicit dep) — open
  - **#419** (portal Pay CTA → nonexistent route) — open

## File Manifest

See `/tmp/crane-file-manifest-ss.md` for the full manifest. Summary:

- **Languages:** TypeScript (236 .ts), Astro (76 .astro), Markdown (180), HTML (41), JSON (29), SQL (28), TOML (20), YAML (6)
- **Total source LOC:** ~62,866 (.ts + .tsx + .astro)
- **Files > 500 LOC:** 23 (largest: `src/pages/admin/entities/[id].astro` at 1347)
- **Tests:** 59 test files (`.test.ts` + `.spec.ts`); 56 in `tests/`, 3 in `src/`, **0 in `workers/`**
- **Migrations:** 27 SQL files
- **API endpoints:** 54 in `src/pages/api/`
- **Workers:** 4 (`job-monitor`, `new-business`, `review-mining`, `social-listening`)
- **npm audit:** 6 moderate, 0 high, 0 critical (all in devDep tooling chain)
- **Total deps:** 724 (300 prod + 305 dev + 132 optional)

## Top 10 Action Items (ranked)

1. **[high]** Add rate limiting to `src/pages/api/auth/login.ts` and `src/pages/api/auth/magic-link.ts` using existing `rateLimitByIp()` from `src/lib/booking/rate-limit.ts`.
2. **[high]** Add rate limiting to `src/pages/api/contact.ts` (currently only honeypot).
3. **[high]** Add tests for the four deployed workers (`workers/job-monitor`, `new-business`, `review-mining`, `social-listening`). Currently zero coverage.
4. **[high]** Rewrite `README.md` to reflect current stack and remove references to nonexistent `/sod`, `/eod` commands.
5. **[medium]** Remove unused `pdf-lib ^1.17.1` from `package.json` devDependencies.
6. **[medium]** Downgrade `@astrojs/check` to 0.9.2 to clear 6 moderate `npm audit` findings; verify `npm run typecheck` still passes.
7. **[medium]** Add `orgId` parameter to `getContextEntry`, `listContext`, `countContext`, `getContextSize` in `src/lib/db/context.ts`.
8. **[medium]** Provision separate D1/R2/KV bindings for `wrangler.toml` staging environment; until done, add a CLAUDE.md warning.
9. **[medium]** Extract data-fetch and DOM-build logic out of admin Astro monoliths (`[id].astro`, `[quoteId].astro`, `engagements/[id].astro`).
10. **[medium]** Close issues #398 (Pattern A/B — verified resolved) and #399 (milestones DAL — verified resolved). Add `docs/api/routes.md` listing all 54 endpoints with auth requirement.

## Raw Model Output

### Claude Review

(Full output captured by orchestrator and reflected in the structured findings above. Sub-agent ID for continuation: a3b2694862b363f6a.)

### Codex Review

Skipped (Phase 1 — Claude-only).

### Gemini Review

Skipped (Phase 1 — Claude-only).
