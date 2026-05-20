# UX Lead Contribution - PRD Review Round 1

**Author:** UX Lead Agent
**Date:** 2026-05-19
**Scope:** MVP / Phase 1 only (platform PRD §20 Phase 1; law-firm PRD §17 Phase 1)
**Source documents reviewed:** `platform-prd.md` v0, `law-firm-prd.md` v0, `CLAUDE.md`

---

## Overview

This contribution covers the UX surface area across the AI Employee product family — platform and law-firm vertical — from the perspective of interaction design, information architecture, user journey, and accessibility. The PRDs are architecturally strong and well-structured. The UX gaps are concentrated in three areas: (1) what's actually on each screen, content-block level; (2) first-time and daily user flows, which are described abstractly but not translated into screen-by-screen sequences; (3) edge and error states, which appear in the risk matrix but have no corresponding interaction design.

MVP scope governs all recommendations below. Phase 4+ dashboard tabs are not designed here.

---

## Target User Personas

### Margaret — The Litigation Partner (Buyer + Power User)

Margaret has run her PI firm for 22 years. She has tried over 200 cases and knows exactly how her office should run. She does not lack confidence in her own judgment — she lacks time and bandwidth for the supply chain of work that surrounds her judgment: the intake calls she has to screen, the signing-page emails she sends three times before a client responds, the status updates she writes at 7pm when she would rather be home.

Margaret is not a technology skeptic. She adopted Filevine when her old system stopped working. She knows what good software looks like: it does its job and stays out of her way. She does not read tooltips. She does not explore settings menus. If something requires more than three taps to complete, she stops and asks her paralegal to do it.

What Margaret needs from the dashboard: she needs it to be a morning ritual, not a tool. She opens it once, sees what needs her attention, approves what's ready, flags what isn't, and closes it in four minutes. She needs the agent's drafts to sound exactly like her — not close, not "good enough," but exact. The moment a client says "this feels off," the product is dead for her.

What kills Margaret on the product: any screen that requires reading. Any draft that uses an em dash. Any configuration step that takes more than 15 minutes. Any failure that reaches a client before she sees it. A dashboard that looks like software.

Margaret reviews drafts from her phone while waiting for a court call to start. She is not sitting at a desktop when she approves communications.

---

### Ramon — The Case Manager / Paralegal (Designated Operator)

Ramon manages 110 active matters across the firm. He handles intake screening, document collection, signing orchestration, and the steady stream of "where are we on this" from clients. He is exceptionally organized, and he has built his own systems — a spreadsheet for signing-page tracking, a folder convention in Filevine, a set of recurring calendar reminders for follow-ups.

Ramon is the person who will actually operate the dashboard every day. He is the one who will edit memory, train the agent on corrections, watch the queue. He is not threatened by the agent — he's seen enough bad software to know it won't replace him — but he is skeptical that it will actually reduce his workload rather than adding another thing to monitor.

What Ramon needs: a dashboard that replaces his spreadsheet, not adds to it. A queue that shows him exactly what's pending and what he needs to do. An obvious way to teach the agent when a draft is wrong. Scope controls that are visible and easy to set — he does not want the agent touching matters he has flagged as sensitive. A clear signal that the loop is closing: that the agent is actually getting better based on his corrections.

What kills Ramon on the product: a queue that grows faster than he can clear it. Corrections that don't stick. A settings screen he has to navigate to fix something that breaks. Any sense that he is spending more time managing the agent than the agent is saving.

Ramon lives in the dashboard. He opens it at 8:15am when he arrives, checks the queue after lunch, and reviews the day's activity before leaving. The dashboard is his workbench.

---

### Susan — The Compliance / Ethics Counsel (Auditor Persona)

Susan is not a regular user. She appears twice: during the initial engagement review, when she evaluates whether the firm can ethically adopt the product; and in the event of a bar inquiry or client complaint, when she needs to reconstruct what the agent did and when.

Susan is not hostile to AI, but she is disciplined. She will ask specific questions: What did the agent read? What did it draft? Who reviewed it? Was any client-confidential information shared with a model that could learn from it? What happens if this goes in front of a disciplinary board?

What Susan needs: a single compliance export she can hand to outside counsel. A readable audit log with timestamps and actor names. The DPA, clearly written, not a 40-page terms-of-service. A clear statement of what the agent does and does not do, with architectural controls she can cite.

What kills Susan on the product: audit logs that require technical interpretation. Ambiguity about what "closed-loop" means in practice. Any sign that the platform's privacy claims are marketing language rather than architectural reality.

Susan's engagement with the dashboard is episodic and read-only. She never edits memory. She never approves drafts. She may visit once or twice a year.

---

### Captain (SMD Operator)

The Captain operates the platform on behalf of customers. For UX purposes, the Captain's surfaces are the control plane (not the customer dashboard), but the Captain also operates the customer dashboard during the onboarding session. The Captain needs to be able to demonstrate every feature fluently, including error states.

---

## User Journey

### Day-1 Experience: Margaret and Ramon Sit Down for the Onboarding Session

**0:00 — Captain arrives at the firm.**

The firm has signed. Margaret and Ramon are in the conference room. The firm's Filevine tenant is on screen.

**0:05 — Captain opens the dashboard for the first time.**

Margaret sees a screen with the firm's name at the top, the agent's persona name ("Marcus"), a status line ("Not yet active — completing setup"), and a progress checklist with five steps: Voice samples loaded, Trust ceilings configured, Scope rules set, First digest scheduled, Go-live confirmed. Three of five steps are green (pre-completed by Captain before the session). Two are yellow.

This is the first screen Margaret has ever seen. It must communicate progress, not complexity. She is not evaluating features; she is evaluating whether this is going to be straightforward.

**0:10 — Voice tab (with Ramon, partner observes).**

Captain walks Ramon through uploading voice samples. The screen shows a simple upload area with a label: "Margaret's sent emails — upload up to 50." Ramon uploads a ZIP of sanitized outbound emails he prepared. The screen shows a counter: "22 samples loaded. 8 more needed to meet minimum." After the final batch: "32 samples loaded. Minimum met."

