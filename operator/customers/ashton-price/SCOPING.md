# Ashton & Price — Operator Scoping (internal)

> SUPERSEDED IN PART by `RESEARCH-SYNTHESIS.md` (2026-06-25). The connector map
> below predates the research team and is wrong on two points the synthesis
> corrects: Smokeball DOES have a calendar/Events API, and InfoTrack ships a
> production MCP server (so the filing/serving lane is directly integrable, not
> "research needed"). Read the synthesis as authoritative; this remains useful for
> the lifecycle phasing and the lane framing.

Working scope for the A&P pilot, derived from the 2026-06-25 email loop with
Christa Barrera (Operations Manager). This is the engineering/architecture
substrate that the client-facing **revised plan** (promised by Scott 06-25 18:41)
is translated from. Not client-facing.

Source thread: "RE: Intro meeting with Scott Durgan" — Scott's 08:22 discovery
map → Christa's 18:28 validation + expansion → Scott's 18:41 "revised plan
coming." Read in full; this doc encodes her answers verbatim where they bind scope.

## The settled lane (do not relitigate)

Communicated to the client in writing (Scott 08:22) and confirmed by Christa
("largely right"):

> The Operator does not replace CoCounsel or BriefPoint. Those are the drafting
> engines. The Operator prepares their inputs, routes their outputs, and does the
> work between and around them.

Every piece of work product goes to an attorney to review and finalize. The
Operator never sends to another party and never signs on its own
(`external_send: draft_for_review`, ADR 0005 law floor, non-raisable). The
Operator _does_ draft (meet-and-confer letters, verification requests, separate
statements, chronologies) — drafting for internal review is in-lane; autonomous
external send is not.

## Integration / connector map

A&P's stack (Christa 18:28). Backends proposed per ADR 0020 (MCP-first; build
only where no acceptable MCP) and ADR 0053 (author-built MCP connectors).

| Tool                                   | Role in their stack                                                                        | Operator integration                                                                                                                              | Backend (proposed)                                                                     | Status                                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Smokeball**                          | System of record — matters, documents, tasks, deadlines (the hub)                          | Read matters/docs; write tasks/deadlines/memos; watch `matter.updated`                                                                            | `mcp:smokeball`                                                                        | **Live** vs staging (26 reads + create_memo); prod gated on 72-hr review                                                                                                                |
| **Microsoft 365** (Outlook/Word/Teams) | Email + calendar + docs + chat                                                             | Watch inbound mail (discovery-by-email path); consolidate calendar → Smokeball; Teams notify                                                      | `build:msgraph` (Track E)                                                              | **Blocked** — M365 backend not yet runtime-wired; needs app-reg/DWD                                                                                                                     |
| **Claude**                             | AI drafting / summarization / analysis                                                     | The Operator's _own_ runtime model (Opus 4.8). The in-lane drafting happens here.                                                                 | native                                                                                 | Live                                                                                                                                                                                    |
| **BriefPoint**                         | Written discovery responses + objections                                                   | Smokeball Marketplace partner, folder-based. Operator stages inputs into the matter folder BriefPoint draws from; picks up output from the matter | via Smokeball Documents (no direct API)                                                | Works through hub                                                                                                                                                                       |
| **CoCounsel** (Thomson Reuters)        | Broader drafting (motions, chronologies, depo summaries)                                   | One-way doc push Smokeball→CoCounsel per TR partnership; Operator stages inputs / routes outputs via matter folder                                | **TBD**                                                                                | **Blocked on external info** — Friday 06-26 TR eval + Smokeball×TR briefing next week. Christa explicitly defers drafting-orchestration (Claude vs CoCounsel vs BriefPoint) until after |
| **InfoTrak**                           | Process serving, SOP tracking, e-filing, doc/invoice import to Smokeball, Smokeball E-Sign | Service confirmation → auto-trigger responsive-pleading deadline; client verification via Smokeball E-Sign, tracked + chased                      | research API → else `build:` or guide-through; E-Sign signal may surface via Smokeball | **Research**                                                                                                                                                                            |
| **Greenfiling**                        | E-filing                                                                                   | Guide / track e-filing                                                                                                                            | research API → else guide-through                                                      | **Research**                                                                                                                                                                            |
| **YoCierge**                           | Medical records vendor — auto-uploads records + invoices into the Smokeball matter         | Records-status coordination; chronology trigger on new records                                                                                    | detect via Smokeball doc-added events; direct API only if needed                       | Mostly via hub                                                                                                                                                                          |
| **Adobe** (Acrobat / PDF Services)     | PDF, Bates stamping, exhibit prep, e-signing                                               | Bates / exhibit assembly for motions + trial; PDF handling                                                                                        | `build:` (Adobe PDF Services API)                                                      | Research / build                                                                                                                                                                        |
| **Dropbox**                            | Sharing exhibits / records / demands with clients + defense counsel                        | Place / retrieve shared docs (outbound sharing human-gated)                                                                                       | research MCP → else `build:`                                                           | **Research**                                                                                                                                                                            |

