# Ashton & Price Operator — Build Plan

> **Superseded for sequencing (2026-07-04).** The build this plan prepared is
> done and merged (#1637: 19 skills authored + gated + staged) and the
> Smokeball app is approved. Active sequencing now lives in
> **`IMPLEMENTATION-PLAN.md`**. This file remains the record of build posture,
> the commitment → build map, and the guardrails (§3), which carry over
> unchanged. The §9 `bin/connect-smokeball.sh` reference is stale — prod
> connect is the client-portal OAuth flow (#1633/#1649).

_Prepare the committed litigation-lifecycle Operator to the fullest extent
possible while Christa's feedback and Smokeball app approval are pending._

Source of truth for what we owe: **`CLIENT-PROPOSAL.md`** (the sent
"Litigation Lifecycle Solution"). Build posture: **`REDUNDANCY-AUDIT.md`**
(CUT / GATE / BUILD). Current seat: **`customer.yaml`**. Read those; this plan
sits on top of them.

---

## 1. Mission

Prepare A&P's Operator across the **full litigation lifecycle the proposal
commits to** — filing → discovery → motions → minor's compromise → trial prep →
mediation/settlement, discovery deepest — so that when the gates lift, go-live is
a **connect-and-validate** step, not a start-building step. This explicitly
includes the four cross-cutting capabilities the proposal promises (the trust
dial, firm-voice drafting, tune-as-it-goes, watch-and-schedule), not just the
discovery skills.

Not in scope this session: wiring anything to A&P's live tenant, finalizing
anything that depends on Christa's markup, or building what a certified incumbent
already owns.

## 2. The two gates and two open decisions (what "to the extent possible" routes around)

| Blocker                                               | Blocks                                                                           | Outside our control?    |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------- |
| **Christa's feedback** (she's out this week)          | Final shape of every lane; her top-slippage priorities; the 7 proposal questions | Yes — wait              |
| **Smokeball 72-hr app approval** (submitted, pending) | Live prod connect + per-matter validation                                        | Yes — wait              |
| **Deadline fork** (rules-engine vs compute)           | Final deadline-lane shape only                                                   | Her answer (proposal Q) |
| **CoCounsel / drafting division** (post-TR meeting)   | Motion/response drafting orchestration only                                      | Her Friday meeting      |

Everything up to the live connection is buildable **offline** against the
already-shipped Smokeball connector (`operator/connectors/smokeball/`, write-cut
live, 33 tests green) plus synthetic fixtures. That is the whole opportunity.

## 3. Guardrails (non-negotiable — from the redundancy audit + doctrine)

- **Never re-perform what an incumbent owns.** Deadline computation belongs to the
  certified rules engine (LawToolBox / Smokeball-InfoTrack). We read its dates and
  chase; we compute **only** if Christa confirms deadlines are figured by hand
  today, and then only calibrated on their matters and always attorney-confirmed
  (the proposal poses this as the open fork — do not resolve it unilaterally).
- **Never draft work product.** BriefPoint / CoCounsel are the drafting engines.
  The Operator stages inputs into the matter folder and routes outputs. It _does_
  draft connective artifacts for internal review (verification requests,
  meet-and-confer letters, separate-statement tables) — internal draft, never
  autonomous external send.
- **Never send to another party or the court; never sign; never move trust money.**
  `external_send: draft_for_review`. Smokeball runs trust accounting and math.
- **Fail-closed + surface-and-ask** where accuracy is unproven; **test-and-tune
  per matter**. Unconfigured entitlement = refused, not drafted.
- **Training-output property** baked into every skill body (what / why / next /
  when-to-bring-the-attorney + the governing rule) — the proposal commits to it.
- **The trust dial is the firm's**, per action-class × connector (see
  `ENTITLEMENTS.md`); ceilings here are recommended defaults, not floors.

## 4. Commitment → build map

Every capability the proposal names, what the Operator must do, whether it exists
today, and whether we can build it now. "Exists" = a skill body in
`operator/skills/` and/or wired on the `operator` persona in `customer.yaml`.

