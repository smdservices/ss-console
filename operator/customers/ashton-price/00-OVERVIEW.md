# Ashton & Price Operator — Overview & Delivery Model (read first)

The big-picture frame for the A&P pilot. Detail docs are indexed at the bottom;
this is the altitude view so the deadline/InfoTrack/LawToolBox detail stays in
proportion.

## How we deliver the full litigation lifecycle

A&P asked for the Operator to support the **complete California PI litigation
lifecycle** — complaint filing → discovery → motions → minor's compromise → trial
prep → mediation/settlement — and to function as an **embedded training tool** for
their paralegals, with the **architecture in place from day one**.

We deliver that **not** by rebuilding a law firm's tools, but as **the connective
layer across the systems A&P already runs.** Their systems of record do the heavy
lifting; the Operator is the glue and the chase — the always-on coordinator that
carries work between systems and makes sure nothing falls through. This is the
thesis: the Operator competes with a **hire** (a litigation coordinator/paralegal),
not with software. Christa's "embedded training tool for paralegals" ask _is_ that
thesis stated back to us.

## One pattern, applied to every phase

The Operator's job is the **same shape in every phase** — which is why the full
lifecycle is deliverable as one architected machine, not seven separate builds:

- **Watch** — Smokeball matter events + the inbound inbox for what just happened.
- **Capture** — the inputs that slip (service date/method off a served doc, a new
  YoCierge record, a returned client verification).
- **Stage** — the right documents into the right matter folder for the drafting
  engines (BriefPoint/CoCounsel) and tools.
- **Trigger** — the right downstream (activate the deadline via the rules engine,
  route to the attorney, kick the next step).
- **Chase** — what's outstanding (verifications, opposing responses, records,
  signatures, lien payoffs) until it's done.
- **Assemble** — the mechanical no tool does (separate-statement table, trial
  binder, MC-350 packet index).
- **Surface** — one quiet digest of what actually needs a human.
- **Train** — every action explains what / why / what-next, cites the rule, and
  carries the escalation line, so a junior paralegal builds real competency by
  working alongside it.

## The systems map (connect; never re-perform)

| Function                                                              | Who owns it                                       | Operator's role                                    |
| --------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| Matters, docs, tasks, calendar, trust, settlement statements          | **Smokeball** (system of record)                  | read/write via `mcp:smokeball`; the hub it watches |
| Court filing + service of process                                     | **InfoTrack** (production MCP)                    | stage + present; a human submits                   |
| Court-deadline calculation                                            | **LawToolBox / Smokeball-InfoTrack rules engine** | activate it, read its dates, chase; never compute  |
| Drafting (discovery responses; motions, chronologies, depo summaries) | **BriefPoint + CoCounsel**                        | stage inputs, route outputs; never draft           |
| PDF / Bates / exhibits                                                | **Adobe**                                         | assemble where it's a real gap                     |
| Medical records                                                       | **YoCierge → Smokeball**                          | observe + chase what's outstanding                 |
| Mail / calendar / inbound discovery                                   | **M365 / Graph**                                  | watch the inbox (the handoff gap); calendar        |
| Settlement math, legal analysis, valuation                            | **Smokeball native + attorney + CoCounsel**       | feed inputs + track; never compute/judge           |

**Entitlements are the firm's to specify** (we recommend defaults at onboarding —
see `ENTITLEMENTS.md`), per action class × connector. Recommended defaults today:
read / internal-write / firm-internal replies **autonomous**; client- and
tribunal-bound mail **draft-for-review**; signing and other commitments **never
autonomous**; unconfigured = **fail-closed (refused, not drafted)**. The only things
_not_ on the firm's dial are the integrity controls (irreversibility ban on money
movement / ledger posting / court filing + the prompt-injection taint-gate). Send is
one ordinary entitlement among peers — never the centerpiece.

## Delivery model — day-one architecture, not deferred phases