### The key architectural insight: Smokeball is the hub

InfoTrak, YoCierge, and BriefPoint all **import into / draw from the Smokeball
matter**. So the Operator can observe most of the workflow through Smokeball
matter/document events (`mcp:smokeball`, already live) **without** direct
integration to each vendor. One surface to watch for most signals.

**The two signals NOT covered by the hub** (these are the real integration work):

1. **Inbound email discovery** — discovery arrives by email _before_ it's filed
   into Smokeball. This is Christa's "close the handoff gap" priority. Requires
   **M365/Graph watch** (Track E). Promotes Track E in priority.
2. **Physical mail discovery** — arrives by mail, no digital signal until someone
   scans/files it into Smokeball. The Operator can only act once it's in Smokeball
   (or a human tells it). Honest limitation — matches Scott's "catch discovery as
   it arrives" test-and-tune caveat. The Operator chases the _filing_ step rather
   than pretending to see the mail.

Plus the E-Sign completion signal (InfoTrak-powered Smokeball E-Sign) — confirm
whether it surfaces via Smokeball events before building a direct InfoTrak path.

## Full lifecycle → skill decomposition (phased)

Christa's frame: "the discovery workflow is the right place to start, but I want
the architecture built to support the full case lifecycle from day one." Architect
wide, ship discovery deep first.

### Phase 1 — go-live (gated on 72-hr review + connect)

The validated 8-step discovery map, plus her top-4 slippage targets (Christa Q2):

- `discovery-served-watch` — spot served doc in matter, classify type, read
  service date + method, notify responsible attorney
- `discovery-response-clock` — compute CA response deadline + downstream dates
  with service-method math (§1013 +5 mail / §1010.6 +2 court-day e-serve);
  calendar in Smokeball; attorney one-click confirm. **Handles extensions,
  stipulations, amended service** (Christa Q2: top slippage)
