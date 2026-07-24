# Ashton & Price — Research Synthesis (the clear-eyed picture)

Output of the 2026-06-25 research session: 19 agents (7 legal phases each
adversarially verified against primary sources, 5 stack areas cross-referencing
our repo + vendor docs). This is the authoritative picture; it supersedes the
connector-map assumptions in `SCOPING.md` where they conflict (noted below).
`REVISED-PLAN-draft.md` stays shelved — we respond to Christa only after this is
Captain-settled.

Raw structured output: the workflow result file (367KB) — see the session
transcript. This doc is the judgment layer on top of it.

> REFINED by `REDUNDANCY-AUDIT.md` (2026-06-25, later same session): a "does an
> incumbent already own this?" pass re-tagged Bucket-1 (much of it was
> belt-and-suspenders), corrected the deadline lane (activate the existing
> LawToolBox/Smokeball-InfoTrak rules engine + chase — never compute or audit),
> culled the firm-question list to one light confirm (Christa's email already
> answered the rest), and dropped the "Phase 1/2/3/4" delivery labels (the
> architecture spans the full lifecycle from day one — her requirement; only
> activation is external-seam-gated). Read REDUNDANCY-AUDIT for the current build
> posture; the phasing and Bucket-1 numbering below are superseded.

---

## 1. The architecture verdict (what the research changed or sharpened)

**a. Smokeball-as-hub holds, and it is even stronger than we thought.** InfoTrack,
YoCierge, BriefPoint, and Smokeball E-Sign all import into / draw from the
Smokeball matter. The Operator watches one surface for most signals. Two
corrections to `SCOPING.md`:

- **Smokeball HAS a calendar/Events API** (create/update non-recurring; recurring
  read-only; no delete). So "consolidate deadlines into Smokeball" does not strictly
  depend on M365. Earlier SCOPING said no calendar API — wrong.
- **Smokeball has far richer webhooks** than the single `matter.updated` we
  subscribe (file-added, task, event, memo events). `files.updated` is the keystone
  for hub-watching.

**b. The genuine Smokeball blind spot is inbound email, not calendar.** Discovery
arrives by email (and physical mail) before it's filed. Closing that "handoff gap"
needs **M365/Graph (Track E)** — fully doable app-only with mailbox scoping, but
not yet runtime-wired and gated on firm IT actions.

**c. InfoTrack ships a production, agent-grade MCP server.** This is the standout
finding. E-filing + service-of-process + Smokeball E-Sign all run through InfoTrack,
which is directly integrable (OAuth2 MCP) with a present-orders → attorney-confirm
gate. Consequence: we do **not** integrate Tyler/Odyssey eFileCA directly (that
requires becoming a certified EFSP — infeasible). **We ride InfoTrack.** The entire
filing/serving lane moves from "guide-through / unknown" to "directly integrable,
human-gated."

**d. Our `mcp:smokeball` connector is the bottleneck, and it's ours to fix.** It
exposes ~26 reads + `create_memo`. The Smokeball API supports calendar/event
writes, task writes, folder writes, and the richer webhooks — our connector does
not expose them yet. These are **build gaps in our code, not vendor limits.** This
is the unblocked foundation everything else sits on.

**e. The drafting engines are orchestrated around, never through.** BriefPoint has
no API (folder-based, human-run). CoCounsel Phase-1 is a one-way Smokeball→CoCounsel
push with no Operator-facing API and manual return-to-matter; it is SKU-dependent
and deferred pending Friday's eval. The Operator stages inputs into the matter
folder and picks up outputs — exactly the lane we communicated.

## 2. Verification corrections (bake these in; do NOT ship the originals)

- **Medi-Cal reduction math — MATERIAL ERROR in the raw research.** W&I §14124.78
  is **not** a "50%-of-net cap." Verbatim, .78 caps DHCS recovery at the
  beneficiary's **net** recovery (after fees/costs) — effectively 100% of net — and
  where .78 governs, the §14124.72(d) reductions do **not** also apply. The real
  mechanical reductions: §14124.72(d) = 25% fee reduction + pro-rata litigation
  costs; §14124.78 = cap at net. **Encoding a 50%-of-net Medi-Cal cap would
  systematically underpay/miscalculate.** (The hospital-lien 50%-of-net is a
  separate rule; confirm Civ. Code §3045.x before encoding.)
- **CCP §1005(b) overnight/express delivery = +2 _calendar_ days, not +2 court
  days.** (Electronic +2 court days is CCP §1010.6; mail +5 calendar in-state.)
- **Sacramento local-rule specifics are UNVERIFIED** — saccourt.ca.gov returns 403
  to automated fetch. Every Sacramento local number (law-and-motion reservation
  procedure + phone numbers, ex parte cutoffs, MSC offsets LR 2.92–2.99, minor's-
  compromise dept) is corroborated only by secondary sources. Must be confirmed
  from the canonical PDF or clerk before any client reliance. (Becomes a research
  to-do, below.)

## 3. Connector reality

