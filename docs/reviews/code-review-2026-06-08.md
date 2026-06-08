# Code Review: SMD Services

**Date:** 2026-06-08
**Reviewer:** Claude Code (automated, Opus orchestrator + Sonnet review agent)
**Scope:** Full codebase
**Mode:** Phase 1 (Claude-only — Codex/Gemini skipped)
**Golden Path Tier:** Tier 1 floor (mandatory) + Tier 2 infra present (Sentry, full CI/CD, security scanning, branch protection)

## Summary

**Overall: A− (improved from B+ on 2026-05-08).** The codebase is in excellent health for a pre-launch venture operating at effective Tier 2. The prior cycle's findings were resolved (README rewrite, branch protection, webhook HMAC tests, AGENTS.md fix all closed). Security remains the strongest dimension: complete webhook signature verification with crypto test coverage, auth middleware with no bypass vectors, systematically parameterized SQL, correct per-host cookie boundaries. The two remaining B dimensions are Code Quality (a persistent "parse-don't-cast" instance in the admin quotes path) and Dependencies (dev-only moderate audit findings). The single most important pre-launch action is hardening the new public assessment-turn endpoint before the ADR 0039 funnel takes advertising traffic.

## Scorecard

| Dimension     | Grade | Trend                 |
| ------------- | ----- | --------------------- |
| Architecture  | A     | stable                |
| Security      | A     | stable                |
| Code Quality  | B     | stable                |
| Testing       | A     | stable                |
| Dependencies  | B     | stable                |
| Documentation | A     | improved (from B)     |
| Golden Path   | A     | improved (from B)     |

**Overall: A−** (improved from B+)

## Detailed Findings

### 1. Architecture

**Findings:**

