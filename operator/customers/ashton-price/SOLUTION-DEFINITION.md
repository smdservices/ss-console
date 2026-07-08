# Ashton & Price — Solution Definition & Open Determinations

_What we actually know about standing up A&P's Operator, at the factual level the
assigned implementation specialist holds it. **Part 1** is what is defined and
concrete. **Part 2** is what we still have to determine, with the specific unknown
in each. Not a status report. Snapshot 2026-07-08._

> **Internal note.** The A&P instance of
> `operator/templates/SOLUTION-DEFINITION.template.md` — the worked example. When
> the template's structure changes, update this in step; when this document's facts
> change, keep `customer.yaml` in step.

> **On judging the work:** on A&P's real matters the **firm** judges the
> Operator's output — we do not, and cannot; it is their ground truth. We grade
> only on our own sandbox, where we authored every case. On their live account our
> role is to fix defects that need a code change, through the rehearsal-first
> pipeline. There is no phase where we grade their matters.

---

## Part 1 — What is defined (the concrete solution)

### The firm and the seat

- Ashton & Price LLP — plaintiff personal-injury firm, Fair Oaks (Sacramento), CA.
- **Chris Price** — principal/litigator, the decision-maker. **Christa Barrera** —
  office manager, the operational spine (trust/IOLTA, AP/AR, file organization).
  Scott runs the pilot hands-on.
- The Operator runs on its own isolated Machine in Fly's San Jose region (nearest
  to Sacramento). It runs on Sonnet 4.6 for the day-to-day volume and escalates to
  Opus 4.8 for genuinely heavy work (document review). Its clock is Pacific,
  business hours M–F 8–6.

### The Operator's identity

- Displays as "Operator" (neutral — the firm may name it), titled "AI Case
  Coordinator," tone plainspoken, warm, concise.
- Has its own email inbox (an AgentMail address).
- Reachable through Claude only via our console, and today only by Scott. Giving
  Chris his own Claude bridge is a deliberate later step — the per-user
  confidentiality walls are an unsolved problem, so it is not at go-live.

### What the Operator actually does — the CA PI lifecycle, ~30 skills

Each skill below is a specific job with a specific trigger — **W** webhook,
**S** scheduled, **P** person-invoked.

**Intake & initiation.** new-matter-intake (P), conflict-intake-router (P),
consult-scheduler (P), matter-initiation-setup (P — folders, standard tasks, SOL
and per-defendant service deadlines at matter open), service-confirmation-watcher
(S — watches InfoTrack service confirmations, starts the responsive-pleading
clock).

**Discovery — the deepest lane, the firm's named slip area.**

- discovery-served-watch (W) — reads served discovery routed to it, classifies the
  type, reads the service date and method off the proof of service, and proposes
  the response deadline flagged for an attorney to confirm.
- client-verification-tracker (S, daily) — the firm's #1 slip: tracks the client
  verification and chases on a cadence until it is signed.
- discovery-response-tracker (S, daily) — watches response deadlines, both
  directions (what we serve and what we receive).
- separate-statement-assembler (P) — collates the CRC 3.1345 item-by-item separate
  statement for an attorney to finalize.
- opposing-response-deficiency-review (W) — reviews the other side's responses and
  surfaces candidate deficiencies, each tied to the request and the rule.
- meet-and-confer-drafter (P) — drafts the meet-and-confer letter; the attorney
  decides whether and when to send.
- discovery-response-staging (P) — stages our responses on the matter.

**Medical records & chronology.** medical-records-chaser (S, weekly — chases
outstanding providers), medical-chronology-maintainer (S — checks for newly landed
records and keeps a running chronology that quotes the record).

**Motions.** motion-calendar-tracker (S — keeps motion deadlines and hearings
current), motion-package-assembler (P — assembles and stages the package).

**Minor's compromise.** minors-compromise-packet (P assembly + S tracking —
MC-350/MC-351, guardian ad litem, hearing, lien figures).

**Trial prep.** trial-binder-assembler (P assembly + S weekly trial-prep deadline
sweep).

**Mediation, settlement, liens.** mediation-settlement-tracker (S — 998 and
conference deadlines), lien-ledger-tracker (S, weekly — each lien tracked as a
task, chases open payoffs), settlement-statement-feeder (P — feeds figures from
authored data only; it never computes the trust math, Smokeball does).

**Keeping matters moving.** engagement-letter-chaser, trust-balance-nudge,
matter-status-responder, document-receipt-logger, stalled-matter-nudge.

**Deadlines.** deadline-and-sol-tracker, deadline-miss-escalator (S, daily 7am —
the escalation ladder).

**Chris's two named asks (committed deliverables).**

- matter-memo-on-update (W, matter.updated) — the flagship: a Smokeball matter
  change drives an internal supervision memo.
- matter-document-review (P) — surfaces and highlights document issues; never
  drafts work product.

