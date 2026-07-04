# Ashton & Price Operator — Implementation Plan (go-live)

_The active sequencing document for the A&P pilot. Supersedes `BUILD-PLAN.md`
for sequencing (the build it planned is done and merged); `BUILD-PLAN.md`
remains the record of build posture and guardrails. What we owe:
`CLIENT-PROPOSAL.md`. Delivery model: `00-OVERVIEW.md`. Trust dial:
`ENTITLEMENTS.md`. Per-skill evidence: `../../grading/matrix.md`.
Process-grain test strategy: `TEST-PLAN.md`. Client-facing shape:
`CLIENT-IMPLEMENTATION-PLAN.md`._

---

## 1. How this plan is structured (read once)

Four rules shape everything below:

1. **Gate-sequenced, never time-sequenced.** Milestones are verification
   events — a seam observed carrying real data — not dates. A milestone is
   done when its exit criterion has a `crane_verify` record, matching the
   "done means wired" standard. No effort or duration estimates appear
   anywhere in this plan.
2. **Two axes: seams × lanes.** Vertical **seams** (Smokeball prod connect,
   inbound email, InfoTrack, rules engine, voice) come live one at a time;
   each unlocks lifecycle **lanes** (discovery, initiation, motions, minor's
   compromise, trial prep, settlement/liens). Lanes then validate
   **per-matter** on real A&P matters as they occur — the "test and tune"
   posture already communicated to Christa.
3. **Per-skill promotion ladder.** Every skill's status is one of:
   `authored → gated → staged → fixture-graded → live-shadow →
draft_for_review → autonomous`. Promotion beyond `draft_for_review`
   happens only where the firm's entitlement dial authorizes it AND the
   enable-gate checklist (`docs/runbooks/operator/enable-gate-checklist.md`)
   passes. Evidence lives in `operator/grading/matrix.md` + `runs/`; this
   plan tracks milestones, not per-skill state — never duplicate the matrix
   here.
4. **Two standing gates sit above the ladder (Captain, 2026-07-04).**
   **(a) Lifecycle acceptance.** The litigation-lifecycle model the skills
   are built on is working doctrine, not firm-confirmed fact — the proposal
   is still awaiting Christa's markup. Internal-only work (M0–M1: our seat,
   our rehearsal office) proceeds and iterates now. **Nothing runs against
   the firm's account before the working session has corrected the model**
   (2026-07-04 realignment — the original plan let shadow precede the
   session; that was out of order, relationally and in its own
   dependencies: shadow scope is a session output). Connect happens at the
   session; observation follows it; nothing firm-visible activates until
   the firm has signed off the lifecycle model for that lane — the
   acceptance level of `TEST-PLAN.md`.
   **(b) Smokeball write defect (ticket #617858).** Memo and document
   writes fail server-side on Smokeball's end (task and calendar writes
   verified working live, 2026-07-03). Go-live blocker for every lane whose
   delivery path lands output in Smokeball as a memo or document. We wait
   for vendor resolution; no workaround routing. Gate (b) governs delivery
   writes on the client's account; hydrating our own staging tenant with
   test data is test infrastructure, not a workaround (Captain,
   2026-07-04 — see M1).

**Ladder definitions.** `live-shadow` = executes against real firm data on a
schedule/trigger, output routed internally (Captain/ops) only — the firm sees
nothing. `draft_for_review` = live, outputs routed to the firm as drafts;
nothing external sends autonomously. `autonomous` = firm-authorized per
action-class × connector, enable-gate passed.

**Change flow (standing rule).** Nothing lands on the `ashton-price` seat
directly. Skill/config changes flow: synthetic fixtures →
`pilot-smokeball` (staging seat, kept alive for exactly this) →
`ashton-price`. The staging seat is the regression harness for a paid
client's Machine.

## 2. Where we are (verified, 2026-07-04)

