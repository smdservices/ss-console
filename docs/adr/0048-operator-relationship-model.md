---
title: Operator Relationship Model — Composition, Deterministic Foundation, and the Legible Surface
date: 2026-06-14
status: accepted
captain: Scott Durgan
related-adr: 0037-operator-thesis.md, 0016-honcho-disposition.md, 0035-no-imposed-entitlement-defaults.md, 0026-config-surface-is-security-boundary.md, 0043-operator-runtime-read-path.md
related-issues: 855
---

# ADR 0048 - Operator Relationship Model

**Status: ACCEPTED. Captain decision, 2026-06-14.**

The Operator should build a per-person **working relationship** — learning how each
person it serves likes to be worked with — because that relationship is the moat
(ADR 0037: the moat is the harness + the guide + the **memory**) and the switching
cost. "Help" is not a docs site bolted onto the product; it is the early, explicit
phase of that relationship, which later runs on tacit understanding. This ADR fixes
what the relationship model _is_, what we build first, and the policies that keep it
honest and safe — **before** capture code accretes, so we do not grow a parallel,
overlapping, or fabrication-prone store next to the ones already in the tree.

## Context

Reconnaissance on 2026-06-14 (verified against the live customer-zero Machine via the
ADR-0043 runtime-read seam, not just the docs) established the ground truth this ADR
is built on:

1. **Honcho is not running.** ADR 0016's 2026-05-30 revision deferred the inference
   engine to Phase 2; the in-container version was never booted. A `memory_export`
   read of `persona_observations` on customer-zero returns `{"entries": []}`. So the
   automatic "infer unstated preferences from conversation" capability does not exist
   today, and standing it up is a separate, heavy, per-Machine infrastructure effort.

