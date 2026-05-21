# Business Analyst Perspective — Round 1

## Stance on existing material

**REFINE.** Architectural primitives are sound: reviewer-as-sender, three trust ceilings, closed-loop posture, customer.yaml as single source of truth. Underspecified is operational fit at the customer site once the runtime is up — how work moves through the firm on day 14, who touches what when something breaks, what compliance asks for that the packet doesn't yet support, what happens when the customer's tooling is shaped differently than the connector list assumes.

## What's right

**Paralegal-as-co-buyer (law-firm §3 P2 / §11.8).** Biggest small-firm AI adoption risk is paralegal non-adoption. PRD names it, splits calibration time (90min P vs 4-6hr M, §11.9), assigns memory curation to paralegal. Most failed rollouts die here; correctly addressed.

**Reviewer-as-sender as workflow primitive.** Platform §9.2 + law-firm §11.6 treat it architecturally. Maps onto existing flow: paralegal drafts → partner reviews → partner sends. Fits existing workflow rather than asking firm to invent one.

**Third-rail map (law-firm §5).** Trust accounting, citation-bearing drafts, court filing, settlement authority correctly walled off — the four places misfires produce bar grievances.

**PR #831 dashboard-roles.** Three-role matrix with operator-limited-approval is right shape — paralegal does most work, partner stays on judgment-bearing skills, outside counsel reads audit without touching drafts.

**PR #831 decommission-drain + compliance-evidence-packet.** Off-boarding as runbook-grade compliance op with drain window, signed PDF, plain-language README before raw evidence. Most packets fail leading with JSON; this leads with narrative.

## What's wrong

**Connector list assumes tooling real PI firms don't always have.** Law-firm §7.2 pre-builds Filevine/SmartAdvocate/Clio/CASEpeer/Neos/MyCase/Litify — reasonable for _modernized_ firms. Meeting firm is 20 years old; realistic shapes include Needles (acknowledged dead-end), homegrown Filemaker DB, paper + Outlook + Dropbox + PracticeMaster for billing, or Clio bought reluctantly and unused. 7-day adapter fallback is good, but the most common reality — _firm has no working PM system_ — is unaddressed. Different demo, not a connector problem.

**Morning-digest delivery breaks litigation schedules.** Platform §12.3 + law-firm §11.8 assume 8am digest is the partner's primary touchpoint. A 20-year PI litigator has depositions at 9am, court all morning, in front of a juror, not their phone. The 8am-from-phone loop is a knowledge-worker-from-laptop assumption. Need configurable cadence (8am / lunch / EOD), weekend catch-up, email-reply ingestion so partner approves via reply not dashboard.

**4-6 hour paralegal calibration is impractical at signing firms.** Paralegals at $300k-settlement firms carry 80-150 active matters; half a day off-queue means client work doesn't ship. Paralegal sits 90 minutes, defers rest, calibration completes in slivers over 3 weeks. PRD assumes contiguous time the role doesn't have.

**Sent-folder-watching opt-out + slow learning convergence.** Default opt-out (correct privilege posture) means voice learns from rejection signals + direct-teach only. Slower convergence than PRDs assume; blind-test gate may stay un-passed at week 4. Synthesis theme 10 acknowledges fallback but doesn't fold it into renewal timeline.

**Partner-side workflow when something breaks is missing.** Partner taps "flag" on a misclassified hostile-counsel email — then what? One-shot correct (closes loop)? Item to paralegal queue (delayed)? Highest-value learning signal — partner-caught misses — has no specified path.

**Audit-log queries don't match what real auditors ask.** Packet handles "what did the agent do over period X." Counsel asks: "every draft for matter #1234 between settlement and disbursement," "every memory rule mentioning OC Jones," "every citation-refusal fire." Audit tab filters by date/skill/event-type, not by matter or person. Packet is CSV; counsel wants targeted views.

**Skill-version pinning deferred to Phase 4 doesn't fit beta-1.** A firm three weeks into voice calibration won't tolerate a `memory-curator` update changing diff classification. Single-version + control-plane disable is insufficient — disabling mid-beta is a customer-day event.

