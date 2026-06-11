# Operator Implementation — current-state runbook & gap register

**What this is.** The honest, traced account of how SMD stands up and supports a
customer Operator **today** — not an idealized process. Every status claim below
is grounded in a committed artifact (`operator/bin/*`, the customer-zero config,
or an ADR), cited inline. Where we don't know something, it says so.

**How it was built.** Traced from the only real instance — customer-zero (SMD
itself, `operator/customers/smd/`) — plus the lifecycle scripts in `operator/bin/`.
It is a _trace_, not a whiteboard. Customer-zero is a partial witness: it exercises
the agent/automation spine faithfully but under-represents the human spine (no
external assessment, no real client clarifications, no paid training), because we
are dogfooding ourselves. That asymmetry is flagged where it matters.

**Why it exists.** Two outputs. (1) A checklist we execute and harden per customer.
(2) A product-improvement register — every place the process is harder than it
should be becomes a candidate issue (Part C).

---

## Legend

**Actor** — who does the step:
👤 SMD-human · 🤝 customer · 🤖 agent · ⚙️ automated script (no human in the step)

**Status** — how real it is:
✅ automated/working · ◑ semi (script exists, human drives) · ✋ manual ·
⛔ blocked / authored-but-unbuildable today

---

## Part A — Stand-up (one-time)

The shape: **assessment → agent authors config → human approves → one provisioning
command → grant access → calibrate voice → shadow → graduate.** The mechanical
middle (provision) is solved and agent-runnable. The cost lives in the bookends.

### A0 · Assessment & authoring

| Step                                                                                                         | Actor | Status | Artifact                                     | Gap / note                                               |
| ------------------------------------------------------------------------------------------------------------ | ----- | ------ | -------------------------------------------- | -------------------------------------------------------- |
| Run onboarding interview (walk the day, capture mailbox roles, capability levels, voice intent, hard-nevers) | 👤🤝  | ✋     | `customers/<slug>/onboarding-interview-*.md` | The real human cost. ~no tooling; it's a meeting.        |
| Agent authors `customer.yaml` + `onboarding-plan.md` from the transcript                                     | 🤖    | ◑      | `customers/<slug>/customer.yaml`             | The `aie-onboard` skill. **The fragile seam** — see C-1. |
| Captain reviews, answers clarifications, approves the buildable subset                                       | 👤    | ✋     | approved `customer.yaml`                     | Authored-intent vs buildable-subset split happens here.  |

**Customer-zero lesson.** The first pass seeded `customer.yaml` from a _test
fixture_ treated as if it were Scott → wrong identity (`venturecrane.com`) rode
along for weeks → late rework. The fix was redoing it as a real interview
(`onboarding-interview-2026-05-31.md` header). The agent will confidently author
from whatever transcript it's handed, including a wrong one. **Authoring is only
as good as the interview, and nothing downstream catches a plausible-but-wrong config.**

### A1 · Provision the Machine — **one command**

```
operator/bin/reprovision.sh <slug>
# = infisical run --env=prod --path=/ss --silent -- operator/bin/provision-customer.sh <slug>
```