- `client-verification-tracker` — draft plain-language verification request →
  attorney approve-and-send → route through Smokeball E-Sign → track signature →
  chase if unsigned (Christa Q2: #1 slippage, "falls through consistently")
- `opposing-response-deficiency-review` — review opposing responses for gaps
  (boilerplate objections, non-answers, missing verifications); start as
  attorney-reviewed assist, calibrated on past matters
- `meet-and-confer-drafter` — draft M&C letter with 45-day-to-compel deadline
  noted. **Flag the decision point rather than auto-drafting** (Christa Q1: M&C
  sometimes handled informally first)
- `separate-statement-assembler` — assemble the CRC 3.1345 item-by-item table
  (Christa Q2: "extremely time-consuming"). Mechanical assembly; attorney
  finalizes/files
- `medical-chronology-maintainer` — running chronology + case timeline, updated as
  records arrive (Christa Q2: maintenance burden as new records land)
- `propounded-discovery-tracker` — track discovery _we_ serve, follow up on
  outstanding opposing responses, flag when to move to compel (Christa Q1: explicit
  add — not just inbound)
- `daily-needs-you-digest` — one short batched summary (due soon, unsigned,
  deadline near). Quiet-by-design

### Phase 2 — architected day-one, activated as connectors land

- Complaint / case initiation: complaint, summons, **CM-010**; defendant service
  tracking via InfoTrak → auto-trigger responsive-pleading deadline; e-filing via
  InfoTrak / Greenfiling / Odyssey-eCourt by venue
- Motions practice: MSJ / opposition / reply, motions in limine, ex parte —
  format + procedural compliance by court and department

### Phase 3 — Minor's Compromise (Christa: "significant part of our practice")

- MC-350 / MC-351 prep; petition for approval; GAL appointment tracking; hearing
  scheduling/follow-up; net-settlement calc + fee disclosures; **Probate Code
  compliance**; post-approval funding / structured-settlement coordination

### Phase 4 — trial prep + mediation/settlement

- Trial brief; exhibit/witness lists; depo-summary integration; trial-binder org
  in Smokeball
- Mediation brief / settlement-conference statement; damages summary with
  liability + comparative-fault analysis; **lien tracking + resolution** (ERISA,
  Medi-Cal, Medicare, provider liens)

### Cross-cutting — built into every phase from day one

- **Paralegal training function** (Christa: "core requirement, not a
  nice-to-have"). Realized as a _property of every skill's output_, not a separate
  skill: each step the Operator does explains what / why / what-comes-next, cites
  the governing rule (e.g. CCP §2030.290), and carries the escalation line (when
  to involve the attorney vs proceed). A junior paralegal builds competency by
  working alongside it. Lives in skill-body design + voice, not a connector.
- **Smokeball as single source of truth** — consolidate deadlines (currently split
  Smokeball tasks ↔ Outlook calendar, Christa Q6) into Smokeball; establish +
  enforce matter folder structure (Christa Q5, once CoCounsel picture clear)
- **Quiet by design** — batch routine items; reach out only when a person is
  genuinely needed

## customer.yaml delta (current → target)

Current `ashton-price/customer.yaml` skills are a generic law-firm spine (intake,
conflict, consult-scheduler, engagement-letter-chaser, trust-balance-nudge,
status responders) + 2 committed deliverables + generic deadline tracker. That set
does **not** yet express the CA-PI discovery workflow.

- **Add** the Phase-1 discovery skills above (some specialize existing ones —
  e.g. `deadline-and-sol-tracker` → keep for SOL, add `discovery-response-clock`
  for service-math discovery deadlines).
- **Connectors:** add M365/Graph (`build:msgraph`) when Track E wired — gates the
  inbound-email-discovery path + calendar consolidation + Teams; add InfoTrak
  signal path if E-Sign/service-confirmation not mirrored via Smokeball.
- **Webhook triggers:** keep `smokeball matter.updated`; add an
  inbound-email-discovery trigger via M365; expand `matter-inbox-router` routing.
- **Keep** `external_send: draft_for_review` throughout (matches "never sends to
  another party, never signs").
- Existing `matter-document-review` ("surface/highlight only, never drafts work
  product") stays as the non-drafting boundary for _review_; the new drafters are
  distinct skills that produce internal drafts for attorney finalization.

## External dependencies / blockers (name these in the plan)

1. **Smokeball 72-hr app review** — submitted 06-24 PM; gates prod connect /
   go-live. Scott told Christa: link early next week → simple testing.
2. **CoCounsel integration picture** — Friday 06-26 TR eval + Smokeball×TR
   briefing next week. Christa defers drafting-orchestration until after.
   **Structure the plan so CoCounsel slots in later; do not block on it.**
3. **M365/Graph backend (Track E)** — not yet runtime-wired. Now higher priority:
   it gates the inbound-email-discovery "handoff gap" Christa flagged as a
   priority, plus calendar consolidation and Teams.
4. **Vendor API research** — InfoTrak, Greenfiling, YoCierge, Adobe, Dropbox:
   confirm MCP availability, else `build:` adapter or guide-through.

## Next actions

- [ ] Draft the client-facing **revised plan** in Scott's 08:22 voice (concrete,
      quiet-by-design, test-and-tune), expanded to the lifecycle + training
      function + integration map, CoCounsel-deferred. `draft_for_review` — Scott
      reviews + sends.
- [ ] Vendor-API research pass (InfoTrak / Greenfiling / YoCierge / Adobe /
      Dropbox) to firm up the connector backends.
- [ ] Decide whether to promote Track E (M365/Graph) given the inbound-email
      priority.
- [ ] Translate the Phase-1 skill set into `customer.yaml` once the plan is
      Captain-approved.