- **Architecture spans the full lifecycle from day one** (her requirement). The
  connective pattern above is uniform across phases, so it's built broadly, not
  sliced into a Phase-1/2/3/4 roadmap.
- **Activation is gated by external seams coming live**, not by us holding back
  scope: Smokeball connect/approval → reads → chase/staging skills → M365 (inbound
  email) → InfoTrack MCP → CoCounsel picture (post-Fri) → rules-engine activation.
- **Validation is per-matter** ("test and tune," already communicated to Christa):
  each capability proves out on real A&P matters as they occur. Discovery is the
  entry point — her call, and where the slippage is worst.

## The litigation-lifecycle scope at a glance (what the connective layer does per phase)

- **Complaint / initiation** — capture service confirmations (InfoTrack), trigger the
  responsive-pleading deadline (rules engine), chase the filing/service steps.
- **Discovery** — capture served discovery (inbox + matter), trigger response
  deadlines, stage for BriefPoint/CoCounsel, chase client verifications (her #1
  slippage), track propounded discovery, assemble separate statements (her #3),
  drive the meet-and-confer / compel windows.
- **Motions** — stage packages, format/compliance checks, watch tentative rulings,
  stage CRS reservations + e-filing (InfoTrack).
- **Minor's compromise** — index the MC-350 packet, track GAL + hearing, chase liens
  for item 12, feed the settlement math (Smokeball computes).
- **Trial prep** — assemble exhibit/witness lists + binders (Adobe), stage brief
  skeletons for the drafting engines.
- **Mediation / settlement** — maintain the lien ledger + chase payoffs, feed the
  settlement statement (Smokeball), track 998/MSC deadlines.

Across all of it: the chase, the staging, the capture, the surfacing, the training.

## Where we are (2026-06-25)

- Research + verified synthesis done; redundancy pass done (cut everything an
  incumbent owns).
- **Smokeball connector write-cut SHIPPED** (events/tasks/folders; 33 tests green).
  Coupled overlay `action_classes` mirror pending (repo-switch go).
- Smokeball app config scopes corrected + saved.
- Firm questions culled to **one light confirm** (deadline-engine status).
- Client "revised plan" SHELVED until this alignment is approved.

## Doc index

- **`00-OVERVIEW.md`** — this file (big picture + delivery model + status). Read first.
- **`IMPLEMENTATION-PLAN.md`** — the active go-live sequencing (gate-sequenced
  milestone ladder, firm-input register, tracking model). **Current as of
  2026-07-04; start here for "what's next."**
- `BUILD-PLAN.md` — the pre-approval build plan (done; superseded for
  sequencing by the implementation plan; guardrails §3 still govern).
- **`CLIENT-PROPOSAL.md`** — the sent "Litigation Lifecycle Solution"; source
  of truth for what we owe.
- **`REDUNDANCY-AUDIT.md`** — current build posture (CUT/GATE/BUILD), firm-question
  cull, InfoTrack findings, phases reframe. **Most current detail.**
- `RESEARCH-SYNTHESIS.md` — verified research picture (its Bucket-1/phasing
  superseded by the audit).
- **`ENTITLEMENTS.md`** — the onboarding entitlement-configuration surface (firm
  specifies; we recommend defaults). Full action-class × connector matrix.
- `SCOPING.md` — earliest scoping (connector-map partly superseded; its
  "non-raisable floor" language predates this correction).
- `customer.yaml` — the provisioning artifact.

(The client reply is kept as a local working draft until the delivery model is
approved; it is intentionally not committed.)

## Open / next

- The one firm confirm (deadline-engine status) — folds into the revised plan.
- Overlay `action_classes` mirror (repo-switch go) to govern the new connector tools.
- Build-now connective set: chase skills, inbound-discovery capture (M365),
  staging/folder structure, separate-statement assembly (pending CoCounsel coverage
  Fri), wire `mcp:infotrack`.
- Then revise the client plan from this delivery model + the confirm.