## What's missing

**Paralegal-to-paralegal handoff.** Most $300k firms have 2-3 paralegals splitting matters; when Maria is out, Karen picks up. Dashboard is single-operator — no per-paralegal queues, reassignment, or PTO delegation. Calibration in §11.9 produces a config only Maria can operate.

**Intake from the receptionist.** Real PI intake also arrives via walk-in, referral phone to partner mobile, 2am answering-service handoff. Receptionist — operationally first touch at larger firms — isn't a configured user.

**Court-bound deadline coordination beyond tracking.** Deadline-docketer surfaces deadlines but doesn't coordinate the _multi-party scheduling_ (partner picks dates, paralegal emails OC, invites sent, court confirms). Most missed deadlines fail in coordination, not awareness.

**Email-reply correction ingestion.** Partner under court pressure interacts via inbox reply, not dashboard. No path to ingest "yes, send a reminder" as workflow continuation rather than chat.

**After-hours/weekend posture.** What does Marcus do at 11pm Saturday on an urgent client email? Customer.yaml has `business_hours` but no specified boundary behavior. The existing answering-service handles this today; agent's role at that boundary is unspecified.

**Per-matter close-out (vs. per-customer decommission).** When a PI matter settles and disburses after 18 months, what happens to its accumulated memory, lien-tracker state, medical-chronology spreadsheet? Active vs. closed-matter retention isn't addressed; firm has 7+ year malpractice obligations.

**Rule-with-exception handling.** Paralegal teaches "no medmal under $1M"; top referral source sends a $750k medmal. Marcus rejects per rule; referral partner is offended. "Apply rule but flag unusual context" capability is missing. Rules are absolute; contextual judgment is the missing layer.

**Voice degradation response.** Quarterly LLM-judge sample detects drift, but _response_ workflow (re-run blind-test? Captain session? cost?) is unspecified. Most voice products fail at the 90-day mark.

**Multi-firm referral relationships.** Some senior PI lawyers carry co-counsel ties. Marcus is in Firm A's instance; Firm B lawyer emails are workflow-essential, not opposing-counsel-blind. `domain_blocks` handles shutout, not "treat Firm B as in-scope without adding their lawyers as users."

## Operational risks ranked

1. **Paralegal non-adoption from calibration fatigue + workflow displacement.** 4-6hr calibration collapses to slivers; paralegal misroutes intake just-different-enough, ignores queue, partner loses credible drafts, renewal fails. Mitigate: 4 × 90-min sessions over 2 weeks; "assistant not replacement" framing; weekly digest of "what only Maria can do."

2. **Connector reality differs from Tier-1 pre-build.** Firm reveals Needles + Outlook + paper + billing spreadsheet; 7-day Filevine adapter is irrelevant. Mitigate: discovery probes actual day-to-day stack first; ship a "no PM system" demo mode on email + Outlook + DocuSign + QuickBooks alone.

3. **Partner timing mismatch — 8am-from-phone doesn't fit court days.** Partner opens digest at 4pm; SLAs expire; flagged items pile; partner perceives agent as noisy. Mitigate: configurable cadence, email-reply approval ingestion, "off today" inbox-set mode.

4. **Voice drift without calibration relationship.** Day 1 passes 82%; day 90 LLM-judge shows 35% AI-likely; recalibration burns 2 partner hours; renewal sours. Mitigate: voice maintenance as contractual obligation via Captain hours; quarterly 30-min tune-up baked into SKU.

5. **Compliance question the packet can't answer.** Counsel asks per-matter cross-skill audit trail; CSV doesn't support without 2hr custom report; ≤60s SLA violated. Mitigate: per-matter audit drill-down as first-class dashboard view in v1; test packet against hostile-counsel question list before customer #1.

## Workflow map — what the team should have

Day-2 operations with handoffs. `P`=Partner, `M`=Paralegal, `R`=Receptionist, `C`=Compliance, `A`=Agent.