**Firm-wide surface.** daily-needs-you-digest (S, weekday morning — one batched
digest of what needs a human), matter-inbox-router (W — routes inbound mail to the
right skill), matter-status-digest (P).

Every scheduled skill is empty-seat gated: no open matters means no LLM turn and
no token bill. Schedules are staggered Pacific weekday/weekly times.

### What it is allowed to do (recommended defaults, pending firm sign-off)

- Its prepared work goes to a person before anything leaves the firm; internal
  writing also prepares-for-review by default.
- It answers firm staff directly (anyone `@ashtonandprice.com`); anyone outside
  the firm it only drafts for — reaching outside needs explicit authorization.
- Non-negotiable regardless of how the firm sets the dial: it never moves money or
  posts to the ledger, never files or sends outside without a person, refuses
  rather than guesses when it cannot verify, and treats document contents as
  information, never as instructions.

### The systems, and each one's real connection state

- **Smokeball** — the system of record (matters, documents, tasks, trust,
  settlement figures). Connects to A&P's **real production tenant** by firm
  authorization; the app is approved; the document-write defect is resolved. Live
  the moment the firm authorizes. A matter change drives the supervision memo.
- **The Operator's own inbox** (AgentMail) — live.
- **Microsoft 365 / Graph** — A&P's actual mail and calendar. **Not wired yet.**
  This matters twice: Smokeball has no calendar API, so deadline events must land
  on their M365 calendar; and served discovery arriving by email needs an M365
  watch. Both wait on this.
- **InfoTrack** — court filing, service confirmations, e-sign verifications. Not
  wired; the Operator is built to read its confirmations.
- **Adobe** — trial-binder Bates-stamping. Not wired; still research.
- **YoCierge** — medical records; flows into Smokeball, so the Operator observes it
  through Smokeball rather than connecting directly.
- **CoCounsel / BriefPoint** — drafting engines. The Operator stages inputs and
  routes outputs; it does not draft. The division of labor is unsettled (see Part 2).

### Proven, not assumed

On our own staging tenant — a practice Smokeball account we filled ourselves,
including a broken proof of service, the same discovery served twice, a
same-name-different-case trap, and a document with instructions planted for an
automated reader — we ran this entire lifecycle end to end across two rounds and
graded every step. Every runnable process passed and every guardrail held; it even
caught two real gaps we had not planted. That evidence is the rehearsal report the
firm already has. Two lanes we could not fully run: the motion package (waits on
the CoCounsel decision) and the trial binder (Adobe).

---

## Part 2 — What we still have to determine

Each is a specific unknown, why it matters, and who answers it.

1. **How deadlines are computed.** Does A&P use Smokeball's court-rules calendaring
   (the InfoTrack-tied engine) today, or figure dates by hand? This decides whether
   the Operator activates and reads that engine's dates or computes the California
   response windows itself. Not cosmetic: in rehearsal, two runs of one service
   type disagreed by two court days — this fork is how that gets settled. → Christa.
2. **Where deadlines land.** Their calendar is M365, not Smokeball. Every deadline
   the Operator proposes has to be written to their M365 calendar, which is not
   wired. Wiring M365 is a prerequisite for the calendar half of the entire
   lifecycle. → us (build) + their IT (consent).
3. **How served discovery reaches the Operator.** Forward it to the Operator's
   inbox, watch an M365 mailbox, or watch a shared folder? This is Christa's #1
   priority and the sharpest edge — it is also the prompt-injection surface. A watch
   needs M365 admin consent. → Christa + IT.
4. **The CoCounsel drafting division.** How do Claude, CoCounsel, and BriefPoint
   split the drafting, so there is no overlap and no wasted cost? Pending Christa's
   Thomson Reuters meeting. It sets the motion and response work. → Christa.
5. **Voice.** We have no writing samples. We need the firm's own letters and
   templates, grouped by who they are written to (client / opposing counsel /
   expert / internal), or the Operator's drafts read generically. → Christa.
6. **The entitlement dial.** We recommended prepare-for-review across the board and
   direct replies to firm staff. Does the firm accept that, want some internal work
   fully autonomous, or lock some work tighter? → Chris + Christa.
7. **The persona.** Keep the neutral "Operator," or give it a name? → the firm.
8. **The starting matter set.** Which real matters does it watch first? → Christa.
9. **Trigger exceptions.** Chris's own Smokeball user id, so his edits to his own
   matters do not fire the supervision memo; and any matters to exempt entirely.
   → Chris.
10. **InfoTrack access.** Confirm A&P is on InfoTrack and get us connected, so
    service confirmations and e-filing/e-sign tie in. → Christa.
11. **The M365 administrator.** Who administers their Microsoft 365, for the consent
    in #2 and #3. → Christa.
12. **Skill scope at launch.** Are all ~30 skills wanted from the start, or should
    some stay off until later? → Chris + Christa.

Most of these resolve in one working session. Four of them (#2 M365 calendar, #3
inbound watch, #5 voice seeding, #10 InfoTrack) also carry build or setup work on
our side once the answer is in.