The test sandbox is visible but not yet active. Captain runs two scenarios: an anxious-client status update and a routine opposing-counsel email. Marcus drafts both. Ramon edits one. The screen shows the diff highlighted in yellow. A button: "Teach Marcus from this edit." Ramon clicks. A confirmation: "Got it. Marcus will apply this pattern to future drafts in this category."

Margaret reads the two drafts. She asks Captain to change the closing salutation. Captain navigates to Rules, adds the rule ("Close with 'Best' not 'Best regards'"), re-runs the scenario. Draft updates. Margaret nods.

This is the calibration session. Margaret's total time: 45 minutes, 10 scenarios, 2 rule edits. Ramon's: 3.5 hours, full scenario suite.

**End of Day-1 session:**

Margaret's view when she leaves: one screen showing "Marcus is ready. First digest tomorrow at 8am." One button: "Confirm and go live." She clicks it. She's done.

---

### Week-1 Experience: Margaret's Morning Ritual

**Day 2, 8:00am — Margaret's phone.**

An email arrives from marcus@firm.com. Subject: "5 drafts ready for your review — Tuesday." The email is the morning digest. It lists five items, each with a one-line summary. At the bottom: a single link — "Review in dashboard."

Margaret taps the link on her phone. The Today tab opens. She sees five cards in a vertical stack, each showing: recipient name, draft type (Status update / Intake follow-up / Signing reminder), and a one-line preview of the draft's opening sentence.

She taps the first card. Full draft opens. She reads. It sounds like her. She taps "Send." The draft moves to her Drafts folder in Outlook under her own identity. She will send it when she reviews her email, as she always does.

She taps the second card. Draft opens. She reads. One sentence is wrong — Marcus suggested a 30-day timeline she does not recall agreeing to. She taps "Flag for Ramon." Card is marked orange. Ramon will see it in his Queue.

Three minutes. Five cards. Two sent, one flagged, two deferred to desktop later.

**Day 3 — Ramon's morning.**

Ramon opens the dashboard at 8:15am. Queue tab. He sees 12 items: 7 ready for review, 3 flagged by Margaret (one of which is the mis-timed draft), 2 agent-flagged for attention.

He opens the flagged item. He reads Margaret's note (auto-populated from the flag action: "Incorrect timeline — check matter"). He opens the matter in Filevine, confirms there is no agreed-on 30-day commitment, returns to the dashboard, edits the draft to remove the timeline sentence, marks it "Ready to review." A notification goes to Margaret's digest queue.

He opens an agent-flagged item: a matter where a client has not responded to two signing requests in six days. The agent has drafted a third reminder and flagged it "Pending partner approval — escalation threshold." Ramon reviews, approves. Moves on.

Total queue review: 22 minutes.

---

### Week-4 Experience: The Loop Is Closing

By week 4, the morning digest has become background noise in the best possible way. Margaret opens it, scans five drafts, approves four in 90 seconds. The fifth gets a one-tap edit and goes out. She no longer reads every word — she skims and sends, because the agent has been right enough times that trust is accumulating.

Ramon has stopped using his signing-chase spreadsheet entirely. The Queue shows every pending signing envelope with days-since-sent. He doesn't have to remember to follow up.

The Memory tab shows 14 rules Marcus has learned. Ramon added 6 directly; 8 were distilled from Margaret's edits. One of the distilled rules reads: "Never reference a timeline unless it appears in the matter record." Margaret has not explicitly taught this — Marcus inferred it from the day-3 correction. Ramon reads it and confirms it is accurate.

The "what Marcus learned this week" section of the dashboard shows: "Based on 11 of your edits last week, Marcus refined voice on client status updates — removing timeline references not sourced from matter records." This is the loop-closing moment.

---

## Information Architecture

### Dashboard: 7-Tab V1 Surface

The dashboard is a single-page web app. Navigation is a fixed left rail with tab icons + labels. Content area occupies the right. No nested navigation in v1.

---

### Tab 1: Today (Primary user: Margaret)

**Purpose:** The principal's morning cockpit. Read and act in under five minutes.

**Content blocks:**

```
+-------------------------------------------------------+
| HEADLINE SUMMARY (weekly, auto-updated)               |
| "This week: Marcus drafted 47 replies, sent 42        |
|  with your approval, flagged 3 for review,            |
|  learned from 6 of your edits."                       |
+-------------------------------------------------------+
| ACTION QUEUE SUMMARY (counts only, tap to go to Queue)|
| [ 5 Ready for review ]  [ 2 Flagged ]  [ 0 Overdue ] |
+-------------------------------------------------------+
| PRIORITY CARDS (top 3 items from queue)               |
| Card: [Recipient] [Type] [1-line preview]  [Send] [Flag]
| Card: ...                                             |
| Card: ...                                             |
| [ View all 5 in Queue → ]                             |
+-------------------------------------------------------+
| RECENT ACTIVITY (last 24h, collapsed by default)      |
| "Yesterday: 4 sent, 1 rejected, 2 absorbed edits"     |
+-------------------------------------------------------+
| AGENT STATUS                                          |
| Marcus: Active | Connectors: 6 healthy, 0 down        |
| [ Pause all skills ]                                  |
+-------------------------------------------------------+
```

**Design constraints:**
- No data tables on this screen.
- Priority cards are the only interactive surface beyond the queue link and the pause control.
- No "hours saved" estimate. Platform PRD §12.3 is explicit: no soft estimates until 60 days of real data.
- Headline summary uses exact counts from audit log. Zero fabrication.
- Agent Status block should be visually minimal — a green dot and a connector health indicator. Only escalated to a warning state if a connector is down or a skill has failed.

**Interaction states:**
- Empty state (no drafts today): "Nothing pending today. Queue is clear." No filler content, no "check back later."
- First-login state (before go-live): Progress checklist replaces action queue summary.
- Connector-down state: Agent Status block shows warning — "Filevine is not responding. Drafts requiring matter data are paused." [See Error States below.]

