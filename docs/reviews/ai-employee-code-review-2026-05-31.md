# AI Employee — Comprehensive Code & Schema Review

_Date: 2026-05-31 · Review-only, no code changed · Method: 4 parallel review agents over 3 code surfaces + schema, synthesized._

## Surfaces reviewed

| Surface | What it is | Size | Live? |
|---|---|---|---|
| `ss-console/src/**/ai-employee/` | TS/Astro admin + client portal | ~27k LOC, 131 files | yes |
| `ss-console/ai-employee/` | Python substrate baked into each Fly Machine image | ~46k LOC (≈half tests) | yes (88 commits/14d) |
| `venturecrane/hermes-smd-overlay` | Python Hermes plugin overlay (audit/trust/voice/memory/webhook/inbound) | ~22.7k LOC Python | yes (deployed v0.4.0) |
| D1 migrations 0038–0046 + `customer-yaml/*` | data layer / config schema | — | yes |

Context: per corrected session memory, customer-zero (Crane) is currently **dormant / config-broken**, not live-and-sending. This review lands before any real client depends on the runtime — the right time to fix structural debt.

---

## THE HEADLINE: the safety floor is implemented twice and is drifting

**The single most important finding.** The trust-ceiling, voice-transform, audit-emit, and memory-mirror logic exists in **two parallel implementations**:

- `ss-console/ai-employee/adapter/` — the **canonical "policy core"** the overlay was *ported from* (17 overlay files carry `"Ported from ss-console/ai-employee/adapter/..."` docstrings; `enforce.py:108` calls the adapter `trust_ceiling.py` "the canonical policy core").
- `hermes-smd-overlay/plugins/` — the copy that **actually executes** in the customer Machine.

The deploy path proves the overlay wins at runtime: `ai-employee/templates/Dockerfile:154-177` `pip install`s + `hermes plugins install`s the overlay at `v0.4.0`; `bootstrap.sh:331` runs `hermes gateway run`, which loads plugin code from `~/.hermes/plugins/` (the overlay), **not** `/app/adapter`. The in-tree `adapter/` copies run only inside the pre-boot invariant gate (`safety-substrate/run_invariants.py`, for trust/audit) or **not at all** (`adapter/voice/`, `adapter/memory/` are not on the runtime path).