1. [LOW] `src/lib/db/quotes.ts:238` — `OPEN_QUOTE_STATUSES` is exported but has no importer outside its own file. Recommendation: drop the `export`; it is an internal constant.
2. [LOW] `src/lib/pdf/render.ts:28` — module-level `let wasmReady: Promise<void> | null` is mutable Worker-scope state, which CLAUDE.md prohibits. It is a memoized WASM init with an intentional re-init-on-failure path. Recommendation: document the accepted exception or move init to a per-request/startup hook.
3. [LOW] `src/scripts/assessment-voice.ts`, `src/scripts/scorecard.ts` — module-level `let` exists but these are browser-injected scripts, not Worker modules. Not a violation; confirms the rule is Worker-scoped.
4. [LOW] `operator/bin/lib/decommission.py` (1,101) and `operator/adapter/voice/transform.py` (1,366) exceed the 500-line ceiling but are justified (composed pipeline; non-fabrication transform engine) and outside the TS-scoped ceiling. Recommendation: consider splitting `transform.py` by transformation type if it grows.
5. [MEDIUM] `src/pages/api/` — 88 route files, cleanly namespaced (admin/portal/webhooks/booking/assessment). No catch-all sprawl. The only note: `api/assessment/turn.ts` self-documents that public-traffic hardening is a pre-launch follow-up (see Security #2).

**Grade: A.** Clean three-surface separation (Astro subdomains + standalone workers/ + Python operator/), business logic isolated in `src/lib/`. Several DAL/types files exceed 500 lines but are single-responsibility, not god objects. The WASM module-state is the only genuine (minor) Worker-state violation.

### 2. Security

**Findings:**

1. [LOW] `src/pages/contact.astro:98` — `status.innerHTML = '...' + html` where `html` is `Object.values(body.fields).join('. ')`. The `/api/contact.ts` response contains only hardcoded literal validation strings — no user input echoes back, so no live XSS. The pattern is structurally receptive: if the response shape ever carries user-derived text it becomes a vector. Recommendation: switch to `textContent`/`createTextNode` or escape before injection.
2. [LOW→pre-launch] `src/pages/api/assessment/turn.ts` — public, session-less endpoint making live LLM calls, rate-limited only at 200/hr/IP. `MAX_TURNS=60` caps a single session but not session restarts; IP rotation can exhaust LLM budget. Documented as "dogfood-only preview." Recommendation: before the ADR 0039 funnel goes live, add a signed assessment session ID + per-session turn/cost ceiling.
3. [CLEAN] SQL — all D1 queries use `.prepare().bind()`; dynamic WHERE/ORDER clauses use only hardcoded column-name literals (`entities.ts:204-207`). No user-controlled identifiers.
4. [CLEAN] Webhooks — Stripe, SignWell, Resend/Svix, and Healthchecks all verify HMAC-SHA256 via `crypto.subtle` with constant-time comparison; Stripe adds a 5-min replay window. Behavioral tamper/wrong-secret/stale-timestamp tests exist.
5. [CLEAN] Auth — `src/middleware.ts` sequences Clerk session population before enforcement; admin requires Clerk ID + D1 `role='admin'`; cookies are `HttpOnly; Secure; SameSite=Lax; Path=/` with no `Domain=` (per-host boundary). `redirectToAdminHost` uses strict equality to avoid redirect loops. API-key/machine-key auth use constant-time compare with empty-key guards.
6. [CLEAN] No hardcoded secrets in `src/` or `operator/` (only labeled test fixtures). `.gitleaks.toml` configured. No CORS exposure (correct for same-origin subdomain architecture). Error logs use structured prefixes without tokens/PII.

**Grade: A.** No exploitable findings on shipped/live surface. Both low findings are defense-in-depth on surfaces that are either fed only hardcoded strings (contact) or not yet live (assessment preview). Webhook/auth/SQL posture is exemplary.

### 3. Code Quality

**Findings:**

1. [MEDIUM] `src/pages/api/admin/quotes/[id].ts:104` — `JSON.parse(existing.line_items) as LineItem[]` is a cast, not a validated parse; corrupt JSON throws instead of degrading. Verified present. Recommendation: add a `parseLineItems(): LineItem[] | null` helper mirroring the existing `parseDeliverables` pattern. (Same theme as open issues #833/#834/#835.)
2. [MEDIUM] `src/pages/api/admin/quotes/[id].ts:160-166` — `parseLineItemsField` checks `Array.isArray` but not per-element shape (`problem`/`description`/`estimated_hours`), then `return parsed as LineItem[]`. Recommendation: add a per-element type-guard predicate.
3. [LOW] `src/middleware.ts:73` — `renewSession(...).catch(() => {})` fire-and-forget is intentional (KV-write failure must not fail the request) but uncommented. Recommendation: add an intent comment.
4. [LOW] `src/lib/db/quotes.ts:238` — dead export (also under Architecture).
5. [LOW] `createQuote` (`quotes.ts:307-391`, 84 lines) exceeds the 75-line function ceiling. Recommendation: extract signal-attribution resolution to a helper.
6. [CLEAN] TypeScript — `tsconfig` extends `astro/tsconfigs/strict` with no overrides; zero `@ts-ignore`/`@ts-expect-error`; no `as any` casts. The `any` grep hits are prose in comments.
7. [CLEAN] DRY — `src/lib/booking/intake-questionnaire.ts` is the canonical shared intake; `tests/intake-questionnaire.test.ts` enforces /book == /get-started. No floating promises; no Worker module-mutable singletons beyond the WASM promise.

**Grade: B.** Strict, clean TypeScript with no suppressions or floating promises, but the cast-not-parse pattern persists in the admin quotes path — a fresh instance of the still-open "parse-don't-cast" theme.

### 4. Testing

**Findings:**

1. [CLEAN] Webhook crypto boundaries — `tests/webhooks/stripe-verify.test.ts`, `signwell-verify.test.ts`: valid/tampered/wrong-secret/missing-header/stale-timestamp.
2. [CLEAN] Policy tests — `forbidden-strings.test.ts`, `enrichment-prompt-contracts.test.ts`, `intake-questionnaire.test.ts` enforce the anti-fabrication doctrine at source level with specific string assertions.
3. [CLEAN] Cross-org isolation — `tests/portal/tenant-scoping.cross-org.test.ts`, `admin/milestones.cross-org.test.ts`, `admin/resend-invitation.cross-org.test.ts` seed two orgs against real D1 (crane-test-harness) defending the #399 findings.
4. [CLEAN] Authorship — `tests/quotes-authored-content.test.ts` verifies null authored fields render nothing, not a synthesized default.
5. [MEDIUM] `tests/middleware.test.ts` is source-text/regex-based, not behavioral — it cannot exercise the auth-enforcement branches at runtime (e.g., Clerk returns userId but D1 lookup fails). Recommendation: add harness-backed integration tests for the enforcement branches.
6. [MEDIUM] No tests for `src/pages/api/assessment/turn.ts` input validation (`parseTurns`, `MAX_TURNS`, `MAX_TURN_CHARS`). Recommendation: add unit tests for the validator (pairs with the endpoint-hardening work).
7. [LOW] Legacy magic-link sliding-window renewal (`renewSession`) has no dedicated test. Recommendation: assert expiry renews on an authenticated request.

**Grade: A.** 140 Vitest suites plus Python pytest; the critical shipped paths (auth, webhooks, payments, cross-org, authorship) are behaviorally tested, and the policy-test rigor is enterprise-leading. The two MEDIUM gaps sit on a structurally-tested middleware and a not-yet-live endpoint.

### 5. Dependencies

**Findings:**

1. [LOW — dev only] 9 moderate npm-audit vulns, all in dev deps (`@cloudflare/vite-plugin`→miniflare→ws; `yaml-language-server`→yaml). No production-runtime exposure; security CI correctly gates on high/critical only.
2. [CLEAN] No `eval(`/`new Function(` in `src/` or `workers/`; no known dynamic-codegen deps (Ajv/Handlebars). (Python `operator/` runs on Fly.io, not workerd — eval rules N/A.)
3. [LOW] `typescript ^5.3.0` trails current 5.7/5.8. Not a security issue. Recommendation: bump on next maintenance window.
4. [CLEAN] No unused production dependencies in the sampled check.

**Grade: B.** Zero production-runtime vulnerabilities and no eval usage, but moderate (not low) dev-only audit findings and a slightly-behind TS keep it off A.

### 6. Documentation

**Findings:**

1. [CLEAN] `CLAUDE.md` (33KB) — business model, three-subdomain architecture, tone/no-fabrication policy with cited past-violation file paths, decision stack, full Operator ADR map. Best-in-fleet.
2. [CLEAN] `README.md` — concise, accurate stack/setup/deploy; correctly defers depth to CLAUDE.md (the prior #538 stub was rewritten).
3. [CLEAN] ADRs — 39 ADRs + `decision-stack.md` (29 locked decisions); consistent status/issue/rationale structure.
4. [CLEAN] Migrations — every reviewed `.sql` carries a header explaining touched/not-touched tables and the implementing ADR.
5. [LOW] ADR 0040 is referenced by the current branch name but not yet present in `docs/adr/` — presumably in-flight on this branch. Recommendation: confirm it lands with this branch.
6. [LOW] Some admin utility modules lack function-level JSDoc. Low priority.

**Grade: A (improved from B).** The prior README/AGENTS gaps are closed; CLAUDE.md, ADRs, and migrations are all well above the fleet bar.

### 7. Golden Path Compliance

**Findings:**

1. [CLEAN] Tier 1 — git, CLAUDE.md, strict TypeScript + ESLint (flat config v10), no hardcoded secrets, `.gitleaks.toml`.
2. [CLEAN] Sentry — wired via `src/lib/observability/sentry.ts` wrapping every request; no-ops when DSN unset; `tracesSampleRate 0.1`, `sendDefaultPii false`.
3. [CLEAN] CI/CD — 11 workflows: `deploy.yml`, `verify.yml`, `security.yml` (daily audit + gitleaks + dependency review), plus merge gates (`scope-deferred-todo`, `unmet-ac-on-close`, `tick-acs-on-merge`). Branch protection active (#723 closed).
4. [CLEAN] Uptime — `api/health.ts` health endpoint + `api/webhooks/healthchecks.ts` integration.
5. [MEDIUM — out of repo] ss is not registered on the crane-console Golden Path compliance dashboard despite operating at Tier 2. Administrative gap. Recommendation: add ss to the dashboard for automated tier tracking.

**Grade: A (improved from B).** All repo-level technical requirements met; the only gap is dashboard registration, which lives in crane-console, not this repo.

## Model Convergence

Single-model (Phase 1, Claude-only). No convergence data.

## Trend Analysis

vs 2026-05-08 (Overall B+ → A−):

| Dimension     | 2026-05-08 | 2026-06-08 | Movement |
| ------------- | ---------- | ---------- | -------- |
| Architecture  | A          | A          | stable   |
| Security      | A          | A          | stable   |
| Code Quality  | B          | B          | stable   |
| Testing       | A          | A          | stable   |
| Dependencies  | B          | B          | stable   |
| Documentation | B          | A          | improved |
| Golden Path   | B          | A          | improved |

Prior-cycle issues resolved: #538 (README), #723 (branch protection), #728 (webhook HMAC tests), #766 (AGENTS.md venture), #724/#725/#726/#727/#729/#730/#731 — all CLOSED. Still open: the parse-don't-cast cluster #833/#834/#835 (webhook/session/enrichment) — this review adds a fourth instance (admin quotes line_items), plus copy/positioning issues #764/#765.

## File Manifest

~185K lines of source: TypeScript 104,687 (520 files), Astro 34,714 (202), Python 39,316 (136), SQL 5,838 (74), TSX 1,042 (2), Markdown 380 files. 56 D1 migrations. 140 Vitest suites + Python pytest. 11 CI workflows. 39 ADRs.

## Raw Model Outputs

### Claude Review

See "Detailed Findings" above — synthesized from the Sonnet review agent's full output (132 tool calls across all 7 dimensions). Findings independently spot-verified by the orchestrator against source (`quotes/[id].ts:104`, `assessment/turn.ts` header, prior scorecards).

### Codex Review

Skipped (Phase 1).

### Gemini Review

Skipped (Phase 1).
