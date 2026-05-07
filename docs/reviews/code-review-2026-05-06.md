# Code Review: SMD Services

**Date:** 2026-05-06
**Reviewer:** Claude Code (automated)
**Scope:** Full codebase
**Mode:** Full (Phase 1 — Claude-only)
**Models Used:** Claude (Sonnet)
**Golden Path Tier:** 1 (default; not enrolled in compliance dashboard)

## Summary

**Overall Grade: B** (improved from C+ on 2026-04-24)

The codebase has continued its upward trajectory. Every one of the 22 GitHub issues filed across the prior four code reviews is now closed. The recent coding-standards adoption push (`feat/adopt-coding-standards`, `3810749`) brought the entire source under the new ESLint regime — `max-lines: 500`, `max-lines-per-function: 75`, `complexity: 15`, `no-explicit-any: error` — with only two legitimate `eslint-disable` comments in the entire `src/` tree. Auth rate limiting (#535), contact rate limiting (#536), README rewrite (#538), worker test coverage (#537), and the four CLAUDE.md content-correctness issues (#642–#645) are all resolved. The previous review's largest file (`admin/entities/[id].astro` at 1347 LOC) is now 499 LOC.

The remaining gaps are workmanlike: branch protection on `main` is still not enabled (the single biggest-blast-radius issue this review), `src/lib/enrichment/index.ts` is at the absolute ESLint line cap and will breach on the next addition, the public `/api/scorecard/submit` endpoint has no IP rate limit, and the `pdf-lib` dependency is still declared but unused.

## Scorecard

| Dimension     | Grade | Trend     |
| ------------- | ----- | --------- |
| Architecture  | B     | stable    |
| Security      | C     | improved  |
| Code Quality  | B     | stable    |
| Testing       | B     | stable    |
| Dependencies  | B     | stable    |
| Documentation | B     | improved  |
| Golden Path   | B     | stable    |

**Overall: B** (improved from C+)

## Previous Issue Resolution

**22 of 22 prior code-review issues resolved.** Clean slate going into this review.

## Detailed Findings

### 1. Architecture

Findings:

1. [LOW] `workers/scan-workflow/` — empty shell directory containing only `.wrangler/` and `node_modules/`, no `src/index.ts` or `wrangler.toml`. Likely Outside View retirement debris (PR #702/#703). Misleading alongside the five working sub-workers. Recommendation: delete the directory or file an issue tracking its intended use.
2. [LOW] Duplicate D1 migration numeric prefixes — `0027_create_enrichment_runs.sql` and `0027_harden_magic_links_context_and_milestones.sql` both carry prefix `0027`; same issue at `0028`. Wrangler tracks applied migrations by full filename, so both apply correctly. Not a runtime bug, but breaks the convention that prefixes are unique and monotonic. Recommendation: renumber `0027_harden_*` → `0028_*` and shift downstream files; `d1_migrations` history is unaffected.
3. [MEDIUM] `workers/social-listening/` is a complete 354-line Reddit pipeline implementation with `wrangler.toml` and a daily cron, intentionally excluded from CI build/deploy per `verify.yml:70`. The `SOCIAL_LISTENING_WORKER_URL` env var points to `https://ss-social-listening.automation-ab6.workers.dev`, suggesting it has been deployed manually. Operational drift risk: secrets and schema drift can accumulate when one worker is outside the CI loop. Recommendation: document the manual deploy process explicitly in `workers/social-listening/README.md`, or re-enable the CI build dry-run with a deploy-gate flag.
4. [POSITIVE] Subdomain routing in `src/middleware.ts` is clean and safe. `hostname === 'smd.services'` strict-equality for legacy redirects correctly avoids the redirect loop a `startsWith('admin.')` would trigger. Per-host cookie isolation is enforced by `applySessionCookie`.
5. [POSITIVE] No significant dead exports across the sampled DAL modules (`sow/store.ts`, `email/templates.ts`, `auth/session.ts`, `portal/session.ts`, `db/entities.ts`).

Grade: **B**
Rationale: Structure is coherent. The largest file is now 737 LOC (down from 1347 last review), 18 files at or near the 500-line ESLint cap with most within 50 LOC of it. The `social-listening` operational drift is the medium that prevents A. No regression vs prior review.

### 2. Security

Findings:

1. [LOW] `src/pages/api/auth/magic-link.ts:87` — server log writes `[magic-link] Failed to send email to ${normalizedEmail}: ${result.error}`. PII (email address) lands in Cloudflare Workers logs on Resend failures. Not user-visible but is a data-retention concern. Recommendation: drop the email from the log; the Resend dashboard already correlates by recipient.
2. [LOW] `src/pages/api/scorecard/submit.ts` — public endpoint with no IP-based rate limit. Protection is honeypot (`website_url` field) plus a 15s minimum-time guard. A bot that fakes `started_at` bypasses both. Each submission creates D1 entities + contacts, generates a PDF, and triggers a Resend email — realistic resource-exhaustion vector. Recommendation: add `rateLimitByIp(env.BOOKING_CACHE, 'scorecard', clientIp, 5)` matching the pattern in `/api/contact.ts`.
3. [LOW] `TURNSTILE_SECRET_KEY` documented in `wrangler.toml` secrets comments, never used in any source file (`PR #704` removed Turnstile from booking entirely). Documentation-vs-implementation drift creates false confidence. Recommendation: remove `TURNSTILE_SECRET_KEY` from the `wrangler.toml` secrets list.
4. [LOW] `src/components/admin/GeneratorConfigForm.astro:61,119,164,186,275` uses `set:html` to populate `<textarea>` values. Browsers treat textarea content as text (not HTML) so the practical risk is near-zero, and the values are admin-authored from D1. But the pattern is non-idiomatic and could mislead. Recommendation: replace with `value={...}`.
5. [POSITIVE] All D1 queries are parameterized with `.prepare()` / `.bind()`. Dynamic SQL builds (`buildQuoteFields`, `listEntities`) compose from hardcoded column-name literals, never user input. No SQL injection vectors found across the sampled DAL modules.
6. [POSITIVE] Both webhook handlers (SignWell, Stripe) implement HMAC-SHA256 verification with constant-time comparison and 5-minute replay windows. SignWell handler extracts only verification fields before dispatching; Stripe handler verifies before JSON parsing.
7. [POSITIVE] Session cookie isolation is correct (no `Domain=` attribute → per-host). Admin cookies cleared on apex visits. Portal cookies stay on `portal.smd.services`.
8. [POSITIVE] Admin password login has rate limiting (10/hr) and a host guard rejecting POSTs from non-admin hosts.
9. [POSITIVE] PBKDF2 with 100,000 iterations, `crypto.randomUUID()` for session tokens, constant-time comparisons across password verification, session management, API key validation, and HMAC verification. No third-party crypto library; all primitives via `crypto.subtle`.

Grade: **C**
Rationale: Improved from D — the two HIGH rate-limit findings from last review (#535 auth, #536 contact) are resolved. Per rubric, four LOW findings → C ("3+ low-severity"). No HIGH findings code-side this review. (Branch protection is captured under Golden Path to avoid double-counting; it is process-governance, not code-level.)

### 3. Code Quality

Findings:

1. [HIGH] `src/lib/enrichment/index.ts` — 564 raw lines / ~500 effective, sitting at the absolute `max-lines` ESLint limit. The file aggregates 12+ enrichment functions (`tryPlaces`, `tryWebsite`, `tryOutscraper`, `tryAcc`, `tryRoc`, `tryReviewAnalysis`, `tryCompetitors`, `tryNews`, `tryDeepWebsite`, `tryReviewSynthesis`, `runSingleModule`) plus cross-exports from `enrichment-advanced.ts`. Any addition will breach the cap. Recommendation: extract data-fetching modules to `src/lib/enrichment/data-sources.ts` and synthesis to `src/lib/enrichment/synthesis.ts`, keeping `index.ts` as a thin barrel.
2. [MEDIUM] `src/pages/admin/index.astro` at 541 raw / ~494 effective. The recent extraction (`9748afc`) carved out `AnalyticsSiteTraffic.astro`, `GeneratorPipelineCard.astro`, `PipelineSettingsPanel.astro`, but left the remaining dashboard cards inline. Recommendation: track for the next refactor pass; not urgent at 494 effective.
3. [LOW] `src/lib/enrichment/dispatch.ts:143` — sole `// eslint-disable-next-line @typescript-eslint/no-explicit-any` in `src/`, for `(globalThis as any).navigator?.userAgent`. Workers don't expose `navigator` through the standard type surface. Recommendation: replace with `declare const navigator: { userAgent?: string } | undefined` in the function scope, or a typed interface for the Workers-specific check.
4. [LOW] `pdf-lib` (`^1.17.1`) declared in `package.json` with zero imports in `src/`. The codebase uses `@formepdf/core` and `@formepdf/react` exclusively. Likely a dependency that was replaced but never removed. Recommendation: `npm uninstall pdf-lib`.
5. [POSITIVE] No swallowed `catch {}` blocks. The only `.catch(() => {})` is the fire-and-forget `renewSession` in `middleware.ts`, which is intentional (renewal failure should not block the response).
6. [POSITIVE] The `any` firewall is genuinely enforced — only two `eslint-disable` comments in `src/` (the dispatch navigator check and `env.d.ts` triple-slash).
7. [POSITIVE] Coding-standards adoption commit (`3810749`) appears to have passed cleanly. DAL modules use a closed-set `col` array pattern in dynamic update builders — safe and DRY.

Grade: **B**
Rationale: Strict TS, consistent error handling, no `any` leakage. The HIGH on `enrichment/index.ts` is structural (file at cap) and the only MEDIUM is a near-cap admin page. Per rubric, "1-2 minor issues (occasional `any` type, one duplicated pattern, 1-2 unused exports)" maps to B. Stable vs prior review.

### 4. Testing

Findings:

1. [MEDIUM] `src/pages/api/booking/reserve.ts` (586 lines, the largest API endpoint) has no unit or integration test for the handler itself. Adjacent unit tests exist (`booking/holds.test.ts`, `booking/signed-link.test.ts`, `booking/rollback.test.ts`, `booking/tokens.test.ts`, `booking/ics.test.ts`) plus a source-inspection test in `canonical-app-url.test.ts`. The core validation logic (`validateReserveInput`, `validateSlotTiming`, three-phase commit sequence, Google sync rollback wiring) is not exercised behaviorally. Recommendation: add `tests/booking/reserve.test.ts` covering validation failures, rate-limit path, and rollback on Google sync failure.
2. [MEDIUM] Webhook signature verification tests in `tests/signwell.test.ts` and `tests/resend-webhook.test.ts` are source-inspection tests (read source as a string, assert regex patterns). They do not exercise `verifyEventHash()` or `verifyStripeSignature()` with real HMAC inputs. A bug in constant-time comparison or hash format would not be caught. Recommendation: add behavioral tests using the existing `installWorkerdPolyfills()` harness pattern from `signwell-handler.test.ts`. Test: valid hash passes, tampered hash fails, stale timestamp fails.
3. [LOW] `tests/middleware.test.ts` is entirely source-inspection. A runtime routing mistake would not be caught if variable names change. Recommendation: add at least one behavioral test for `enforceAuth()` with mocked `APIContext` objects.
4. [POSITIVE] Cross-org isolation testing is thorough: `milestones.cross-org.test.ts`, `time-entries.cross-org.test.ts`, `tenant-scoping.cross-org.test.ts`, `resend-invitation.cross-org.test.ts` all exercise `org_id` scoping at the DAL layer with real D1 migrations.
5. [POSITIVE] `tests/forbidden-strings.test.ts` is a content-correctness gate enforcing CLAUDE.md Pattern A/B compliance. Right mechanism for the right policy.
6. [POSITIVE] `src/lib/webhooks/signwell-handler.test.ts` is the gold standard: real D1 migrations via `crane-test-harness`, full `handleDocumentCompleted` path with mocked external services.

Grade: **B**
Rationale: Broad suite (80+ files, ~16k LOC), strong on DB isolation and content policy. Two important untested paths (booking reserve, behavioral webhook verification) are the gap that prevents A. Stable vs prior review.

### 5. Dependencies

Findings:

1. [MEDIUM] `pdf-lib` (`^1.17.1`) declared but unused in `src/`. Bundle weight + attack surface for no purpose. Recommendation: `npm uninstall pdf-lib`; confirm with `npm run build`.
2. [LOW] `npm audit` reports 6 moderate vulnerabilities, all in the postcss/yaml dev-tooling chain (`@astrojs/check` → `@astrojs/language-server` → `volar-service-yaml` → `yaml`). Dev-time only. `security.yml` correctly runs at `--audit-level=high`, so CI is not blocked. `npm audit fix` clears the postcss variant without breaking changes; the yaml chain requires `--force` against `@astrojs/check`. Recommendation: run `npm audit fix` for postcss; defer yaml until upstream publishes.
3. [POSITIVE] No `eval()` or `new Function()` calls in `src/` or any deployed worker (`enrichment-workflow`, `job-monitor`, `new-business`, `review-mining`). Workers runtime compatibility maintained.
4. [POSITIVE] `@tailwindcss/vite` correctly used in `astro.config.mjs` — required pattern for Tailwind v4.
5. [POSITIVE] Stack versions current: Astro v6, React v19, Wrangler v4, ESLint v10, Vitest v3, TypeScript v5.3.

Grade: **B**
Rationale: Clean dependency surface. One unused runtime dep (`pdf-lib`). Audit findings are dev-chain only and CI correctly ignores moderate. Stable vs prior review.

### 6. Documentation

Findings:

1. [MEDIUM] `docs/design/brief.md:514`, `docs/design/contributions/round-1/interaction-designer.md:18`, and the round-2 counterpart show `/scorecard` as "Exists" in route tables. The `/scorecard` route is retired (middleware 301 → `/`). The `POST /api/scorecard/submit` endpoint still works, but the public frontend page is gone. Recommendation: annotate route tables with "redirects to /" or add a one-line note at the top of the affected docs. These are archived design records, not operational references — light touch is fine.
2. [LOW] `docs/adr/index.md` lists 2 ADRs but the substantive decision corpus lives in `docs/adr/decision-stack.md` (43+ numbered decisions). The index doesn't surface it. Recommendation: add a one-line pointer to `decision-stack.md` in `docs/adr/index.md`.
3. [POSITIVE] `CLAUDE.md` is accurate and current. Outside View retirement is correctly documented (`~~**Outside View**~~` strikethrough with PR refs). ADR 0002 is correctly marked superseded.
4. [POSITIVE] `README.md` is genuinely useful for a fresh clone — explains three-subdomain architecture, includes `/etc/hosts` setup for local subdomain testing, lists all build commands. (Closes #538.)
5. [POSITIVE] D1 migrations are well-commented. `0001_create_tables.sql` documents creation order, JSON contracts, ID strategy. Recent migrations explain "why" inline.
6. [POSITIVE] `src/lib/db/context.ts` has a prominent `INVARIANT: APPEND-ONLY` comment enforcing the table contract — good use of inline doc for a load-bearing constraint.

Grade: **B**
Rationale: CLAUDE.md is exceptional, README is useful, schema is documented. API docs still missing — that's the "missing 1-2 sections" of B per rubric. Plus minor design-doc drift. Improved from C (README rewrite via #538).

### 7. Golden Path Compliance (Tier 1)

Findings:

1. [HIGH] **Branch protection on `main` is not enabled** (confirmed by `gh api repos/venturecrane/ss-console/branches/main/protection` → 404). `verify.yml` and `security.yml` run on `push` to main, but without protection, a direct push bypasses CI entirely. This is the single biggest-blast-radius issue in this review — for a system that handles signed SOWs, Stripe invoices, and client PII, every change should be PR-gated. Recommendation: enable via GitHub → Settings → Branches → Add rule. Require: status check `verify`, require PR review, disallow force push.
2. [MEDIUM] No Sentry / structured error monitoring. Cloudflare Observability is enabled (`[observability] enabled = true`), which captures duration metrics and uncaught exceptions, but there is no surface that aggregates errors with stack traces and rates. Production errors surface only via `console.error` in Workers logs. Tier 2 requirement; pre-launch acceptable but worth flagging for first-client onboarding.
3. [LOW] `npm audit fix` is a clean one-command win for the postcss moderate vulnerability.
4. [POSITIVE] All Tier 1 requirements met: GitHub repo with CI, comprehensive `CLAUDE.md`, TypeScript + ESLint with a strong rule set, no hardcoded secrets (env vars via `wrangler secret` / Infisical).
5. [POSITIVE] `scope-deferred-todo.yml` and `unmet-ac-on-close.yml` are content-policy enforcement gates that exceed Tier 1 requirements — typically found only in mature Tier 2+ codebases.

Grade: **B**
Rationale: Tier 1 fully met. The HIGH on branch protection is governance-side, not Tier 1 strict requirement, but is bedrock hygiene. Stable vs prior review (same posture: branch protection and Sentry both absent then too).

## Trend Analysis

| Dimension     | 2026-04-24 | 2026-05-06 | Movement |
| ------------- | ---------- | ---------- | -------- |
| Architecture  | B          | B          | stable (largest file 1347 → 737) |
| Security      | D          | C          | improved (auth+contact rate-limits closed) |
| Code Quality  | B          | B          | stable (coding-standards adoption clean) |
| Testing       | B          | B          | stable |
| Dependencies  | B          | B          | stable (pdf-lib still hanging on) |
| Documentation | C          | B          | improved (README rewrite) |
| Golden Path   | B          | B          | stable |
| **Overall**   | **C+**     | **B**      | **improved** |

## Model Convergence

Phase 1 — single Claude (Sonnet) reviewer. No convergence analysis available.

## File Manifest

- ~58k LOC source (Astro + TS), ~16k LOC test (Vitest)
- 317 source files in `src/` (.ts/.tsx/.astro)
- 24 .ts files across 6 sub-workers in `workers/`
- 80 test files in `tests/`
- 41 D1 SQL migrations in `migrations/`
- 18 source files at or above the 500-line ESLint cap
- 567 markdown files (extensive `docs/` tree)
- 745 npm dependencies (301 prod, 325 dev, 155 optional)

## Raw Model Outputs

### Claude Review

(Findings condensed into the "Detailed Findings" section above.)

### Codex Review

Skipped (Phase 1 — Claude-only)

### Gemini Review

Skipped (Phase 1 — Claude-only)

---

## Closure Addendum — 2026-05-07

Same-day execution: a 3-agent team resolved every HIGH and MEDIUM finding, plus the four LOW security findings that were holding Security at C. Five PRs merged to `main` between 04:48 and 05:30 UTC.

### Issues closed

| Issue | Severity | Finding | PR |
|-------|----------|---------|----|
| [#723](https://github.com/venturecrane/ss-console/issues/723) | HIGH (Golden Path) | Branch protection on `main` not enabled | direct API config |
| [#724](https://github.com/venturecrane/ss-console/issues/724) | HIGH (Code Quality) | `src/lib/enrichment/index.ts` at ESLint max-lines cap | [#734](https://github.com/venturecrane/ss-console/pull/734) |
| [#725](https://github.com/venturecrane/ss-console/issues/725) | LOW (Security) / MED (filed) | No IP rate limit on `POST /api/scorecard/submit` | [#732](https://github.com/venturecrane/ss-console/pull/732) |
| [#726](https://github.com/venturecrane/ss-console/issues/726) | MED (Architecture) | `workers/social-listening` excluded from CI | [#733](https://github.com/venturecrane/ss-console/pull/733) |
| [#727](https://github.com/venturecrane/ss-console/issues/727) | MED (Testing) | No behavioral test for booking reserve handler | [#735](https://github.com/venturecrane/ss-console/pull/735) |
| [#728](https://github.com/venturecrane/ss-console/issues/728) | MED (Testing) | Webhook HMAC verification tested by source-inspection only | [#736](https://github.com/venturecrane/ss-console/pull/736) |
| [#729](https://github.com/venturecrane/ss-console/issues/729) | LOW (Security) | Recipient email logged on magic-link send failure | [#732](https://github.com/venturecrane/ss-console/pull/732) |
| [#730](https://github.com/venturecrane/ss-console/issues/730) | LOW (Security) | `TURNSTILE_SECRET_KEY` documented but unused | [#732](https://github.com/venturecrane/ss-console/pull/732) |
| [#731](https://github.com/venturecrane/ss-console/issues/731) | LOW (Security) | `set:html` on admin `<textarea>` elements | [#732](https://github.com/venturecrane/ss-console/pull/732) |

**Branch protection on `main` is now enforced.** Required check: `Typecheck, Lint, Format, Test`. Strict (must be up-to-date with main). No force-push, no deletions. Self-merge allowed (0 required reviewers). `enforce_admins: false` (Captain can override in genuine emergencies).

### Test count

`+23 new tests` across two new test files:
- `tests/booking/reserve.test.ts` — 10 behavioral tests against the real handler with real D1 migrations (validation, rate-limit, calendar_unavailable, happy path, Google sync rollback)
- `tests/webhooks/signwell-verify.test.ts` + `tests/webhooks/stripe-verify.test.ts` — 13 HMAC tests (valid, tampered hash, wrong secret, missing header, stale timestamp, body-mutation-replay)

`reserve.test.ts` did not assert "slot outside business hours" because the handler doesn't validate that — slot bounds are enforced at slot-listing time. Documented in the test header rather than inventing coverage.

### Effective grades after closure

| Dimension     | Original (2026-05-06) | After closure (2026-05-07) | Movement |
| ------------- | --------------------- | -------------------------- | -------- |
| Architecture  | B                     | B                          | stable (one MED closed; two LOWs remain — empty `scan-workflow/` dir, duplicate migration prefix) |
| Security      | C                     | A                          | improved (4 LOWs closed, zero open findings) |
| Code Quality  | B                     | B                          | stable (HIGH closed; one MED + 2 LOWs remain — admin/index.astro at 494 effective, dispatch.ts `any` escape, unused `pdf-lib`) |
| Testing       | B                     | A                          | improved (both MEDs closed; only one LOW left — middleware tests source-inspection only) |
| Dependencies  | B                     | B                          | stable (`pdf-lib` removal still pending; npm audit moderate dev-chain unchanged) |
| Documentation | B                     | B                          | stable (design doc /scorecard route drift unchanged; ADR index pointer unchanged) |
| Golden Path   | B                     | B                          | stable within bucket (HIGH closed via branch protection; Sentry MED + npm audit LOW remain) |
| **Overall**   | **B**                 | **B+**                     | **improved** (two A's, no C's, no HIGHs) |

### Path to A overall (next pass)

Five remaining items would lift the overall grade to A:
1. Remove `pdf-lib` from `package.json` (Dependencies → A) — one-line PR
2. `npm audit fix` to clear postcss moderate (Golden Path → A) — one-command PR
3. Decompose `src/pages/admin/index.astro` cards into components (Code Quality → A) — small refactor
4. Add Sentry / structured error monitoring (Golden Path → A) — Tier 2 work, defer until first client
5. Annotate retired `/scorecard` route in design docs (Documentation → A) — three-line edit

### Operational notes worth carrying forward

1. **Worktree isolation regression.** Two of the three teammates (`security-cleanup`, `enrichment-refactor`) reported their isolated worktrees were sharing branch state. Both teammates worked around it (branched fresh from origin/main, stashed/popped) and PRs landed clean — but the parallel-isolation contract is supposed to prevent this. Worth filing against `crane-console` as a worktree-doctor follow-up.

2. **Required-check naming gotcha.** Initial branch protection config used the workflow name (`"verify"`) as the required context. The actual required context is the **job name** (`"Typecheck, Lint, Format, Test"`). The workflow file is `verify.yml` with `name: Verify` and a single job named `Typecheck, Lint, Format, Test` — that last name is what GitHub's status check API reports. Updated post-hoc; documented here so the same trap doesn't bite the next venture.

3. **`gh pr merge --auto` not enabled at repo level.** Sequential merge with `gh pr update-branch` between each is the working pattern for now. Enabling repo-level auto-merge would let `--auto` queue the cascade, but is a separate governance change.

4. **Shared test helper opportunity.** `ci-and-tests` introduced a small `parseJson<T>(res)` helper in each new test file because lint autofix kept stripping `(await res.json()) as ShapeT` casts. Worth pulling into `tests/_stubs/` if more API-route tests land.

---

## Closure Addendum Round 2 — 2026-05-07

A second 3-agent team executed the path-to-A items the same day. Three more PRs merged to `main` between 05:55 and 06:30 UTC.

### Issues / PRs

| PR | Scope | Lift |
|----|-------|------|
| [#738](https://github.com/venturecrane/ss-console/pull/738) | Cleanup bundle (8 fixes): remove `pdf-lib`, `npm audit fix`, document the historical 0027/0028 migration prefix collision (renaming would break D1 idempotency in prod), confirm `workers/scan-workflow/` is already gone, replace `(globalThis as any).navigator` with a typed scoped cast, ADR index pointer to `decision-stack.md`, annotate `/scorecard` route as retired across all four design docs (rounds 1–3 + scorecard spec + workers-migration-validation) | Architecture, Code Quality, Dependencies, Documentation, Golden Path |
| [#739](https://github.com/venturecrane/ss-console/pull/739) | Decompose `src/pages/admin/index.astro` from 541 → 183 raw lines (-358, ~66%); extract `DashboardTodaysWork`, `DashboardPipeline`, `DashboardRevenue`, `DashboardFollowUpHealth`, `DashboardAutomations` into `src/components/admin/` | Code Quality |
| [#740](https://github.com/venturecrane/ss-console/pull/740) | Wire `@sentry/cloudflare` via `Sentry.wrapRequestHandler` in `src/middleware.ts`. Gated on `SENTRY_DSN` — true no-op when secret unset. +7 new gating tests. Test count: 1759 → 1766. | Golden Path (pending Captain DSN provisioning) |

### Effective grades after Round 2

| Dimension     | 2026-05-06 | After R1 (05-07) | After R2 (05-07) | Movement |
| ------------- | ---------- | ---------------- | ---------------- | -------- |
| Architecture  | B          | B                | **A**            | improved |
| Security      | C          | A                | A                | stable   |
| Code Quality  | B          | B                | **A**            | improved |
| Testing       | B          | A                | A                | stable   |
| Dependencies  | B          | B                | **A**            | improved |
| Documentation | B          | B                | **A**            | improved |
| Golden Path   | B          | B                | **A** *(pending DSN)* | improved |
| **Overall**   | **B**      | **B+**           | **A** *(pending DSN)* | improved |

### Captain follow-up — required to fully activate the Golden Path A grade

Sentry is wired but inert until `SENTRY_DSN` is provisioned:

1. Create a Sentry project at sentry.io under SMDurgan LLC, named `ss-web`.
2. Copy the DSN.
3. Provision as a Cloudflare Worker secret:
   ```
   echo $SENTRY_DSN | npx wrangler secret put SENTRY_DSN
   ```
   Or via the Infisical → wrangler bulk-secret path documented in `CLAUDE.md`.

Until that lands, errors continue to surface only via `console.error` in Workers logs. The wiring imposes zero overhead when the secret is unset.

### Operational notes carried forward into Round 2

1. **Same harness isolation bug, harder failure mode.** The `Agent({ isolation: "worktree" })` parameter silently dropped all three Round 2 agents into the **primary checkout** (not into `.claude/worktrees/<id>/`). One agent (`cleanup-bundle`) detected this in its first action via `git status` showing the parent's branch state and stopped without modifying anything. Worktrees were created manually via `git worktree add` and re-routed. Update appended to [crane-console#875](https://github.com/venturecrane/crane-console/issues/875) — escalate severity from "isolation can leak" to "isolation can fail entirely."

2. **Prettier check trap.** Round 2 task briefs said `npm run lint && npm run typecheck && npm run test && npm run build` — missing `npm run format:check`. Two of three PRs failed CI on Prettier. Fixed by running `prettier --write` and pushing. The full verify chain is `npm run verify` (which includes `format:check`); future task briefs should require that or list `format:check` explicitly.

3. **Stale-cache merge race.** After `#738` landed, `gh pr update-branch` and `gh api compare` both reported `#739` as up-to-date with main when it was actually 1 commit behind. The merge UI returned `mergeStateStatus: BLOCKED` with no useful error. Forced resolution by `git merge origin/main` locally and pushing the merge commit non-force. Worth raising with GitHub if reproducible — looks like an internal GraphQL cache lag.

4. **Round 2 agent of note.** `cleanup-bundle` made the right call on `dispatch.ts` — instead of `declare const navigator: { userAgent?: string } | undefined`, used `(globalThis as { navigator?: { userAgent?: string } }).navigator` to avoid shadowing the `lib.dom.d.ts` global in any TS env that exposes it. Same call-site semantics, no `any`, no eslint-disable. Preserve this pattern for similar Workers-vs-DOM type escapes.