They are **measurably diverging on the load-bearing safety logic**:
- Trust: only **89 shared code lines** out of 171 (adapter) / 548 (overlay). The overlay added ADR 0025 send-ceiling exposure rules and a consolidated `shared/action_classes.py` (48 `ActionClass` refs vs the adapter's 16); `adapter/action_classes.py` doesn't even exist.
- Audit: **68 shared lines** of 409 (adapter) / 531 (overlay). Both are live, so the audit **schema** must stay byte-identical across two repos by hand.
- Voice transform: ~93% shared but the overlay added `evaluate_draft_voice_fidelity()` (~70 LOC) the adapter lacks.

**Why it matters:** a fix to the safety floor in one repo does not fix the other, and the venture's own P0 rule is that the safety floor must be correct. This is the spine that every other finding hangs off. **It needs a Captain decision: which repo owns each concern, and what keeps them in lockstep (shared package, generated artifact, or a hard "adapter is reference-only, delete the runtime-dead copies" call).** Note: nothing here is "safe to delete" blindly — deleting the adapter copies would break the boot-invariant gate that still imports `trust_ceiling.py` / `audit_log.py`.

---

## P0 — correctness / safety-adjacent (verify first)

1. **Voice plugin is a silent no-op in the overlay.** `plugins/hermes-smd-voice/__init__.py:51,92,131` — `bind_runtime` is never called by any code, so `_R2_READER` stays `None` and both voice hooks early-return. `SMD_R2_VOICE_BINDING` (declared `requires_env`) is read by nothing. As shipped, **voice sample injection and fidelity scoring never run** — the plugin registers "successfully" and does nothing. This is exactly the documented `project_ai_employee_fail_open_antipattern` (stub default reaches live path, reports success). _Fix: wire `bind_runtime` from the Machine boot path, or mark the plugin inactive so it can't masquerade as live._

2. **Fail-open candidates in the live boot-gate safety filters (need direction check).**
   - `ai-employee/safety-substrate/citation_filter.py:183,189` — bare `return True` on a citation/fabrication gate that `bootstrap.sh` step 8 enforces on every boot. Confirm `True` = "blocked," not "allowed."
   - `ai-employee/adapter/voice/transform.py:1185,1265,1276` — `return True` in fabrication-guard helpers. Confirm the True branch is the reject direction.
   - `NoOpExportSigner` / `NoOpVoiceExportSigner` used as the **default** signer (`adapter/memory/export.py:232,449`, `adapter/voice/export.py:218,417`) — a no-op signer as runtime default is the same anti-pattern (lower blast radius: Captain-side evidence path, not the Machine runtime).

3. **Audit-log INSERT SQL + 12-column tuple hand-copied in 3 places, cross-repo.** Overlay `hermes-smd-audit/emit.py:120`, `hermes-smd-webhook-router/__init__.py:103`, `hermes-smd-trust/outbound.py:255` — each re-implements the INSERT with hand-built `None` placeholders; comments admit "must match emit.py column order exactly." Plus the schema is duplicated again in `ai-employee/adapter/audit_log.py` and `d1-schema.md`. **A column reorder silently corrupts the other writers.** _Fix: one `shared/audit_writer`; single-source `ACCEPTED_ACTION_TYPES` + schema._

---

## P1 — structural duplication (the "duplicate functions" the review targeted)

### Cross-repo / Python
4. **ULID + `_iso_utc` + Crockford encoder copy-pasted 8× in the overlay** (audit `emit.py:85`, webhook-router, trust `outbound.py:232`, memory-mirror `state.py`/`mirror.py`/`archive.py`/`dismiss.py`, voice `state.py`/`export.py`, `shared/inbound.py`) **plus a 3rd copy in the Python tree** (`adapter/audit_log.py`, `adapter/memory/state.py`). The code asks for `shared/ulid.py` in three TODO comments. _Fix: `shared/ulid.py` + `shared/timefmt.py`, import everywhere._
5. **Two ceiling-ordering structures in one file** — `hermes-smd-trust/enforce.py:93` (`_CEILING_ORDER`/`_min_ceiling`) vs `:120` (`_RESTRICTIVENESS`/`_most_restrictive`) encode the same 3-value order twice.
6. **Parallel no-op signer classes** — `NoOpExportSigner` and `NoOpVoiceExportSigner` are the same class twice (`voice/export.py:219` docstring says so); `memory/export.py` and `voice/export.py` are near-parallel export pipelines.

### TS/Astro
7. **`paginate*` copy-pasted byte-for-byte 4×** — `drafts.ts:275`, `notifications.ts:255`, `audit.ts:461`, `calendar.ts:274`. Collapse to one generic `paginate<T>()`; the four `*ListPage` interfaces become `Page<T>`.
8. **Relative-age formatter reimplemented 4×** — `formatDraftAge` (drafts.ts:314), `formatNotificationAge` (notifications.ts:356), `formatMatterAge` (matters.ts:215), `formatLastActionRelative` (aliveness.ts:284). The duplication already produced a unit drift: `yr` (matters) vs `y` (drafts/notifications).
9. **Absolute-timestamp formatter duplicated** — `formatAuditTimestamp` (audit.ts:503) and `formatLastActionAbsolute` (aliveness.ts:311) build identical `Intl.DateTimeFormat` UTC configs (aliveness comment admits it).
10. **`Tone` union re-typed locally in 4 files** to "avoid a hard import" (audit/notifications/matters import it; drafts/aliveness re-declare). Import `Tone` from `src/lib/portal/status.ts` once. Same story for `DEFAULT_*/MAX_*_PAGE_SIZE` quartets and `distinct*Skills` collectors.

---

## P1 — schema inconsistencies

11. **`config_change_audit` (0046) has NO foreign keys** despite storing `entity_id` and `actor_user_id` — every sibling table FK-constrains these. For a security-boundary audit ledger (ADR 0026), an unconstrained `entity_id` means a governance row can reference a non-existent customer. _Fix: add FKs, or document why the immutability requirement forbids them._
12. **Two overlapping config-history mechanisms with no live writer** — `customer_config_history` (0045, git-sync) vs `config_change_audit` (0046, governance). The intent→effect link is "a tracked follow-on" that doesn't exist; `recordCustomerConfigSync` (0045's writer) **has no caller**. A compliance auditor cannot reconstruct intent→effect from the schema as built.
13. **Four identifiers for "the customer"** used inconsistently as keys: `customer_id` (yaml) → `customer_slug` (0039) vs `entity_id` (PK/FK on most tables) vs `org_id`. 0045 keys on `customer_slug` with no `entity_id` at all; 0046 has both but no FK. _Fix: one ADR note fixing the canonical mapping; standardize new tables on `entity_id` (FK)._
14. **Three timestamp conventions** — most 0038–0046 tables use `TEXT DEFAULT (datetime('now'))` (space-separated, no `Z`) while their own comments promise "ISO 8601 UTC"; only 0046 uses true ISO via `strftime`; `events` (0024) uses INTEGER epoch-ms. String-comparing a `datetime('now')` value against an app-supplied ISO `...Z` value mis-sorts (affects cost-anomaly dedupe/snooze). _Fix: standardize on the 0046 `strftime` form._
15. **`vertical` stored as free TEXT with no CHECK** in `customer_configs` (0042) and `entities` (0008) while TS `ACCEPTED_VERTICALS` is a closed 6-member union. `compliance_enabled` + `vertical` were bolted on 3 migrations after table creation — the projection lagged the TS source of truth (the exact drift this review exists to catch).
16. **No shared machine-readable schema for `customer.yaml`** — two independent parsers (TS validator here, overlay parser there) of a 647-LOC contract, with **no shared JSON-schema**. `skill_capture_v1.json` is the model it lacks. Concrete drift already present: skill-name pattern is enforced 64-char lowercase in `skill_capture_v1.json` but the customer.yaml validator accepts **any non-empty string** as `skill.name` (`sections-personas.ts:234`).
17. **Missing rollback scripts** for the 4 most recent AIE migrations — 0040, 0044, 0045, 0046 (0044 does an `ALTER TABLE ... ADD COLUMN ... CHECK`, awkward to reverse in SQLite).
18. **`Persona.voice_overrides` / `escalation_overrides` typed `unknown`** (`types.ts:326`) and passed through with zero validation — the two override fields that change agent behavior bypass all validation in an otherwise rigorously-validated config.