| Proposal commitment                                   | Operator must                                                                                        | State today                                                                 | Verdict / lane                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Cross-cutting: the trust dial**                     | Per-task refused/draft/autonomous, firm-set, adjustable                                              | Substrate exists (entitlements; `ENTITLEMENTS.md`)                          | **Config** — author A&P defaults, confirm at onboarding                          |
| **Cross-cutting: firm voice**                         | Draft in A&P's voice from their letters/templates                                                    | Voice layer exists (native + overlay); `voice_library` path set, **empty**  | **Buildable now** (ingest once samples arrive) + **gap** (no samples yet)        |
| **Cross-cutting: tune-as-it-goes**                    | Learn firm patterns; carry corrections forward                                                       | Memory/learning loop native (Honcho mirror)                                 | **Config/verify** — confirm wired for A&P                                        |
| **Cross-cutting: watch-where-work-lives + schedules** | Own/monitored inbox, forwarded, folder; N cron jobs                                                  | Native (AgentMail inbox + webhook + Hermes cron); one webhook trigger wired | **Buildable now** — add triggers/crons per skill                                 |
| **Discovery: get discovery to the Operator**          | Inbound mail/email capture before Smokeball; classify; match to matter                               | **Gap** — needs M365/Graph (Track E) for the email path                     | **Gated** (Track E) + partial now (forwarded/Smokeball path)                     |
| **Discovery: read served doc + deadline to calendar** | Classify type; read service date+method off POS; surface deadline for confirm                        | **Gap** — no skill                                                          | **Buildable now** (capture spec + skill); compute fork gated on her answer       |
| **Discovery: client verification** (her #1 slip)      | Draft request → e-sign → track → chase until signed                                                  | **Gap** — no skill                                                          | **Buildable now** — first skill to build                                         |
| **Discovery: separate statement** (her #3 time sink)  | Assemble CRC 3.1345 item-by-item table for attorney                                                  | **Gap** — no skill                                                          | **Buildable now** (mechanical assembly)                                          |
| **Discovery: propounded-discovery tracking**          | Watch our-served deadlines; flag M&C + compel window; bring decision to attorney                     | **Gap** — no skill                                                          | **Buildable now**                                                                |
| **Medical records + chronology**                      | Watch YoCierge→Smokeball; running chronology; chase outstanding                                      | **Gap** — no skill                                                          | **Buildable now** (ledger/timeline; narrative draft deferred to drafting engine) |
| **Case initiation + complaint**                       | Folders/tasks/SOL + service deadlines; stage filing pkg; InfoTrack service→responsive clock          | **Gap** — no skill                                                          | **Buildable now** (setup/staging); InfoTrack signal via Smokeball                |
| **Motions**                                           | Track motion calendar; assemble/stage package by court/dept; tentative-ruling watch                  | **Gap** — no skill                                                          | **Buildable now** (assembly/track); drafting division gated on CoCounsel         |
| **Minor's compromise**                                | MC-350/MC-351 packet; GAL + hearing track; disclosure inputs; lien chase; blocked-account            | **Gap** — no skill                                                          | **Buildable now** (form-fill/track/chase; math stays Smokeball)                  |
| **Trial prep**                                        | Trial binder (exhibit/witness lists, depo summaries, Bates via Adobe); track prep deadlines          | **Gap** — no skill                                                          | **Buildable now** (assembly/track); Adobe backend = research                     |
| **Mediation/settlement + liens**                      | Lien ledger (health-plan/Medi-Cal/Medicare/ERISA/provider); chase payoffs; feed settlement statement | **Gap** — no skill; demand-side `pi` addon exists but not wired             | **Buildable now** (ledger/chase; never compute reduction or move money)          |
| **Paralegal competency**                              | Every skill output explains what/why/next + rule + escalation                                        | Property of skill bodies                                                    | **Buildable now** — bake into every body                                         |

**Bottom line:** the seat currently carries only the generic law spine (intake,
conflict, consult, engagement-letter/trust nudges, status responders). **None of
the litigation-lifecycle skills above exist yet.** That is the build.

## 5. Buildable-now workstreams

Sequenced. The method is the one proven on the 12 marketing packs: **one skill at
a time, through the adversarial gate** (a veteran-CA-PI-paralegal subagent tries
to fail it on domain/compliance error), Captain reviews at the gate. **Never a
build-them-all-at-once run.**

**A — Lock the target (`customer.yaml` delta).** Translate §4 into the definitive
skill catalog on the `operator` persona, each with the right initiation (manual /
scheduled / webhook), keeping `draft_for_review`. This is the open next-action in
`SCOPING.md`. Changes nothing live. Captain-approved before commit. _Fast; do
first — it defines everything downstream._

**B — Offline validation substrate.** Synthetic, de-identified CA-PI matters +
served-discovery documents (interrogatories / RFP / RFA / depo notice across
service methods, each with a proof of service) so the watch/capture/classify/
assemble skills validate before a live tenant exists. Extends the `pi` addon's
declared `synthetic-matter-pi-auto`.

**C — Capture-spec reference (inputs, not arithmetic).** CA served-discovery
**type** taxonomy + **service-method** taxonomy — the exact fields the skill reads
off the proof of service and hands to the rules engine (or, if her answer is
"by hand," to a calibrated deadline routine). Framed as a capture spec, explicitly
not a deadline calculator.

**D — Discovery skill bodies (deepest), one at a time through the gate.** Order by
her stated slippage:

1. `client-verification-tracker` — her #1 slip. The proof skill.
2. `discovery-served-watch` — classify + capture service date/method + surface.
3. `separate-statement-assembler` — her #3 time sink; mechanical CRC 3.1345 table.
4. `propounded-discovery-tracker` — outgoing deadlines + M&C/compel window.
5. `daily-needs-you-digest` — the quiet batched summary (quiet-by-design).

**E — Cross-cutting capabilities.** Confirm what the Hermes substrate already
provides vs. what A&P-specific config is needed: the trust-dial defaults
(`ENTITLEMENTS.md`), voice-library wiring (ready for samples), tune-as-it-goes
(Honcho), watch/schedule (webhook + cron per skill). Mostly **config + verify**,
not new engines — but the plan must state each explicitly so none is assumed.

**F — The rest of the lifecycle, architected now.** Initiation, motions, minor's
compromise, trial prep, mediation/settlement/liens. The connective shape (watch /
capture / stage / trigger / chase / assemble / surface / train) is **uniform**
across phases, so these are architected day-one and their bodies built as the
discovery pattern proves — not sliced into deferred quarters (matches the "full
architecture from day one, validation per matter" posture in the audit).

**G — Vendor-API research (firm the connector backends).** InfoTrack MCP is
confirmed (OAuth2, filing + serve, attorney-gated). Remaining: YoCierge,
Greenfiling, Adobe PDF Services, Dropbox — MCP availability, else `build:` or
guide-through. Lower priority; unblocked.

## 6. What stays gated (and what unblocks it)

- **Live Smokeball validation** ← app approval clears → `bin/connect-smokeball.sh`
  → smoke read (auth_status → list_matters).
- **Inbound-email-discovery** (the handoff gap she flagged as #1 priority) ←
  M365/Graph "Track E" runtime wiring.
- **Deadline-lane final shape** ← Christa's answer to the rules-engine fork.
- **CoCounsel / drafting division** ← her Friday Thomson Reuters meeting.
- **Final accuracy tuning** ← real A&P served-discovery docs + past matters +
  her markup.

None of these block workstreams A–G.

## 7. Open decisions (need Captain before/at build)

1. **Addon shape.** Expand `law-firm/pi` into the real PI-**litigation** addon
   (reusable for the next PI firm; flip A&P to `addons: [pi]`) — or inline the
   skills on `operator` for now and defer the addon abstraction. _Lean: inline now,
   addon once the shape is proven._
2. **Skill home.** New skill bodies in `operator/skills/` (where the base law
   skills live) vs. `hermes-smd-overlay` (where the `pi` addon skills are said to
   live). Needs one decision to avoid split-brain.
3. **Session ambition.** How far this session: lock A (customer.yaml delta) + B/C
   (fixtures + capture spec) and stop at the gate — or also hand-build skill D-1
   (`client-verification-tracker`) through the adversarial gate as the proof.

## 8. Definition of done ("prepared to the extent possible")

- `customer.yaml` expresses the full committed lifecycle skill set (Captain-approved).
- The BUILD-safe discovery skills (D) exist as bodies, gate-passed, validated on
  synthetic fixtures (B), reading against the capture spec (C).
- Cross-cutting capabilities (E) are confirmed wired/configured or explicitly
  gap-listed with the unblock condition.
- The rest of the lifecycle (F) is architected in the customer.yaml and specced,
  bodies staged for per-matter validation.
- **Go-live is a connect-and-verify checklist, not a build.**

## 9. Go-live connect sequence (when the gates lift)

1. Smokeball app approved → register prod callback → `bin/connect-smokeball.sh`
   (firm-delegated authorization_code grant; refresh token to Infisical).
2. Smoke read on A&P's real matters (auth_status → list_matters) via the SMD
   operator MCP turn.
3. Enable webhook triggers (`smokeball matter.updated`, `agentmail message.received`).
4. Wire M365/Graph (Track E) → turn on the inbound-email-discovery path.
5. Christa's markup → tune each lane; resolve the deadline fork + CoCounsel division.
6. Per-matter validation, widening autonomy as each capability proves accurate.