---

### Tab 2: Queue (Primary user: Ramon)

**Purpose:** The operator's workbench. Everything that needs action.

**Content blocks:**

```
+-------------------------------------------------------+
| FILTER BAR                                            |
| [ All ] [ Ready ] [ Flagged ] [ Agent-flagged ]       |
| Sort: [ Age ▾ ] [ Skill ] [ Priority ] [ Matter ]     |
+-------------------------------------------------------+
| QUEUE ITEMS (list, most-urgent first)                 |
| Each item:                                            |
|  [ Status dot ] [Recipient] [Skill type] [Matter ref] |
|  [Age since drafted] [1-line preview]                 |
|  Actions: [Open draft] [Approve] [Flag] [Reject]      |
+-------------------------------------------------------+
| BULK ACTIONS (when items selected)                    |
| [ Approve selected ] [ Flag selected ]                |
+-------------------------------------------------------+
```

**Item status dot colors:**
- Green: ready for review, agent confidence high
- Yellow: agent-flagged (uncertain or escalation-threshold)
- Orange: flagged by reviewer
- Red: overdue (past configured escalation threshold)
- Grey: draft rejected, no further action required

**Draft detail view (tapped/clicked from queue item):**

```
+-------------------------------------------------------+
| DRAFT HEADER                                          |
| To: [Recipient name + email]  |  Matter: [ref]        |
| Skill: [inbox-triage-and-draft]  |  Drafted: [time]   |
+-------------------------------------------------------+
| DRAFT BODY (rendered, not raw text)                   |
| [Full draft text]                                     |
+-------------------------------------------------------+
| VOICE CONFIDENCE                                      |
| "No voice violations detected."                       |
| or: "1 potential voice issue flagged — [detail]"      |
+-------------------------------------------------------+
| WHAT MARCUS USED TO WRITE THIS                        |
| Sources: Matter record (Filevine), 2 memory rules,    |
|          3 voice samples                              |
| [Expand to see full context used]                     |
+-------------------------------------------------------+
| ACTIONS                                               |
| [ Send to Drafts folder ] [ Edit ] [ Flag ] [ Reject ]|
+-------------------------------------------------------+
```

**The "What Marcus used" block** is a critical trust-building element the PRDs imply but don't name. The partner and operator need to see that the draft is grounded in actual sources, not hallucinated. This block makes the sourcing visible. It is not a full citation list — it is a short plain-language list of what data was accessed. Expandable for the compliance use case.

**Design constraints:**
- Bulk approve should require confirmation if more than 5 items selected. The operator should not be able to approve 30 drafts with one click without seeing them.
- The "Edit" action opens an inline editor, not a separate page. Editing a draft stays in the queue view context.
- "Reject" should surface a one-tap reason picker: "Wrong approach," "No longer needed," "Out of scope." This feeds the rejection-signal learning loop (platform PRD §10.2).

---

### Tab 3: Memory (Primary users: Ramon + Margaret)

**Purpose:** What Marcus knows about the firm. Read, edit, delete, export.

**Sub-sections:**

```
+-------------------------------------------------------+
| WHAT MARCUS LEARNED THIS WEEK                         |
| (collapsed by default; expanded shows distilled rules)|
| "Based on 11 edits: updated voice on client updates"  |
| [ Review and confirm ] [ Dismiss ]                    |
+-------------------------------------------------------+
| HARD RULES (structured, editable)                     |
| Displayed as cards in a list                          |
| Each card: rule text | category | date added | source  |
| Actions: [Edit] [Delete]                              |
| [ + Add rule ]                                        |
+-------------------------------------------------------+
| PERSON MAPPINGS                                       |
| Similar card list                                     |
| Each card: name | role | notes | date added           |
| Actions: [Edit] [Delete]                              |
| [ + Add person ]                                      |
+-------------------------------------------------------+
| PROCESS KNOWLEDGE                                     |
| Narrative markdown, rendered                          |
| [ Edit (opens markdown editor) ]                      |
+-------------------------------------------------------+
| VOICE SAMPLES + RULES (link to Voice tab)             |
| "[12 samples loaded | 4 active rules] → Voice tab"    |
+-------------------------------------------------------+
| EXPORT                                                |
| [ Export memory as JSON + Markdown ]                  |
+-------------------------------------------------------+
```

**Memory rule card detail (editing a rule):**

This is the most critical interaction in the product. A busy paralegal needs to edit a rule quickly, without breaking something. The pattern:

1. Ramon sees a rule card: "We don't take cases more than 2 years post-incident in TX."
2. He taps "Edit."
3. The card expands inline (no modal, no navigation). A text field appears with the current rule text. A category selector. A toggle: "Active / Paused."
4. He edits, taps "Save."
5. A brief confirmation: "Rule updated. Marcus will apply this to future drafts immediately."
6. If the rule affects a broad category (e.g., a voice rule that affects all client drafts), a warning appears: "This rule applies to all client communications. Want to run a test draft to confirm the change?" Not blocking — he can dismiss.

**The editing pattern is: inline card expansion, no modal, no page navigation, immediate application, optional test.** The "optional test" button is the bridge to the Voice test sandbox. This is the fastest path for a busy operator.

**Editing via rule category — an alternative flow for Margaret:**

Margaret is not going to navigate to the Memory tab to add a rule she just thought of. She will be looking at a draft. The rule-add flow should be available from the draft detail view in Queue:

"While reviewing this draft, teach Marcus a new rule → [Add rule]" — this opens a lightweight inline form that lands the rule in Memory without leaving the Queue view.

**"What Marcus learned this week" section design:**

This section is the weekly learning digest in compressed form. It shows 2-4 summary lines derived from the memory-curator skill. Each line has two actions:

- "Confirm" — signals to the agent that this learning is correct; strengthens the rule's confidence.
- "Revert" — undoes the distilled learning; the rule is removed and a flag is added to the audit log.

If there is no learning to show (first week, or a week with no corrections), show: "Nothing new this week. Marcus learned from 0 edits." Do not hide the section — the empty state communicates that the loop exists, just had nothing to process.

