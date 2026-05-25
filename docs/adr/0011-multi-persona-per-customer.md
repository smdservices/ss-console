---
title: Multi-Persona Per Customer — Persona = Hermes Profile, v1 Ships at Length 1, Multi-Profile Switching via Hermes /handoff
date: 2026-05-24
status: accepted
captain: Scott Durgan
supersedes: 0011-multi-persona-per-customer.md (prior version of this file; see `git log docs/adr/0011-multi-persona-per-customer.md`)
related-prd: docs/pm/ai-employee/platform-prd.md §2, §7.3, §9, §11, §12.1, §20
related-spec: docs/specs/ai-employee/customer-yaml-schema.md
related-issue: https://github.com/venturecrane/ss-console/issues/790
---

# ADR 0011 — Multi-Persona Per Customer

**Status:** Accepted (Captain decision, 2026-05-24).

**Source:** The locked Hermes-alignment build plan dated 2026-05-24, following the Practical AI Podcast ep. #357 (2026-05-21) intel that Hermes' multi-tenant work is in flight as plugin-layer-only and that multi-persona maps cleanly onto multi-profile-per-user via `/handoff`. This rewrite replaces the prior version's "schema-locked, runtime deferred to Phase 2" framing with a concrete Hermes-aligned implementation that ships in v1 at `personas[]` length 1 and supports v2 expansion without additional engineering.

## Context

A customer may eventually want more than one AI persona attached to their business — for example, an inbox-triage agent ("Marcus") and a separate intake-handling agent ("Casey") running against the same firm's connectors and memory but with distinct identities, signature blocks, voice envelopes, and skill assignments. The prior ADR locked the data-model commitment (`personas: []` array) but deferred runtime implementation to "Phase 2, gated on a paying multi-persona customer."

Three findings reshape the runtime question:

1. **Hermes' identity model is per-profile.** Each Hermes profile has its own `HERMES_HOME`, `SOUL.md` (identity file), `config.yaml`, skill catalog symlinks, and Honcho peer card. Profiles are the unit of identity isolation upstream. The `_apply_profile_override()` mechanism in `hermes_cli/main.py` sets `HERMES_HOME` before any module imports, so every `get_hermes_home()` call thereafter returns the profile-scoped path. This is process-level isolation by construction.

