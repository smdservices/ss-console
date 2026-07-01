# Code Review: SMD Services

**Date:** 2026-06-30
**Reviewer:** Claude Code (automated — 3 parallel review agents + orchestrator verification)
**Scope:** Full codebase, `venturecrane/ss-console` (worktree off `feat/booking-email-delivery-webhook-alerts`)
**Mode:** Full (Phase 1 — Claude-only; Codex/Gemini skipped)
**Golden Path Tier:** 2 (SSR app on Cloudflare Workers, production CI/CD)

## Summary

**Overall: C** (down from B− on 2026-06-12 — but see Trend; the prior review was a different, focused two-repo scope and the headline new finding sits on a newer surface).

The platform's bones are genuinely strong: the subdomain/auth middleware is exemplary, webhook signature verification is uniformly fail-closed with constant-time comparisons and replay protection, all D1 access is parameterized, `npm run verify` passes fully live (3,359 tests green across 203 files + all 7 worker suites), there are zero dependency vulnerabilities anywhere, and the docs tree is unusually thorough and test-enforced. The grade is pulled to C by **three live, production-affecting issues**, each independently verified against prod state:

1. **[CRITICAL] A live, unauthenticated, unrate-limited Anthropic proxy** at `/api/assessment/llm` — `ELEVENLABS_LLM_SECRET` is unset in prod (auth is gated behind `if (expected)`), `ANTHROPIC_API_KEY` is present, so anyone can POST conversation turns and drain SMD's Anthropic budget today.
2. **[CRITICAL] A Pattern-B content-policy violation on a live financial document** — `service-finalize.ts:123` hardcodes `'Deposit - Operations Cleanup Engagement'` as the description on every client's Stripe invoice, regardless of actual scope. This is the exact phrase family CLAUDE.md names as a previously-fixed P0 fabrication; the 2026-06-12 cleanup pass didn't reach this file.
3. **[CRITICAL — ops] Production error monitoring is dark** — `SENTRY_DSN` was never provisioned in prod, so the (correct, ready) Sentry integration opens no transport. Any unhandled prod exception is invisible.

A recurring root cause threads through the security findings: **routes that intend their own non-Clerk auth, placed under `/admin` or as bare paths, interact badly with the path-prefix middleware gate** — yielding one live open proxy, one permanently-broken OAuth CSRF check, and one unreachable machine-health endpoint, all invisible to a test suite that mocks past the middleware boundary.

## Scorecard

| Dimension     | Grade | Trend                         |
| ------------- | ----- | ----------------------------- |
| Architecture  | B     | stable                        |
| Security      | D     | regressed (from C)\*          |
| Code Quality  | C     | stable                        |
| Testing       | C     | stable                        |
| Dependencies  | B     | stable                        |
| Documentation | B     | regressed (from A)            |
| Golden Path   | C     | regressed (from B)            |

\* The 2026-06-12 review (focused on AI-slop/dead-code across two repos) did not surface the open LLM proxy; it sits on the newer ADR-0039 voice surface. Most movement is newly-exposed risk, not regression of previously-clean surface.

## Detailed Findings

Severity tags: [C]=critical, [H]=high, [M]=medium, [L]=low. File:line refs verified against the worktree; the three criticals additionally verified against live prod secret state.

### 1. Security — Grade: D