| Fact                                                                                                                                                                                                                                       | Evidence                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19 PI-litigation skills authored + adversarially gated + revised; every safety bright line held                                                                                                                                            | PR #1637; `law-firm/pi` addon.yaml v0.2.0; 64 fixtures (43 adversarial)                                                                                                       |
| Catalog selector: 19/19 blind pass over the 33-skill catalog                                                                                                                                                                               | `../../verticals/law-firm/addons/pi/tests/catalog-selector-test.md`                                                                                                           |
| Skills staged on `quinn` in both `pilot-smokeball` and `ashton-price` customer.yaml                                                                                                                                                        | 2026-07-02 staging pass                                                                                                                                                       |
| Live execution proven on `pilot-smokeball`; hardening fixes landed from that pass                                                                                                                                                          | #1639 (catalog frontmatter), #1641/#1644 (citation-safe email, neutral persona), #1650 (Smokeball /contacts 400s), #1651 (delivery discipline v2), #1665 (seat-local cron TZ) |
| Smokeball app **approved** for production                                                                                                                                                                                                  | Captain, 2026-07-03                                                                                                                                                           |
| `ashton-price` seat **unprovisioned**; Anthropic workspace pre-created, config row to author at provision                                                                                                                                  | `docs/runbooks/operator/cost-telemetry-enable.md`; #1667/#1668                                                                                                                |
| Cost plane live: per-seat workspace attribution + machine-local breaker                                                                                                                                                                    | ADR 0062; #1664/#1666                                                                                                                                                         |
| Smokeball prod connect path = client-portal OAuth (settings hub), firm-delegated authorization_code grant                                                                                                                                  | #1633/#1649 (the `bin/connect-smokeball.sh` reference in BUILD-PLAN §9 is stale)                                                                                              |
| Litigation-lifecycle model **not firm-confirmed** — proposal awaiting Christa's markup                                                                                                                                                     | `CLIENT-PROPOSAL.md` header; standing gate (a)                                                                                                                                |
| Smokeball memo + document writes **fail server-side** (403); task write verified working live                                                                                                                                              | Ticket #617858; 2026-07-03 live probe (task created + read-verified); standing gate (b)                                                                                       |
| App 1 (original `client_credentials` staging app, performed the original doc seeding) credentials captured to `SMOKEBALL_SEED_*` + **live-verified incl. doc-write** (App 2 had overwritten `SMOKEBALL_STAGING_*`; deny confirmed per-app) | `vfy_01KWQKZVDVESGWY5VRDA12PK46` + `vfy_01KWQN1EYR3N41YVP5W3YYMJVX` (2026-07-04)                                                                                              |

## 3. Milestone ladder

Each milestone names its exit criterion (the thing observed working) and who
holds the blocking input. Milestones overlap where noted; the numbering is
dependency order, not a strict serial queue.

The gates and the 2026-07-04 sequencing correction split the ladder:
**M0–M1 are internal-only** — our seat, our staging tenant — and proceed
now. **Everything that touches the firm's account starts at the working
session (M2):** the Connect authorization happens in the room, observation
follows on the matters they chose, and activation (M5 onward) holds until
gate (a) clears for the lane in question and gate (b) clears wherever the
lane's delivery path writes memos or documents into Smokeball.

### M0 — Seat live

