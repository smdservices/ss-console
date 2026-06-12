# Code Review: SMD Services

**Date:** 2026-06-12
**Reviewer:** Claude Code (automated, 6 parallel review agents + orchestrator verification)
**Scope:** Full codebase, BOTH repos — `venturecrane/ss-console` @ adf1037 (main) and `venturecrane/hermes-smd-overlay` @ aac8f0f (main)
**Focus:** AI-slop patterns, dead code, redundant functions, abandoned scaffolding (Captain-directed)
**Mode:** Full-scale (6 parallel Claude agents; Codex/Gemini: Phase 1, skipped)
**Golden Path Tier:** 1 (validation), with substantial Tier 2 posture already in place

## Summary

**Overall: B−** (down from A− on 2026-06-08 — but the scope roughly doubled: this is the first review to cover the overlay repo and to deep-dive `operator/`. Most of the grade movement is newly-reviewed territory carrying debt, not regression in previously-graded surface.)

The platform spine is sound: subdomain/auth middleware is correctly centralized, webhook crypto is right, the overlay's enforcement chain is fail-closed on its primary paths, and the behavioral test tier (crane-test-harness suites) is genuinely good. The acute problems are: (1) four Pattern A content-policy violations (P0 by venture policy) live on client-facing surfaces, all slipping past the forbidden-strings guard; (2) a fail-open path in the overlay's trust-ceiling resolution that silently downgrades an authored `REFUSED` posture on I/O errors; (3) ~250 source-text mirror assertions impersonating test coverage on the money path; and (4) a large unmanaged-duplication problem between `operator/adapter/` and the overlay plugins, plus ~42 files of unreachable connector scaffolding.

## Scorecard

| Dimension     | Grade | Trend                  |
| ------------- | ----- | ---------------------- |
| Architecture  | B     | regressed (from A)\*   |
| Security      | C     | regressed (from A)\*   |
| Code Quality  | C     | regressed (from B)\*   |
| Testing       | C     | regressed (from A)\*   |
| Dependencies  | B     | stable                 |
| Documentation | A     | stable                 |
| Golden Path   | B     | regressed (from A)     |

\* Scope expansion: the 2026-06-08 review did not cover hermes-smd-overlay or deep-dive `operator/` (52K lines) — the majority of new findings live there or in test-quality territory the prior review sampled differently.

## Detailed Findings

Severity tags: [C]=critical, [H]=high, [M]=medium, [L]=low. All file:line refs verified against main of each repo.

### 1. Content Policy (P0 per CLAUDE.md — graded under Code Quality but listed first)

Four Pattern A violations, all verified verbatim by the orchestrator. Each is a hardcoded client-facing promise of uncontracted business behavior; each slips past `tests/forbidden-strings.test.ts` (which guards `we'll be in touch` but not `will be in touch`, etc.):

1. [C] `src/lib/sow/service-finalize.ts:45` — signature-confirmation email: "Our team will be in touch shortly with next steps, including the deposit invoice and scheduling details." Textbook Pattern A (same class as the audited `'We'll reach out to schedule kickoff.'`). Fix: remove the sentence per empty-state pattern; extend forbidden-strings with `will be in touch` variants.
2. [C] `src/components/portal/InvoiceDetail.astro:91,241,501` — "This payment link is no longer active. We will send a new one." / "Payment link pending. We will send it shortly." (×2). Fix: state-describing copy ("Payment link is being prepared." / "Contact your consultant to request a new link.").
3. [C] `src/components/portal/EngagementProgress.astro:138` — empty-timeline state: "The work begins at the first scheduled check-in." Implies a schedule commitment not authored per engagement. Fix: neutral empty state per `docs/style/empty-state-pattern.md`.
4. [C] `src/pages/portal/products/operator/index.astro:301` — provisioning state: "Your Operator is being configured. We'll reach out once it's ready to review." Fix: drop the reach-out clause; keep the state label.