1. [C] **`src/pages/api/assessment/llm.ts:66-92` — live unauthenticated Anthropic proxy.** Auth is gated behind `if (expected)` (line 68): when `ELEVENLABS_LLM_SECRET` is unset the endpoint is "open (dogfood default)" per its own doc comment. **Verified:** `ELEVENLABS_LLM_SECRET` is *missing* in `/ss` prod and `ANTHROPIC_API_KEY` is *present*, so line 73's 503 guard does not fire. No rate limiting exists in the route or in `src/lib/claude/assessment-llm.ts` (only `MAX_TOKENS` caps output); `parseMessages` permits 200 messages/request with no per-message length cap. The route is public (not under `/api/admin` or `/api/portal`), reachable at `smd.services/api/assessment/llm`. **Fix (do first):** make the secret check fail-closed (`if (!expected) return json(503, …)` instead of allowing open access), provision `ELEVENLABS_LLM_SECRET` in prod and on the ElevenLabs agent config, add per-IP rate limiting matching the `/api/booking/reserve` pattern, and cap message/content length.
2. [H] **`src/pages/api/oauth/callback.ts:159-196` + `src/middleware.ts:39-50,297` — OAuth-connector CSRF check can never pass.** `resolveAdminSession` only populates `locals.session` for paths starting `/admin` or `/api/admin` (middleware.ts:40); `/api/oauth/callback` is neither (it's excluded from the admin rewrite at middleware.ts:106), so `locals.session` is always `null` and `reviewerMatches(null, reviewer_id)` always returns `false` → every real admin OAuth callback hits `reviewer_mismatch`. Fails closed (not a bypass) but the connector-consent flow is structurally broken while CI is green. **Fix:** widen `resolveAdminSession`'s gate to include `/api/oauth/callback`, or have the callback read `locals.auth()` (Clerk, populated for every request) directly and look up the admin row, matching the working portal-side callback.
3. [H] **`src/pages/api/admin/fleet/health.ts` + `src/middleware.ts:267-280` — machine-bearer route shadowed by the Clerk gate.** This route is built for a non-browser caller (`verifyHealthReadKey`, the Operator's `health_monitor` skill) but lives under `/api/admin`, where `enforceAdminAuth` unconditionally requires `locals.auth().userId` + `session.role === 'admin'` before the handler's own bearer check runs. A bearer-only request with no Clerk cookie is 401'd by middleware. The codebase's own convention for machine-bearer routes (`/api/internal/heartbeat.ts`, `/api/internal/runtime-summary.ts`) deliberately lives outside `/api/admin`. No test exists, so the break is unverified in CI — the fleet-health monitoring this exists to support is likely non-functional. **Fix:** move to `/api/internal/fleet-health` (house convention) or add an explicit middleware carve-out before the Clerk gate.
4. [L] **`src/pages/api/booking/reserve.ts:88-134` — unbounded free-text into D1** from a public endpoint (rate-limited 10/hr/IP, so blast radius is small). **Fix:** add max-length checks (2-5KB) on free-text fields.

**Positive (no finding):** Webhook signature verification (SignWell HMAC+timestamp, Resend/Svix, Stripe, Sentry HMAC, Healthchecks bearer) is uniformly fail-closed on missing secret, uses constant-time comparison and replay windows, and SignWell defers parsing until after hash verification (issue #833 hardening). All `src/lib/db/*` SQL is parameterized; dynamic fragment builders interpolate only hardcoded column names with `?` placeholders, values always via `.bind()`. No hardcoded secrets in source. Sampled IDOR-prone portal endpoints (`portal/quotes/[id]/sow.ts`, `portal/documents/[...key].ts`) correctly scope every lookup to the client's id/org and validate path traversal. `security.yml` runs gitleaks + npm audit + Semgrep (`p/security-audit`, `p/owasp-top-ten`) + a nosemgrep-justification gate.

**Grade rationale:** One live critical (unauthenticated cost-bearing endpoint = "missing auth on a sensitive endpoint") forces D. Held off F because it is cost/budget exposure rather than customer-data exfiltration or SQL injection, and the rest of the security surface (webhook crypto, SQL, IDOR scoping, secret hygiene, CI scanning) is genuinely strong.

### 2. Code Quality — Grade: C

1. [C] **`src/lib/sow/service-finalize.ts:123` — fabricated client-facing content on a Stripe invoice (P0).** `description: 'Deposit - Operations Cleanup Engagement'` is hardcoded on every client's invoice regardless of scope — the phrase family CLAUDE.md names as a fixed Pattern-B violation (`'Operations cleanup engagement as discussed during assessment.'`). `git blame` predates the 2026-06-12 Pattern-A cleanup (#1348), which didn't reach this file. **Fix:** source from the quote's authored `engagement_overview`/`milestone_label` (existing columns, `quotes.ts:51-52`), fall back to explicit "TBD" per `docs/style/empty-state-pattern.md`, never a synthesized phrase. Extend the forbidden-strings guard to cover Stripe/PDF invoice paths.
2. [H] **`service-finalize.ts:65-69` and `:89-93` — discarded `sendEmail` results.** Both `handleSignedEmailJob` ("SOW Signed - Next Steps") and `handlePortalInvitationJob` (portal welcome) `await sendEmail(...)` and discard the `SendResult` without checking `.success` — the exact bug class CLAUDE.md flags as historical, and which `confirmation-emails.ts` (commit 41cf0f1) was *just* hardened against. A Resend rejection here means a client signs and never learns next steps, or never gets portal access, with zero visibility. **Fix:** apply the check-and-alert pattern from `confirmation-emails.ts` to both jobs.
3. [H] **Dead exports, no CI gate.** A sweep of ~955 named exports under `src/lib`/`src/portal` found confirmed zero-reference exports: `ENTITY_TIERS` + `createEntity` (`db/entities.ts` — entities are created via the unexported `insertEntityIfMissing:365`), `MEETING_STATUSES` (`db/meetings.ts`), `INVOICE_STATUSES` (`db/invoices.ts`), `SERVICE_STATUSES` (`db/services.ts`), `createOutboxJob` (`sow/store.ts` — outbox rows inserted via raw inline SQL in `service-finalize.ts:224/238/259`, bypassing the helper), `getDocument` (`signwell/client.ts`), `distinctAuditActions` (`portal/operator/audit.ts:585`), `ASSESSMENT_OPENING_MESSAGE` (`claude/assessment.ts`). ~190 more are exported-but-internal-only (lower severity). **Fix:** adopt `knip` or `ts-prune` in CI.
4. [M] **Webhook payloads cast, not parsed** (`webhooks/stripe.ts:44`, `sentry.ts:74`, `resend.ts:103`, `signwell.ts:68` all `JSON.parse(raw) as T`). HMAC verifies the *sender*, but the JSON *shape* is never runtime-validated — a provider API-version change surfaces only where a field happens to misbehave. Contrast `admin/entities/bulk.ts:50` (cast to all-`unknown`, then validate each field). **Fix:** apply narrow-after-cast to webhook payloads.
5. [M] **`src/lib/email/templates.ts` DRY** — a full `<!DOCTYPE html>…` wrapper is repeated in 9 template functions (lines 22, 71, 112, 146, 199, 271, 340, 370, 435, 509). **Fix:** `wrapEmailLayout()` helper.
6. [M] **Admin-auth guard copy-paste** — `if (!session || session.role !== 'admin')` (or its JSON-response form) is duplicated verbatim across ~48 `src/pages/api/admin/**` files. Reasonable defense-in-depth, but a new permission tier would require ~48 edits. **Fix:** extract `requireAdminSession(locals)` in `lib/auth`.

**Positive (no finding):** No empty `catch {}` anywhere in `src`; every swallowed-error path carries an explanatory comment. `as any` is effectively absent. The one module-level mutable state (`pdf/render.ts:36`, WASM-init memoization) is a documented, justified exception citing the coding standard by section.

**Grade rationale:** Mechanical hygiene is genuinely good (strict TS, no floating promises, no empty catches, minimal `any`), but a recurring P0 fabrication + a recurring discarded-email pattern + accumulated dead-export debt with no automated gate hold it at C.

### 3. Architecture — Grade: B

1. [H] **API helper duplication with signature drift.** `src/lib/api/helpers.ts` exports a canonical `jsonResponse(status, data)` (created in the 2026-06-12 dedup), yet 18 route files still define a local copy — and at least two **invert the argument order**: `api/admin/entities/bulk.ts:128` and `api/webhooks/sentry.ts:156` define `jsonResponse(body, status)`. A latent bug if code is copied between files (loose typing masks the swap). **Fix:** delete local copies, import the shared helper, add a lint rule banning local re-declaration.
2. [H] **`reserve.ts` over the 75-line function ceiling** despite prior helper extraction: `handlePost` (101), `commitBookingToDb` (85), `syncGoogleCalendarAndPromote` (80). **Fix:** extract `handlePost`'s four labeled phases into named orchestration calls, as `service-finalize.ts` does for outbox dispatch.
3. [M] **Data-access boundary leaking into `.astro` pages** — 10 pages embed raw `env.DB.prepare()` SQL in frontmatter instead of delegating to `lib/db/*`. Worst: `portal/index.astro:82-136` (4 queries + pending-invoice sort/filter logic duplicating `lib/db/invoices.ts` + `milestones.ts`). Others: `admin/entities/[id]/meetings/[meetingId].astro:52-59`, `admin/generators/index.astro:63-130`, `auth/verify.astro`, `portal/quotes/[id].astro`, `portal/invoices/[id].astro`. **Fix:** route page data access through `lib/db` or a dedicated reader.
4. [M] **`src/lib/operator/customer-yaml/types.ts` is 949 lines** — ~2× the ceiling; its header admits it exists "so validator.ts stays under 500." Ceiling met by displacement, not reduction. The sibling `sections-*.ts` (17 files) proves the team can decompose by domain. **Fix:** split along the same seams, or formally exempt declarative type-only files in `coding-standards.md`.
5. [M] **API handler style split ~39/31** between `handlePost` + thin wrapper vs. inlining in `export const POST`. No rule. The wrapper is more testable. **Fix:** standardize on the wrapper.
6. [L] **`SlotPicker.astro` inlines ~370 lines of client JS** (`<script is:inline>` 154-525) while equivalent booking logic is extracted to `src/scripts/*`. **Fix:** extract to `src/scripts/slot-picker.ts`.

**Positive (no finding):** `src/middleware.ts` (319 lines) is the house style done right — single-purpose functions per routing concern, comments encoding the learned no-self-redirect-loop lesson. `lib/` is genuinely domain-organized.

**Grade rationale:** Architecture is coherent and the team demonstrably knows how to decompose; debt (inline SQL in pages, helper signature drift) is real but localized and identified, not pervasive — B.

### 4. Testing — Grade: C

1. [H] **`tests/oauth-callback.test.ts:41-51` mocks past the middleware** — invokes `GET` with a hand-built `locals.session`, never exercising `src/middleware.ts`, so it asserts handler logic in isolation while the real path (which never populates `locals.session` for this route — Security #2) stays broken. The "mocks hide integration bugs" pattern, on the auth boundary. **Fix:** add an integration test that runs the real middleware against `/api/oauth/callback` (as `tests/middleware-behavior.test.ts` does for pages).
2. [M] **`tests/middleware.test.ts:164-183` is a source-regex assertion**, not behavioral — it locks in the literal condition causing the OAuth bug, so the actual fix (widening the gate) would force a rewrite of this test. It guards *for* the bug. **Fix:** assert the runtime consequence (does `locals.session` populate for `/api/oauth/callback`?).
3. [M] **No coverage for `handleBookingEmailDeliveryFailure`** (`webhooks/booking-email-failure.ts:91-125`) — the orchestration behind the just-shipped commit 41cf0f1. Only the pure parser is tested. **Fix:** drive the full function against the D1 harness with a stubbed alert send.
4. [M] **No test for `/api/admin/fleet/health`** (Security #3) — the route's brokenness is invisible to CI.
5. [M] **No test for `/api/assessment/llm` auth-by-default-open** (Security #1) — the missing-secret-means-open condition is untested.
6. [L] **Coverage thresholds pinned to baseline** — `vitest.config.ts`: lines 22, branches 67, functions 52, statements 22, explicitly "the 2026-04-16 baseline, not aspirational." Branch 67% is reasonable; line/statement 22% leaves wide latitude for untested route handlers.

**Positive (no finding):** `tests/booking/reserve.test.ts` is exemplary — real D1 via `@venturecrane/crane-test-harness` with migrations, mocking only true externals (Resend, Google), covering validation, 429 rate-limit, calendar-unavailable, happy path, and the compensating rollback on calendar failure. This is the shape the rest should follow. `tests/forbidden-strings.test.ts` (727 lines) is a meaningful regression lock for the Pattern A/B policy (limitation: catches known strings, not new semantic variants).

**Grade rationale:** Where integration tests exist they're high quality and catch real bugs, but the auth boundary and the two newest/highest-risk surfaces ship with zero/partial failure-mode coverage, and thresholds permit it — C.

### 5. Dependencies — Grade: B

1. [M] **No npm coverage in dependabot** — `.github/dependabot.yml` configures only `github-actions`. `npm outdated` shows silent drift: `astro` 6.4.7→7.0.4 (major), `typescript` 5.9.3→6.0.3 (major), `@astrojs/cloudflare` 13.5.2→14.0.2 (major), plus minor lag on wrangler/eslint/vitest/tailwind. **Fix:** add an `npm` ecosystem block (grouped, weekly, routed through `dependabot-auto-merge.yml`), patch/minor auto-merge, majors manual.
2. [M] **`security.yml` audit only runs at repo root** — does not iterate `workers/*/` (separate lockfiles). All 7 are clean today, but a worker-only vuln wouldn't fail CI. **Fix:** add the `for dir in workers/*/` loop already used in `verify.yml`/`deploy.yml`.
3. [L] **`zod` (prod dep) imported in only 5 files**, none of the 92 `src/pages/api/` routes — those hand-roll validators. Satisfies "parse, don't cast" in spirit but maintains two idioms. **Fix:** a style decision (standardize on zod, or document hand-rolled type-guards as house style).
4. [INFO] **`ajv` present but dev-only transitive** (via `@astrojs/check`/eslint) — zero direct imports, not bundled into the Worker, so **no workerd `EvalError` risk**.

**Positive:** `npm audit` clean at root + all 7 workers (0 vulns). No genuinely unused dependencies (`@astrojs/*`, `wrangler`, `@venturecrane/tokens` all used via config/CLI/CSS-import, not direct imports).

**Grade rationale:** Clean security and no dead weight, but 1-2 key majors behind with no automated currency mechanism — B.

### 6. Documentation — Grade: B

1. [H] **CLAUDE.md auth section is stale.** The Three-Subdomain Architecture section describes auth purely as per-host session cookies and **never mentions Clerk** (`grep Clerk CLAUDE.md` → nothing), but `src/middleware.ts:1-31` documents the 2026-05-25 unified model where **Clerk is the primary identity layer** for both admin and portal, with the session-cookie path now legacy/fallback. An agent reading CLAUDE.md builds a ~6-week-stale mental model of a security-sensitive subsystem. **Fix:** update the section to describe Clerk as primary with the session cookie as documented fallback, matching `middleware.ts`.
2. [L] **README version drift** — claims "Vitest 3, ESLint 9"; actual `eslint@10.3.0`, `vitest@4.1.8`. **Fix:** bump the two numbers.
3. [INFO] **No formal API docs** for the 92 `src/pages/api/` routes (no OpenAPI/`docs/api/`). Acceptable for an internal admin/portal/webhook surface at this stage.

**Positive:** Docs are exemplary — 222 markdown files across 22 subdirs (58 ADRs, 33 handbook pages), handbook-integrity tests in CI, and spot-checks of 4 CLAUDE.md claims (npm scripts, all 15 cited ADRs resolve, connector-dir removals, env-access pattern) all accurate. Strong "why not what" inline comments in `quotes.ts`, `astro.config.mjs`, `middleware.ts`.

**Grade rationale:** Otherwise A-grade documentation, but a HIGH-severity stale section on the security-relevant auth model caps the dimension at B until fixed.

### 7. Golden Path Compliance (Tier 2) — Grade: C

1. [C] **Production error monitoring is dark.** `src/lib/observability/sentry.ts` wraps the handler via `Sentry.wrapRequestHandler`, conditional on `env.SENTRY_DSN`. **Verified:** `SENTRY_DSN` is *absent* from `/ss` prod. So no transport opens — any unhandled prod exception or 5xx is invisible except via `wrangler tail`/Cloudflare dashboard. The integration code is correct and ready; only the secret is missing. **Fix:** provision a Sentry project, set `SENTRY_DSN` in prod via Infisical → Workers secret, verify with a deliberate test exception before closing this gate.
2. [PASS] **CI/CD exceeds the Tier 2 bar.** `verify.yml` runs on every PR: typecheck → typecheck:workers → format:check → lint → build → test → test:workers. `security.yml`: npm audit (`--audit-level=high`), gitleaks (auto-fetches latest), astro check, Semgrep (4 rulesets), nosemgrep-justification audit. `deploy.yml`: wrangler dry-run, D1 migrations before app publish, deploys all 7 workers (3 were added after the 2026-06-12 review — good self-correction). **`npm run verify` ran live end-to-end and passed:** 0 typecheck errors, 0 lint errors (20 pre-existing `any` warnings), build OK, 3,359 tests pass / 2 skipped across 203 files, all 6 worker suites green.
3. [PASS] Tier 1 baseline: git, extensive CLAUDE.md, TS strict + ESLint flat config with `no-floating-promises: error`, `.gitleaks.toml` wired into `security.yml`, no hardcoded secrets, no tracked `.env`/`.dev.vars`.
4. [MANUAL-CHECK] **Branch protection on `main`** — confirm in GitHub settings that direct pushes are blocked and `verify`/`security` are required checks.
5. [MANUAL-CHECK] **Uptime monitoring** — no code-visible synthetic check against the three hosts. Worth confirming given finding #1 means an uptime check is currently the *only* possible prod health signal.

**Grade rationale:** Process is strong and verified-live, but one critical Tier-2 requirement (error monitoring) is effectively missing in prod, plus two unverified manual-check items — C.

## Trend Analysis

Previous review: **2026-06-12, Overall B−** (a Captain-directed AI-slop/dead-code focus spanning both `ss-console` *and* `hermes-smd-overlay`, deep-diving `operator/`). This review is the standard full-codebase pass over `ss-console` only — so the scopes are not directly comparable.

- **Security C → D:** driven by the live unauthenticated LLM proxy, which sits on the newer ADR-0039 voice surface the prior review didn't cover. Not a regression of previously-clean code so much as newly-exposed risk.
- **Documentation A → B:** the stale Clerk auth section in CLAUDE.md (the May migration predates both reviews; this pass caught it).
- **Golden Path B → C:** `SENTRY_DSN` confirmed-dark in prod this pass.
- Architecture, Code Quality, Testing, Dependencies: **stable** (B/C/C/B).

**Prior code-review issue resolution:** Of the `source:code-review`-labeled issues, the large majority are CLOSED. **2 remain open:** #765 (Phoenix → Arizona statewide system-prompt copy) and #764 (Done-card placeholder copy + extend forbidden-strings). The recurrences in this review (Pattern-B invoice phrase, discarded sendEmail, forbidden-strings coverage gap) reinforce #764's direction — extend the forbidden-strings guard beyond known portal strings to Stripe/PDF/invoice paths.

## File Manifest

- Source (ts/tsx/astro, excl node_modules/dist/tests): ~113K lines; total incl tests ~154K.
- TS 622 · Astro 195 · test files 203 · markdown 488. Deps: 16 runtime, 18 dev.
- 7 standalone workers (cost-anomaly, cost-telemetry, enrichment-workflow, job-monitor, new-business, review-mining, social-listening).
- Stack: Astro SSR on Cloudflare Workers + Static Assets, single Worker `ss-web`, D1 + R2, three-subdomain routing via `src/middleware.ts`, Clerk primary auth.

## Model Convergence

Single-model (Claude, 3 parallel agents by dimension cluster). The auth-boundary-vs-middleware root cause was independently surfaced by both the security agent (Security #1-3) and corroborated by the code-quality agent's discarded-email finding in the same `service-finalize.ts` file — two agents converging on `service-finalize.ts` as a debt hotspot from different angles.

## Verification Notes

The three criticals were verified by the orchestrator beyond the agents' reports:
- LLM proxy: read `llm.ts:66-92` (auth behind `if (expected)`) + `crane_secret_check` confirming `ELEVENLABS_LLM_SECRET` missing and `ANTHROPIC_API_KEY` present in prod → exploit is live, not latent. (ledger `vfy_01KWDE8X65GYK9KBA68C37NZF9`)
- Stripe invoice fabrication: read `service-finalize.ts:120-137` confirming the hardcoded `description` literal.
- Sentry dark: `crane_secret_check` confirming `SENTRY_DSN` missing in prod. (ledger `vfy_01KWDE8ZJD7D7XWKHPC5FNAXQH`)

## Raw Model Outputs

### Claude Review — Architecture & Code Quality agent
See agent transcript. Key: helper signature drift (jsonResponse arg-order inverted in 2 files), reserve.ts ceiling breaches, inline SQL in 10 .astro pages, types.ts 949 lines; Pattern-B Stripe invoice (C), discarded sendEmail ×2 (H), 8 confirmed dead exports (H), webhook casts (M), email-template DRY (M), admin-guard copy-paste ×48 (M).

### Claude Review — Security & Testing agent
See agent transcript. Key: open LLM proxy (C), OAuth CSRF permanently broken (H), fleet/health shadowed (H), reserve free-text (L); oauth-callback test mocks past middleware (H), middleware source-regex test (M), booking-email-failure/fleet-health/assessment-llm untested (M×3), coverage thresholds low (L). Webhook crypto + SQL + IDOR scoping verified strong.

### Claude Review — Dependencies, Documentation & Golden Path agent
See agent transcript. Key: 0 vulns everywhere, dependabot npm gap (M), per-worker audit gap (M), zod underuse (L), ajv dev-only (no Workers risk); CLAUDE.md auth stale (H), README version drift (L); Sentry dark in prod (C), CI/CD verified green live, Tier 1 baseline confirmed.

### Codex Review
Skipped (Phase 1 — Claude-only).

### Gemini Review
Skipped (Phase 1 — Claude-only).