---

### Tab 4: Audit (Primary users: Ramon + Susan)

**Purpose:** Full record of what the agent did. Exportable for compliance.

**Content blocks:**

```
+-------------------------------------------------------+
| SCOPE / AUDIT VIEW ("What Marcus saw this week")      |
| Filterable by: sender | folder | subject | date range |
| Table: timestamp | source | type | agent action       |
| Actions: [Mark thread agent-blind] [Export this view] |
+-------------------------------------------------------+
| FULL AUDIT LOG                                        |
| Filterable by: skill | trust ceiling | actor | date   |
| Table rows:                                           |
|  timestamp | skill | action | reviewer | outcome      |
| [ Export audit log ] — generates compliance packet    |
+-------------------------------------------------------+
```

**Scope/Audit View — "What Marcus saw this week":**

This is named explicitly in platform PRD §12.5 but has no interaction design. Here is the specific content:

Each row in the scope view represents one read event by the agent: an email thread scanned, a matter record accessed, a document opened. The row shows:

- Timestamp
- Source type (email / matter record / document / calendar event)
- Source identifier (sender name + subject line, or matter reference)
- What the agent did with it (read for triage / read for draft / read for conflict-check / flagged and did not read due to scope rule)

The "flagged and did not read" rows are critical for compliance confidence. They show that the scope rules are working. Susan can point to a row and say: "The agent did not read threads from opposing counsel because the scope rule blocked it." This is the audit trail that answers bar-ethics scrutiny.

The "Mark thread agent-blind" action adds the thread's sender/subject to the scope block list in real time. Ramon can do this from the Audit tab without navigating to any settings screen.

**Compliance export:**

The Export button for the audit log generates a package that includes:

1. The filtered audit log as CSV
2. The full memory rule set as JSON (at the time of export)
3. The DPA reference (a PDF link, not a full copy inline)
4. A plain-language summary: "During [date range], the agent drafted [N] communications, sent [N] with reviewer approval, read [N] sources, and declined to read [N] sources due to scope rules."

This summary is the artifact Susan hands to outside counsel. It should be readable by a non-technical lawyer. No JSON, no raw log data in the summary section.

---

### Tab 5: Persona (Primary users: Margaret, then Ramon)

**Purpose:** Configure the agent's identity — name, signature, avatar, tone.

**Content blocks:**

```
+-------------------------------------------------------+
| PERSONA IDENTITY                                      |
| Name: [Marcus]  [Edit]                                |
| Title: [AI Associate]  [Edit]                         |
| Avatar: [Image]  [Replace]                            |
| Pronouns: [They/Them]  [Edit]                         |
+-------------------------------------------------------+
| EMAIL SIGNATURE                                       |
| [Preview of HTML signature]                           |
| [Edit signature]                                      |
| [Jurisdiction disclosures: PA/UT active]              |
+-------------------------------------------------------+
| TONE DESCRIPTORS                                      |
| [ warm-but-professional ] [ concise ]                 |
| [ never effusive ] [ always end with thanks ]         |
| [ + Add descriptor ] [ Edit list ]                    |
+-------------------------------------------------------+
| INTERNAL COMMS IDENTITY                               |
| Slack/Teams display name: [Marcus — AI Associate]     |
| [Edit]                                                |
+-------------------------------------------------------+
```

**Design constraint:** Persona is configured once during onboarding, rarely touched again. The tab should not be prominent. In the left-rail navigation order, it comes fifth — after Today, Queue, Memory, Audit. It is a configuration tab, not an information tab.

The jurisdiction disclosure row under Email Signature is important. Per bar ethics (law-firm PRD §8.2-8.3), PA and Utah clients require explicit AI-use language in the engagement letter. The Persona tab shows whether this is active, and links to the engagement letter clause library. This is where Susan will look first during a compliance review.

---

### Tab 6: Skills (Primary user: Ramon)

**Purpose:** What the agent can do. Activate, configure, set trust ceilings.

**Content blocks:**

```
+-------------------------------------------------------+
| ACTIVE SKILLS (enabled for this customer)             |
| Each row: skill name | status | trust ceiling | config |
|  [inbox-triage-and-draft] [Active] [Draft for review] |
|  [morning-digest]         [Active] [Autonomous]       |
|  [pi-intake-triage]       [Active] [Draft for review] |
|  [signing-coordinator]    [Active] [Draft for review] |
|  ...                                                  |
+-------------------------------------------------------+
| AVAILABLE SKILLS (not yet enabled)                    |
| Each row: skill name | description | [ Enable ]       |
+-------------------------------------------------------+
| PAUSED SKILLS                                         |
| Each row: skill name | paused by | date | [ Resume ]  |
+-------------------------------------------------------+
```

**Trust ceiling control (per skill row):**

The trust ceiling selector is a three-state control — not a toggle, because the three states are meaningfully different:

```
[ disabled ] —— [ draft for review ] —— [ autonomous ]
                        ^
                    current state
```

When a user promotes a skill to autonomous (where promotion is permitted), a confirmation dialog appears:

"Promote conflict-check to autonomous? This skill will run without per-draft review. You can demote it back to draft-for-review at any time. [Confirm] [Cancel]"

The confirmation dialog is not blocking for the overall flow, but it is a deliberate friction point. Trust ceiling promotions are logged in the audit trail (platform PRD §11.3). The confirmation dialog text should reference this: "This change will be recorded in the audit log."

For skills that cannot be promoted to autonomous (trust-accounting-adjacent skills, court-filing-adjacent skills per platform PRD §11.2), the autonomous option is greyed out with an explanation: "This skill cannot run autonomously by design. Partner review is architecturally required."

**Skill configuration (per skill):**

Clicking a skill row opens a detail panel (right side of screen on desktop; full screen on mobile). The panel shows:

- Skill name and description (plain English, not technical)
- What this skill does: 2-3 sentences
- What this skill does NOT do: 1-2 sentences (the third-rail boundary)
- Trust ceiling control
- Scope constraints: which folders / matter types / contacts this skill can access
- Configuration parameters specific to this skill (e.g., for pi-intake-triage: firm case criteria)