Provision the `ashton-price` Machine: `operator/bin/provision-customer.sh
ashton-price` under Infisical `/ss` env; per-seat
`ANTHROPIC_API_KEY__ASHTON_PRICE` picked up automatically (#1667);
`customer_configs` row authored with the pre-created workspace id; boot smoke
test; all 5 safety invariants pass on boot; cost telemetry attributing to the
seat.

- **Blocked by:** nothing. Start immediately.
- **Exit:** `crane_verify` records for boot + invariants + a cost-telemetry
  row carrying `customer_slug=ashton-price`.

### M1 — Rehearsal office hydrated, lane chains proven (L2)

The staging seat (`pilot-smokeball`, bound to our own tenant in Smokeball's
vendor staging environment) becomes a fully hydrated rehearsal office: the
synthetic matter set per `TEST-PLAN.md` §3 (representative matters plus the
edge cases — wrong-matter lookalikes, malformed proofs of service, injection
attempts), then every lane's L2 scenario suite run end-to-end. This is where
all iteration happens until the firm's account is in play — and for as long
as we work together, per the change-flow rule.

**Seeding path (decided: App 1 — Captain, 2026-07-04).** Document seeding
through the seat's own connector hits the same #617858 deny (App 2 tokens).
Seeding runs on **App 1**, the original `client_credentials` staging app
that performed the original document seeding (upload contract locked in
`operator/connectors/smokeball/tests/test_document_writes.py`). Manual
web-UI seeding covers a bounded starter set in the interim; task and
calendar seeding through the seat works today regardless.

**Credential handling (do not get this wrong twice).** App 2's rollout
**overwrote** `SMOKEBALL_STAGING_CLIENT_ID/SECRET` in `/ss` — the vault
holds App 2 values under those names (prefix-verified 2026-07-04). App 1's
credentials live under **separate, purpose-named keys** —
`SMOKEBALL_SEED_CLIENT_ID` / `SMOKEBALL_SEED_CLIENT_SECRET` (captured from
the Developer Console 2026-07-04, distinct-from-App-2 verified) — never
under the `SMOKEBALL_STAGING_*` / `SMOKEBALL_PROD_*` names App 2 depends
on. The US API key is account-scoped (same for all apps):
`SMOKEBALL_STAGING_API_KEY` serves App 1 too; no separate seed key exists.

**Seed credentials LIVE-VERIFIED including doc-write
(`vfy_01KWQN1EYR3N41YVP5W3YYMJVX`, 2026-07-04):** `client_credentials` mint
200 → `/matters` read 200 → **full two-stage document upload succeeds**
(POST `documents/files` 202 + presigned PUT 200) on matter `54bc1371` —
the same tenant + matter where App 2's writes 403. Document seeding is
unblocked, and the deny is confirmed **per-app** at Smokeball's authorizer
(App 1 allowed, App 2 denied, same tenant/resource) — strong addendum
evidence for ticket #617858 (Captain call whether to send).

- **Blocked by:** nothing. Start immediately.
- **Exit:** every lane's L2 scenario suite has a passing end-to-end run on
  the staging seat, recorded per `TEST-PLAN.md` §7.

### M2 — Firm working session (the firm-facing kickoff)

Schedule it now; it is the first thing that touches the firm's
relationship with the Operator, and nothing runs against their account
before it. One session with Christa (+ Chris where the dial needs the
principal) to correct the model and lock what only the firm can give:

1. **Lifecycle walkthrough** — walk our picture of how a case moves through
   their office, filing to settlement; they correct it. First pass of L4
   acceptance for the discovery lane.
2. **Entitlement sign-off** — walk `ENTITLEMENTS.md` defaults; the dial is
   theirs; unconfigured stays fail-closed.
3. **Christa's markup** on the proposal lanes + her 7 open questions.
4. **The deadline fork** — rules engine vs by-hand today (we never resolve
   this unilaterally; it sets the deadline-lane shape).
5. **CoCounsel / drafting division** — outcome of her Thomson Reuters
   meeting; sets motion/response orchestration.
6. **Voice samples** — firm letters/templates into the voice library
   (path is set, library is empty).
7. **Monitored-inbox decision** — owned address vs forwarding vs Graph watch
   (feeds M6).
8. **Starting matter set** — which live matters observation watches first.
9. **Connect authorization** — performed in the room via the portal OAuth
   flow; we verify the connection live together (feeds M3).

- **Blocked by:** Christa's availability (was out week of 2026-06-29).
- **Exit:** committed `customer.yaml` + `ENTITLEMENTS.md` delta reflecting
  the firm's answers; open forks resolved or explicitly parked; Connect
  authorized.

### M3 — Smokeball production connect

Register the production callback on the approved app **before** the working
session; the firm authorizes at the session (M2 item 9) via the portal OAuth
connect flow (settings hub); refresh token vaulted; smoke read
(`auth_status` → `list_matters`) against A&P's **real** matters through the
seat's MCP, verified in the room or immediately after.

- **Blocked by:** M0 (seat) + M2 (the authorization happens at the session).
- **Exit:** verify record of a real-matter list read through the live seat.
- **Watch:** the `/contacts` bare-term 400 class of API quirk (#1650) — first
  reads against real tenant data are where the next such quirk surfaces.

### M4 — Watch lane live (read-only shadow)

Webhook triggers (`smokeball matter.updated`) + seat-local crons enabled;
`daily-needs-you-digest` and the tracker/watch skills running in
**live-shadow** against the starting matter set the firm chose (M2 item 8),
with the model as corrected in the session — output to us, not the firm.
This is where per-matter validation starts: we grade shadow output against
what the firm actually did.

- **Blocked by:** M3 + M2 item 8 (starting matter set).
- **Exit:** consecutive shadow digests graded accurate in `runs/` (rubric
  per `operator/grading/rubric.md`), zero safety-line violations.

### M5 — Discovery lane activation (per-matter, draft_for_review)

The proposal's deepest lane, ordered by her stated slippage. Each skill walks
the ladder on live matters: live-shadow → graded → promoted to
`draft_for_review` with drafts routed to the firm.

1. `client-verification-tracker` — her #1 slip; the proof skill.
2. `discovery-served-watch` — classify + capture service date/method +
   surface the deadline for confirmation.
3. `separate-statement-assembler` — her #3 time sink.
4. `discovery-response-tracker` + `discovery-response-staging`.
5. `opposing-response-deficiency-review` → `meet-and-confer-drafter`.

- **Blocked by:** M4 (shadow substrate) + M2 items 2–4 (dial, markup,
  deadline fork) + **gate (a)** (discovery-lane lifecycle sign-off, the L4
  acceptance record per `TEST-PLAN.md`) + **gate (b)** for the skills that
  write into Smokeball (`separate-statement-assembler` and
  `discovery-response-staging` land documents; blocked until #617858
  resolves — no workaround routing).
- **Exit:** each skill has a graded live run in `runs/` sustaining
  `draft_for_review` with zero safety-line violations; the firm is receiving
  and using its drafts.

### M6 — Inbound-email seam (Track E)

M365/Graph DocumentStorage + mail watch (**#1055, P0**) built in
`hermes-smd-overlay`, wired to the seat; `matter-inbox-router` +
`discovery-served-watch` email path live. This closes the handoff gap Christa
flagged as her #1 priority: served discovery reaching the Operator **before**
it reaches Smokeball. Prompt-injection taint-gate applies to everything off
this seam.

- **Blocked by:** #1055 build; A&P tenant admin consent
  (`docs/runbooks/operator/ms-graph-azure-ad-setup.md`); M2 item 7.
- **Exit:** a real served-discovery email captured → classified → matter-
  matched → surfaced, verified end-to-end.

### M7 — Remaining lanes, per-matter as events occur

Initiation, motions, minor's compromise, trial prep, mediation/settlement/
liens. Bodies exist and are gated; each activates when a real matter presents
the event, walking the same ladder. Seams pulled in as lanes need them:
InfoTrack MCP (filing/service signals), rules-engine activation (per the M2
deadline-fork answer), Adobe (trial binder assembly — backend still research).

- **Blocked by:** M5 pattern proven; the relevant seam per lane; per-lane
  gate (a) sign-off; a matter presenting the event.
- **Exit:** rolling — per-lane first graded live run, recorded in the matrix.

### M8 — Operate + tune (steady state)

The pilot's standing rhythm once M5 is live: weekly matrix review (rollup +
promotions); autonomy widening only via the enable-gate checklist and only
where the firm's dial authorizes; voice tuning as Layer 2 (#855) lands;
cost-plane review per seat; correction-capture (tune-as-it-goes) confirmed
carrying forward.

- **Exit:** none — this is the operating state the milestones converge into.

## 4. Per-process test strategy

Skill-grain evidence (the grading matrix + `runs/`) proves individual skills.
It does not prove a _process_ — served discovery arriving, getting classified,
tracked, staged, reviewed, and answered as one chain. `TEST-PLAN.md` defines
the process-grain strategy: the synthetic matter set (its §3), one end-to-end
scenario suite per lifecycle lane, run through four levels.

| Level | What runs                                                                                                     | Where                                      |
| ----- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| L1    | Component: per-skill fixtures (64, 43 adversarial), re-run on every change                                    | Repo, pre-merge                            |
| L2    | Integration: full lane chains over synthetic matters through the real substrate                               | `pilot-smokeball` staging seat (M1)        |
| L3    | System: live-shadow on real A&P matters, output internal, graded against what the firm actually did           | `ashton-price` seat (M4+)                  |
| L4    | Acceptance: the firm reviews the process and its output against how the firm actually runs; per-lane sign-off | Firm (working session + reviewed evidence) |

L4 is the mechanism of standing gate (a): lifecycle sign-off is not a
one-time meeting, it is per-lane acceptance criteria passing, recorded per
`TEST-PLAN.md`. No lane promotes to `draft_for_review` without its L4 record.
The change flow (fixtures → staging seat → paid seat) is the regression
discipline underneath all four levels.

## 5. Firm-input register (everything we need from A&P)

The client-visible face of this plan. Every ask, who owes it, what it
unlocks. When presenting to the firm, this table — not the milestone ladder —
is the artifact to speak from (in its client-facing shape,
`CLIENT-IMPLEMENTATION-PLAN.md`).

| #   | Input                                                | Owner            | Unlocks                             |
| --- | ---------------------------------------------------- | ---------------- | ----------------------------------- |
| 1   | Working session scheduled                            | Christa          | M2 → the whole firm-facing sequence |
| 2   | Connect authorization (at the session, portal OAuth) | Christa or Chris | M3 → everything on their account    |
| 3   | Entitlement sign-off                                 | Chris + Christa  | M5+ promotions                      |
| 4   | Markup + 7 proposal questions                        | Christa          | Lane final shapes                   |
| 5   | Deadline-fork answer                                 | Christa          | Deadline-lane shape                 |
| 6   | CoCounsel division (post-TR meeting)                 | Christa          | Motion/response lane                |
| 7   | Voice samples (letters/templates)                    | Christa          | Firm-voice drafting                 |
| 8   | Inbox decision + M365 admin consent                  | Christa + IT     | M6                                  |
| 9   | Starting matter set                                  | Christa          | M4 shadow scope                     |
| 10  | Lifecycle sign-off (per-lane acceptance)             | Chris + Christa  | Gate (a) → M5+                      |

## 6. Dependency register

Everything the plan waits on that we do not fully control, with owner and
blast radius. Update in place; a dependency that blocks a milestone is also
named on that milestone.

| Dependency                                  | Owner                              | Blocks                                                                               | State (2026-07-04)                                                                                                         |
| ------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Smokeball memo/document write defect        | Smokeball support (ticket #617858) | Gate (b): M5+ delivery paths that write docs/memos — go-live blocker, no workarounds | Open; task/calendar writes unaffected; deny confirmed **per-app** (App 1 writes succeed, same tenant) — addendum candidate |
| Lifecycle sign-off (per-lane acceptance)    | Chris + Christa                    | Gate (a): all firm-visible activation (M5+)                                          | Proposal awaiting markup                                                                                                   |
| Working-session scheduling                  | Christa                            | M2 → the whole firm-facing sequence (connect, shadow, activation)                    | Was out week of 2026-06-29                                                                                                 |
| Connect authorization                       | Christa or Chris                   | M3                                                                                   | Asked at the working session (M2 item 9)                                                                                   |
| ~~App 1 credential retrieval~~ **RESOLVED** | Captain (done 2026-07-04)          | ~~M1 document-bearing L2 scenarios~~ unblocked                                       | `SMOKEBALL_SEED_*` vaulted + live-verified incl. doc-write (`vfy_01KWQN1EYR3N41YVP5W3YYMJVX`)                              |
| M365 tenant admin consent                   | A&P IT                             | M6                                                                                   | Not started                                                                                                                |
| Graph DocumentStorage + mail watch build    | Us (#1055, P0)                     | M6                                                                                   | Open                                                                                                                       |
| CoCounsel / drafting division answer        | Christa (post-TR meeting)          | Motion/response lane shape                                                           | Pending her meeting                                                                                                        |
| Deadline fork (rules engine vs by-hand)     | Christa                            | Deadline-lane shape                                                                  | Open, M2 item 4                                                                                                            |
| InfoTrack MCP availability                  | Us + vendor                        | M7 filing/service signals                                                            | Research                                                                                                                   |
| Adobe backend (trial binder)                | Us                                 | M7 trial-prep lane                                                                   | Research                                                                                                                   |

## 7. Tracking model

- **This document** is the canonical map. Milestone status updates land here
  in the same PR as the work that moves them, with the verify record cited.
- **GitHub milestone "A&P Operator Go-Live"** holds the work items — one
  issue per milestone workstream, plus discovered work filed against it.
  Issues are the unit of doing; this doc is the unit of understanding.
- **`operator/grading/matrix.md` + `runs/`** remain the per-skill evidence
  ledger. This plan never restates per-skill verdicts.
- **`TEST-PLAN.md`** holds the synthetic matter set, the process-grain
  scenario suites, and the four test levels; L4 acceptance records are the
  lifecycle sign-off evidence.
- **Client-facing shape** is the standing `CLIENT-IMPLEMENTATION-PLAN.md` —
  this plan in the firm's language, maintained alongside this file (when the
  shape changes, update both in the same PR). Status notes to the firm derive
  from it and the §5 register; Captain reviews and sends everything.
  Client-facing content carries no internal codenames, no timeframes, no
  uncontracted commitments (CLAUDE.md Pattern A/B).

## 8. Risks worth naming (not a ceremony section)

- **The lifecycle model is presumed, not confirmed.** The working session
  (M2) corrects it before anything runs against the firm's account, and
  per-lane acceptance (L4) confirms it lane by lane. Expect the model to
  move; corrections flow back through L1–L3 on the rehearsal office.
- **The write defect has no deadline.** #617858 is in Smokeball's queue, not
  ours. Gate (b) means the document-writing half of the discovery lane waits
  on a vendor we cannot schedule; it also constrains rehearsal-office
  document seeding (M1) unless the App 1 or web-UI path is taken. Keep the
  ticket warm and keep the unaffected paths (tasks, calendar, drafts routed
  to the firm) moving.
- **Real-tenant API quirks.** #1650's `/contacts` 400 class will recur on
  first real reads (M3/M4). Budget iteration there; the MCP breaker protects
  the seat.
- **Single-threaded firm inputs.** Christa owns 9 of the 10 register items,
  and the sequencing correction makes her availability block the entire
  firm-facing sequence (M2 → M4), not just one milestone. The mitigation is
  M1: the rehearsal office carries all iteration until she is available, so
  waiting costs readiness nothing.
- **Inbound email is the sharpest edge.** M6 is both her #1 priority and the
  prompt-injection surface. The taint-gate and fail-closed posture are not
  relaxable for speed.
- **Guardrails carry over wholesale** from `BUILD-PLAN.md` §3: no deadline
  computation (rules engine owns it, pending the fork answer), no work-product
  drafting, no external send / signing / trust-money, fail-closed on
  unconfigured entitlements, training-output property in every skill.