| Connector              | State                                    | What it unlocks                                                   | Gap to close                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp:smokeball`        | **Live**, reads + create_memo            | matters, contacts, tasks, docs, trust, file-arrival detection     | **Build:** calendar/event writes, task writes, folder writes, richer webhooks (files.updated keystone). API supports all.                                                                       |
| `mcp:infotrack`        | Vendor MCP exists                        | e-filing, service of process, E-Sign — staged, attorney-confirmed | Firm Partners-Portal creds; verify tool surface + that `confirm_orders` is permission-withholdable for the fail-closed gate                                                                     |
| M365 / Graph (Track E) | **Not wired**                            | inbound-email discovery watch, calendar consolidation             | Architecture call: BUILD adapter vs hosted MCP (subscription-to-our-webhook favors BUILD); overlay materializer gap (#1055/#1056); firm IT (Entra app reg + admin consent + RBAC mailbox scope) |
| BriefPoint             | Folder-based, no API                     | written discovery responses                                       | None to build — orchestrate around it (stage in / pick up out)                                                                                                                                  |
| CoCounsel              | Phase-1 one-way push                     | broader drafting                                                  | Deferred — post-Friday eval + Smokeball×TR briefing; SKU-dependent                                                                                                                              |
| Adobe PDF Services     | Buildable (server-to-server OAuth)       | combine/split/OCR/stamp for exhibits + records                    | No native Bates (build adapter or desktop); PHI-to-cloud data-retention decision                                                                                                                |
| Acrobat Sign           | Buildable, **human-gated**               | signature status tracking                                         | Send-for-signature is outbound = attorney-gated; confirm firm even uses it vs Smokeball E-Sign                                                                                                  |
| Dropbox                | API + official remote MCP (beta)         | place/retrieve shared files                                       | Grant read/write, **withhold `sharing.write`** (outbound links human-gated); verify MCP supports headless + whether it exposes sharing                                                          |
| YoCierge               | Sales-gated API or observe-via-Smokeball | medical-records status                                            | Decide build:yocierge vs observe-only; needs sandbox token                                                                                                                                      |
| Green Filing           | No API; maybe unused                     | —                                                                 | Confirm firm even uses it (likely consolidate onto InfoTrack)                                                                                                                                   |

## 4. The one load-bearing question

**Does A&P already run an automated court-rules/deadline calculator** (Smokeball's
InfoTrack court-rules calendaring, or LawToolBox)? This recurs across nearly every
legal brief and **materially changes the build**: if yes, the Operator's deadline
value is **verify + chase**, not **compute**; if no, the Operator originates the
dates. Everything in the deadline lane forks on this. Ask first.

## 5. BUCKET 1 — Build now (confident, unblocked)

Recommended sequence — start with the foundation that's entirely in our control:

1. **Smokeball connector build-out** (`operator/connectors/smokeball`): add
   calendar/event writes, task writes, folder writes, and subscribe the richer
   webhooks (files.updated keystone, task._, event._, memo.\*). Unblocks most of
   Phase 1. Verify writes against A&P's live prod tenant at connect (a staging
   doc-write blocker was noted historically).
2. **Separate-statement assembler (CRC 3.1345)** — pure column assembly from stored
   discovery; highest-leverage discovery-enforcement value; mechanical; no external
   block. (Leave the "factual/legal reasons" block for the attorney — confirm that
   boundary with the firm.)
3. **The 45-day compel-further clock + the discovery-response clock** — deterministic
   once the CCP statutes are primary-source-pinned (Bucket 2) and the compute-vs-
   verify question is answered. Calendar both extended and unextended dates to be safe.
4. **Client-verification tracker + chaser** — her #1 slippage; high-confidence;
   completion inferred from the signed doc landing in the matter (files.updated).
   Calibrate the chase cadence once we know how they collect signatures.
5. **Lien ledger + chase + statutory deadline tracking** — the ledger/dunning/
   deadline spine is high-confidence and unblocked. Apply the **corrected** Medi-Cal
   math; gate the reduction calculator on the primary-text confirmation.
6. **Medical-chronology maintainer** — records land via YoCierge→Smokeball
   (observable); use Adobe OCR for scanned sets (pending the PHI-to-cloud decision).
7. **Minor's-compromise packet assembler (MC-350)** — significant for the firm;
   mostly mechanical assembly + a deadline/GAL/blocked-account engine; high-
   confidence once a redacted exemplar and the Sacramento dept are confirmed.

Cross-cutting from day one: **the paralegal-training output property** (every skill
explains what/why/next + cites the rule + carries the escalation line) and
**quiet-by-design** batching.

## 6. BUCKET 2 — Needs our own further research

- **Primary-source-pin the CA deadline statutes before shipping any computed date:**
  CCP §2030.260 / §2031.260 / §2033.250 (30-day base), §1013 (+5 cal mail) / §1010.6
  (+2 court days e-serve), the 45-day compel-further windows (§2030.300(c) etc.),
  §437c (81-day MSJ), §1005 (16 court days), §12/§12a rollover. Several were not
  fetched from leginfo this round.
- **Sacramento local rules from the canonical PDF / clerk** (saccourt 403'd
  everything): law-and-motion reservation procedure + numbers, ex parte cutoffs, MSC
  offsets (LR 2.92–2.99), minor's-compromise dept assignment, IDC posture, current
  mandatory-vs-permissive e-filing status.
- **Hands-on Smokeball API test** against A&P's tenant: task/event/folder writes,
  the webhook event catalog + `files.updated` payload shape (does it carry folderId/
  type to classify the source vendor?), UpdatedSince format (.NET ticks vs ISO).
- **Track E architecture decision** (BUILD adapter vs hosted MCP) + the overlay
  materializer gap (build:/OAuth-MCP not yet wired — reopen/re-scope #1055/#1056) +
  Graph subscription-renewal cron + webhook hardening (clientState, Graph IP ranges).
- **InfoTrack MCP tool surface** (once we have Partners-Portal creds): exact tools,
  params, and whether `confirm_orders` can be permission-withheld at credential/scope
  level for the fail-closed gate.
- **Vendor specifics:** Dropbox MCP (sharing/headless support → mcp vs build), Adobe
  data-retention/BAA terms for PHI, YoCierge API spec, BriefPoint CA output fidelity
  (needs a real sample), CoCounsel return-to-matter mechanism.
- **Confirm the verification flags against primary text:** Medi-Cal §14124.76/.78/.785
  verbatim; CMS Medicare day-counts (65/60/120/180) + thresholds; the practice case
  law (Sexton — 45-day jurisdictional; Appleton — unverified = no response; Golf &
  Tennis Pro Shop — objections-only nuance).

## 7. BUCKET 3 — Needs Christa / Chris (the forks that change the build)

- **The load-bearing one (above): do they already auto-calculate deadlines?**
- Default service method (electronic vs mail) per opposing party — drives all
  discovery math.
- How service method + date is captured today — structured field vs buried in a PDF.
  Determines whether the clock can be computed reliably at all.
- Where served discovery lands — which mailbox; Smokeball vs email. Drives the M365
  watch design (one shared discovery mailbox is cleanest).
- How client verifications are collected — portal / e-sign / paper; e-sign acceptable?
- Do they handle PI matters with **government defendants**? (build the GCA 6-month
  branch or not)
- Minor's compromise: mostly pre-suit (Prob. §3500) or in-suit (CCP §372 GAL)?
- Statewide or Sacramento-only? (per-court local-rule profiles)
- The **entitlement boundary**: Operator stages vs submits for e-filing/serving —
  the central authority decision. (Default: stage, named attorney confirms.)
- Volume per month (discovery responses / motions to compel / minor's / liens) and
  lien mix — sizes where to invest first.
- Who is the named reviewer/approver per draft, and expected turnaround before a
  deadline.

## 8. FIRM TO-DO LIST (lead-time / firm-only — surface these with the response)

Critical-path ordered. These have a clock or are firm-only.

1. **Smokeball:** clear the 72-hr app review (submitted 06-24), then a firm
   authorizer (Christa or Chris) completes the OAuth consent via
   `bin/connect-smokeball.sh` → prod refresh token. Confirm plan tier is Prosper+
   (required for API + webhooks). _Gates go-live._
2. **Microsoft 365 / Entra (multi-step IT, real lead time):** admin creates an app
   registration (or grants admin consent to our multitenant app) → shares App/tenant
   ID, issues a client secret/cert; grants admin consent for Mail.Read,
   Calendars.ReadWrite; Exchange admin runs RBAC-for-Applications to scope access to
   only the discovery/attorney mailboxes. Decide which mailbox(es) to watch.
3. **InfoTrack:** create a Partners-Portal login (partners.infotrack.com), generate
   firm-owned ClientId/ClientSecret; name the authorized filing attorneys.
4. **Accounts + API access:** YoCierge (Record Retrieval API token + who signs HIPAA
   auths); Adobe (Developer Console project + PDF Services credential; confirm
   Acrobat Sign tier if used); Dropbox (scoped app + offline refresh token; set team
   shared-link policy to "team only"). Confirm whether Green Filing is even used.
5. **Sample work product (de-identified):** a real filing packet (complaint +
   SUM-100 + CM-010 + POS-010); an MC-350 exemplar (petition + order + blocked-
   account order); the firm's meet-and-confer + separate-statement templates; a
   BriefPoint CA discovery sample.
6. **Share from their meetings:** CoCounsel SKU + integration timeline (Fri 06-26
   TR eval) and the Smokeball×TR partnership briefing (next week).
7. **Data-handling decision:** is sending client medical-record PDFs to Adobe's
   cloud (OCR/assembly) acceptable, or do we keep sensitive assembly Machine-local?

## 9. Next actions (ours)

- [ ] Captain review of this synthesis + the compute-vs-verify question.
- [ ] Start Bucket-1 #1 (Smokeball connector build-out) — unblocked, foundational.
- [ ] Bucket-2 primary-source pin of the CA deadline statutes (small, gates the
      deadline skills).
- [ ] Only then: revise the client plan (REVISED-PLAN-draft.md) into the clear-eyed
      version and surface the firm to-do list to Christa.
