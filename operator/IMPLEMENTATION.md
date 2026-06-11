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
should be becomes a candidate issue.

**How it's organized.** Two complementary cuts of the same ground:

- **§ The fifteen surfaces** — the primary spine. The path from assessment meeting
  to a well-appointed Operator runs through fifteen configuration surfaces. Each is
  traced through four beats and the findings hang off the surface.
- **Part A / B** — the temporal process wrapper (stand-up sequence, support
  catalog). Detail now lives in the surface traces; these keep the time-ordered view.
- **Part D** — what we still don't know.

---

## Legend

**Actor** — who does the step:
👤 SMD-human · 🤝 customer · 🤖 agent · ⚙️ automated script (no human in the step)

**Status** — how real it is:
✅ working · ◑ semi (works, known hole) · ✋ manual · ⛔ blocked / broken / dropped

**The four beats** (every surface is traced through these):

- **Elicit** — what the assessment/interview must surface to author it.
- **Author** — where it lands in `customer.yaml` and what _validates_ it.
- **Materialize** — what makes it _live_ on the Machine (overlay `translate.py`,
  `bootstrap.sh`, broker, plugins).
- **Verify** — how we confirm it's actually running, not just validated.

**Job tag** on each finding: **[overlay-job]** = our code fixes it ·
**[Hermes-job]** = the substrate's responsibility · **[process]** = a runbook/people gap.

---

## The fifteen surfaces — assessment → well-appointed Operator

Traced against customer-zero (`operator/customers/smd/`), the ss-console validator
(`src/lib/operator/customer-yaml/`), the overlay (`bootstrap/`, `plugins/`,
`workspace_broker/`, `shared/`), and the live interview. Every status and claim is
grounded in the file:line that implements it. The three load-bearing surprises
(F-08-1/2, F-05-2) were re-verified against source by hand, not relayed.

### Two patterns the full sweep revealed

**Pattern 1 — a wide "authored-but-inert" layer.** The same gap class recurs across
surfaces: a field passes validation and _looks_ configured, but is dropped at
materialize, read by nothing at runtime, or enforced only by prose the model may
ignore. Map: `users[]`/principal (01/14), `persona.cron` (15), `skills_disabled[]`
(04), per-skill `trust_ceiling` (08), `trusted_sender_domains` (09), folder/keyword/
domain blocks (09), `escalation.*` (12), `connectors{}` for `build:` (06), `memory{}`
ids (13), `voice_library` (11), `model` (03). **The genuinely enforced spine is
narrow and real:** banned-tools, customer-wide `scope.action_ceilings` (volume-read +
ADR-0035 fail-closed), the sender-agnostic taint-gate, the content-sensitivity floor,
the broker structurally lacking a send op, and `CODE_EXECUTION` fail-closed. The rest
of the table is theater.

**Pattern 2 — verify is broken almost everywhere.** The runtime-read seam
(`runtime_read.py:45`) exposes only `{audit_log, activity, draft, matter}`; only
`audit_log` is real — **and it is currently empty** because of the #1285 binding bug
(`SMD_D1_AUDIT_BINDING` path-vs-varname). So today _nothing_ about a running Operator
is externally observable. Every surface's verify beat is ⛔ or ◑.

---

### Who it is

#### Surface 01 · Identity / principal