The "what this skill does NOT do" section is not optional. It is the paralegal-frame communication for each individual skill. It communicates the boundary concretely, at the skill level, not just at the product level.

---

### Tab 7: Voice (Primary users: Margaret + Ramon)

**Purpose:** The agent's voice — rules, samples, test sandbox, violation log.

**Content blocks:**

```
+-------------------------------------------------------+
| VOICE RULES (Layer 1)                                 |
| Categories: Tone | Banned patterns | Required patterns |
| Each rule displayed as a tag: [× no em dashes]        |
| [ + Add rule ] [ Edit rules ]                         |
+-------------------------------------------------------+
| VOICE SAMPLES (Layer 2)                               |
| Counter: 32 samples loaded (minimum met)              |
| Categories: To-client | To-vendor | To-counterparty   |
| [ Upload samples ] [ View all ] [ Delete ]            |
+-------------------------------------------------------+
| PER-RECIPIENT COHORTS (Layer 3, v1)                   |
| [ Anxious client ] [ Opposing counsel ] [ Vendor ]    |
| Each cohort: sample count + tone descriptor           |
| [ Configure cohort ]                                  |
+-------------------------------------------------------+
| TEST SANDBOX                                          |
| "Describe a scenario and see how Marcus would draft it"|
| [ Scenario input field ]                              |
| [ Generate draft ]                                    |
| [ Draft output — editable ] [ Accept ] [ Re-run ]     |
| [ Teach Marcus from this edit ]                       |
+-------------------------------------------------------+
| VIOLATION LOG                                         |
| "This week: 0 violations caught."                     |
| or: list of violations with draft reference           |
+-------------------------------------------------------+
| BLIND TEST RESULTS (post-calibration session)         |
| Status: [ Passed — 88% indistinguishability ]         |
| Date of last test: [date]                             |
| [ Request new blind test ]                            |
+-------------------------------------------------------+
```

**Voice test sandbox UX — the critical calibration surface:**

The test sandbox is the primary tool for voice calibration. The interaction design must support the Captain-led calibration session (4-6 hours with the paralegal) and the ongoing self-service use after onboarding.

The flow:

1. User types a scenario: "A client has been waiting 10 days for a status update. The matter is in discovery. Nothing urgent to report."
2. User clicks "Generate draft."
3. Draft appears in the output area (≤8 seconds, per measured commitment in law-firm PRD §11.3.1).
4. User reads the draft. Three paths:
   - **Looks right:** User clicks "Accept." Draft is added as a voice sample (tagged by scenario type) and the interaction is logged.
   - **Needs edit:** User edits directly in the output area. When done: "Teach Marcus from this edit" button. Clicking it shows a diff of the changes and a confirmation: "Marcus will apply this pattern to future [client status updates]." Confirm or cancel.
   - **Wrong approach entirely:** User clicks "Re-run" (regenerates with current rules). Or clicks "Add a rule" (lands in the Rules editor, pre-populated with context from this scenario).

**The test sandbox does not show raw prompts or model internals.** The user is teaching voice, not engineering prompts. The abstraction is: "scenario in, draft out, edit if needed, Marcus learns." Nothing below that surface is visible.

**Violation log design:**

The violation log is a short list of self-caught violations from the past 7 days. Each entry shows:

- Draft reference (matter + recipient type, no personally-identifying info)
- Violation type (e.g., "em dash detected and removed," "sentence length exceeded max, shortened")
- What Marcus did about it (always: "removed / shortened / revised before delivering draft")

The log builds confidence that the voice rules are working. An empty log for the week ("0 violations caught") is also a positive signal and should be displayed explicitly, not hidden.

---

## Interaction Patterns

### Trust-Ceiling Promotion Flow

**Trigger:** Ramon clicks the trust ceiling selector on a skill row in the Skills tab and selects "Autonomous."

