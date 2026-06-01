# AI Employee Code Review — VERIFIED Findings (supersedes the 2026-05-31 draft)

_Every finding below was re-checked by running or grepping the actual code. Verdicts: **CONFIRMED** (execution-backed) · **OVERSTATED** (real but smaller/different than first claimed) · **FALSE** (does not hold) · **MIXED**._

> **Why this doc exists.** The first review (`ai-employee-code-review-2026-05-31.md`) was produced by agents reading code, and its headline — "the trust/audit/voice safety floor is implemented twice and is **actively diverging**" — did **not survive execution**. The lead then fabricated a "Phase 0 safety-divergence" report + ADR 0032 + a case-table generator on top of that misread (invented `PLAN_MAX_CEILING`, an `approve` ceiling, a `requires_human` field, and divergences D1–D5 that do not exist in the code). Those artifacts were **deleted**. This doc is the re-grounded, execution-verified replacement. Baselines are green: overlay `pytest` 466 passed; substrate `run_invariants` 8/8; substrate `pytest` 163 passed.

## The retraction (most important)

| First-review claim | Verdict | Evidence |
|---|---|---|
| Trust/voice/audit safety floor is **actively diverging**; live policy is weaker | **FALSE (for trust logic)** | Normalized diff of `enforce`, `resolve_ceiling`, `_class_default`, `_most_restrictive` across `adapter/trust_ceiling.py` and overlay `enforce.py` → **logic-identical**, whitespace/paren only. The "89 of 171/548 shared lines" stat was a line-count of two files where the overlay wraps the *same* core in extra non-policy scaffolding. |
| Autonomous `external_send` unreachable / lower-only clamp bug (lead's "D5") | **FALSE (fabricated)** | Ran it: `resolve_ceiling(external_send, authored=autonomous)` → `AUTONOMOUS`; `enforce(...)` → `allowed=True`. The floor narrows only — documented ADR 0025/0022 design, not a bug. `PLAN_MAX_CEILING`, the `approve` ceiling, and `requires_human` **do not exist** in the codebase. |

**Consequence:** the safety-core work is **duplication hygiene (drift risk)**, not a safety emergency, and needs **no Phase-0 divergence adjudication**. Single-sourcing is still worth doing, at lower stakes and risk.

## P0 — genuine correctness defects (all CONFIRMED by execution)

| # | Finding | Evidence |
|---|---|---|
| P0-1 | **Overlay voice plugin silently no-ops.** `bind_runtime` is defined (`hermes-smd-voice/__init__.py:51`) but **never called** anywhere in either repo (grep: only docstrings/`__all__`/log line). `_R2_READER` stays `None`; both hooks early-return (`:92,:131`). Registers "successfully," does nothing. | `grep -rn bind_runtime` → no call site; voice subsystem runtime-inert. |
| P0-2 | **Audit INSERT hand-copied 3×.** Three distinct `INSERT INTO audit_log` literals + 12-col tuples: `hermes-smd-audit/emit.py:120`, `webhook-router/__init__.py:103`, `trust/outbound.py:255`. Column reorder silently corrupts two writers. | `grep -rn "INSERT INTO audit_log"` → 3. |
| P0-3 | **`_outcome_from_result` returns `("ok", None)` on both branches** (`emit.py:367-368`) — every tool call audited `outcome="ok"`, even errors. | Read lines 356-368. |
| P0-4 | **NoOp signers are the default.** `adapter/memory/export.py:449` `signer or NoOpExportSigner()`; `adapter/voice/export.py:417` same. Ships unsigned evidence (`signature_kind="stub"`, empty sig) silently when unconfigured. | Read both sites. |

> **Do NOT touch** `citation_filter.py:183,189` or `transform.py:1265,1276` — verified **fail-CLOSED** (True = reject/abort). They get direction-pinning tests only.

## P1 — genuine duplication (CONFIRMED, magnitudes corrected)

| # | Finding | Verdict | Evidence |
|---|---|---|---|
| P1-1 | `paginate*` **byte-identical** across `drafts.ts:275`, `notifications.ts:255`, `audit.ts:461`, `calendar.ts:274` | CONFIRMED | `diff` of bodies → identical modulo type names. |
| P1-2 | ULID/Crockford kit copied **5×** (not 8); `iso_utc` **9×** | OVERSTATED→real | `grep "def _encode_crockford"` → 5; `iso_utc` defs → 9. |
| P1-3 | Audit row schema duplicated (ties to P0-2) | CONFIRMED | same 3 sites + adapter `audit_log.py`. |
| P1-4 | Relative-age formatters: 6 functions, **only 2 truly share the ladder**; `yr`/`y` unit drift real (`matters.ts:232` `yr` vs `drafts.ts:325` `y`) | OVERSTATED | not one impl ×5; a family with drift. date-fns v4 already a dep (`package.json:33`). |

## P1 — schema (ALL CONFIRMED by execution)

| # | Finding | Evidence |
|---|---|---|
| S-1 | `config_change_audit` (0046) has **no FK constraints** on `entity_id`/`actor_user_id` | `grep REFERENCES\|FOREIGN KEY 0046` → none. |
| S-2 | `recordCustomerConfigSync` (0045 writer, `customer-config.ts:322`) **never called** (only def + JSDoc `@example`) → `customer_config_history` is dead-on-write | `grep -rn "recordCustomerConfigSync("` → 1 hit, inside a JSDoc comment. |
| S-3 | Timestamp drift: **only 0046** uses ISO-Z `strftime`; 0038/39/40/41/43/44/45 use `datetime('now')` (space-separated, no Z) | per-file grep counts shown. |
| S-4 | **Missing rollbacks** for 0040, 0044, 0045, 0046 (0034/35/38/39/41/42/43 present) | `ls migrations/rollbacks/` |
| S-5 | `vertical` is `TEXT` nullable, **no CHECK**, in both `entities` (0008:33) and `customer_configs` (0042:30); TS `ACCEPTED_VERTICALS` is a closed 6-member union | grep both. |
| S-6 | `Persona.voice_overrides`/`escalation_overrides` typed **`unknown`** (`types.ts:326-327`), zero validation | read lines. |

## P2 — dead code (CORRECTED — two first-review claims were FALSE)

| Item | Verdict | Evidence / consequence |
|---|---|---|
| `UndoToast.astro` | **CONFIRMED dead** | zero importers (src/ + tests/). |
| `ACTION_CLASSES` re-export (`config-governance.ts:272`) | **CONFIRMED dead** | 0 refs (tests use `ACCEPTED_ACTION_CLASSES` from types.ts). |
| `ChangeDirection 'n/a'` variant | **CONFIRMED dead** | never produced by `changeDirection()`. |
| `resolve_skill_pins.py` | **OVERSTATED** | zero importers BUT has `if __name__=="__main__"` — an unwired CLI script, not inert. |
| `cost_*` cluster | **CONFIRMED no live caller** | importers = tests only; `adapter/__init__.py` ref is a docstring; no `__main__`/CI/bin. |
| `wrangler.toml:123` → `audit_log_integrity.py` | **OVERSTATED** | ref real + file absent, BUT it's inside a **comment block**; the other 3 "dangling refs" don't appear in wrangler.toml at all. |
| **`teach-marcus` audit chain** (`buildMemoryRuleAddedAuditEvent`/`recordMemoryRuleAddedAudit`) | **FALSE — NOT dead** | **live production** at `teach.ts:148,153`. **Deleting it (as the approved plan's L4 listed) would break a feature.** |
| `listConfigChangeAudit`/`ConfigChangeAuditRow` | **MIXED** | test-only, not dead — leave or wire to a UI; don't delete blindly. |
| `ai-employee-access` 5 symbols | **MIXED** | over-exported (used internally) — drop `export`, don't delete. |

## P2 — AI slop / consistency

| Item | Verdict | Evidence |
|---|---|---|
| `Tone` re-declared 4× | **FALSE** | declared once (`status.ts:46`), imported elsewhere. Real (minor): 4 inline *subset* literal return-unions. |
| README "six/seven/five plugins" contradiction | CONFIRMED | README:7 "Six", table lists 7, :33 "five"; `ls plugins/` = 7. |
| version 0.3.1 (pyproject) vs v0.4.0 (Dockerfile pin) | CONFIRMED | both quoted. |
| `requires_env` **under-declared** (`SMD_WEBHOOK_SIGNING_SECRET` load-bearing, undeclared; trust under-declares its D1 binding) | CONFIRMED (one direction) | grep declared vs read. "Wrong both directions" — declared-but-unread did not reproduce. |
| "Marcus" in identifiers only, kept out of shipped copy | CONFIRMED | rendered label is `Teach ${personaName}` / `Add rule`. |

## Sprawl (CONFIRMED)

- **TS:** 6 files over 500 LOC — `customer-yaml-editor.ts` 692, `drafts.ts` 676, `types.ts` 647, `audit.ts` 637, `sections-other.ts` 540, `costs/index.astro` 521.
- **Python:** 32 files over 500 LOC — worst `voice/transform.py` 1366, `bin/lib/decommission.py` 1101, `evidence/packet.py` 874, `sticky_stop.py` 861, `audit_log.py` 639.

## What changed vs the first review (the audit trail)

- **Retracted (FALSE):** trust-core divergence, autonomous-unreachable, `Tone` ×4, teach-marcus dead. The lead's fabricated Phase-0 divergence report + ADR 0032 + case-table generator: **deleted**.
- **Corrected (OVERSTATED):** ULID 8×→5×, relative-age 5×→"6 funcs, 2 match", resolve_skill_pins "dead"→"unwired script", wrangler dangling-refs 4→1-commented.
- **Held (CONFIRMED):** all 4 P0s, paginate ×4, all 6 schema findings, README/version/requires_env drift, UndoToast/ACTION_CLASSES/'n/a' dead, sprawl counts.