| Step (`provision-customer.sh`)                                                                          | Actor | Status | Note                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ----- | ------ | ------------------------------------------------------------------------------------------ |
| Validate slug charset, then `customer.yaml` via canonical TS validator                                  | ⚙️    | ✅     | Step 1; fail-closed.                                                                       |
| Split `hermes_ref` into tag@sha, assert 40-hex pin (ADR 0024)                                           | ⚙️    | ✅     | Step 1b; no live upstream lookup.                                                          |
| Upload `customer.yaml` to R2 (`vaults/<slug>/customer.yaml`)                                            | ⚙️    | ✅     | Step 2; bootstrap fetches it at boot.                                                      |
| Render `fly.toml` from template                                                                         | ⚙️    | ✅     | Step 3; gitignored `.rendered/`.                                                           |
| Create Fly app + 10GB volume + per-customer skill-bodies R2 bucket                                      | ⚙️    | ✅     | Steps 4–5b; idempotent, fail-closed on volume enumerate.                                   |
| Stage secrets (Anthropic, R2, observability, per-customer runtime-read HMAC key, connector + Google SA) | ⚙️    | ✅     | Steps 6–6b; **vault→env→Fly, no paste — agent-runnable.**                                  |
| Create healthchecks.io check                                                                            | ⚙️    | ◑      | Step 6c; warn+skip if no API key.                                                          |
| Seed `fleet_status` row in central D1                                                                   | ⚙️    | ⛔     | Step 6d; **depends on `customer_configs` projection — missing (#1308)** → warn+skip today. |
| Deploy (builds image: clone Hermes@sha, copy skills, overlay plugins)                                   | ⚙️    | ✅     | Step 7.                                                                                    |
| Boot smoke test (customer.yaml → profiles → plugin chain)                                               | ⚙️    | ✅     | Step 8 (`boot-smoke-test.sh`).                                                             |

**Takeaway:** provisioning is **not** the labor. It's one idempotent, re-runnable,
agent-executable command. The R2-cred hunt that once burned ~2h/run is closed
(creds in Infisical `/ss`, injected by the wrapper).

### A2 · Grant access (credentials / authorization)

| Step                                                                                      | Actor | Status | Artifact                                                                      | Gap / note                                                                               |
| ----------------------------------------------------------------------------------------- | ----- | ------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Google authority                                                                          | 👤/🤝 | ◑      | `/opt/data/oauth/google.json` **or** `GOOGLE_SERVICE_ACCOUNT_JSON` Fly secret | **Two paths, and customer-zero's docs disagree — see C-2.**                              |
| — user-OAuth path: browser consent, token saved 0600, live read-probes per scope          | 🤝    | ✅     | `gmail-oauth-consent.py`                                                      | Customer clicks consent. Verifies granted ⊇ required; refuses to narrow a working token. |
| — DWD path: customer-owned service account, domain-wide delegation impersonates `subject` | 👤    | ◑      | `google_auth.mode: dwd` in `customer.yaml`                                    | What SMD's committed config actually uses; broker holds the key (ADR 0045).              |
| Other connectors (Clio etc.): seed encrypted token off-box                                | 👤    | ◑      | `CLIO_TOKENS_ENC_B64` etc.                                                    | Staged from `/ss`; warn+skip if unused.                                                  |
| Telegram channel: bot token → auto-enables polling; allowlist materialized fail-closed    | ⚙️    | ✅     | `telegram.allow_from`                                                         | Bootstrap guard refuses launch if token set without resolvable allowlist.                |

### A3 · Voice calibration

| Step                                                                                     | Actor | Status | Artifact                         | Gap / note                                                                                                                            |
| ---------------------------------------------------------------------------------------- | ----- | ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Collect writing samples from the principal                                               | 🤝    | ✋     | corpus JSONL                     | **Customer-zero supplied none → calibration can't run → falls back to general profile (B4).** The most common authored-but-inert gap. |
| Ingest corpus → content-free structural diffs into R2 vault (leak invariant fail-closed) | ⚙️    | ✅     | `vaults/<slug>/voice/cohort/...` | `voice-ingest-corpus.py`; differ + `assert_style_only` real.                                                                          |
| Run the blind-test voice gate                                                            | 👤    | ⛔     | gate verdict                     | `run-voice-gate.sh` **synthetic mode only; live mode exits 3 "not implemented"** — needs per-customer D1 binding (#800). See C-3.     |

### A4 · Shadow mode (observe / draft / no-send)

| Step                                  | Actor | Status | Note                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ----- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enable skill(s) at `draft_for_review` | ⚙️    | ✅     | Skill body installs into the profile; runs **on-demand / inbound-webhook**.                                                                                                                                                                                                                 |
| Authored hourly cron fires            | ⚙️    | ⛔     | **`customer.yaml` authors `inbox-triage` @ `0 7-19 * * *`, the validator accepts it, but `translate.py::_persona_config` never reads `persona.cron` — validated-but-not-materialized. The skill has never run on schedule.** See C-10. Verified by the live agent ("no cron was ever set"). |
| Captain reviews drafts, grades, tunes | 👤    | ✋     | Human review loop — real recurring cost during onboarding.                                                                                                                                                                                                                                  |

### A5 · Graduated autonomy

| Step                                                       | Actor | Status | Note                                                                                                                                     |
| ---------------------------------------------------------- | ----- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Raise a skill's `trust_ceiling` once the principal chooses | 👤    | ✋     | SMD v1 has **no** promotion candidate — principal wants to send himself. Promotion is a deliberate per-customer decision, not a default. |

---

## Part B — Ongoing support (recurring change catalog)

Every support request resolves to: **which artifact changes → what makes it live →
how we verify.** Today almost everything routes through _edit `customer.yaml` →
push → restart_. The "lighter path?" column is where the product work is.

### B1 · Modify / roll back a skill

- **Change:** `operator/skills/<skill>/SKILL.md` (+ references, grading fixtures).
- **Live path today:** content-hash pin in `customer.yaml` → rebuild image → redeploy.
  `rollback-skill.sh <slug> <skill> <hash>` automates the pin-flip + redeploy.
- **Verify:** `fly logs` shows the target skill version loads; re-grade.
- **⛔ Broken today:** `rollback-skill.sh` reads top-level `skills[]`, but the live
  schema nests skills under `personas[].skills[]` — it can't find any skill in a
  real config (C-4). Version→commit lookup also "Phase B, not wired."

### B2 · Refine the voice

- **Change:** add samples → `voice-ingest-corpus.py --r2`.
- **Live path:** new structural-diff samples land in the R2 vault; the runtime
  reader consumes them at the deterministic key.
- **Verify:** voice gate — **blocked on live mode (C-3)**; synthetic only today.

### B3 · Change an entitlement / scope / persona / connector

- **Change:** edit the relevant `customer.yaml` block (`scope.action_ceilings`,
  `trusted_sender_domains`, `personas[]`, `connectors{}`).
- **Live path:** `sync-customer-yaml.sh <slug>` validates + pushes to R2 → **manual
  `fly machine restart`** to apply.
- **⛔ Friction:** the live customer-sync sidecar is a **Phase-2 stub**, so a merged
  edit does _not_ propagate on its own — restart is mandatory (C-5). New-connector
  types with no MCP need a `build:` adapter first (real eng, not a config edit).

### B4 · Remove / correct a memory

- **Change (Phase 1):** flat-file memory — `MEMORY.md` / `USER.md` on the volume.
- **Live path today:** **no tooling.** Phase-1 memory edit is a manual volume edit;
  inferred memory (Honcho) deferred to Phase 2 (ADR 0016). C-6.
- **Design intent:** Captain dismissal should _physically remove_ the state
  (ADR 0016, mirror-don't-gate) — unbuilt for Phase 1.

### B5 · Re-consent / rotate a credential

- **Change:** re-run `gmail-oauth-consent.py` (backs up the old token, refuses to
  overwrite with a narrower grant) or restage the Fly secret + redeploy.
- **Verify:** the script's live read-probes per scope. ✅ for the user-OAuth path.

---

## Part C — Product-improvement register

Each is a place the process is harder/more fragile than it should be. Candidates
for issues; none filed by this doc.

- **C-1 · The assessment→yaml seam has no safety net.** The agent authors a
  plausible config from any transcript; a wrong-but-valid config passes validation
  and ships (the fixture-as-Scott incident). _Fix candidate:_ an authoring
  read-back/confirm step that echoes identity + entitlements to the principal for
  sign-off before provisioning.
- **C-2 · Onboarding-plan and committed config disagree on Google auth.**
  `onboarding-plan.md` (2026-05-31) says `mcp:google-gmail` + user OAuth consent on
  `smdurgan@smdurgan.com`; the committed `customer.yaml` uses `build:google-gmail`
  - `google_auth.mode: dwd` impersonating `crane@smd.services` via the ADR 0045
    broker. The plan predates the broker/DWD decision and was never reconciled.
    _Fix candidate:_ regenerate the plan from the final config, or mark it as an
    as-of snapshot. Decide which Google path is the **default** for new customers.
- **C-3 · Voice gate has no live mode.** `run-voice-gate.sh --mode live` exits 3;
  needs the per-customer Hermes D1 binding (#800) + ingestion store + panel form.
  Until then voice quality can't be gated on real customer data.
- **C-4 · `rollback-skill.sh` is on a stale schema.** Reads top-level `skills[]`;
  live schema is `personas[].skills[]` (same bug class as the retired Python
  validator). It cannot roll back a skill on any real config. _Fix:_ walk personas.
- **C-5 · No live config propagation.** Every entitlement/scope/persona/connector
  change needs a manual Machine restart because the customer-sync sidecar is a
  Phase-2 stub. _Fix candidate:_ finish the sidecar so non-structural edits apply
  without a restart.
- **C-6 · No memory-management tooling.** "Remove a memory" — a routine support
  request you named — has no script in Phase 1; it's a hand-edit of volume files.
- **C-7 · `fleet_status` seed depends on a missing projection.** Step 6d needs
  `customer_configs` (#1308); today it warns+skips, so the admin fleet view has no
  "no-signal-yet" row until the first heartbeat.
- **C-8 · No authored web capability, but the agent self-provisions one.** No web
  search/fetch/browser tool is wired (not a connector, not native). The live agent
  installed Chrome itself via `execute_code`/`terminal`. _Two implications:_ (a) a
  governance gap — raw shell is broad and ungoverned at the action-class grain;
  (b) a product decision — if web access is wanted, author it as an entitled
  capability (MCP-first per ADR 0020) rather than leaving it to self-install.
- **C-9 · The retired cage frame survives in customer-facing marketing copy.**
  `src/pages/operator.astro` ¶"You Set The Limits" line 215: _"its drafts go to a
  reviewer on your team, who sends them"_ — the natural-language form of the retired
  external-send-identity brand, which the string CI-guard cannot catch (it scans
  for the banned token, not the prose that means the same thing). It contradicts
  the same section's ¶1 (correct ADR-0035 "you author it, nothing assumed") and
  customer-zero's own config (`external_send: autonomous` from day one — no reviewer
  sends Crane's mail). The live agent **read its own marketing page** (it has web
  access) and recited it back as self-description. _Fix:_ rewrite ¶2 to frame
  "start by watching / reviewer sends" as one **authored on-ramp**, not the default;
  reckon with agent-ingests-own-marketing as a self-knowledge loop.
- **C-10 · Authored cron is validated but never materialized.** `persona.cron` in
  `customer.yaml` (ADR 0021 Stream B; validator has a dedicated suite) is read by
  nothing in `translate.py::_persona_config`. SMD's `inbox-triage` @ `0 7-19 * * *`
  has never fired on schedule — confirmed by the live agent. _Fix:_ materialize
  `persona.cron` into the Hermes-native scheduler config; add a materialization
  test, not just a validation test. **This is the worst gap class — every static
  signal says "configured"; only the running Machine reveals it isn't.**

---

## Part D — What we don't know yet (honest blanks)

Zero real cycles have measured these; they are the forecasts the cost baseline
rests on, and the first external customer is where they get trued up.

- **Real stand-up wall-clock** end to end on an external client (the agent-runnable
  provision is minutes; the bookends — interview, clarification rounds, OAuth
  coordination, sample chasing, shadow-grading — are unmeasured).
- **Support volume/month** on a _running_ Operator: how many B-class requests, of
  which type, at what human cost. Customer-zero has generated essentially none yet.
- **First-provision failure rate** for a client whose stack isn't ours (connectors
  we haven't wired, an auth path that isn't DWD-on-our-domain).
- **How much of A0 authoring survives** without rework when the transcript is a
  real client's, not our own.

> **Instrument the first external stand-up** before running it — capture wall-clock
> per A-step, who touched it, and where it stalled. A cycle you didn't watch can't
> be measured after the fact.
