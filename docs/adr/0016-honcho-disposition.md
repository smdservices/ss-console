---
title: Honcho Disposition — Mirror, Don't Gate; Tuned Native Configuration; TTL Archival with Captain Reversibility
date: 2026-05-24
status: accepted
captain: Scott Durgan
supersedes: 0016-honcho-disposition.md (prior version of this file; see `git log docs/adr/0016-honcho-disposition.md`)
related-spec: docs/specs/operator/customer-yaml-schema.md
related-issue: TBD (filed as follow-on to the locked Hermes-alignment plan dated 2026-05-24)
---

# ADR 0016 — Honcho Disposition

**Status:** Accepted (Captain decision, 2026-05-24); **amended 2026-05-30** — see Revision below.

## Revision (2026-05-30) — Honcho deferred behind the owned-memory file; flat-file core restored

The first real boot of customer-zero exposed that the in-container Honcho integration was **fictional**: `bootstrap.sh` ran `python -m honcho.migrations` / `python -m honcho.server` against the pip package `honcho-ai`, which is the Honcho **client SDK**, not the server. Real Honcho v3.0.7 ([plastic-labs/honcho](https://github.com/plastic-labs/honcho)) is a uv **source repo** — `fastapi run src/main.py` (api) plus a **separate `python -m src.deriver`** worker (the deriver is what produces the conclusions this ADR's mirror depends on), alembic migrations via `scripts/provision_db.py`, requiring **pgvector** Postgres and a **mandatory LLM provider**. The Machine had never booted; it died at the fictional migration step.

Reviewing the Hermes docs + our harness intent (PRD §10) resolved the posture (Captain, 2026-05-30):

- **Memory is two layers.** The customer-owned, editable, exportable memory file (rules, person-mappings, voice — PRD §10) lives in **our D1/R2**; that is the product and the trust mechanism. Honcho is the **inferred-memory engine** that sits **behind** that file and feeds it — a _swappable provider_, not the substrate. This is the "you own the memory; we can swap the tech underneath" promise, delivered by the architecture, not a config knob.
- **Hermes agrees.** Honcho is 1 of 8 _optional_ memory providers that run **alongside** an always-on flat-file core (`MEMORY.md`/`USER.md`), never replacing it. Boot never depends on Honcho.
- **Phase 1 (now):** boot on the flat-file core with Honcho **removed** from the boot path. The `hermes-smd-overlay` `translate.py` no longer tombstones `MEMORY.md`/`USER.md` or emits a Honcho config block; Postgres/Redis/Honcho are not started; the Honcho secrets are optional. This is implemented in ss-console (`operator/templates/*`, `bin/*`) + overlay (`bootstrap/translate.py`).
- **Phase 2 (deferred, demand-gated):** vendor the **real** `plastic-labs/honcho@v3.0.7` source (api + deriver, pgvector, localhost-bound, `AUTH_USE_AUTH=false`) the same way upstream Hermes is vendored; rewrite `memory-mirror/honcho_client.py` against the real API (its assumed `/conclusions` endpoints likely do not match v3.0.7); build the admin `persona_observations` viewer/dismiss UI; bump `machine.memory_mb` and price the deriver's continuous LLM spend (ADR 0004).

**What the Decision below still means, and what changed.** The decision to _keep_ Honcho as the inferred-memory provider stands; the mirror/dismissal/evidence-status/TTL machinery is the right shape for Phase 2. What is **reversed** is the disposition that Honcho is the _sole_ memory provider with the flat-file core **tombstoned** — the flat-file core is always-on (Hermes' own model), and Honcho runs alongside and feeds the owned D1 file. The "in-container unmodified Honcho image" wiring (and Verification #6's `docker image inspect plasticlabs/honcho`) is replaced by **vendored source at a pinned tag** in Phase 2.

**Loud caveat.** With Honcho off and the explicit D1/R2 memory not yet on the runtime read path (the tail-log drain, #821), the Phase-1 agent has **in-session flat-file memory only**. The first real boot proves the **harness** (quarantine → draft → send), not the product memory.

---

_Original decision (2026-05-24), preserved below with the amendments above governing._

**Status:** Accepted (Captain decision, 2026-05-24).

**Source:** The locked Hermes-alignment build plan dated 2026-05-24, following a focused Honcho deep-dive (architecture, configurable behaviors, native deferred/proposer capabilities, real-world failure modes) and Captain's directional reframe of the gating question. This rewrite replaces the prior version which proposed a "proposer-only" interception of Honcho writes — that posture had no native surface to land on, addressed a real concern (voice drift, hallucinated facts) with the wrong mechanism, and was framed against the wrong risk (lawyer malpractice).

## Context

Honcho ([plastic-labs/honcho](https://github.com/plastic-labs/honcho), AGPL-3.0) is the memory provider plugin Hermes ships first-class. It runs as a self-contained service (FastAPI + Postgres + Redis + a deriver worker process consuming a Redis queue). It builds a per-peer psychological model from session messages via two LLM-driven loops: a per-batch **deriver** (explicit + deductive conclusions) and a periodic **Dreamer** (inductive generalization via DeductionSpecialist + InductionSpecialist agents). Its read surface is a **Dialectic** tool layer the agent queries for natural-language answers about the peer.

Three first-source findings that changed the disposition calculus:

1. **No native interception surface.** Honcho's documented webhook events are `queue.empty` and `test.event` only ([src/webhooks/events.py](https://github.com/plastic-labs/honcho/blob/main/src/webhooks/events.py)). There is no `conclusion.created` event, no `pending` status flag on conclusions, no native "propose for review, await approval, then apply" path. Once the deriver finishes, conclusions are live. The prior ADR's "intercept Honcho writes" posture had no surface to attach to.

2. **Documented hallucination failure mode.** [Honcho issue #626](https://github.com/plastic-labs/honcho/issues/626) — the shipped extraction prompt's few-shot examples teach the model to over-attribute (one mention of a dog produces "the user has a dog"). [Honcho issue #658](https://github.com/plastic-labs/honcho/issues/658) — explicit user corrections do not propagate; obsolete facts persist as current-tense state. Both are open at time of writing. These are the real risks the disposition must address.

3. **The malpractice framing was overstated.** The prior ADR cast Honcho-driven persona evolution as a malpractice exposure for professional-services customers. First-principles: draft-for-review (ADR 0035) closes the one-shot harm path. The very next outbound draft after a bad Honcho learning is human-reviewed. The malpractice path requires _systematic drift across many drafts each of which looks fine individually_ — a different, narrower, slower risk.

The Captain has directed (2026-05-24) the architectural inversion: **trust Hermes' learning loop natively; add visibility and reversibility; do not gate.** This applies symmetrically to Honcho (this ADR) and the Curator/`skill_manage` (ADR 0017).

## Decision

**Honcho runs unmodified per customer Machine, tuned aggressively but not gated. The `hermes-smd-memory-mirror` plugin mirrors Honcho conclusions to per-customer D1 `persona_observations` with provenance. Captain dismissal in the admin portal physically deletes the conclusion from Honcho. TTL archival prevents unbounded growth.**

Concretely:

### Honcho native configuration (in per-profile `config.yaml`)

```yaml
honcho:
  enabled: true
  recallMode: hybrid # auto-context injection + tools
  dialecticCadence: 3-5 # refresh every 3-5 turns, not every turn
  dialecticDepth: 1 # minimal reasoning tier for speed
  injectionFrequency: every-turn # but only refresh-on-cadence above
  writeFrequency: session # batch flush at session boundary
  contextCadence: 5 # base-context refresh every 5 turns
  observation_gates:
    user_observe_me: true # build model of the customer's contacts/peers
    user_observe_others: false # do not cross-observe
    ai_observe_me: false # do not model the Operator itself
    ai_observe_others: false
```

### `hermes-smd-memory-mirror` plugin behavior

The plugin (one of the four in `venturecrane/hermes-smd-overlay` per ADR 0015 rewrite) registers against Hermes' `on_session_end` hook plus a periodic backup poller for sessions that end abnormally (process crash, timeout, restart). On each fire:

1. Query Honcho's conclusions API for new conclusions since the last mirror checkpoint.
2. For each new conclusion, compute `evidence_status` from Honcho's source-message list:
   - `evidenced` — the conclusion has one or more source-message IDs that resolve to actual messages in the session log.
   - `unevidenced` — the source-message list is empty or the IDs do not resolve. **This catches Honcho bug #626 hallucinations** — fabricated facts won't have valid source-message provenance.
   - `insufficient` — source-message list exists but contains fewer than the configured minimum (default 1).
3. Write a row to per-customer D1 `persona_observations` with full provenance:

   ```
   conclusion_id, customer_slug, persona_slug, peer_id,
   conclusion_text, conclusion_type,        -- 'explicit' | 'deductive' | 'inductive'
   source_message_ids JSON,                  -- from Honcho's reasoning tree
   confidence REAL,                          -- from Honcho if provided
   evidence_status TEXT,                     -- 'evidenced' | 'unevidenced' | 'insufficient'
   mirrored_at TIMESTAMP,
   honcho_created_at TIMESTAMP,
   archived_at TIMESTAMP NULL,
   archived_reason TEXT NULL,
   dismissed_at TIMESTAMP NULL,
   dismissed_by TEXT NULL,
   dismissed_honcho_delete_at TIMESTAMP NULL,
   active BOOLEAN GENERATED ALWAYS AS (archived_at IS NULL AND dismissed_at IS NULL)
   ```

### Admin portal surfaces

- **Two distinct review queues.** Evidenced conclusions surface in a default-collapsed list; unevidenced and insufficient conclusions surface in a separate prominent queue. The bug #626 defense lands at the review surface — unevidenced conclusions are flagged for Captain attention before they shape future drafts, not after.
- **Captain dismissal action.** Triggers (a) update of the D1 row's `dismissed_at` / `dismissed_by`, (b) HTTP `DELETE /conclusions/{conclusion_id}` against the local Honcho. The Honcho delete works around bug #658 (temporal-awareness) by physical removal rather than appending a contradiction. Audit row emits `HONCHO_CONCLUSION_DISMISSED`.

### TTL archival

A daily job (run by the `hermes-smd-memory-mirror` plugin's `archive.py`) sweeps conclusions where `mirrored_at < now() - archive_after_days` (default 180, configurable in `customer.yaml`). For each match:

1. Insert into `persona_observations_archive` (same schema, separate table, append-only).
2. Update `persona_observations` row with `archived_at` and `archived_reason: 'ttl'`.
3. Delete the underlying Honcho conclusion via the API.

Captain can restore an archived conclusion from D1 if needed (the inverse of dismissal). Restore re-inserts the conclusion in Honcho via the API and resets `archived_at` to NULL.

### What this ADR explicitly does NOT do

- **No write-path interception.** No `HonchoInterceptor`, no `verify_honcho_intercepted` boot check, no `proposer_only` blocking. The prior version of this ADR specified those. They are deleted as part of the locked alignment plan.
- **No malpractice framing.** The job of this ADR is voice-integrity and observability for an opaque learning system, not a malpractice gate. Draft-for-review gating holds that job at the per-draft layer.
- **No Honcho code modification.** Honcho runs from a pinned upstream image, byte-for-byte unmodified. CI on the Machine image build asserts the Honcho layer hash matches upstream. This preserves the AGPL § 13 unmodified-deployment safe harbor (see locked plan §5 fork posture).
- **No Plastic Labs commercial relationship as a precondition.** Self-host Shape 1 per the AGPL analysis. We may engage Plastic Labs commercially if a real reason surfaces; we do not do so as a goodwill gesture.

## Alternatives Considered

### Pattern 1: Disable Honcho entirely

Use Hermes' built-in `MEMORY.md`/`USER.md` flat-file memory only.

**Rejected.** Hermes' built-in memory is two flat text files totaling ~3.5KB. No structure, no provenance, no cross-session reasoning loop. Honcho is the substrate Hermes ships as the memory backbone (the upstream README highlights it). Disabling it forfeits the differentiating learning capacity that makes the agent improve with use.

### Pattern 2: Intercept Honcho writes (prior ADR version)

The prior ADR specified an interceptor that catches deriver writes and routes them to a review queue before they affect persona state.

**Rejected.** No native interception surface exists. Building one requires either forking Honcho (AGPL implications, maintenance burden) or proxying Honcho's API (latency, brittleness, doesn't catch Dreamer-loop writes). The cost is high; the benefit is one-shot-harm prevention that draft-for-review already provides.

### Pattern 3: Use Plastic Labs hosted Honcho

Customers' Hermes points at `api.honcho.dev`; Plastic Labs hosts the service.

**Rejected.** Breaks the "memory lives in the customer's Machine" product story. Exposes us to Plastic Labs' per-token pricing. Adds a single-vendor dependency on a pre-seed company. AGPL is no longer our problem on this path, but the architectural and commercial tradeoffs are worse.

### Pattern 4: Self-host unmodified + mirror to D1 + Captain dismissal (this decision)

Selected. Self-host preserves the product story and the AGPL safe harbor; the mirror provides observability; physical-delete dismissal provides reversibility that works around Honcho's temporal-awareness bug.

## Consequences

**Positive.**

- The substrate is durable. Honcho rebases against upstream without conflict because we do not patch. The plugin runs against a stable HTTP API.
- Voice integrity is achievable through inspection-and-reversal, not through gating that would degrade the learning loop's ergonomics.
- The bug #626 (hallucination) and #658 (temporal awareness) failure modes are addressed concretely — evidence_status flagging at mirror time, physical deletion on dismissal.
- AGPL exposure is bounded by the no-patches discipline. CI asserts the Honcho layer hash; any divergence fails the build.

**Negative / accepted.**

- Honcho can still learn something wrong between session-end mirrors. The first draft after a bad learning may reflect it. The approver catches the draft. We accept this cost.
- Captain inspection of unevidenced conclusions is operational work. We accept this; it is the active mitigation for bug #626.
- D1 `persona_observations` grows with usage. TTL archival caps unbounded growth. The archive table accumulates as well but is materially smaller per-row and cheaper to query.
- If Plastic Labs relicenses Honcho (e.g., SSPL), we pin to the last AGPL version and decide migration vs. fork. The risk is forward-looking, not present.

## Verification

1. **`recallMode: hybrid` and tuned cadences** are present in every per-profile `config.yaml` generated by the bootstrap CLI (forthcoming ADR 0019). A schema check in the bootstrap translator enforces the tuned values.
2. **`hermes-smd-memory-mirror` plugin loads and registers `on_session_end` hook.** `hermes plugins list` shows it; the hook-surface probe (§0 of locked plan) confirms `on_session_end` fires.
3. **D1 `persona_observations` accumulates evidenced + unevidenced rows.** A first-session smoke test against `_template` customer produces measurable rows with correct `evidence_status` classification.
4. **Captain dismissal physically deletes from Honcho.** Smoke test: insert a synthetic conclusion via Honcho API, mirror to D1, dismiss in the admin portal, verify Honcho's `GET /conclusions/{id}` returns 404.
5. **TTL archival sweeps run daily.** The plugin's daily job logs the sweep and writes archive rows. A back-dated synthetic conclusion (`mirrored_at` set 200 days ago) gets archived on the next sweep.
6. **No patches to Honcho.** _(Superseded by the 2026-05-30 Revision: Phase 2 vendors `plastic-labs/honcho@v3.0.7` **source** at a pinned tag — the same clone-and-assert-SHA discipline used for upstream Hermes — not a prebuilt `plasticlabs/honcho` image. The integrity check is the SHA assertion on the cloned tag, not a `docker image inspect` layer-hash compare.)_
7. **No interceptor code.** `rg -i "HonchoInterceptor|honcho_interceptor|verify_honcho_intercepted|proposer_only" operator/ src/ venturecrane/` returns zero matches.

## References

- [Honcho repo](https://github.com/plastic-labs/honcho), AGPL-3.0
- [Honcho issue #626](https://github.com/plastic-labs/honcho/issues/626) — extraction prompt teaches hallucination
- [Honcho issue #658](https://github.com/plastic-labs/honcho/issues/658) — temporal-awareness bug; obsolete facts persist
- [Honcho issue #716](https://github.com/plastic-labs/honcho/issues/716) — deriver silently produces zero observations on some providers
- [Hermes Honcho plugin README](https://github.com/NousResearch/hermes-agent/blob/main/plugins/memory/honcho/README.md)
- [ADR 0005](./0005-external-send-identity.md) — closes the one-shot harm path at the per-draft layer
- [ADR 0015 (rewrite)](./0015-hermes-fork-vs-upstream.md) — plugin-only overlay; this disposition is implemented by `hermes-smd-memory-mirror`
- [ADR 0017 (rewrite)](./0017-skill-curator-disposition.md) — symmetric "mirror, don't gate" posture for the skill-creation loop
- AGPL § 13 analysis (locked Hermes-alignment plan, §5)
- Locked Hermes-alignment build plan dated 2026-05-24