2. **`persona_observations` (migration 0007) is Honcho-shaped and explicitly
   non-runtime-read.** Its own header forbids agent-runtime reads ("No skill ... reads
   from this table at agent runtime") because Honcho over-attributes (bug #626) and an
   unreviewed inferred conclusion must not silently shape drafts. It also carries
   active schema drift with the overlay mirror's writer (see Open Items). It is a
   Captain-review mirror, not a runtime relationship store.

3. **`voice_corrections` (migration 0010) already is the deterministic correction
   store** — and reaches, in its own header, the identical conclusion this ADR makes:
   corrections are _deterministic, authored, must-apply_ facts that the transform reads
   at runtime, which is exactly why they live in a dedicated table and not in
   `persona_observations`. Its read+apply primitive (`operator/adapter/voice/corrections.py`)
   exists; its `live_edit` capture _writer_ does not.

4. **Sent-capture is unbuilt.** `draft_queue.r2_sent_key` is defined but never
   populated; the sent-folder watcher (`hermes-smd-voice/pipeline.py`) is a stub. So the
   _runtime input_ to any live-edit correction writer (the human's sent version) does
   not exist end to end yet.

5. **Entitlements are code-enforced and authored-only** (ADR 0035 / 0026;
   `trust_ceiling`/`enforce()`). The agent never raises its own ceiling.

## Decision

### 1. The relationship model is a composition, not a new monolith

The model has three lanes, unified by **one legible surface**. Two lanes already exist;
we do not fork parallel stores for them.

| Lane                                 | Store                                                              | Status                              |
| ------------------------------------ | ------------------------------------------------------------------ | ----------------------------------- |
| Style / correction (how drafts read) | `voice_corrections` (0010), runtime-applied by the voice transform | exists; live-edit writer is the gap |
| Behavioral / authored (how to act)   | `customer.yaml` authored preferences, materialized to config       | this ADR adds the block             |
| Inferred (unstated patterns)         | `persona_observations` / Honcho (0016)                             | deferred until Honcho runs          |

The **legible surface** — "here's what I've learned about working with you" — composes
these into one human-readable, Captain-reviewable view (admin first; client portal
later). A human employee's model of you is opaque; the Operator's is legible and
correctable. That is delight, trust, and governance in one surface.

### 2. Binding policies (these constrain every future PR on this model)

- **a. Deterministic floor only.** The overlay captures _only_ deterministic signals
  Honcho will never compute. All probabilistic / free-text inference is Honcho's job,
  deferred. We never ship a heuristic dressed as a fact.
- **b. Honest evidence vocabulary.** Reuse the closed-set evidence discipline. A
  classification is labeled by how it was derived, never inflated to "fact."
- **c. Informational only.** Relationship state shapes help, style, and anticipation.
  It **never** self-grants capability or autonomy. Entitlements stay authored in
  `customer.yaml` and enforced in code; the model may _propose_ a trust change, a human
  _grants_ it. (A good employee learns your coffee order on their own; they do not start
  wiring money because they feel trusted.)
- **d. No duplication.** `voice_corrections` is THE correction/style store. The
  relationship model composes it; it does not fork a second one. (Repo rule: shared
  flows stay shared once canonicalized.)
- **e. Runtime-read discipline preserved.** `persona_observations` stays
  non-runtime-read (the Honcho-hallucination defense). Deterministic must-apply stores
  (`voice_corrections`) are runtime-read. The relationship model never reads
  `persona_observations` at agent runtime.
- **f. Taint-aware learning.** A capture sourced from a session that ingested untrusted
  inbound (`SESSION_TAINT`) is not promoted to a standing correction/preference — an
  injected message must never become a learned rule.

### 3. Live-edit capture is content-free, derived from structural-category change

A live-edit correction is derived **without persisting any body text**: compute
`extract_structural_diff` (`operator/adapter/voice/diff.py`) over the agent draft and
the human's sent version, compare the **closed-set** `greeting_style` / `signoff_style`
categories, and emit a `voice_corrections` row (`source='live_edit'`) only on a category
change, with `before_pattern`/`after_text` drawn from a **fixed, non-PII template map**
(category → canonical literal). This preserves the Voice Layer 2 privacy floor (raw
bodies are never persisted). Lexical and honorific live-edit corrections are **out of
scope** for this deterministic floor — they would require persisting real phrases, so
they remain calibration-session-authored.

### 4. Phase 1 scope (the foundation we build now)

1. **The pure live-edit extractor primitive** (`operator/adapter/voice/live_edit.py`) —
   `(draft, sent, reviewer, cohort) → voice_corrections rows`. Pure, deterministic,
   fully unit-tested. Ships now as the canonical primitive (the repo's established
   "primitive now, runtime call site later" pattern, per `corrections.py`).
2. **The legible surface** — add `memory_export` to the console `RUNTIME_READ_KINDS`,
   expose `voice_corrections` through the seam allow-list, and an admin view composing
   `voice_corrections` (taught style rules) + authored `customer.yaml` preferences.
   Read-only, honest confidence rendering.
3. **The authored-preference channel** — a `relationship:` block in `customer.yaml`
   (authored behavioral preferences + capture knobs), registered in
   `operator/contracts/customer-yaml-blocks.yaml`.
4. **This ADR.**

The live-edit **runtime trigger** (invoking the primitive when a draft is approved with
a captured sent version) depends on the unbuilt sent-capture pipeline (Context 4) and
**activates when that lands**. That dependency is filed as the blocking follow-on; we do
not build the sent-capture epic under this ADR.

## Consequences

- **Nothing is throwaway when Honcho lands.** It joins the inferred lane into
  `persona_observations`; the composition surface already renders multiple lanes; the
  deterministic lanes (voice/authored) remain the high-confidence backbone.
- **The spine ships now; automated style-learning activates when sent-capture lands.**
  The capture _logic_ is tested and ready; only its runtime input is pending.
- **Privacy floor preserved** — no body text persisted; corrections are
  category + fixed template.
- **Roadmap:** Phase 2 — pull / help-on-request reading the composed model + the
  client-portal surface; Phase 3 — proactive tips with gating + decay; Phase 4 — Honcho
  inferred lane + the throughput-up-while-help-need-down value metric.

## Open Items / Follow-ons

- **Sent-capture pipeline** (`draft_queue.r2_sent_key` population / sent-folder watcher)
  — blocks the live-edit runtime trigger. File as the activating follow-on.
- **`persona_observations` schema drift** — migration `0007` (`conclusion_id` PK) and
  the overlay mirror's `schemas.py` DDL (`observation_id` PK, `honcho_conclusion_id`)
  define different shapes for the same table, and the mirror's INSERT columns match
  neither cleanly. Dormant (Honcho off) but real. File as a separate hardening issue;
  out of scope here.
