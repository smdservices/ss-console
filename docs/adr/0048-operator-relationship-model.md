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

> **Amended 2026-06-16 (Captain).** The **style / voice-correction (live-edit)**
> lane described below (the lane-table "Style / correction" row, §2d's framing of
> it as a relationship lane, §3, and §4.1) is **retracted**. Diffing corrected
> drafts captures _voice_ (how a message reads), not _personality_ (how a person
> wants to be worked with) — the wrong surface. The **learned** relationship lane
> is now a **per-peer working-preference memory** built on Hermes' native memory
> loop, keyed on the per-sender id Hermes threads each turn and mirrored to D1; it
> captures _stated and demonstrated_ working preferences (preference + why +
> how-to-apply, never trait labels), reversible and inspectable. The **authored**
> lane (`customer.yaml relationship:`, shipped — §1 row 1 / §4.2) stands as the
> seed. `voice_corrections` (migration 0010) reverts to a dormant voice-glossary
> table outside the relationship model; its read/apply + live-edit primitives
> (`corrections.py`, `live_edit.py`) and the `memory_export` seam exposure are
> removed. The binding policies in §2 (informational-only, no-duplication,
> runtime-read discipline, taint-aware) carry over. The body below is preserved as
> the original record; read it through this amendment.

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

3. **`voice_corrections` (migration 0010) is a voice-glossary table, not a
   relationship lane.** _(2026-06-16: it was briefly modeled as the relationship
   "style" lane; that is retracted. The read/apply + live-edit primitives were
   removed; the table remains dormant — forward-only migration — and out of scope
   for this model.)_ **(2026-07-31, #2091: the table is now retired outright.**
   Its named runtime consumer, `adapter/voice/corrections.py::select_active`,
   never existed, and ADR 0083 §4 makes a correction an edit to an output
   class's property rather than a glossary substitution. Migration 0010 is
   deleted; the correction lifecycle lives in
   `migrations/0102_operator_voice_corrections.sql` console-side, with capture
   as an append-only seat audit row. Every runtime layer was probed clear —
   `vfy_01KYWTNX8A3JYPY08H6GSH8MZ8`, `vfy_01KYWTNZVVQY33J4XB1PP02NEZ`,
   `vfy_01KYWTZGDRYTGZDJRHRNBW72SG`.**

4. **Sent-capture is not pursued.** _(2026-06-16: the live-edit correction writer
   depended on a sent-folder watcher that was never built; with the style lane
   retracted, that dependency is dropped, not deferred.)_

5. **Entitlements are code-enforced and authored-only** (ADR 0035 / 0026;
   `trust_ceiling`/`enforce()`). The agent never raises its own ceiling.

## Decision

### 1. The relationship model is a composition, not a new monolith

The model has three lanes, unified by **one legible surface**. Two lanes already exist;
we do not fork parallel stores for them.

| Lane                                      | Store                                                         | Status                             |
| ----------------------------------------- | ------------------------------------------------------------- | ---------------------------------- |
| Authored (how to work with each person)   | `customer.yaml relationship:`, materialized to SOUL.md/config | shipped (Phase 2); the seed        |
| Learned (how each person works, observed) | Hermes native memory, keyed per peer, mirrored to D1          | forthcoming (per-peer memory loop) |
| Inferred (unstated patterns)              | `persona_observations` / Honcho (0016)                        | deferred until Honcho runs         |

> _(2026-06-16 amendment: the original first row was "Style / correction →
> `voice_corrections`"; retracted — see the banner above.)_

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
- **d. No duplication.** The authored lane and the learned lane write the same
  KIND of per-person working preference (one composed model, two sources); we do
  not fork parallel stores. (Repo rule: shared flows stay shared once
  canonicalized.) _(2026-06-16: `voice_corrections` is a separate voice-glossary
  concern, not a relationship lane. 2026-07-31, #2091: that table is retired;
  style is now a property of an output class — see item 3 above.)_
- **e. Runtime-read discipline preserved.** `persona_observations` stays
  non-runtime-read (the Honcho-hallucination defense). The relationship model
  never reads `persona_observations` at agent runtime.
- **f. Taint-aware learning.** A capture sourced from a session that ingested untrusted
  inbound (`SESSION_TAINT`) is not promoted to a standing correction/preference — an
  injected message must never become a learned rule.

### 3. The learned lane is per-peer working-preference memory on the native loop

_(2026-06-16: this section replaces the retracted "live-edit capture" design.)_

The learned lane captures how each person likes to work — cadence (bullets vs
prose), autonomy (act vs ask), how they word requests and corrections, how they
refer to others — from **the content of the request on any channel**, not from the
artifacts the Operator produces. It runs on Hermes' **native memory loop** (the
built-in capture → distill → store → inject-at-session-start cycle), with one
addition: keyed on the **per-sender id Hermes threads on each turn**, so one
person's preferences stay separate from another's, and **mirrored to per-customer
D1** with provenance (ADR 0016 mirror-don't-gate) so every learned rule is
Captain-inspectable and reversible. Each unit is a **stated or concretely
demonstrated** preference, written as preference + why + how-to-apply, **never a
trait or psychological label**; recency supersedes; no approval gate stands between
the agent and its memory (safety is the trust discipline + inspectability + §2f
taint-awareness). The detailed design lives in the per-peer relationship-loop plan
and its forthcoming ADR.

### 4. Scope (what shipped, what's next)

1. **The legible surface** — the admin `.../[customer]/memory` view, read-only,
   composing the lanes honestly. It reads the **authored** lane live via the
   `config_export?section=relationship` seam; the learned and inferred lanes are
   shown honestly until they land.
2. **The authored-preference channel** — a `relationship:` block in
   `customer.yaml`, materialized by `translate.py` into each persona's SOUL.md +
   config and served to the surface via `config_export`. Shipped (Phase 2). This is
   the seed of the per-person relationship.
3. **This ADR.**

The **learned lane** (per-peer working-preference memory on the native loop) is the
next build, against current Hermes; it is specified in the per-peer
relationship-loop plan, not under this ADR.

## Consequences

- **Nothing is throwaway when Honcho lands.** It joins the inferred lane into
  `persona_observations`; the composition surface already renders multiple lanes;
  the authored lane remains the high-confidence backbone alongside the learned lane.
- **The authored seed ships now; the learned lane is built next** on Hermes' native
  memory loop, keyed per peer (see the per-peer relationship-loop plan).
- **Roadmap:** the learned per-peer lane → pull / help-on-request reading the
  composed model + the client-portal surface → proactive tips with gating + decay →
  Honcho inferred lane + the throughput-up-while-help-need-down value metric.

## Open Items / Follow-ons

- **Per-peer relationship loop** — build the learned lane on Hermes' native memory
  loop against current Hermes (per-peer keying + D1 mirror + trust discipline).
  Tracked in the per-peer relationship-loop plan.
- **`persona_observations` schema drift** — migration `0007` (`conclusion_id` PK) and
  the overlay mirror's `schemas.py` DDL (`observation_id` PK, `honcho_conclusion_id`)
  define different shapes for the same table, and the mirror's INSERT columns match
  neither cleanly. Dormant (Honcho off) but real. File as a separate hardening issue;
  out of scope here.