**Sequence:**
1. Confirmation dialog appears (not modal for the full page — a focused dialog over the skills row).
2. Dialog: "Promote [skill name] to autonomous? [Description of what this means]. This will be recorded in the audit log. [Confirm] [Cancel]"
3. If confirmed: skill status updates immediately. A brief toast notification: "Conflict-check promoted to autonomous. Recorded in audit log." Toast disappears after 4 seconds.
4. Audit tab logs the event: timestamp, actor (Ramon's name), skill name, old ceiling, new ceiling.

**Demotion:** reverse flow with same pattern. No confirmation dialog required for demotion (it reduces risk, not increases it).

**Non-promotable skill:** if user attempts to promote a non-promotable skill, the autonomous option is inert (not just greyed — clicking it should produce a tooltip: "This skill requires partner review by design. This cannot be changed."). The tooltip is informational, not an error.

---

### Morning Digest Email — Layout and Content

The morning digest email is the product's daily touchpoint with Margaret. It must be readable in 60 seconds on a phone.

**From:** marcus@[firm-domain].com
**Subject:** "[N] drafts ready for review — [day]" (no decorative punctuation, no emoji)
**Body (plain text preferred; minimal HTML):**

```
Good morning,

Here's what's ready for your review this morning:

1. [Recipient name] — Status update (auto accident, matter #1234)
   "Following up on the medical records request..."

2. [Recipient name] — Intake follow-up (slip-and-fall inquiry)
   "Thank you for reaching out about the incident..."

3. [Recipient name] — Signing reminder (DocuSign — 6 days pending)
   "Just a quick note that the engagement letter..."

4. [Recipient name] — Red flag: late payment flagged (AR 47 days)
   "I've flagged matter #5678 for your attention..."

5. [Recipient name] — Conflict check: no conflict found (new inquiry)
   [No review needed — for your information]

Review in dashboard → [link]

—Marcus
```

**Design constraints for the digest email:**
- No "good news" framing or performative language. Margaret is a litigation partner, not a newsletter subscriber.
- No em dashes (CLAUDE.md + platform PRD voice standard). Use colons and commas.
- Each item: recipient, type, and the opening sentence of the draft (or a plain-English summary for non-draft items). Not a full draft — a preview sufficient for Margaret to decide whether to open the item first or last.
- The fifth item above shows an informational item (autonomous skill result). These should appear at the bottom, labeled "[No review needed]" to distinguish from items needing action.
- Single link at the bottom. Not per-item links — Margaret should use the dashboard queue for triage, not click into six separate URLs from her phone.
- No unsubscribe link. This is an operational communication, not a marketing email.

**Digest empty state:** if there are no items for review today, still send the email: "Nothing requires your review today. Marcus handled [N] items autonomously." This maintains the daily-ritual behavior and proves the agent is working even on light days.

---

### Agent's Persona in Slack/Teams (Internal Comms)

When the agent posts to a Slack or Teams channel, the post comes from the persona identity ("Marcus — AI Associate" with avatar). Platform PRD §7.2 and §9.2 confirm this is internal-only; the persona is visible to firm staff, not clients.

**Internal comms post format (example: red-flag alert):**

```
Marcus — AI Associate | 10:47 AM

@[paralegal-Ramon] Flagging matter #1234 (Smith v. Acme Insurance):
AR is now 47 days past invoice date. No response to the reminder sent
November 12.

Suggested action: partner review of billing status.

[View in dashboard →]
```

**Design principles for internal comms posts:**
- Always include a matter reference, not just a client name (matter references are less exposed if the message is seen outside intended context).
- The post never contains substantive legal content, settlement figures, or privileged communication.
- The post includes the dashboard link. This keeps the dashboard as the action surface.
- The persona's "voice" in internal posts should be direct and operational. Not chatty, not corporate. Treat it as a brief status message between colleagues, not a report.
- The agent's internal posts should not use first-person framing ("I flagged," "I noticed") except in conversational contexts. Prefer: "Flagging..." or "[Skill name] has flagged..."

**Scope constraint on internal comms:** the agent does not post to all-hands channels or channels it has not been explicitly configured to use. Internal comms scope is a `customer.yaml` configuration. This should be visible in the Persona tab (see §05 above: "Internal Comms Identity" block).

---

### Onboarding Flow (What the Customer Actually Sees)

**Captain-initiated session. Customer sees the following sequence.**

**Screen 1: Welcome / Setup Progress (Day 1, first login)**

```
+-------------------------------------------------------+
|  Welcome to Marcus — AI Associate                     |
|  Smithfield PI Firm                                   |
+-------------------------------------------------------+
|  Setup checklist:                                     |
|  [✓] Connectors configured (Filevine, DocuSign...)    |
|  [✓] Practice area: Personal Injury                   |
|  [✓] Scope rules: active                              |
|  [ ] Voice calibration: 0 of 32 samples loaded        |
|  [ ] Go-live confirmed                                 |
+-------------------------------------------------------+
|  [ Begin voice calibration → ]                        |
+-------------------------------------------------------+
```

This screen is the only full-session screen in v1. After go-live, the partner never sees it again. It collapses to the Today tab.

**Screen 2: Voice Calibration (Captain-led, Ramon as operator)**

The Voice tab in setup mode. A progress indicator is visible at the top: "32 samples minimum. 0 loaded." Ramon uploads in batches. The counter updates with each upload. When the minimum is met, the progress indicator turns green and the "Run test scenarios" button becomes active.

**Screen 3: First Test Scenario (Voice tab, Test Sandbox)**

Captain types the first scenario. Marcus drafts. Captain and Ramon review together. This is the moment the customer sees what the product actually produces. It must work well. If the draft has voice issues (which is likely at 32 samples), Captain should normalize this: "We'll refine this over the calibration session. The voice improves as you correct it."

**Screen 4: Go-Live Confirmation (Back to Setup Progress screen)**

All checkboxes are now green. One large button: "Activate Marcus." A confirmation: "Marcus will begin watching your inbox and drafting items starting at [8am tomorrow]. You'll receive your first digest at [8am]."

One more checkbox: "First external draft will not send until Margaret manually approves" (pre-checked, cannot be unchecked). This is the 10-business-day shadow mode default.

Margaret checks the box and clicks "Activate Marcus." She is done.

---

### Error States

**Connector Down (e.g., Filevine is not responding)**

Today tab: Agent Status block shows a yellow dot instead of green. Text: "Filevine is not responding. Skills that require matter data are paused." Link: "View affected skills →" (goes to Skills tab filtered to affected skills).

Queue tab: Items that require Filevine data show a yellow chip: "Matter data unavailable." The draft preview shows: "Draft paused — waiting for Filevine." No broken UI, no missing content.

The agent continues working on skills that do not require Filevine (email triage, calendar management, Outlook-based drafts). The partial degradation is visible, not hidden.

Resolution: when Filevine comes back, the agent resumes automatically. A brief notification in the Today tab: "Filevine reconnected. 3 paused drafts are being processed." No action required from the operator unless they want to review.

**Voice Gate Failure (blind test result below 80%)**

Skills tab: A warning banner at the top of the tab: "Voice calibration incomplete. External drafts are not yet active." The go-live check in the setup progress screen does not turn green until the blind test passes.

The banner links to the Voice tab, which shows the blind-test result with specifics: "Last blind test: 64% indistinguishability. Target: 80%. Recalibration session recommended."

The Today tab shows: "Marcus is in calibration mode. No external drafts yet. Internal reviews and memory building continue." This state must not look like a failure — the agent is still doing useful work (reading, triaging, memory-building) in shadow mode. The voice gate is a quality bar, not a broken product.

**Memory Rule Conflict (two rules produce contradictory behavior)**

Memory tab: A conflict indicator appears on the affected rules. "Conflict detected: Rule A ('Always CC Sarah on new intake') and Rule B ('Never CC staff on intake from [domain]') apply to the same condition. Which rule takes priority?"

Two buttons on the conflict card: "[Rule A takes priority]" and "[Rule B takes priority]." The user resolves. Once resolved, the conflict indicator clears. This is logged in the audit trail.

**Memory Corruption (agent absorbed an incorrect correction)**

Memory tab, "What Marcus learned this week" section: shows the distilled rule. If the user recognizes it as wrong, they click "Revert." The revert removes the rule and surfaces a brief explanation: "This correction has been undone. Marcus will not apply this pattern in future drafts."

The audit log records the revert event with timestamp and actor. There is no data loss — the original draft and the incorrect correction remain in the audit log, but the derived rule is removed from active memory.

The platform PRD §18 identifies this risk ("Memory corruption / wrong learning"). The UX response is: make every distilled rule visible and individually revertable. The paranoid operator can review everything. The trusting operator can ignore the section. Neither path breaks anything.

---

## Platform-Specific Design Constraints

### Dashboard (Web App)

**Layout:** Two-column on desktop (nav left rail 240px, content area remaining width). Single-column on mobile (nav collapses to bottom tab bar with icons only). The seven tabs must map to icons that work without labels at mobile scale.

**Left-rail navigation order (v1):**
1. Today (home icon)
2. Queue (inbox icon)
3. Memory (brain/book icon)
4. Audit (log/list icon)
5. Persona (person icon)
6. Skills (toolkit icon)
7. Voice (waveform icon)

Order prioritizes information tabs over configuration tabs. Margaret will live in Today and occasionally Queue. Ramon will live in Queue and Memory. Susan will live in Audit. Configuration tabs are last.

**Typography:** The dashboard is a professional tool for a litigation firm. No playful fonts. A single sans-serif family (e.g., Inter or equivalent), maximum two weights (regular and medium). Body text at 16px minimum. Data tables at 14px minimum. No text below 14px anywhere in the v1 surface.

**Color semantics (must be consistent across all 7 tabs):**
- Green: healthy, confirmed, sent, approved
- Yellow: attention needed, agent uncertainty, connector delay
- Orange: flagged by reviewer, escalation-threshold item
- Red: error, overdue, critical (sparingly)
- Grey: inactive, paused, informational

Colors cannot be the only differentiator for status — every status dot must also have a text label nearby, per WCAG 1.4.1 (use of color).

**Session timeout:** the dashboard handles sensitive firm data. Session timeout after 30 minutes of inactivity, with a 2-minute warning before expiry. This matches the security posture of the firm's practice management software.

---

### Email Integration

The morning digest is the primary email surface. Design constraints:

- Plain text body preferred; minimal HTML if required. Many law firm email clients (Outlook on Windows) render HTML inconsistently.
- No images in the digest. The avatar and branding live in the dashboard, not the email.
- The "From" display name for the digest is "[Persona name] — AI Associate" (e.g., "Marcus — AI Associate"). Not "AI Employee" — the persona name is the brand the firm has adopted.
- Digest links use the dashboard URL, not a separate link-tracking service. The platform PRD §14 no-lock-in architecture means no data flows to a link-tracking vendor.
- The digest has no "unsubscribe" footer and no marketing language. It is an operational message. Marketing email rules (CAN-SPAM, etc.) do not apply to operational service communications; confirm with legal before adding any marketing-style footer.

**Draft-delivery to Outlook:** the agent uses Microsoft Graph to create a draft in the reviewer's Drafts folder. The draft shows the correct recipient, subject, and body. The reviewer opens their Outlook drafts folder, sees the agent's work, edits if needed, and sends from their own account. This is exactly the reviewer-as-sender pattern. The UX implication: the draft must look identical in Outlook to what the reviewer would have written. No agent watermark, no "AI Draft" subject line prefix. Clean.

---

### Slack/Teams Internal Comms

**Slack:** The agent posts as the persona identity (a Slack bot app installed in the workspace). The bot must be scoped to specific channels — not all channels. The customer.yaml `InternalComms` connector includes channel scope.

**Teams:** Similar pattern via Microsoft Graph bot framework. The persona posts to specified Teams channels.

**Design constraint:** the agent must not post in response to every event. Notification fatigue is a real risk. The internal comms surface should be used for:
- Red-flag alerts (matters needing immediate attention)
- Escalation-threshold notifications (signing page stalled, late payment)
- Daily digest prompts if Slack/Teams is the customer's preferred medium over email (configurable)

The agent should not post to Slack/Teams for every draft created. That is the Queue's job.

---

## Accessibility Requirements

The dashboard is a professional tool used by working adults. WCAG 2.2 Level AA is the compliance target. The following specific requirements apply to the v1 surface:

**1.4.1 Use of Color (Level A):** All status indicators (green/yellow/orange/red dots) must have a text label or icon in addition to color. The queue's status dot must be accompanied by text: "Ready," "Flagged," "Overdue."

**1.4.3 Contrast Minimum (Level AA):** All body text must meet 4.5:1 contrast ratio against background. UI components and focus indicators must meet 3:1. The dashboard's likely light-background design must be verified against these ratios before shipping.

**1.4.4 Resize Text (Level AA):** The dashboard must remain usable at 200% browser zoom. No content should be cut off or require horizontal scrolling at 200% zoom on a standard 1440px viewport.

**2.1.1 Keyboard Navigation (Level A):** All interactive elements (tabs, buttons, queue items, trust ceiling controls) must be reachable via keyboard Tab/Enter/Space navigation. The approval flow (open draft, approve, move to next) must complete entirely via keyboard.

**2.4.3 Focus Order (Level A):** Focus order on each tab must follow the visual order. The left-rail navigation should receive focus before the content area. Within the queue, focus should move item-by-item through the list.

**2.4.7 Focus Visible (Level AA):** All focusable elements must have a visible focus indicator. The default browser outline is not sufficient — implement a 2px solid focus ring in a high-contrast color (blue or equivalent on a white background).

**3.3.1 Error Identification (Level A):** When the operator submits an invalid rule in the Memory tab (e.g., an empty rule text field), the error must be identified in text, not just color. "Rule text is required" must appear adjacent to the empty field.

**3.3.2 Labels and Instructions (Level A):** All form fields in the Memory, Voice, and Persona tabs must have visible labels. Placeholder text is not a label.

**4.1.2 Name, Role, Value (Level A):** The trust ceiling selector (three-state control) must expose its current state via ARIA. A screen reader should announce "Conflict-check: draft for review" when focusing the control.

**Mobile accessibility:** Margaret reviews drafts from her phone. The minimum touch target size for action buttons (Send, Flag, Reject) is 44x44px (Apple HIG minimum, also WCAG 2.5.5 guideline). Queue cards must be fully tappable, not just the button within them.

**WCAG 2.2 additions (relevant to this product):**

**2.5.7 Dragging Movements (Level AA):** If any reordering functionality is added to the queue (drag to reprioritize), a non-drag alternative must be available (e.g., "Move to top" menu item).

**2.5.8 Target Size Minimum (Level AA):** Inline action buttons within queue cards must meet the 24x24px minimum with no adjacent neighbor within 24px. This applies specifically to the small action icons in queue rows.

---

## Mobile Experience Considerations

Margaret reviews drafts from her phone. This is not speculative — law-firm PRD §11.8 explicitly says: "Partner receives daily 8am digest: '5 drafts pending review.' 60-second scan from phone." The mobile experience is load-bearing.

**What must work on mobile (v1):**

1. The morning digest email renders correctly in mobile email clients (Outlook iOS, Apple Mail).
2. The "Review in dashboard" link from the digest opens the Today tab correctly on mobile.
3. The Today tab: priority cards are full-width, tappable, and show the Send/Flag actions prominently.
4. The Queue tab: list view with full-width cards. Approve and Flag are prominent. The draft detail view must be readable without horizontal scroll.
5. The draft detail view: full draft body readable at mobile font sizes. Actions (Send to Drafts / Flag / Reject) are bottom-anchored for thumb reach.

**What can be desktop-only in v1:**

- Memory tab rule editing (Ramon does this at his desk; it's a deliberate operation)
- Voice tab test sandbox (calibration sessions are desktop-driven)
- Audit tab compliance export (Susan uses a desktop; this is an episodic, deliberate action)
- Skills tab trust-ceiling management (configuration, not daily use)

The mobile-first path is: Today tab → Queue item → Send/Flag. That path must be frictionless. Everything else can degrade gracefully to "open on desktop."

---

## Gap Analysis: Issues Not Addressed in Current PRDs

The following UX gaps require PRD-level decisions before design can proceed:

**Gap 1: Multi-user role model is undefined.**

Platform PRD §19 notes: "Multi-user role model in dashboard (principal-only vs principal+operator+compliance multi-role): demoed as principal-only; multi-role in beta-1. Role schema not yet specified." Beta-1 requires Margaret (partner), Ramon (paralegal), and Susan (compliance) to have different views of the same dashboard. Without a role model, the interaction design cannot be completed.

Recommendation: define three roles before beta-1 UX is locked: (a) Principal — full access, send-approval authority; (b) Operator — full access except cannot change trust ceilings above configured maximum without principal confirmation; (c) Compliance — read-only access to Audit tab only, no ability to approve drafts or edit memory.

**Gap 2: The "add rule from draft view" flow has no surface in current PRD.**

The most natural moment for rule-teaching is during draft review, not in the Memory tab. The PRD describes the Memory tab as the rule surface but does not provide a shortcut from Queue. This gap means operators will either not add rules, or will navigate out of their workflow to do so.

Recommendation: add a "Teach Marcus" affordance to the draft detail view that creates a new Memory rule with the draft's context pre-populated.

**Gap 3: Trust-ceiling promotion UX location is ambiguous.**

The PRD specifies that trust-ceiling promotion lives in the Skills tab. But the law-firm PRD §11.8 mentions "trust ceiling promotions discussed" at week 4 as a milestone. There is no UX design for how this conversation happens — does the Captain initiate it? Does the dashboard surface a recommendation? Does the operator self-discover it?

Recommendation: add a "Promotion ready?" recommendation card to the Today tab when a skill has maintained ≥90% approval rate over 4 consecutive weeks. The card says: "Conflict-check has been approved 97% of the time over the past 4 weeks. Consider promoting to autonomous." The partner clicks the card, lands on the Skills tab with the relevant skill highlighted.

**Gap 4: The compliance export is referenced but not designed.**

Platform PRD §13 and law-firm PRD §11.6 reference the compliance evidence packet. The Audit tab design above addresses this, but the format and contents of the exported package require a content-level specification before implementation. The current PRD says "generate compliance evidence packet" without specifying the document structure.

Recommendation: define the compliance export packet structure as a named artifact before beta-1, with Susan's use case as the design constraint: handed to outside counsel, readable by a non-technical lawyer, answering the five bar-ethics questions (what did the agent read, what did it draft, who reviewed it, was confidential data shared with a learning model, what are the controls).

**Gap 5: The morning digest cadence and format are underdefined.**

The PRD specifies that the morning digest exists and runs at 8am. It does not specify: what triggers the digest (time-based vs. draft-count threshold), what happens on days with nothing to review, whether the digest is email-only or also Slack/Teams, whether the operator receives the same digest as the partner or a separate one, and how the digest handles flagged items from the prior day that were never resolved.

The digest format above addresses the layout. The cadence and routing decisions require a product decision before implementation.

**Gap 6: Onboarding flow transitions back to normal operation.**

The setup progress screen (the five-step checklist) is the first thing Margaret sees. But there is no specified transition from "setup mode" to "normal operation mode." Once go-live is confirmed, what does the Today tab show? What happens to the setup progress screen — does it persist as a secondary view, or disappear entirely?

Recommendation: on go-live confirmation, the setup progress screen is replaced by the Today tab. The setup checklist is permanently accessible from a "Setup" link in the dashboard footer (below the main nav), but is not shown in the primary nav. If the user navigates back to it after go-live, it shows all checkboxes green with a timestamp: "Activated [date]."

---

*End of UX Lead Contribution — Round 1.*
