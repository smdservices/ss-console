# Ashton & Price — Redundancy Pass ("belt-and-suspenders" audit)

Refines `RESEARCH-SYNTHESIS.md` Bucket-1. One test applied to every scoped
capability:

> **Does a system of record already own this function?**
>
> - **BUILD** — pure connective tissue: chase, watch, stage, surface, flag, or
>   mechanical assembly that no incumbent performs. Safe to build now.
> - **GATE** — value depends on what the firm uses today → convert to a "what do
>   you use for X?" question; do not build until answered.
> - **CUT** — re-performs a function an incumbent clearly owns (date computation,
>   settlement math, work-product drafting, legal analysis). Drop it; the Operator
>   reads/connects/chases around it.

Why this matters: re-performing an incumbent's function is (a) liability we
shouldn't own (legal arithmetic, settlement math), (b) trust erosion (false-
positive second-guessing of a certified system), and (c) off-thesis (the value is
the connective tissue between disconnected systems, not their features).

## CUT — stop building these (an incumbent owns the function)

| Capability I had scoped                                                                                                                       | Incumbent that owns it                                                                                                                                                                                                                                                                        | What the Operator does instead                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deadline **computation** (SOL, response clocks, trial-date cascade, motion notice math)                                                       | A **certified court-rules engine** already exists in their ecosystem — **LawToolBox** (industry standard; integrates with both Smokeball and InfoTrack) and/or Smokeball's InfoTrack-linked court-rules calendaring. Per Christa's email it is **not active today** (deadlines manual/split). | the Operator does NOT compute; it reads the engine's dates from Smokeball and chases the work. The genuine win is helping **activate** that engine — exactly her "InfoTrak should auto-trigger responsive-pleading deadlines" wish — not building arithmetic we'd be liable for. |
| **Cross-checking** the calculator's dates / flagging discrepancies                                                                            | —                                                                                                                                                                                                                                                                                             | nothing. We don't audit a certified system. (The only adjacent value is reading the served doc to capture the _input_ date/method — that's BUILD, below.)                                                                                                                        |
| **Settlement statement + final disbursement** math/package                                                                                    | Smokeball native (settlement statements + disbursement)                                                                                                                                                                                                                                       | assembles the _inputs_ (lien payoffs, costs) and chases them; lets Smokeball produce the statement                                                                                                                                                                               |
| **Statutory lien-reduction** calculator (Medi-Cal/hospital %)                                                                                 | attorney judgment (+ the §14124.78 error shows the danger)                                                                                                                                                                                                                                    | maintains the ledger + chases payoff letters; never computes the reduction                                                                                                                                                                                                       |
| Substantive **deficiency analysis**, **damages / comparative-fault analysis**, **objection-basis** legal judgment, **expert-report analysis** | CoCounsel + the attorney                                                                                                                                                                                                                                                                      | logs/tracks what _they_ flag; drives the clock; never judges                                                                                                                                                                                                                     |
| **Drafting** work product (chronologies, briefs, motions, declarations)                                                                       | BriefPoint / CoCounsel                                                                                                                                                                                                                                                                        | stages inputs, routes outputs (already settled — reaffirmed)                                                                                                                                                                                                                     |

## GATE → AUDITED against Christa's 06-25 email (seven of eight dissolve)

Homework: re-check each "what do you use for X?" against what she actually wrote.
It would be embarrassing to ask things her detailed email already answered.

| Question                                 | What she already told us                                                                                                                                                                                                                                                            | Verdict                                                                                                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deadline calculator?                     | deadlines "split between Smokeball tasks and Outlook"; wants InfoTrak confirmations to "automatically trigger responsive pleading deadlines — this should not be a manual step" (⇒ manual today); top slippage = "deadline calendaring … extensions, stipulations, amended service" | **Manual/semi-manual today.** Don't ask the broad version — one light confirm only (below). Whether a rules engine is available is **our research** (LawToolBox / Smokeball-InfoTrak), not her homework. |
| Court forms / complaints                 | not stated; only relevant to minor's-compromise packet                                                                                                                                                                                                                              | **Defer** — premature, near-term build doesn't touch it                                                                                                                                                  |
| Separate statements / CoCounsel coverage | CoCounsel not onboarded (eval Fri — she already committed to brief us); BriefPoint = discovery responses only; separate statements = her **#3 time-sink** (⇒ manual gap)                                                                                                            | **Don't ask** — confirmed gap; CoCounsel coverage is already coming Friday                                                                                                                               |
| Lien-resolution vendor                   | none in her stack; she asks the _Operator_ to do lien tracking (lifecycle §6) ⇒ nothing owns it                                                                                                                                                                                     | **Don't ask** (Phase-later; light confirm at most)                                                                                                                                                       |
| Settlement statements / disbursement     | Smokeball native (our research); no other tool named                                                                                                                                                                                                                                | **We already know** — assume Smokeball                                                                                                                                                                   |
| Calendar — where deadlines live          | **answered** (split Smokeball/Outlook → consolidate into Smokeball); whether M365 Cloud Sync is enabled is config we **check ourselves** at connect                                                                                                                                 | **Answered + ours to verify**                                                                                                                                                                            |
| Conflicts                                | not raised; Smokeball native; off her litigation focus                                                                                                                                                                                                                              | **Drop**                                                                                                                                                                                                 |
| Damages / valuation                      | analysis we already **CUT** (CoCounsel/attorney)                                                                                                                                                                                                                                    | **Drop** — moot                                                                                                                                                                                          |

## The firm questions that actually survive

Essentially **one light confirm**, framed to show we read her email (not homework she should do for us):

> "Today, are your court deadlines calendared by hand, or does a court-rules engine (LawToolBox, or InfoTrak/Smokeball's court-rules calendaring) compute them from the rules? We want the Operator to lean on that engine and chase the work — not reinvent the math."

Everything else is answered by her email, known from our research, ours to verify at connect, or genuinely premature. The CoCounsel division-of-labor she's _already_ bringing us after Friday — we don't ask, we receive.

## InfoTrack homework (verified 2026-06-25)

- **InfoTrack ships a production MCP** (confirmed at infotrack.com/model-context-protocol): OAuth 2.0, endpoint `https://search.infotrack.com/services/mcp-us-server/mcp`, two tool sets — **Court Filing** (start a filing from PDFs, auto-extract case data, auto-calc fees) and **Service of Process** (order serves, track progress). This is the Operator's path for filing/serving, **attorney-gated** (never auto-submit). Confirm the exact tool surface + whether confirm/submit can be scope-withheld once we have a Partners-Portal login.
- **InfoTrack does NOT compute court deadlines itself.** Court-rules calendaring is **LawToolBox** (industry-standard rules engine; integrates with both InfoTrack and Smokeball/M365) and/or Smokeball's InfoTrack-linked court-rules calendaring. The InfoTrack↔LawToolBox loop is exactly "a filing/serve event → auto-calculated downstream deadlines" — i.e. Christa's stated wish is **activating existing certified capability**, not new arithmetic.
- **The MCP covers filing + serve only — not calendaring.** So the Operator reads rules-engine deadlines from Smokeball (once active); it does not pull them through the InfoTrack MCP.
- Smokeball↔InfoTrack integration (native, configured in Smokeball) also auto-syncs proof of service and e-filed stamped docs + fees back into the matter — signals the Operator observes via Smokeball, no separate build.

Sources: [InfoTrack MCP](https://www.infotrack.com/model-context-protocol), [InfoTrack×LawToolBox](https://lawtoolbox.com/infotrack/), [InfoTrack Smokeball integration](https://www.infotrack.com/smokeball), [Smokeball InfoTrack config](https://support.smokeball.com/hc/en-us/articles/5859843268503-InfoTrack-Overview-and-Configuration).

## BUILD — genuinely connective, no incumbent owns it (safe now)

These are the Operator's real lane — the work that falls _between_ systems and the
chase that nothing else does:

- **Chase**: client-verification chase (her #1 slippage), outstanding-opposing-
  response chase, records chase (vs YoCierge), lienholder dunning, stalled-matter
  chase, engagement-letter chase.
- **Watch / capture / surface**: inbound-email-discovery triage + classification
  (the handoff gap, via M365); reading the **served document** to capture the
  service date + method (the deadline _input_, surfaced for confirmation — not the
  arithmetic); tentative-ruling portal watch; CRS hearing-reservation staging;
  government-defendant tripwire; the CRC 7.950.5 expedited-eligibility checklist.
- **Stage / organize**: stage served requests + supporting docs into the matter
  folder BriefPoint/CoCounsel draw from; enforce the folder structure; trial-binder
  assembly (Adobe).
- **Catch-what-slips (gap-fill, framed as "currently falling through," never
  "auditing your system")**: deadlines no system tracks today — most clearly the
  45-day compel-further clock keyed to the **verified** response (a calculator
  triggered on "response received" won't key off verification) and the matrix of
  statutory lien clocks. Confirm the gap exists before building.
- **The training output property**: every skill explains what/why/next, cites the
  rule, carries the escalation line. No incumbent does this.

## "Phases" was the wrong frame — full-lifecycle architecture from day one

Christa's exact words: _"the discovery workflow is the right place to start, but I
want the architecture built to support the full case lifecycle from day one."_ So
she wants (a) the **architecture to span the entire lifecycle from day one**, and
(b) **discovery as the entry point** (her framing too). My earlier "Phase 1/2/3/4"
labels implied staged _delivery over time_ — that undersold her day-one requirement
and is dropped.

Reconciliation, sharpened by the redundancy pass:

- **The Operator's lane is the connective layer, and it's largely uniform across the
  whole lifecycle** (chase, stage, capture, surface, train). After cutting
  everything an incumbent owns, what's left is not phase-specific legal depth — it's
  connective tissue spanning complaint → discovery → motions → minor's-compromise →
  trial → settlement. That layer is feasible to architect and build broadly from the
  start, not sliced into deferred phases.
- **What "lands first" is gated by external seams coming live, not by us deferring
  scope:** the Smokeball connect/approval, M365 wiring (inbound email), the InfoTrack
  MCP + rules-engine activation, the CoCounsel picture (post-Friday), vendor
  confirmations. Capabilities turn on as their seam is live.
- **Validation is per-matter, not per-phase** — Scott's already-communicated "test
  and tune": each capability proves out on real matters as they occur (the minor's-
  compromise capability validates when a minor's-compromise matter runs). An honest
  validation cadence Christa accepted ("largely right"), not a roadmap of quarters.

So: architecture spans the full lifecycle day one; the connective layer is built
across all of it; discovery is the entry point (her call + worst slippage);
activation is external-seam-gated; validation is per-matter. No "Phase N" deferral.

## Corrected build-now set (replaces RESEARCH-SYNTHESIS Bucket-1 #2–#7)

Pure connective work, calculator/forms/vendor-agnostic:

1. **Smokeball connector write-cut** — DONE (the substrate for staging + chasing).
2. **Chase skills** — verification, outstanding-response, records, stalled-matter.
3. **Inbound-discovery capture** — triage + service date/method capture (needs M365).
4. **Staging + folder structure** — into the BriefPoint/CoCounsel matter folder.
5. **Separate-statement _mechanical_ assembly** — only after confirming CoCounsel
   doesn't (the coverage info she's bringing Friday), since it's her #3 time-sink and
   likely a true gap.
6. **Wire `mcp:infotrack`** (filing + serve) — attorney-gated; the Operator stages
   and presents, a human submits. Verified MCP, OAuth2.

Deadline lane = **activate the existing rules engine** (LawToolBox / Smokeball-
InfoTrak court-rules) + chase + capture the service-date/method input. Not a build —
an activation. Everything date-computing, form-generating, math-computing, or
work-product-drafting stays CUT or GATED.