---

## P2 — dead code

### TS (genuinely removable, not the documented pre-bridge stubs)
- `UndoToast.astro` (62 LOC) — zero importers; `ApproveAndSendButton` inlines its own undo markup.
- `config-governance.ts` read/audit API — `listConfigChangeAudit`, `ConfigChangeAuditRow`, `ACTION_CLASSES` (no external caller); `recordConfigChangeAudit` should drop its `export` (one internal caller).
- `teach-marcus.ts` audit chain — `MemoryRuleAddedAuditEvent` / `buildMemoryRuleAddedAuditEvent` / `recordMemoryRuleAddedAudit` wired to nothing (the `teach.ts` route imports only the validator).
- Unused `export`s on `ai-employee-access.ts` (5 symbols used only internally); `DraftSendStatus.astro` (confirm); `ChangeDirection`'s `'n/a'` variant never produced.
- _Caveat: the empty list resolvers (`listDrafts…`/`listAudit…` returning `[]`/`null`) are the documented pre-Hermes-bridge (#821) contract — **not** dead, keep them._

### Python tree
- `adapter/resolve_skill_pins.py` — zero references anywhere (no importer/CLI/CI/test). Cleanest deletion candidate.
- `adapter/cost_ingest.py` / `cost_rollup.py` / `cost_telemetry/` — no Python importer, no `__main__`, no CI/bin caller; only a TS sibling reads the D1 they'd write. Either unwired or driven from out-of-repo.
- `wrangler.toml:123` references `ai-employee/adapter/audit_log_integrity.py` — **file doesn't exist** (ported to overlay `integrity.py`, in-tree copy deleted, comment never updated). Same dangling references to already-deleted `audit_log_immutability.py`, `honcho_interceptor.py`, `audit_emit_points.py`.

### Overlay
- Voice ingestion/export subsystem (~3,200 LOC: `pipeline/export/state/filter/diff/namespaced.py`) reachable **only from tests** — no `register()`/hook imports it. Wire to a real cron/CLI entrypoint or remove.
- `integrity.py` / `immutability.py` (audit) and `archive.py` / `dismiss.py` (memory-mirror) imported only as `# noqa: F401 surface for tests` — no in-repo runtime caller (plausibly cross-process from ss-console; document or relocate). `shared/d1_env.py`, `samples.retrieve_relevant_samples` (always returns `[]`) — dead.

---

## P2 — AI slop & sprawl

- **Doc-vs-code drift in overlay README/AGENTS**: header says "Six plugins," table lists **7**, Install says "five." Real count = 6 production + 1 probe. `pyproject.toml:7`/`plugin.yaml:2` say `0.3.1` but deployed is `v0.4.0`; per-plugin versions independently stale. Hook list undercounts: `subagent_stop` + `pre_gateway_dispatch` are live production hooks **not covered by the rebase probe** despite AGENTS.md claiming full coverage.
- **`requires_env` is wrong both directions**: voice declares `SMD_R2_VOICE_BINDING` required but never reads it; webhook-router treats its "required" audit binding as optional while the genuinely load-bearing `SMD_WEBHOOK_SIGNING_SECRET` (no secret → routing disabled) is **undeclared**.
- **No-op functions**: `_outcome_from_result` (audit `emit.py:356`) returns `("ok", None)` on both branches — every tool call audited as `outcome="ok"` even on errors. `_split_sentence_at_clause` (voice `transform.py:997`) has a dead `if … : pass` block.
- **Persona naming drift ("Marcus")**: the persona is config-driven in all shipped output (and comments rigorously enforce "no 'Marcus' in user-facing copy"), yet "Marcus" is baked into **symbol/module names** — `teach-marcus.ts`, `TeachMarcusButton/Form.astro`, `validateTeachMarcusInput`, `TeachMarcusResult/Validation`. The actual customer-zero persona is "Crane," which appears nowhere. _Fix: rename to the feature (`teach-memory-rule` / `TeachAgentButton` / `validateMemoryRuleInput`)._
- **Over-engineered casts**: `customer-yaml-editor.ts:407-419` launders a string through a 6-line conditional-type incantation that an enum-validated parse would do safer; `reconstructFromProjection` (`:602-648`) hardcodes 5 sentinel business-ish values (`vertical:'mixed'`, `fly_region:'iad'`, 40-zero `hermes_ref`) adjacent to the repo's no-fabrication policy.
- **Files over the 500-LOC ceiling**: Python — `voice/transform.py` **1366**, `evidence/packet.py` 874, `sticky_stop.py` 861, `memory/retention.py` 751, `namespace_assertion.py`/`audit_log.py` 639, overlay `enforce.py` 766 + `transform.py` 1351. TS — `customer-yaml-editor.ts` 692, `drafts.ts` 676, `types.ts` 647, `audit.ts` 637, `sections-other.ts` 540, `costs/index.astro` 521. No function exceeds the 75-line ceiling on the TS side; the Python `enforce()` (~150 LOC) and overlay `on_pre_gateway_dispatch` (~140 LOC) do.

---

## Recommended sequence

1. **Decide safety-floor ownership** (the headline) — which repo owns trust/voice/audit/memory, and the lockstep mechanism. Everything else is cheaper after this.
2. **Verify the P0 fail-open/no-op items** (#1–3) — these are correctness, not cleanup, and tie to the venture's recurring P0 anti-pattern.
3. **Single-source the cross-repo duplications** (#3–4 audit writer + ULID/timefmt) — highest drift-risk-per-fix.
4. **Schema hardening** (#11–17) — FKs, one timestamp convention, shared customer.yaml schema, rollbacks. Do before a real client writes governance rows.
5. **TS dedup + dead-code sweep** (#7–10, P2 dead) — low-risk, high-readability, mostly mechanical.
6. **Rename "Marcus"** and split over-ceiling files — opportunistic.

_Confidence note: structural findings (deploy path, supersession map, persona naming, doc/version drift) were partially verified directly. "Runtime-unreachable" in the overlay/Python tree means "no `register()`/hook/importer in that repo outside tests" — a few may be invoked cross-process from ss-console cron/portal code, flagged MED not HIGH where the agents hedged. Line numbers are agent-cited; spot-check before acting on any single one._