```
INTAKE
  Walk-in/phone-in     → R logs Lawmatics → A picks up
  Form submission      → A direct → drafts triage + conflict-check
  Existing-client call → R routes to M/P → A surfaces matter context
  Co-counsel referral  → P inbox/mobile → A flags, drafts thank-you, opens prospect
  EXC (rule-override): referral source sends rule-violating case
    A flags "override candidate — needs partner override on file"
    P sets per-source exception in Memory tab → A absorbs → proceeds

MATTER OPS (daily)
  Email arrives    → A triages + drafts → P drafts folder
  P reviews        → 8am/lunch/EOD → P sends from own account → A captures sent-diff if opted-in
  M reviews queue  → 9am → approves operator-class → drafts to P drafts
  M edits memory  → weekly → A absorbs rules immediately
  P forgets dl     → A surfaces in digest → P taps approve from phone
  EXC (partner caught miss at 4pm from phone):
    P replies to flag email "no this is opposing counsel"
    A ingests email-reply as correction → re-classifies → M sees in weekly memory digest

SIGNING + DOCS
  P sends engagement   → A monitors envelope
  No response 48h      → A drafts reminder → M reviews/sends
  Multi-party signing  → A tracks per-party → M sees stalls in Queue
  Doc arrives via email→ A matches checklist → M confirms
  EXC (signed-scan outside DocuSign): A surfaces "confirm receipt" → M marks checklist

DEADLINE COORDINATION (where misses actually happen)
  Court sets hearing → P calendar invite → A reads, extracts cascade
  Discovery served   → P/M logs PM → A calculates response deadlines
  Schedule with OC   → P/M emails OC → A drafts email, P reviews
  Hearing conflicts  → A flags 14d out → P resolves → A absorbs

CLIENT COMMS
  Anxious 3rd email → A drafts warm ack → P sends OR escalates to M for phone
  Routine update    → A drafts from matter → M sends OR flags "need P input"
  EXC (after-hours):
    A drafts ack marked "Monday review" → no send until business hours
    IF urgent keywords (deadline/court date) → A pages P via SMS per customer.yaml

SETTLEMENT + DISBURSEMENT
  Settlement reached → P enters gross + terms → A assembles draft statement
  Liens open         → A holds net → surfaces all open liens to M
  Lien resolved      → M records → A updates → P reviews/signs
  Disbursement       → P or P+CPA via LawPay → A NEVER touches; logs from connector
  EXC (matter close-out): A archives memory to closed-matter retention; out of active queue;
    audit log retains for full retention period

PARALEGAL HANDOFF
  M sets OOO in customer.yaml.users[Maria].status → A reroutes operator drafts to Karen
  Karen sees context (open matters, recent corrections, pending) → reviews per Maria's pattern
  M returns → A re-routes → M sees "Karen handled N items" digest

AFTER-HOURS
  Inbound 6pm-7am → A drafts normal cadence → queue holds → no send until business hours
  Urgent keywords → A pages P via SMS → P decides handle now or queue
  Weekend         → P opens Sunday eve → A presents "weekend digest"

COMPLIANCE
  C requests packet  → from Audit tab → A delivers via compliance-evidence-packet flow
  C targeted query   → "memory rules mentioning Jones" → A renders drill-down (MISSING)
  C substrate proof  → A shows boot-check / citation-refusal / fabrication-filter logs
  EXC (ethics inquiry mid-engagement):
    C requests audit lockdown → P/M sets engagement pause-active → A halts new drafts, retains logs

DECOMMISSION
  P decides terminate → P/M initiates from Audit → 7-day grace period
  Captain confirms    → bin/decommission-customer.sh → drain → exports → substrate deletion
  P receives signed PDF + 30-day archive download link
```

The two workflows PRDs don't yet model: **referral-source exception** (rule-with-override) and **paralegal handoff** (multi-operator continuity). Both common at firms with 2-3 paralegals and an active referral network — the buyer profile.

---

_End — Business Analyst Perspective, Round 1_