Related:
5. [H] `src/pages/assessment/report-preview.astro` + `src/pages/assessment.astro` — unguarded public pages. **Correction vs agent report:** the content is SMD's own 2026-06-05 dogfood VOICE assessment (data subject is SMD itself, not a third-party client), so this is not a client-data exposure — but `/assessment` publicly renders "Preview: internal dogfood, not yet public" and the report-preview page ships internal operational detail with no auth guard, no env flag, and no middleware protection. Fix: admin-session guard or env-flagged 404 (the `patterns.astro` pattern).
6. [M] `src/pages/portal/products/operator/onboarding/index.astro:79` — "we will be alongside you": borderline presence promise. Watch-list.
7. [L] `src/pages/packs/*.astro` (12 files) — "If it is not a fit, we will tell you." Mild behavioral commitment on prospect surfaces; monitor.

### 2. Architecture — Grade: B

1. [H] Cross-repo duplication with no drift management: 5 confirmed ported pairs between `operator/adapter/` (control plane) and overlay plugins (runtime): `voice/transform.py` (1380↔1351 lines, ~97% similar), `audit_log.py`↔`hermes-smd-audit/emit.py`, `voice/pipeline.py`↔`hermes-smd-voice/pipeline.py` (already diverging: `SentItem` vs `SentMessage`, `timezone` vs `UTC`), `namespace_assertion.py`↔`shared/d1_client.py`, `d1_env.py`↔`shared/d1_env.py`. Both sides are live (adapter consumed by `bin/` lifecycle tooling; overlay runs on Machines). A schema change to `ACCEPTED_ACTION_TYPES` on one side must be hand-mirrored. Fix: CI diff-gate in `operator-substrate.yml` alerting when an adapter file changes without a paired overlay PR reference.
2. [H] `src/pages/packs/*.astro` — 12 near-identical ~390-line full-HTML documents (~26.6% line-identical pairwise), each with its own `<html>`/`<head>`/nav/footer/CTA. ~4,700 lines that should be a `PackLayout.astro` + content props.
3. [M] `src/pages/portal/products/operator/index.astro` (547 lines) — worst page monolith: 5 async fetches + state machine + view-model construction + 200 lines of HTML, no shared layout. Extract loader + typed view model.
4. [M] `src/lib/portal/operator/drafts.ts` (649) + `audit.ts` (616) — elaborate resolvers around permanently-stubbed Hermes fetches (pending bridge #821). Collapse to minimal stubs until #821 lands.
5. [M] `workers/cost-anomaly/` + `workers/cost-telemetry/` have wrangler configs and source but are absent from `deploy.yml` — changes ship to neither CI verification nor production.
6. [M] Overlay `plugin.yaml` registers 8 plugins; README documents 7 — `hermes-smd-workspace` (the largest tool surface, 18 brokered tools) is undocumented.
7. [L] `src/pages/design-preview/*.astro` (7 files) use `Astro.redirect('/404')` (a 302) instead of a real 404 Response; `/dev/` pages do it correctly.
8. [L] Two parallel relative-time formatters (`src/lib/portal/operator/relative-age.ts`, `src/lib/admin/relative-time.ts`) — intentional but uncross-referenced.

### 3. Security — Grade: C

ss-console:
1. [M] `src/lib/auth/session.ts:132` + `src/lib/auth/admin-session-shim.ts:48` — bare `JSON.parse` on KV-cached sessions; corrupted KV value 500s an authenticated request instead of falling through to D1. (= open issue #834, still accurate.)
2. [M] `src/lib/enrichment/{review-analysis,review-synthesis,website-analyzer}.ts` — unguarded `JSON.parse` on LLM output; burns Workflow retry budget on malformed responses; no schema validation (unlike `extract.ts`). (= open issue #835, still accurate.)
3. [M] `src/pages/api/webhooks/signwell.ts:45` — pre-verify path correctly narrowed, but post-HMAC payload still used via `as SignWellWebhookPayload` cast with no runtime narrowing. (= issue #833, partially addressed.)
4. [M] `src/pages/api/assessment/llm.ts:9` — `ELEVENLABS_LLM_SECRET` optional ("if unset, endpoint is open"); an unset secret makes this a public Anthropic-quota proxy with no rate limit. Verify the secret is set in prod and add an IP rate limit regardless.
5. [L] `src/lib/db/quotes.ts:435,446` — caller-supplied `column` string interpolated into UPDATE SQL (all current call sites are literals; constrain to a const union).
6. [L] Shared `MACHINE_HEARTBEAT_KEY` authenticates any tenant's heartbeat writes via header-controlled slug — known Wave-1 design, already in the threat model as a deferred upgrade.

hermes-smd-overlay:
7. [H] `plugins/hermes-smd-trust/enforce.py:504-520` — `_resolve_customer_ceiling()` catches broad `Exception` (disk error, YAML parse failure, attribute miss) at debug level and falls through to env var → `DRAFT_FOR_REVIEW` default. A customer who authored `refused` gets silently downgraded on an I/O fault. Orchestrator-verified; the `SMD_TRUST_CEILING` env fallback is dev-only (translate.py never materializes it), so on a production Machine the downgrade path is real. Mitigating: the downgrade lands on a conservative posture (draft-for-review), not autonomous send — fail-open is relative, not absolute. Fix: narrow the inner catch to `NotImplementedError`; let other exceptions reach the outer fail-closed handler at `evaluate_tool_call`. **No test covers this path** — add a `PermissionError` injection test.
8. [H] `webhook_gate.py` — Svix signature verified but no timestamp-freshness window: a captured legitimate delivery replays indefinitely until Machine restart (threat-model OP-P2-3, unmitigated). Fix: reject deliveries older than 5 minutes post-verification.
9. [M] `shared/action_classes.py:315` — unmapped tool names still default to `ActionClass.READ` (the deferred OP-P0-1 hardening). A new Hermes primitive outside `TOOL_ACTION_CLASS_MAP` bypasses ceilings silently.
10. [M] `enforce.py` does not normalize tool names before classification (case-sensitive lowercase map) — `Execute_Code` would miss the CODE_EXECUTION mapping and fall to READ.
11. [M] Audit can go dark silently in two independent paths while enforcement continues: audit plugin registration failure → all hooks no-op (WARNING only); `outbound.py:191` `except Exception: return (None, None)` → gate blocks without emitting records. Wire a broker-visible health signal for no-writer audit state.
12. [M] `shared/inbound.py` `_FENCED_READ_TOOLS` is a 14-name whitelist with no completeness test against the registered Workspace toolset — a new READ tool added without updating it bypasses the inbound quarantine.
13. [M] `bootstrap/translate.py:639` — profile dirs containing secret-bearing MCP configs created with default umask (0755) while files are 0600; create with `mode=0o700` to match broker posture.
14. [L] `shared/secrets.py` `KeyError` messages enumerate expected credential names if they reach a log sink.

### 4. Code Quality — Grade: C

Dead code & abandoned scaffolding:
1. [H] `operator/connectors/{filevine,no_pm,lawpay}/` — 42 files / ~2,400+ lines with **zero runtime wiring** (no customer.yaml uses `build:filevine`/`build:lawpay`/`synthetic:no_pm`; translate.py silently skips `build:`/`synthetic:` backends), **excluded from CI pytest**, and the smoke wrapper `bin/run-connector-smoke-tests.sh` invokes `adapter/run_prod_smoke_test.py` which **does not exist**. These are also known to be architecturally leaky (skills call Clio MCP tool names, not capability methods). Decision needed: relocate to a clearly-labeled drafts tree or delete (CLAUDE.md says new BUILD adapters land in the overlay repo, not here).
2. [H] ADR-0008-era memory modules stranded: `operator/adapter/memory/pipeline.py` (618) + `retention.py` (751) implement the superseded customer-owned-artifact model; `bin/cron-retention.py` runs against a `memory_ingested_items` table no ADR-0016 Machine populates (silent no-op), and `bin/lib/decommission.py`'s memory sweep targets the wrong schema — a **correctness gap in decommission**, not just dead code.
3. [H] `operator/adapter/cost_rollup.py` + `cost_ingest.py` + `cost_telemetry/` — referenced only by their own tests; no bin/ script or production path invokes them.
4. [H] Decommission integrity: `bin/lib/decommission.py` — AgentMail and **Fly Machine destruction** steps are `NoOpStub`s ("decommission" completes with the Machine still running), and `:914` hardcodes `DECOMMISSION_DRAIN_COMPLETE` as the action_type for every step, collapsing the compliance audit trail to 9 identical entries.
5. [M] Orphan scorecard surface: `src/pages/api/scorecard/submit.ts` (225 lines, live POST endpoint: D1 write + email + SignWell join) + `src/scripts/scorecard.ts` — the `/scorecard` page 301s home; no live page renders the form. Delete both (and then `src/lib/scorecard/` likely follows).
6. [M] `src/lead-gen/prompts/partner-nurture-prompt.ts` + `schemas/partner-email-draft.ts` — explicitly PARKED (#714), no runtime consumer, and carries banned `$750k–$5M` revenue-band anchoring that would propagate if rebuilt from this file. Delete.
7. [M] Dead portal components: `PortalHomeDashboard.astro` + `ActionCard.astro` — only importers are dev-gated galleries; the real portal home has its own inline implementation.
8. [M] Dead exports: `quoteSentEmailHtml` (`src/lib/email/templates.ts`, test-only zombie), `SESSION_DURATION_MS` (`src/lib/auth/session.ts:29`, deprecated, zero callers), plus two orphaned JSDoc blocks in templates.ts (107, 191).
9. [M] Overlay: `_min_ceiling()` duplicates `_most_restrictive()` (`enforce.py:114/143` — two implementations of ceiling comparison that must stay in lockstep); `_resolve_vertical()` defined identically in `enforce.py:650` and `outbound.py:182`; lazy audit-client init duplicated across 3 modules.
10. [M] `operator/skills/inbox-triage/SKILL.md` hardcodes `smd.customer: smd` + customer-zero specifics while 11 vertical packs reference it as a generic spine skill; 84+ skill slugs referenced by vertical.yaml files have no SKILL.md body (provisioning a non-law vertical would break bootstrap).
11. [M] ~~workers/scan-workflow ghost~~ — **withdrawn by orchestrator**: directory is untracked local debris (node_modules + .wrangler/tmp only), not in git. Local cleanup, not a repo finding.

Duplication & parse-don't-cast:
12. [H] `trimString`/`isValidEmail`/`escapeHtml`/`jsonResponse` quartet defined independently in `src/pages/api/intake.ts`, `intake/send.ts`, and `scorecard/submit.ts` while `booking/reserve-helpers.ts` already exports them. Extract `src/lib/api/helpers.ts`.
13. [H] `ALLOWED_INTERESTS` 13-value set duplicated in `src/pages/book.astro:33` and `src/pages/api/intake/send.ts:44` — manual-sync hazard on the live intake path.
14. [H] ~16 `JSON.parse(...) as X` sites across src/lib (service-finalize.ts ×5, customer-config, admin-session-shim, oauth/state, signed-link, quote-builder-client, milestones, assessment/session, entity-detail-page ×2, entity-signal-metadata, integrations) — parse-don't-cast is mandated by venture coding standards.
15. [M] 67 files repeat middleware-enforced admin role checks (17 admin pages + 50 API routes) — unreachable branches documented as "belt-and-suspenders" that aren't; one (`engagements/[id].astro:19`) even redirects to a nonexistent `/login`.
16. [M] `src/lib/claude/assessment-to-quote.ts:158` — private `parseLineItems` duplicates the canonical export in `src/lib/db/quotes.ts`.
17. [L] AI-slop texture: multi-page narrating docstrings (`audit_log.py`, `voice/transform.py`, `sticky_stop.py` — the overlay ports trim 30-40% of it); stale `validate_customer_yaml.py` reference in `adapter/__init__.py`; TODO bookmarks in security modules that belong in issues; `console.log` debris (`oauth/audit.ts:53` is the only OAuth audit sink pending #891; stripe-handler business events at log level).

### 5. Testing — Grade: C

1. [H] `tests/invoices.test.ts` (~250 assertions) is **source-text mirroring**: `readFileSync` + `toContain` on string literals — the money path (invoice state machine, `handleInvoicePaid` two-table batch, org scoping, Stripe client) has **zero behavioral D1 coverage**; all green even if the functions were stubs. Same pattern: `tests/signwell.test.ts` (redundant with the good behavioral `src/lib/webhooks/signwell-handler.test.ts`), much of `tests/auth.test.ts`.
2. [H] Overlay: no test injects a non-`NotImplementedError` exception into `CustomerConfig.from_volume()` — the single highest-risk enforcement path (finding 3.7) is untested.
3. [M] Workers tests (7 suites) are not run in CI: `verify.yml` calls `npm test`, not `npm run verify`; `test:workers` only runs locally.
4. [M] `operator/connectors/{filevine,no_pm,lawpay}/tests` excluded from `operator-substrate.yml` pytest (moot if finding 4.1 resolves by deletion).
5. [M] No completeness test for `_FENCED_READ_TOOLS` vs the registered Workspace toolset.
6. [L] Coverage thresholds intentionally low (lines 22% — dragged by .astro; branches 67%, functions 52%). Overlay test quality is genuinely good: 610 tests / ~1,294 assertions, behavioral, with strong end-to-end chains in `test_security_phase1.py`.

### 6. Dependencies — Grade: B

1. [M] `ws` uninitialized-memory disclosure (GHSA-58qx-3vcg-4xpx, moderate) via wrangler→miniflare chain — dev/CI surface only, not the deployed bundle; `npm audit fix` (wrangler 4.92.0→4.100.0) resolves it. 9 moderate total including devDeps.
2. [L] Minor-version lag: astro 6.3.5→6.4.6, @astrojs/cloudflare 13.5.2→13.7.0, formepdf 0.8.3→0.10.4; lint-staged 2 majors behind; `@venturecrane/tokens` on 0.0.2-alpha.
3. [info] No eval/`new Function` dependencies in the Worker bundle. Overlay: uv.lock hash-pinned, minimal surface (pyyaml, boto3), clean.

### 7. Documentation — Grade: A

1. [M] `CLAUDE.md:34` — session-start instruction names `crane_sod`; the tool is `crane_sos`. One-word fix.
2. [L] Overlay README missing the workspace plugin (see 2.6). Everything else verified accurate: build commands match package.json, all referenced paths/ADRs exist, README correct on both repos.

### 8. Golden Path Compliance — Grade: B

1. [M] `security.yml` (Semgrep, Gitleaks, npm audit) runs on PRs but is **not a required status check** — only the verify job gates merge. Add it.
2. [M] CI build-verifies only 4 of the live workers; `cost-anomaly`, `cost-telemetry`, `enrichment-workflow` are unverified at wrangler-config level.
3. [L] Branch protection: 0 required approvals, `enforce_admins: false` — deliberate solo-operator tradeoff, documented here.
4. Strong posture otherwise: `astro/tsconfigs/strict`, ESLint 9 flat config with structural ceilings (500/75/15) + no-floating-promises + import/no-cycle, conditional local gitleaks + unconditional CI gitleaks, pinned Semgrep with dependabot.

## Model Convergence

Single-model (Claude) review; convergence instead achieved via orchestrator re-verification of every critical/high finding against source. Three agent findings were corrected or withdrawn during verification (scan-workflow untracked; report-preview data subject; SMD_TRUST_CEILING env fallback is dev-only — which *strengthened* finding 3.7).

## Trend Analysis

2026-06-08 → 2026-06-12: A− → B−. Drivers, in order: (1) first-ever coverage of hermes-smd-overlay and deep `operator/` review — most C/H findings live there; (2) test-quality audit caught the source-text-mirroring tier the prior review graded as A; (3) four new Pattern A violations on portal surfaces shipped since (or missed by) prior reviews. Previous-issue resolution: 26 of 31 `source:code-review` issues closed; #833 partially addressed; #834, #835, #764, #765 still open and still accurate.

## File Manifest

ss-console: 215,453 code lines (src 110K / operator 52K / tests 41K / workers 7K / migrations+scripts 8K); 616 .ts, 227 .astro, 161 .py. Overlay: 99 .py files, ~30,460 lines (plugins 11.6K, tests 11.8K, shared 4.2K, bootstrap 1.7K). Full manifests: /tmp/crane-file-manifest-{ss,overlay}.md (session artifacts).

## Raw Agent Outputs

Six agent reports (core-libs, surfaces, operator-tree, overlay, security, platform) are preserved in the session transcript (sess_01KTYD98M5T8E0WS9XX2VJG9AC, 2026-06-12). Key counts: core-libs — 3 dead exports, 2 dead modules, ~16 cast violations, 2 workers absent from CI; surfaces — 2 dead components, 1 orphan API route, 4 duplication clusters, 3 Pattern A violations; operator — ~42 zero-reachability files, 5 cross-repo duplicate pairs, 14 slop instances; overlay — 1 high fail-open candidate, 3 duplicate clusters, 6 swallowed-exception sites; security — 0 critical, replay + fail-open highs; platform — money-path mirror tests, 2 CI gaps.