**What it is.** Who the operator _is_ (company, the persona's employer) and who it
_serves_ (the principal). The first surface; everything hangs off it.

| Beat        | Status              | What actually happens                                                                                                                                                                                                                                            | Grounded in                                                                        |
| ----------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Elicit      | ✋                  | Interview captures it richly — principal, legal entity, the three-mailbox relationship, the boss. **No guardrail:** v1 seeded from a test fixture treated as Scott → `venturecrane.com` rode along, surfaced late; fix was a manual redo.                        | `onboarding-interview-2026-05-31.md:9,79-81`                                       |
| Author      | ✅ shape / ⚠️ truth | Validator fail-closed on shape: `customer_id` slug, `customer_name` required, `users[]` ≥1 (email/role/full_name required, role enum, voice_profile_id unique). **Checks form, not truth** — `scott@venturecrane.com` passes.                                    | `sections-identity.ts:249`, `validator.ts:236`                                     |
| Materialize | ⛔ leaks            | SOUL.md = "You are Crane, Chief of Staff at SMDurgan, LLC" + vertical + tone. **`users[]` is read by nothing in `translate.py`** — the principal reaches neither SOUL nor config; `USER.md` is inert. The agent has no materialized statement of whom it serves. | `translate.py:535` (dict omits `users`), `:587` (`_soul_body` never reads `users`) |
| Verify      | ⛔ no path          | No `soul`/`config`/`identity` read kind; can't confirm loaded identity on a running Machine. Only: ask the agent (confabulated from marketing) or root-SSH (banned).                                                                                             | `runtime_read.py:45`                                                               |

**Findings:**

- **F-ID-1** · Principal validated but never materialized — same gap class as cron, in the foundational surface; _pass `users[]` into `_soul_body`, emit "You serve {full_name} ({email}, role)"._ — [overlay-job]
- **F-ID-2** · Author validates shape, not truth (= old C-1) — _authoring read-back/confirm step echoing identity to the principal before provision._ — [overlay-job]
- **F-ID-3** · No verify seam for identity — _add a `soul`/`profile` read kind so console can diff materialized-vs-authored._ — [overlay-job]

#### Surface 02 · Persona

**What it is.** The named agent identity (slug, name, title, status, tone) the customer talks to.

| Beat        | Status | What actually happens                                                                                                                    | Grounded in                                                 |
| ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Elicit      | ✅     | Name/role/tone captured verbatim ("call it Crane … Chief of Staff, not a secretary"; "plainspoken, direct, executive-summary, concise"). | `onboarding-interview-2026-05-31.md:60-63`                  |
| Author      | ✅     | `personas[0]`: slug `crane`, status `active`, title `Chief of Staff`, 4-item tone. Slug/status/name/tone validated.                      | `customer.yaml:62-71`; `sections-personas.ts:86-89,152-225` |
| Materialize | ✅     | `persona{name,title,status,tone}` → `config.yaml`; SOUL.md carries name/title/tone.                                                      | `translate.py:542-547,603-610`                              |
| Verify      | ⛔     | No persona/soul read kind.                                                                                                               | `runtime_read.py:45`                                        |

**Findings:** F-02-1 · No runtime verify for persona/SOUL — _add a `soul`/`config` read kind_ (merges with F-ID-3). — [overlay-job]

#### Surface 03 · Model

**What it is.** The single LLM the agent runs on (`claude-opus-4-8`); per-task tiering deferred.

| Beat        | Status          | What actually happens                                                                                                                              | Grounded in                                |
| ----------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Elicit      | ◑               | Interview asked for and got a **tiered** answer (routine sonnet / sensitive opus); schema can't express tiering, only the sensitive tier survives. | `onboarding-interview-2026-05-31.md:76-78` |
| Author      | ◑               | Single string, **validated only as required string** — no enum / model-id allowlist.                                                               | `customer.yaml:26-29`; `validator.ts:242`  |
| Materialize | ✅ pass-through | `customer.get("model")` copied into `config.yaml`.                                                                                                 | `translate.py:541`                         |
| Verify      | ⛔              | No model read kind; **nothing in the overlay reads `config["model"]`** — Hermes-consumption unverified.                                            | `runtime_read.py:45`                       |

**Findings:**

- **F-03-1** · Model is an unvalidated free string — a typo'd/retired id ships; _validate against an allowlist enum._ — [overlay-job]
- **F-03-2** · Tiering intent silently flattened — _model the tier in schema or track as an explicit open-item, not a yaml comment._ — [overlay-job]/[Hermes-job]
- **F-03-3** · No overlay consumer; if Hermes ignores `config.yaml model:` the authored value is inert (unverified). — [Hermes-job]

---

### What it can do

#### Surface 04 · Skills

**What it is.** Per-persona skill catalog (name, version, trust_ceiling, enabled) + `skills_disabled[]`.

| Beat        | Status | What actually happens                                                                                                                                                                                | Grounded in                                           |
| ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Elicit      | ✅     | "v1 skill: `inbox-triage` only … more to come"; trust = draft-for-review.                                                                                                                            | `onboarding-interview-2026-05-31.md:48,58-60`         |
| Author      | ✅     | Two skills (`inbox-triage`, `workspace`), both `pending`/`draft_for_review`/`enabled`; `skills_disabled:[google-workspace, himalaya]`. Name/ceiling/version/enabled validated.                       | `customer.yaml:73-86`; `sections-personas.ts:249-262` |
| Materialize | ◑      | `skills[]` emitted with pin resolved (`pending` → on-disk content hash); bodies copied into the profile `skills/` dir; catalog image-baked + volume-seeded. **`skills_disabled[]` read by nothing.** | `translate.py:521-533,668-718`                        |
| Verify      | ⛔     | No skills read kind; catalog presence checked at translate time, not runtime.                                                                                                                        | `runtime_read.py:45`; `translate.py:709-713`          |

**Findings:**

- **F-04-1** · `skills_disabled[]` is dead config — zero validator/materializer refs; disabling relies only on absence from the enabled list, so the list gives a false sense of explicit deny. _Validate + materialize into a Hermes deny, or drop it._ — [overlay-job]
- **F-04-2** · Both skills `version: pending` — pin resolves to live hash at translate time, so a body edit silently re-pins on next reprovision (no real pinning). _Set real pins once hashed._ — [overlay-job]

#### Surface 05 · Tools

**What it is.** General agent capability — run code, shell, browse/fetch web, subagents — distinct from connectors (systems of record) and skills (authored bundles).

| Beat        | Status | What actually happens                                                                                                                                                                                                                          | Grounded in                                                |
| ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Elicit      | ✋     | Interview never elicits a tool list (no Tools section).                                                                                                                                                                                        | `onboarding-interview-2026-05-31.md` (absent)              |
| Author      | ⛔     | **No `tools:` block exists** anywhere — validator/types have only `tool_calls_per_run` (a rate cap). SMD authors no `code_execution` ceiling.                                                                                                  | `types.ts:273`; `customer.yaml` (no `tools:`)              |
| Materialize | ◑      | Tools are Hermes-native, enabled by the runtime not the overlay. `execute_code`/`terminal`/`process`/`delegate_task` → `CODE_EXECUTION` (fail-closed unless authored); `web_search`/`web_extract` → **unmapped → default READ**, taint-fenced. | `action_classes.py:255-262`; `inbound/__init__.py:135,152` |
| Verify      | ⛔     | None.                                                                                                                                                                                                                                          | (absence)                                                  |

**Findings:**

- **F-05-1** · No tools authoring surface — an engagement can't declare which capabilities (web, code, browser) a customer's agent may use; posture is implicit. _Add a `tools:` schema section + validator, materialized by translate.py._ — [overlay-job] (+ schema)
- **F-05-2** · C-8 (Chrome self-install) is **CLOSED** for SMD via #1323 (`CODE_EXECUTION` fail-closed, no `code_execution` authored), but the **`unmapped→READ` default for unknown tools persists** (`action_classes.py:251-254`). _Complete the core-allowlist soak to flip the default closed._ — [overlay-job]
- **F-05-3** · `web_search`/`web_extract` are wired, ungoverned (READ), unauthored. The product need stands: a **researched default tool list** answering per-tool {native | MCP | build} and {governing action-class}. _Author the matrix + bind each tool to an action-class + a `tools:` switch._ — [overlay-job] (+ doc)

#### Surface 06 · Connectors

**What it is.** `connectors{}` binding a capability to an adapter + backend prefix. SMD: three `build:google-*`.

| Beat        | Status               | What actually happens                                                                                                                                                                                                                                                                                | Grounded in                                                   |
| ----------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Elicit      | ✅                   | Read/draft/archive Gmail, read/write Calendar + Drive.                                                                                                                                                                                                                                               | `onboarding-interview-2026-05-31.md:28-36`                    |
| Author      | ✅                   | Capability/adapter/backend-prefix/token_ref/scopes validated; three enabled `build:google-*`.                                                                                                                                                                                                        | `sections-connectors.ts:66-118`; `customer.yaml:108-122`      |
| Materialize | ◑ inert for `build:` | `connectors{}` copied into config as **metadata only**; `_materialize_mcp_servers` `continue`s on non-`mcp:` → zero wiring for SMD. Google tools come from the statically-registered `hermes-smd-workspace` plugin (13 tools via the broker socket); authority is `google_auth`, not `connectors{}`. | `translate.py:550,304-306`; broker via `bootstrap.sh:186-220` |
| Verify      | ⛔                   | No connector/health read kind; only the boot-time broker health check, invisible to console.                                                                                                                                                                                                         | `runtime_read.py:45`                                          |

**Findings:**

- **F-06-1** · `connectors{}` inert for `build:` — disabling `connectors.Calendar` would NOT remove the calendar tools; the block is descriptive, not load-bearing. _Gate `hermes-smd-workspace` registration on the authored map, or document that `build:` authority = `google_auth` + plugin presence._ — [overlay-job]
- **F-06-2** · No verify beat for connector liveness — _surface broker health via a runtime kind._ — [overlay-job]

---

### What it's allowed to do

#### Surface 07 · Credential / authz

**What it is.** The Google credential the operator acts through — a customer-owned service-account with DWD impersonating `crane@smd.services` at five scopes, held by the broker (ADR 0045).

| Beat        | Status | What actually happens                                                                                                                                                        | Grounded in                                          |
| ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Elicit      | ✅     | Three-mailbox architecture + least-privilege "gmail.modify, NO send".                                                                                                        | `onboarding-interview-2026-05-31.md` (mailbox table) |
| Author      | ✅     | `mode: dwd` requires `subject` (must contain `@`) + non-empty `scopes`; partial block is a hard error.                                                                       | `sections-google-auth.ts:56-83`                      |
| Materialize | ✅     | Broker decodes `GOOGLE_SERVICE_ACCOUNT_JSON` (Fly secret) to 0600, `from_service_account_info(…, subject=…)`.                                                                | `google_auth.py:52-54`; `provision-customer.sh:431`  |
| Verify      | ◑      | Live DWD/OAuth read-probes EXIST but are **manual, pre-provision** tracer bullets; runtime broker `health` checks only file-presence, not that the credential authenticates. | `gmail-sa-smoke.py`; `server.py:101-106`             |

**Findings:**

- **F-07-1** · Stale env-contract — `sections-google-auth.ts:10-11` claims bootstrap exports `GOOGLE_IMPERSONATE_SUBJECT`/`GOOGLE_OAUTH_SCOPES`, but the live broker reads `customer.yaml` directly and uses neither. _Delete the misleading comment or wire it._ — [overlay-job]
- **F-07-2** · No live credential health on the Machine — a revoked key surfaces only on first real call. _Add a startup `getProfile(me)` probe, fail-closed._ — [overlay-job]

#### Surface 08 · Entitlements

**What it is.** Two authored caps: per-skill `trust_ceiling` and `scope.action_ceilings`. SMD: both skills `draft_for_review`, `external_send: autonomous`.

| Beat        | Status | What actually happens                                                                                                                                                                                                                                                | Grounded in                                                                   |
| ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Elicit      | ✅     | Per-task trust table; "harness is the product, capability configured not hardcoded".                                                                                                                                                                                 | `onboarding-interview-2026-05-31.md` (capability levels)                      |
| Author      | ◑      | Per-skill `trust_ceiling` enum-validated; **`action_ceilings` validated only under `personas[].skills[]`** but SMD authors it under top-level `scope.action_ceilings`, which `checkScope` doesn't read — survives by validator leniency (unknown keys not rejected). | `sections-personas.ts:295-326`; `sections-other.ts:42-64`; `types.ts:482-486` |
| Materialize | ◑      | Whole raw `scope` (incl. `action_ceilings`) → `config.yaml`; per-skill ceiling → `skills[]`.                                                                                                                                                                         | `translate.py:530-535,553`                                                    |
| Verify      | ⛔     | Audit is the intended evidence, but the `audit_log` writer (#1285) never writes → the one real verify kind is empty.                                                                                                                                                 | `broker_audit.py:26,41`; `runtime_read.py:45`                                 |

**Enforcement (verified by hand):**

- `scope.action_ceilings.external_send: autonomous` **IS enforced** — `_resolve_action_ceilings` reads `CustomerConfig.from_volume().scope`, gates at `pre_tool_call`. ✅
- Per-skill `trust_ceiling` is **decorative** — `enforce.py:535` reads `args["_skill_trust_ceiling"]`; **nothing in production stamps it** (written only in `tests/`), so it falls back to `AUTONOMOUS`. ⛔

**Findings:**

- **F-08-1** · `action_ceilings` authored under `scope.*` but validated under the skill path; works only by leniency. _Add `action_ceilings`+`trusted_sender_domains` to `checkScope`/`Scope`, or move the runtime read to the skill path — pick one home._ — [overlay-job]
- **F-08-2** · Per-skill `trust_ceiling` unenforced — the args channel it reads is never populated; both SMD skills' `draft_for_review` is invisible at runtime; only the customer-wide cap (absent here) or the content floor narrows an autonomous send. _Stamp `_skill_trust_ceiling`/`_skill_name` at dispatch, or resolve from `config.yaml skills[]`._ — [overlay-job] (needs a Hermes stamp seam) / [Hermes-job]
- **F-08-3** · ADR-0035 fail-closed-when-unauthored **is real** for `external_send` (`enforce.py:158-165,842-863`). ✅ (not a gap — recorded as a working control)

#### Surface 09 · Guardrails / boundaries

**What it is.** Content/visibility boundaries. SMD: all empty except `trusted_sender_domains: [smdurgan.com, smd.services]`.

| Beat        | Status | What actually happens                                                                                                                  | Grounded in                                                        |
| ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Elicit      | ✅     | "Obey direction only from smdurgan.com / smd.services; outside → never acted on autonomously."                                         | `onboarding-interview-2026-05-31.md` (trusted-sender / hard-never) |
| Author      | ◑      | Folder/keyword/domain blocks validated as string lists; `trusted_sender_domains` passes through **unvalidated** (not in `Scope` type). | `sections-other.ts:42-64`; `types.ts:482-486`                      |
| Materialize | ✅     | Whole raw `scope` → `config.yaml`.                                                                                                     | `translate.py:553`                                                 |
| Verify      | ⛔     | Would rely on the empty audit log.                                                                                                     | `runtime_read.py:45`                                               |

**Enforcement:**

- Block lists are **inert for SMD** (empty) and **read by no overlay code** even if populated. ⛔
- `trusted_sender_domains` is **read nowhere in code** — the gate exists only as prose in `inbox-triage/SKILL.md:33`. ✋
- The real structural wall is the **taint-gate** (sender-agnostic): every Gmail read is marked `UNKNOWN_EXTERNAL`, and a tainted turn refuses autonomous `EXTERNAL_SEND`/`DESTRUCTIVE`/`CODE_EXECUTION`. ✅

**Findings:**

- **F-09-1** · `trusted_sender_domains` enforced by prompt, not code; and the always-taint behavior means the prose gate and the code gate disagree about what's possible. _Map sender domain → trust_class at the inbound chokepoint by consulting `scope.trusted_sender_domains`._ — [overlay-job]
- **F-09-2** · Folder/keyword/domain blocks are dead config — a future customer authoring `email_folders_blind` gets no protection. _Wire a scope filter into the broker's gmail ops, or document as non-enforced._ — [overlay-job]
- **F-09-3** · Broker validates identity, not intent (confused-deputy) — `server.py:107-152` checks `peer_pid == gateway_pid` + payload digest, zero trust/scope eval; all boundary logic is one upstream hook. _Defense-in-depth scope check inside the broker._ — [overlay-job]
- **F-09-4** · "Never send as Scott" is **structurally enforced** by absence (broker exposes no send op; `gmail.send` scope omitted; plugin `from`/`mailbox` args not honored, `userId="me"` hardcoded). ✅

---

### How it shows up

#### Surface 10 · Channels & authorized humans

**What it is.** How a human reaches Crane and who's allowed — Telegram polling with a numeric-id allowlist, plus the AgentMail/managed-mailbox path.

| Beat        | Status                 | What actually happens                                                                                                                                                                    | Grounded in                                                    |
| ----------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Elicit      | ⛔ Telegram / ✅ email | Interview names the email channels but **says nothing about Telegram** — it was an authoring-time decision.                                                                              | `onboarding-interview-2026-05-31.md:50-52` (no telegram)       |
| Author      | ✅                     | `enabled`/`require_mention`/`reactions` bool-validated; when enabled, `allow_from` must be a non-empty list of numeric ids (fail-closed at author time).                                 | `sections-telegram.ts:48-69`                                   |
| Materialize | ✅                     | `_materialize_telegram_platform` raises if enabled with empty allowlist (ADR 0033), else emits `{allow_from, require_mention, reactions}`. Token is the Fly secret `TELEGRAM_BOT_TOKEN`. | `translate.py:500-505,581-583`                                 |
| Verify      | ◑                      | No channel read kind; boot belt `ensure-telegram-allowlist.py` re-checks fail-closed (a launch gate, not console-visible).                                                               | `bootstrap.sh:424-426`; `ensure-telegram-allowlist.py:107-116` |

**Fail-closed chain (3 layers, all confirmed):** author rejects empty → materialize raises → boot refuses launch. All exist because the pinned Hermes ref fails **open** if the allowlist is unset.

**Findings:**

- **F-10-1** · Telegram channel never elicited — the primary live channel was authored without an elicit beat. _Backfill the decision into the interview record._ — [process]
- **F-10-2** · No console-visible verify for the live channel — _add a channel/identity runtime kind._ — [overlay-job]
- **F-10-3** · `require_mention:false` → Crane acts on every DM from the allowlisted id (correct by design; flagged for the "why it behaves this way" column). — [Hermes-job]

#### Surface 11 · Voice

**What it is.** Per-user writing-voice matching: structural-diff samples shape draft tone at runtime.

| Beat        | Status  | What actually happens                                                                                                                                                                                                                          | Grounded in                                                                  |
| ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Elicit      | ✅      | Two voices: Scott's for Gmail draft replies (interim seed from conversation prose), Crane's own for its reports.                                                                                                                               | `onboarding-interview-2026-05-31.md` §Voice                                  |
| Author      | ✅      | `voice_profile_id: scott` on the principal (slug, unique); `voice_library.samples_path` validated.                                                                                                                                             | `sections-identity.ts:49-55`; `sections-other.ts:347-370`                    |
| Materialize | ◑ inert | Block copied verbatim; runtime `hermes-smd-voice` plugin builds an R2 reader, injects a context block from `{slug}/voice/cohort/`. **SMD supplied no samples** → empty prefix → no contribution → drafts fall back to the general model voice. | `translate.py:552`; voice `__init__.py:89-106,156-182`; `samples.py:210-211` |
| Verify      | ⛔      | `run-voice-gate.sh` synthetic works; **live mode exits 3** (needs per-customer Hermes D1 #800).                                                                                                                                                | `voice-gate/cli.ts:173-182`                                                  |

**Findings:**

- **F-11-1** · No samples → voice authored-but-inert; the interim "seed from prose" was never operationalized. _Run `voice-ingest-corpus.py` against a curated Scott corpus._ — [overlay-job]
- **F-11-2** · Live voice gate unimplemented (#800) — fidelity against real drafts can't be verified. — [overlay-job]
- **F-11-3** · No `voice` runtime read kind. — [overlay-job]

#### Surface 12 · Escalation routing

**What it is.** Where red-flags and run failures go — both `team@smd.services` for SMD.

| Beat        | Status | What actually happens                                                       | Grounded in                                              |
| ----------- | ------ | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| Elicit      | ✅     | "Red flags + run failures → the boss/escalation address, immediate."        | `onboarding-interview-2026-05-31.md` (skills & triggers) |
| Author      | ✅     | Both recipient lists validated non-empty; optional ack window positive int. | `sections-other.ts:102-127`                              |
| Materialize | ✅     | `escalation` dict copied verbatim into `config.yaml`.                       | `translate.py:551`                                       |
| Verify      | ⛔     | Not surfaced by `runtime_read`.                                             | `runtime_read.py:45`                                     |

**Enforcement:** `escalation.*` is **read by no overlay code** (grep 0 hits) — context the prose may consult, not a routed mechanism. Red-flag sends happen (if at all) via the `inbox-triage` skill body emailing `team@` from AgentMail, governed by `external_send: autonomous`. ✋

**Findings:**

- **F-12-1** · Escalation is unenforced config + prose routing; **run-failure escalation is the weak case** — a crashed run can't narrate its own failure (a handler can't sentinel its own non-execution). _An off-Machine watchdog (the provisioned healthchecks.io grace webhook) should own failure escalation, reading `escalation.failure_recipients`; today the wiring stops at the ping URL._ — [overlay-job]
- **F-12-2** · `acknowledgement_window_minutes` validated but unused (latent inert field). — note only

---

### What it knows / when it acts

#### Surface 13 · Memory

**What it is.** Per-customer memory isolation ids (`d1_namespace`, `r2_vault_path`, `vectorize_index`).

| Beat        | Status  | What actually happens                                                                                                                                         | Grounded in                                                   |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Elicit      | ⛔      | Interview never elicited a memory/recall requirement; the block was authored from architecture, not a stated need.                                            | `onboarding-interview-2026-05-31.md:82` (sole Honcho mention) |
| Author      | ✅      | Each field required + must match `customer_id` isolation invariant; retention optional.                                                                       | `customer.yaml:167-170`; `sections-other.ts` checkMemory      |
| Materialize | ◑ inert | Ids copied into `config.yaml`, but **no memory-provider block** — Phase 1 is Hermes' flat-file core; Honcho (inferred memory) deferred to Phase 2 (ADR 0016). | `translate.py:553-557,808-812`                                |
| Verify      | ⛔      | Nothing live to verify (no store wired).                                                                                                                      | `runtime_read.py:45`                                          |

**Findings:**

- **F-13-1** · Memory ids are inert in Phase 1 — they reserve namespaces; they do not make memory active. The only live memory is Hermes' flat-file core. _No fix — deliberate Phase-1 posture; flagged so the surface isn't read as "memory works."_ — [overlay-job] (Phase 2)

#### Surface 14 · Knowledge / context (SOUL)

**What it is.** The materialized `SOUL.md` — the actual business/role context the agent is given. Not a yaml block.

| Beat        | Status | What actually happens                                                                                                                                                  | Grounded in                                        |
| ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Elicit      | ◑      | Interview is rich with who's-who (principal Scott, `team@` boss, intake vs Crane identity, trusted domains) — but none of it is destined for SOUL.                     | `onboarding-interview-2026-05-31.md:4,16-20,42-43` |
| Author      | ◑      | The pieces exist in yaml (`users[]`, `customer_name`, `escalation`) but SOUL only consumes `persona.{name,title,tone}` + `customer.{customer_name,vertical}`.          | `translate.py:595-601`                             |
| Materialize | ⛔     | `_soul_body` produces ONLY name/title/company + `## Vertical` (`mixed`) + `## Tone`. No principal, no who's-who, no engagement context. No other enrichment mechanism. | `translate.py:603-610`                             |
| Verify      | ⛔     | No SOUL read kind.                                                                                                                                                     | `runtime_read.py:45`                               |

**Findings:**

- **F-14-1** · SOUL has no principal / no authority context — the agent boots knowing only its name/title/tone + a one-word vertical; the interview captured all the context, the materializer drops it. _Enrich `_soul_body` from `users[]`/`escalation` (authored fields only, never fabricated)._ — [overlay-job]
- **F-14-2** · `vertical: mixed` makes the one context line near-useless (enum has no consulting value, #1141). _Resolve the vertical enum gap._ — [overlay-job]
- **F-14-3** · `users[]` authored+validated but never materialized — the concrete reason F-14-1/F-ID-1 exist. — [overlay-job]

#### Surface 15 · Scheduled jobs

**What it is.** `personas[].cron[]` — per-persona recurring skill runs. SMD: `inbox-triage` @ `0 7-19 * * *`. **In flux** — the per-persona-cron mechanism was explicitly set aside.

| Beat        | Status | What actually happens                                                                                                                                                                                                                                                               | Grounded in                                         |
| ----------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Elicit      | ✅     | "Hourly 0700–1900 Phoenix" for inbox-triage.                                                                                                                                                                                                                                        | `onboarding-interview-2026-05-31.md:48-49`          |
| Author      | ✅     | `checkCron` validates skill-ref/schedule/wake_policy/pre_run. SMD's entry passes.                                                                                                                                                                                                   | `sections-bundles-cron.ts:188-225`                  |
| Materialize | ⛔     | `_persona_config` never references `persona["cron"]`; there is no `_materialize_cron`; bootstrap creates no Hermes cron job. The gateway listens for cron triggers (`bootstrap.sh:477`) but nothing populates them. **Dead config — triage has never run on the authored cadence.** | `translate.py:536-557`; bootstrap.sh (no cron step) |
| Verify      | ⛔     | Nothing materialized to verify; confirmed inert by the live agent.                                                                                                                                                                                                                  | `runtime_read.py:45`                                |

**Findings:**

- **F-15-1** · `personas[].cron` validated but never materialized (= old C-10) — _owned by the superseding work; until it lands, mark the schedule not-in-effect. Do NOT build to the current `persona.cron` schema._ — [overlay-job]

---

### Findings index

Worst-beat status per surface, and where the fix lives. **E/A/M/V** = elicit/author/materialize/verify.

| #   | Surface        | E   | A   | M   | V   | Headline finding                                             | Job             |
| --- | -------------- | --- | --- | --- | --- | ------------------------------------------------------------ | --------------- |
| 01  | Identity       | ✋  | ◑   | ⛔  | ⛔  | principal never materialized; author checks shape not truth  | overlay         |
| 02  | Persona        | ✅  | ✅  | ✅  | ⛔  | no verify kind                                               | overlay         |
| 03  | Model          | ◑   | ◑   | ✅  | ⛔  | unvalidated string; no overlay consumer                      | overlay/Hermes  |
| 04  | Skills         | ✅  | ✅  | ◑   | ⛔  | `skills_disabled[]` dead; pins are `pending`                 | overlay         |
| 05  | Tools          | ✋  | ⛔  | ◑   | ⛔  | no authoring surface; unmapped→READ default                  | overlay+doc     |
| 06  | Connectors     | ✅  | ✅  | ◑   | ⛔  | `build:` connectors inert; authority is `google_auth`        | overlay         |
| 07  | Credential     | ✅  | ✅  | ✅  | ◑   | no live credential health                                    | overlay         |
| 08  | Entitlements   | ✅  | ◑   | ◑   | ⛔  | per-skill ceiling decorative; ceiling schema split           | overlay/Hermes  |
| 09  | Guardrails     | ✅  | ◑   | ✅  | ⛔  | trusted-sender prose-only; block lists dead; confused-deputy | overlay         |
| 10  | Channels       | ⛔  | ✅  | ✅  | ◑   | telegram not elicited; no console verify                     | process+overlay |
| 11  | Voice          | ✅  | ✅  | ◑   | ⛔  | no samples → inert; live gate unbuilt                        | overlay         |
| 12  | Escalation     | ✅  | ✅  | ✅  | ⛔  | unrouted; failure-escalation has no owner                    | overlay         |
| 13  | Memory         | ⛔  | ✅  | ◑   | ⛔  | ids inert in Phase 1 (by design)                             | overlay (P2)    |
| 14  | Knowledge/SOUL | ◑   | ◑   | ⛔  | ⛔  | SOUL has no principal/context                                | overlay         |
| 15  | Scheduled jobs | ✅  | ✅  | ⛔  | ⛔  | cron never materialized (in flux)                            | overlay         |

**Reconciliation with the old Part C register:** the per-surface findings above supersede it. Map: C-1→F-ID-2 · C-3→F-11-2 · C-4 (rollback-skill stale schema) still stands as a B1 support-path bug · C-5 (no live propagation) still stands · C-6 (no memory tooling)→F-13-1 · C-7 RESOLVED (#1308) · C-8→F-05-2 (now closed for SMD) · C-9 (marketing cage-frame prose) still stands — it's a copy gap, not a surface · C-10→F-15-1.

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

| Step (`provision-customer.sh`)                                                                          | Actor | Status | Note                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------- | ----- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Validate slug charset, then `customer.yaml` via canonical TS validator                                  | ⚙️    | ✅     | Step 1; fail-closed.                                                                                                                      |
| Split `hermes_ref` into tag@sha, assert 40-hex pin (ADR 0024)                                           | ⚙️    | ✅     | Step 1b; no live upstream lookup.                                                                                                         |
| Upload `customer.yaml` to R2 (`vaults/<slug>/customer.yaml`)                                            | ⚙️    | ✅     | Step 2; bootstrap fetches it at boot.                                                                                                     |
| Render `fly.toml` from template                                                                         | ⚙️    | ✅     | Step 3; gitignored `.rendered/`.                                                                                                          |
| Create Fly app + 10GB volume + per-customer skill-bodies R2 bucket                                      | ⚙️    | ✅     | Steps 4–5b; idempotent, fail-closed on volume enumerate.                                                                                  |
| Stage secrets (Anthropic, R2, observability, per-customer runtime-read HMAC key, connector + Google SA) | ⚙️    | ✅     | Steps 6–6b; **vault→env→Fly, no paste — agent-runnable.**                                                                                 |
| Create healthchecks.io check                                                                            | ⚙️    | ◑      | Step 6c; warn+skip if no API key.                                                                                                         |
| Seed `fleet_status` row in central D1                                                                   | ⚙️    | ◑      | Step 6d; **`customer_configs` projection now merged (#1308 / `fcbc647`)** → seed should land, not skip. Re-verify on next real provision. |
| Deploy (builds image: clone Hermes@sha, copy skills, overlay plugins)                                   | ⚙️    | ✅     | Step 7.                                                                                                                                   |
| Boot smoke test (customer.yaml → profiles → plugin chain)                                               | ⚙️    | ✅     | Step 8 (`boot-smoke-test.sh`).                                                                                                            |

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

| Step                                  | Actor | Status | Note                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | ----- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Enable skill(s) at `draft_for_review` | ⚙️    | ✅     | Skill body installs into the profile; runs **on-demand / inbound-webhook**.                                                                                                                                                                                                                                                                                                                                                          |
| Authored cron fires on schedule       | ⚙️    | ⛔     | **Verified inert:** `customer.yaml` authors `inbox-triage` @ `0 7-19 * * *`, the validator accepts it, but `translate.py::_persona_config` never reads `persona.cron` — validated-but-not-materialized; the skill has never run on schedule (confirmed by the live agent: "no cron was ever set"). The materializer fix is **set aside** — superseding work is in play; do not build to the current `persona.cron` schema. See C-10. |
| Captain reviews drafts, grades, tunes | 👤    | ✋     | Human review loop — real recurring cost during onboarding.                                                                                                                                                                                                                                                                                                                                                                           |

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
- **C-7 · ~~`fleet_status` seed depends on a missing projection.~~ RESOLVED.** The
  `customer_configs` projection merged (#1308 / `fcbc647`), so step 6d's `SELECT
entity_id FROM customer_configs` now resolves and the seed lands instead of
  warning+skipping. _Residual check:_ confirm the projection is populated before
  (or as part of) the provision run, not only afterward — otherwise the first
  provision still races the row. Re-verify on the next real stand-up.
- **C-8 · No authored web capability, but the agent self-provisions one.** No web
  search/fetch/browser tool is wired (not a connector, not native). The live agent
  installed Chrome itself via `execute_code`/`terminal`. _Two implications:_ (a) a
  governance gap — raw shell is broad and ungoverned at the action-class grain;
  (b) a product decision — if web access is wanted, author it as an entitled
  capability (MCP-first per ADR 0020) rather than leaving it to self-install.
- **C-9 · The retired cage frame survives in customer-facing marketing copy —
  in TWO spots, not one.** `src/pages/operator.astro` carries the natural-language
  form of the retired external-send-identity brand, which the string CI-guard cannot
  catch (it scans for the banned token, not the prose that means the same thing).
  Confirmed live after the #1315 brand-retirement merge — the merge stripped the
  token, not the prose:
  - **§05 body, lines 213–216:** _"It starts by watching… Until then, its drafts go
    to a reviewer on your team, who sends them. The Operator cannot give itself more
    authority."_
  - **§ card body, line 34:** _"Drafts go to a reviewer on your team until you trust
    the Operator to handle a kind of message on its own."_

  Both contradict §05 ¶1 (correct ADR-0035 "you author it, nothing assumed") and
  customer-zero's own config (`external_send: autonomous` from day one — no reviewer
  sends Crane's mail). The live agent **read its own marketing page** (it has web
  access) and recited it back as self-description. _Fix:_ rewrite both to frame
  "start by watching / reviewer sends" as one **authored on-ramp**, not the default;
  reckon with agent-ingests-own-marketing as a self-knowledge loop. **This may be
  the live task for the `chore/retire-external-send-brand` lineage — the token was
  retired venture-wide but the prose wasn't.**

- **C-10 · Authored cron is validated but never materialized — fix set aside.**
  `persona.cron` in `customer.yaml` (ADR 0021 Stream B; validator has a dedicated
  suite) is read by nothing in `translate.py::_persona_config`. SMD's `inbox-triage`
  @ `0 7-19 * * *` has never fired on schedule — confirmed by the live agent. The
  obvious fix (materialize `persona.cron` into the Hermes-native scheduler + a
  materialization test) was built and then **explicitly discarded**: other work in
  play supersedes the per-persona-cron approach, so building to the current schema
  is wasted. **What still stands, regardless of how cron lands:** the gap _class_ —
  every static signal said "configured" while the running Machine said "never ran."
  That is the lesson C-10 exists to carry; the specific cron remedy is now owned by
  the superseding work, not this register.

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