2. **Hermes ships `/handoff` for live session transfer between profiles.** v0.14.0 (PR #23395, released 2026-05-16) makes `/handoff` transfer an active session to a target model, persona, or profile mid-session without dropping anything. Multi-personality threading is also being explored via channel-based routing (PR #20096) and the `thread_require_mention` config for multi-bot Discord threads (PR #25445).

3. **In-process multi-persona is not on the Hermes roadmap.** Per the first-source analysis, the upstream direction is "N profiles, swap between them," not "multiple personas active in one session concurrently." This matches Quesnelle's framing in the Practical AI podcast — multi-tenant and multi-persona are the same primitive (`single gateway, multiple agents` per PR #25660) used different ways.

The prior ADR's runtime deferral was prudent under uncertainty about what Hermes would ship; under current visibility, the answer is concrete and the runtime can ship in v1 without speculation.

## Decision

**A persona is a Hermes profile. N personas = N profiles, all within the same per-customer Machine, each with its own `HERMES_HOME`, `SOUL.md`, `config.yaml`, skill catalog, and Honcho peer card. Persona switching mid-session uses Hermes' native `/handoff`. v1 ships at `personas[]` length 1; the validator enforces this until v2 unlocks it.**

Concretely:

### v1 schema and validator

The `customer.yaml.personas[]` array stays in the schema as authored in the prior version. The TS validator (`src/lib/ai-employee/customer-yaml/sections-personas.ts`) enforces `personas.length === 1` for v1 customers. The forward-compatible schema means a v2 unlock is a validator change, not a schema migration.

Per persona, the customer.yaml carries:

- `slug` — kebab-case, used as the profile directory name (`~/.hermes/profiles/<slug>/`).
- `status` — `active` | `inactive`.
- `name`, `title` — used in `SOUL.md` and signature.
- `tone[]` — voice characteristics injected into `SOUL.md`.
- `skills[]` — per-persona skill set with `name`, `version`, `trust_ceiling`, `enabled` (each persona can run a subset of the customer's catalog; v1's single persona runs the full skill set unless skill-level `enabled: false` overrides).

### v1 bootstrap behavior

At Machine startup, the `hermes-smd bootstrap` CLI (per the forthcoming customer.yaml → per-profile translation ADR 0019):

1. Reads `customer.yaml` from the volume.
2. For each persona in `personas[]` (v1: exactly one), creates `~/.hermes/profiles/<slug>/` with:
   - `config.yaml` — per-profile Hermes config (model pin, memory provider config for Honcho per ADR 0016 rewrite, plugin enables for the four overlay plugins, MCP server bindings from `connectors{}`).
   - `SOUL.md` — persona identity (name, title, tone, voice samples reference).
   - Skill symlinks — the relevant subset of the customer's skill catalog symlinked into `~/.hermes/profiles/<slug>/skills/`.
3. Launches Hermes against the active profile (v1: the only profile).

### v2 runtime (multi-profile switchable)

When `personas[]` length unlocks beyond 1, the runtime change is purely additive:

- Bootstrap creates N profile directories instead of 1.
- The first profile (the one marked `status: active` first in the array) becomes the default at session start.
- The customer (via the admin or customer portal) can issue `/handoff <persona-slug>` to swap to another persona mid-session. Hermes' native handoff transfers the session state to the target profile.
- Each persona has its own Honcho peer card (the customer.yaml.memory section's `d1_namespace` stays per-customer; the Honcho peer-id is per-persona within that namespace).
- Audit rows (`hermes-smd-audit`) include the `persona_slug` field already; multi-persona audit lookups in the admin portal filter by persona.

The v1 → v2 transition is unlocking the validator. No bootstrap code rewrite, no runtime architecture change.

### What this ADR explicitly does NOT do

- **No in-process multi-persona switching.** Hermes does not support this and is not building it. The Hermes-native answer is profile switching.
- **No persona-as-process-thread.** A persona is a profile, isolated by `HERMES_HOME`. We do not spawn separate Hermes processes per persona within a single Machine.
- **No persona-level Machine spawning.** The per-customer Machine model (ADR 0007) is unchanged. A customer with N personas still runs one Fly Machine; that Machine hosts N profile directories.

## Alternatives Considered

### Pattern 1: One Machine per persona

Each persona deploys to its own Fly Machine. N personas = N Machines for one customer.

**Rejected.** Multiplies infrastructure cost per customer with extra personas. Breaks the shared-memory story — each Machine has its own Honcho install, so the customer's connectors and learning are duplicated across personas instead of shared.

### Pattern 2: In-process multi-persona via custom dispatcher

Build a runtime layer that switches persona configuration per turn within a single Hermes process.

**Rejected.** Requires modifying Hermes core (forbidden per ADR 0015 rewrite) or wrapping Hermes' agent loop in a custom dispatcher (which loses native machinery — guardrails, observability, plugin hook semantics). Hermes' identity model assumes per-process per-profile; fighting it is high-cost low-value.

### Pattern 3: N profiles + native `/handoff` (this decision)

Selected. Aligns with Hermes' architecture, ships immediately for v1, scales to v2 without rework.

## Consequences

**Positive.**

- v1 ships with the multi-persona schema in place and a runtime that already supports v2; no future migration required.
- Per-persona isolation comes from Hermes' native profile system; we inherit identity, skill catalog, memory peer-card, and credential separation for free.
- `/handoff` is a Hermes-shipped command, so persona switching ergonomics ride upstream's improvements rather than being SMD-maintained.
- Each persona can have its own Honcho peer-card without breaking the customer's overall memory ownership. Mirror to D1 (`persona_observations`) already keys by `persona_slug`; admin portal lookups filter cleanly.
- A v2 customer paying for two personas can ship without infrastructure expansion — same Machine, two profiles, one bootstrap pass.

**Negative / accepted.**

- The customer cannot run two personas concurrently in the same conversation (e.g., a single email thread CC'ing Marcus and Casey both). They switch via `/handoff`. We accept this; it matches how human role-switching works in firms.
- Persona-level skill granularity is bounded by what Hermes' skill loader does per profile. We inherit upstream's behavior; if we need persona-specific skill behaviors that profiles don't support, we revisit.
- The v1 validator enforces length 1, so a customer who wants two personas immediately requires a v2 unlock release. We accept this; no v1 customer has signed for multi-persona, and unlocking is a validator change, not an architecture pivot.

## Verification

1. **The `customer.yaml` validator enforces `personas.length === 1`** for v1 customers. A two-persona customer.yaml fails validation with an explicit "multi-persona is a v2 feature" message.
2. **The bootstrap CLI creates one profile directory per persona.** For a v1 customer, `ls ~/.hermes/profiles/` shows exactly one persona-slug directory. For a hypothetical v2 customer, the same command shows N.
3. **Each profile is isolated.** `HERMES_HOME` per profile contains its own `SOUL.md`, `config.yaml`, `skills/` (symlinks), and Honcho config. Cross-profile reads via shell commands work only because they are explicit; the runtime does not mix profile state.
4. **`/handoff` works between profiles** in a v2 customer. Smoke test on a two-persona test customer confirms session continuity.
5. **Audit rows carry `persona_slug`.** The `hermes-smd-audit` plugin's schema includes `persona_slug` as a required field; admin portal queries filter on it.

## References

- Hermes upstream identity model: `_apply_profile_override()` in `hermes_cli/main.py`, per-profile `HERMES_HOME` and `SOUL.md`
- [Hermes PR #23395](https://github.com/NousResearch/hermes-agent/pull/23395) — `/handoff` for live cross-profile session transfer (v0.14.0)
- [Hermes PR #25660](https://github.com/NousResearch/hermes-agent/pull/25660) — single gateway, multiple agents MVP (the multi-tenant + multi-persona shared primitive)
- [Hermes PR #20096](https://github.com/NousResearch/hermes-agent/pull/20096) — channel-based profile routing
- Practical AI Podcast episode #357 (2026-05-21), Jeffrey Quesnelle on multi-tenant direction
- [ADR 0004](./0004-productized-ai-employee-offering.md) — productized SKU shape
- [ADR 0007](./0007-per-customer-machine-isolation.md) — per-customer Machine isolation (unchanged: one Machine per customer regardless of persona count)
- [ADR 0015 (rewrite)](./0015-hermes-fork-vs-upstream.md) — no core modifications; persona = profile is the Hermes-native answer
- [ADR 0016 (rewrite)](./0016-honcho-disposition.md) — per-persona Honcho peer cards within per-customer namespace
- [Issue #790](https://github.com/venturecrane/ss-console/issues/790) — schema lock for personas array
- Locked Hermes-alignment build plan dated 2026-05-24
