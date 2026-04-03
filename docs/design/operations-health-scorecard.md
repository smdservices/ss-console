# Operations Health Scorecard — Functional Design Spec

**Issue:** #147
**Status:** Design
**Last updated:** 2026-04-02

---

## 1. Purpose

A self-service interactive assessment on smd.services that lets a business owner answer questions about how their business runs and receive an immediate, personalized Operations Health Report scoring them across 6 operational dimensions.

**Goals:**

- Convert site visitors into qualified leads (target: 30-40% completion rate)
- Pre-qualify prospects by surfacing their 2-3 most acute operational problems
- Mirror the assessment call framework so the scorecard and the real conversation are consistent
- Feed results into the entity pipeline as a `website_scorecard` source

**What it is NOT:**

- A diagnostic tool that tells owners what's wrong (we discover that together)
- A replacement for the assessment call (it's the appetizer, not the meal)
- A calculator with dollar amounts (no published pricing, per Decision Stack)

---

## 2. UX Flow

```
Landing Section (on homepage or dedicated /scorecard page)
    │
    ▼
Context Questions (3 questions — vertical, team size, role)
    │
    ▼
Operations Walkthrough (18 questions — 3 per problem area)
    │
    ▼
Email Capture (gate the detailed report)
    │
    ▼
Results Page (instant scores + summary + CTA to book assessment call)
    │
    ▼
Email Delivery (full PDF report within 60 seconds)
```

### Flow details

1. **Entry point** — CTA button on homepage ("See where your operations stand") and/or dedicated `/scorecard` route. No login required.

2. **Context screen** — 3 quick questions to personalize the experience:
   - What type of business do you run? (vertical dropdown)
   - How many people are on your team? (range selector)
   - What's your role? (Owner / Office Manager / Other)

3. **Walkthrough** — 18 questions across 6 sections. Each section has a conversational header that mirrors the assessment call tone. Progress bar shows completion. One question per screen on mobile, grouped on desktop.

4. **Email gate** — After the last question, before showing results: "Where should we send your full report?" Name + email + business name. Positioned as delivering value, not extracting information.

5. **Results page** — Immediate display of:
   - Overall Operations Health Score (0-100)
   - 6 dimension scores visualized (radar/spider chart or horizontal bars)
   - Top 2-3 problem areas highlighted with plain-language descriptions
   - CTA: "Let's talk about what you found" → book assessment call

6. **Email delivery** — Branded PDF with full breakdown, sent within 60 seconds via Resend. Includes everything on the results page plus recommendations per problem area.

---

## 3. Question Framework

### Design principles

- **Scenario-based, not self-assessment.** "When a new lead comes in, what typically happens?" not "Rate your lead management on a scale of 1-5." Owners can't objectively rate themselves, but they can describe what happens.
- **Non-judgmental.** Every answer is valid. No option reads as "wrong." Frame as a spectrum from informal/manual to structured/automated.
- **Owner's language.** Use the phrases from the assessment call script ("Owner Says" column), not consultant jargon.
- **3 minutes total.** 18 questions, ~10 seconds each. No friction.

### Answer format

Each question has 4 options (A-D) representing a maturity spectrum:

| Level | Label           | Score | Meaning                                       |
| ----- | --------------- | ----- | --------------------------------------------- |
| A     | Ad hoc          | 0     | No process — handled reactively or not at all |
| B     | Owner-dependent | 1     | Process exists but requires the owner         |
| C     | Informal        | 2     | Someone handles it, but nothing is documented |
| D     | Structured      | 3     | Documented process, runs without the owner    |

Labels are NOT shown to the user. The options are written as natural descriptions.

---

### Section 1: Owner Bottleneck

**Header:** "Let's start with your day-to-day"

**Q1.** When a team member needs to make a decision that's outside their normal routine, what happens?

- A) They wait for me — I make most of the calls
- B) They text or call me and I handle it when I can
- C) A few senior people can handle it, but anything big comes to me
- D) We have clear guidelines for who decides what — I rarely get pulled in

**Q2.** If you had to take an unplanned week off tomorrow, what would happen to operations?

- A) Things would stop — I'm involved in almost everything
- B) The basics would keep going, but nothing new would move forward
- C) Most things would be fine, but a few key areas need me
- D) The team would handle it — they know the playbook

**Q3.** How are your core business processes (how jobs get done, how customers get served) documented?

- A) They're not — it's all in my head or people just know
- B) I've written some things down, but it's scattered or outdated
- C) We have some docs, but they're not consistently followed
- D) Key processes are documented and the team actually uses them

---

### Section 2: Lead Leakage

**Header:** "How new business comes in"

**Q4.** When a new lead comes in (call, form, referral), what happens next?

- A) Whoever answers deals with it — no set process
- B) I usually handle it personally when I get a chance
- C) Someone follows up, but there's no system tracking it
- D) Every lead goes into a system with assigned follow-up steps

**Q5.** If I asked you how many leads came in last month and how many became customers, could you tell me?

- A) Honestly, no — I don't track that
- B) I could guess, but I don't have real numbers
- C) I have a rough idea from email/calls but nothing centralized
- D) Yes — I can pull that up and tell you our close rate

**Q6.** What happens to a lead that doesn't buy right away?

- A) We probably lose track of them
- B) I might follow up if I remember, but there's no system
- C) We try to follow up, but it's inconsistent
- D) They go into a nurture sequence — we stay in touch automatically

---

### Section 3: Financial Visibility

**Header:** "The money side"

**Q7.** How current are your books right now?

- A) I'm not sure — my bookkeeper/accountant handles it and I don't check often
- B) They're a few months behind, but I check the bank account
- C) Mostly current — within a couple of weeks
- D) Up to date — I can see where we stand anytime

**Q8.** When you price a job or project, how do you decide what to charge?

- A) Gut feel based on experience
- B) I know my rough costs and add a margin, but I don't track if I was right
- C) I have a pricing framework, but I don't always go back and check profitability
- D) I price based on real cost data and review margins after each job

**Q9.** Could you tell me right now which of your services or jobs are most profitable?

- A) Not really — revenue comes in and bills go out
- B) I have a sense, but I've never run the numbers
- C) I know broadly, but the details are fuzzy
- D) Yes — I track profitability by service/job type

---

### Section 4: Scheduling Chaos

**Header:** "Keeping the calendar straight"

**Q10.** How do you schedule jobs, appointments, or shifts?

- A) Phone calls, texts, maybe a whiteboard — it's manual
- B) I use a calendar, but it's just mine — the team checks with me
- C) We have a shared calendar, but people don't always update it
- D) We use a scheduling tool that the team and customers can see

**Q11.** How often do scheduling conflicts (double-bookings, missed appointments, wrong times) happen?

- A) More than I'd like to admit — at least weekly
- B) It happens a few times a month
- C) Occasionally, but we usually catch it
- D) Rarely — the system prevents most of it

**Q12.** When a schedule changes (cancellation, delay, reschedule), how does everyone find out?

- A) Whoever knows calls or texts whoever needs to know
- B) I usually handle the communication myself
- C) We update the calendar, but sometimes people miss it
- D) Changes sync automatically and notify the right people

---

### Section 5: Manual Communication

**Header:** "Staying in touch with customers"

**Q13.** How do appointment reminders, confirmations, or follow-ups go out to customers?

- A) They don't, really — customers are expected to remember
- B) I or someone on the team manually texts or calls each one
- C) We send them, but it's a manual process each time
- D) They go out automatically — we set it up once and it runs

**Q14.** When a job is done, how does the customer get their invoice?

- A) When I get around to it — sometimes it takes a while
- B) I manually create and send each one
- C) We have a process, but it depends on me or one person to do it
- D) Invoices generate and send automatically when the job is marked complete

**Q15.** If a customer from 6 months ago called right now, could your team pull up their full history?

- A) We'd have to piece it together from texts, emails, and memory
- B) I could probably find it, but nobody else could
- C) We have records, but they're in different places
- D) Yes — their full history is in one place anyone on the team can access

---

### Section 6: Employee Retention

**Header:** "Knowing what your team is doing"

**Q16.** How do you know what your team accomplished today?

- A) I don't, unless I was there watching or they told me
- B) I check in with people individually — calls, texts, end-of-day chat
- C) We have a loose check-in process, but it's not consistent
- D) We use a system where everyone logs their work — I can check anytime

**Q17.** When you onboard a new hire, how do they learn the job?

- A) They shadow someone and figure it out — trial by fire
- B) I personally train them, which takes me away from everything else
- C) We have some training materials, but it's mostly hands-on
- D) There's a structured onboarding process with documentation they follow

**Q18.** How do you handle it when someone on the team isn't performing?

- A) I usually don't notice until something breaks or a customer complains
- B) I address it when I see it, but there's no regular feedback process
- C) We do occasional check-ins, but nothing formal
- D) We have clear expectations and regular reviews — issues surface early

---

## 4. Scoring Logic

### Per-dimension scoring

Each dimension has 3 questions, each scored 0-3 based on answer level:

| Answer              | Points |
| ------------------- | ------ |
| A (Ad hoc)          | 0      |
| B (Owner-dependent) | 1      |
| C (Informal)        | 2      |
| D (Structured)      | 3      |

**Dimension score** = sum of 3 question scores → 0-9 raw, mapped to a 0-100 scale:

| Raw (0-9) | Display (0-100) | Label           | Color           |
| --------- | --------------- | --------------- | --------------- |
| 0-2       | 0-22            | Needs attention | Red (#dc2626)   |
| 3-4       | 33-44           | Room to grow    | Amber (#d97706) |
| 5-6       | 56-67           | Getting there   | Blue (#2563eb)  |
| 7-9       | 78-100          | Strong          | Green (#16a34a) |

### Overall Operations Health Score

Weighted average of all 6 dimensions, scaled 0-100.

Default weights (equal):

| Dimension            | Weight |
| -------------------- | ------ |
| Owner bottleneck     | 1.0    |
| Lead leakage         | 1.0    |
| Financial visibility | 1.0    |
| Scheduling           | 1.0    |
| Communication        | 1.0    |
| Employee Retention   | 1.0    |

**Future enhancement:** Adjust weights by vertical using the pain cluster table. For example, home services could weight scheduling and lead leakage higher. Ship v1 with equal weights.

### Problem identification

Sort dimensions by score ascending. The bottom 2-3 (lowest scores) are highlighted as the primary opportunity areas. If a dimension scores in the "Strong" range, exclude it from the opportunity list even if it's in the bottom 3.

---

## 5. Results Page

### Layout

```
┌─────────────────────────────────────────────────┐
│  Your Operations Health Score                    │
│                                                  │
│              ┌──────┐                            │
│              │  62  │  / 100                     │
│              └──────┘                            │
│         "Getting there"                          │
│                                                  │
├─────────────────────────────────────────────────┤
│  How you scored across 6 areas                   │
│                                                  │
│  Owner bottleneck     ████████░░░░  44  ⚠️       │
│  Lead follow-up       ██████░░░░░░  33  ⚠️       │
│  Financial visibility ██████████░░  67            │
│  Scheduling           ████████████  89            │
│  Communication        ██████░░░░░░  33  ⚠️       │
│  Employee Retention      ████████░░░░  56            │
│                                                  │
├─────────────────────────────────────────────────┤
│  Where we'd start                                │
│                                                  │
│  Based on your answers, the areas with the       │
│  most room for improvement are:                  │
│                                                  │
│  1. Lead follow-up — Leads are coming in,        │
│     but without a system to track and follow      │
│     up, some are falling through the cracks.      │
│                                                  │
│  2. Communication — Your team is spending         │
│     time on messages that could go out            │
│     automatically, freeing up hours every week.   │
│                                                  │
│  3. Owner bottleneck — You're still the           │
│     go-to for too many decisions. Documenting     │
│     key processes would let your team move        │
│     without waiting on you.                       │
│                                                  │
├─────────────────────────────────────────────────┤
│  Want to dig deeper?                             │
│                                                  │
│  This scorecard gives you the lay of the land.   │
│  The real value comes from a conversation —       │
│  walking through your day together and figuring   │
│  out exactly what to fix first.                  │
│                                                  │
│  ┌─────────────────────────────────────────┐     │
│  │    Book a free assessment call →        │     │
│  └─────────────────────────────────────────┘     │
│                                                  │
│  Full report sent to your email.                 │
└─────────────────────────────────────────────────┘
```

### Dimension descriptions (for results)

Each dimension needs a one-liner for each score range, written in second person, non-judgmental:

**Owner bottleneck:**

- Red: "Most decisions and processes run through you. That's common at this stage — but it means the business can't move without you."
- Amber: "You're still the go-to for a lot of decisions. Documenting key processes would let your team move without waiting on you."
- Blue: "Your team handles most of the day-to-day, but a few critical areas still depend on you."
- Green: "Your team operates independently. You've built processes that work without you in the loop."

**Lead leakage:**

- Red: "Leads are coming in, but there's no system catching them. Some are definitely slipping through."
- Amber: "You're following up on leads, but it depends on memory or manual effort. A consistent system would close the gap."
- Blue: "You have a handle on most leads, but there are still gaps in tracking and follow-through."
- Green: "Every lead is tracked and followed up on. You know your numbers and your pipeline is visible."

**Financial visibility:**

- Red: "You're running the business without a clear picture of the numbers. That's more common than you'd think — but it's risky."
- Amber: "You have a general sense of the money, but the details are fuzzy. Getting current books and real margin data would change how you make decisions."
- Blue: "Your financials are reasonably current. Closing the gap on job-level profitability would give you sharper pricing."
- Green: "You know your numbers. You price from real data and can see where the money goes."

**Scheduling:**

- Red: "Scheduling is mostly manual, and conflicts happen regularly. A centralized system would save hours every week."
- Amber: "You have some structure, but it still depends on one person or breaks down under volume."
- Blue: "Scheduling mostly works, but changes don't always reach everyone in time."
- Green: "Your scheduling is solid — automated, visible, and the team stays in sync."

**Communication:**

- Red: "Customer communication is manual and reactive. Reminders, follow-ups, and invoices depend on someone remembering to send them."
- Amber: "Messages go out, but each one is a manual effort. Automating the routine stuff would free up real time."
- Blue: "Some communication is automated, but there are still gaps where things depend on a person."
- Green: "Routine communication runs on autopilot. Your team's time goes to conversations that actually need a human."

**Employee Retention:**

- Red: "You don't have a clear picture of what your team is doing day-to-day. Issues surface late, usually when something breaks."
- Amber: "You check in with people individually, but there's no system giving you the full picture."
- Blue: "You have some visibility, but onboarding and performance feedback are still informal."
- Green: "You know what your team is doing, new hires get up to speed fast, and performance issues surface early."

---

## 6. Email Gate & Lead Capture

### Positioning

The gate appears after the last question, before results. Frame it as delivery, not extraction:

> "Your report is ready. Where should we send the full breakdown?"

**Fields:**

- First name (required)
- Email (required)
- Business name (required)
- Phone (optional — "In case you'd rather talk through your results")

### What happens on submit

1. Show results page immediately (no waiting)
2. In background:
   - Create entity in D1 with `source_pipeline: 'website_scorecard'`
   - Store full scorecard answers + scores as context entry
   - Set `pain_score` based on overall score (inverted — low health = high pain)
   - Set `stage: 'signal'` (or `prospect` if pain_score >= 7)
   - Queue PDF generation via Resend
3. PDF delivered to email within 60 seconds

### Pain score mapping

The scorecard health score (0-100, higher = healthier) needs to be inverted for the entity pipeline's pain score (1-10, higher = more pain):

| Health Score | Pain Score | Auto-stage |
| ------------ | ---------- | ---------- |
| 0-22         | 9-10       | prospect   |
| 23-44        | 7-8        | prospect   |
| 45-66        | 5-6        | signal     |
| 67-88        | 3-4        | signal     |
| 89-100       | 1-2        | signal     |

---

## 7. PDF Report

The emailed PDF includes everything on the results page, plus:

- **Per-dimension deep dive:** The scored level, what it means, and one concrete next step. The next step should be actionable without hiring us (builds trust, not dependency).
- **Vertical context:** "For [vertical] businesses your size, the areas that typically have the biggest impact are [top 2 from pain cluster]." Shows we understand their world.
- **About SMD Services:** Brief footer with who we are, what we do, and CTA to book.

**Design:** Clean, minimal. Matches site typography (Plus Jakarta Sans headers, Inter body). Navy (#1e40af) accent. No stock photos. 3-4 pages max.

**Generation:** Server-side via a headless template (HTML → PDF via Puppeteer or equivalent on Cloudflare). Sent via Resend.

---

## 8. Technical Architecture

### Routes

| Route                            | Purpose                                                      |
| -------------------------------- | ------------------------------------------------------------ |
| `/scorecard`                     | Landing + quiz + results (single-page app experience)        |
| `POST /api/scorecard/submit`     | Accepts answers, computes scores, creates entity, queues PDF |
| `GET /api/scorecard/report/[id]` | Serves the generated PDF                                     |

### Data model

**Scorecard submission** (stored as entity context entry):

```typescript
interface ScorecardSubmission {
  // Context
  vertical: Vertical
  employee_range: '1-5' | '6-10' | '11-25' | '26-50' | '50+'
  role: 'owner' | 'office_manager' | 'other'

  // Answers (18 questions, values 0-3)
  answers: Record<string, 0 | 1 | 2 | 3>

  // Computed scores
  dimension_scores: Record<
    ProblemId,
    {
      raw: number // 0-9
      scaled: number // 0-100
      label: 'needs_attention' | 'room_to_grow' | 'getting_there' | 'strong'
    }
  >

  overall_score: number // 0-100
  top_problems: ProblemId[] // bottom 2-3 dimensions

  // Lead capture
  first_name: string
  email: string
  business_name: string
  phone?: string

  // Meta
  completed_at: string // ISO 8601
  time_to_complete_seconds: number
}
```

### Client-side state

The quiz runs entirely client-side as a multi-step form (Astro with client-side JS — no framework needed). State is held in memory. On submit, one POST to the API. No intermediate saves (the quiz is short enough that abandonment recovery isn't worth the complexity for v1).

### Bot protection

- Honeypot field (same pattern as intake form)
- Minimum completion time check (reject if < 15 seconds — a human can't read 18 questions that fast)
- Rate limiting on the submit endpoint

---

## 9. Analytics & Tracking

Track these events (via the existing analytics pattern or a lightweight event log):

| Event                      | Data                                          |
| -------------------------- | --------------------------------------------- |
| `scorecard_started`        | vertical, employee_range, role, timestamp     |
| `scorecard_completed`      | overall_score, top_problems, time_to_complete |
| `scorecard_email_captured` | entity_id                                     |
| `scorecard_to_booking`     | entity_id (clicked book CTA from results)     |
| `scorecard_abandoned`      | last_question_answered, time_spent            |

Key metrics:

- **Start rate:** visitors who click "Start" / total page visits
- **Completion rate:** finished all 18 / started (target: 70%+)
- **Email capture rate:** submitted email / completed (target: 80%+)
- **Booking rate:** clicked book CTA / captured email (target: 10-15%)

---

## 10. Content & Voice

All copy follows the established standards:

- "We" voice (never "I")
- Objectives over problems — frame results as opportunity, not failure
- Non-judgmental — every score level is described as normal for a growing business
- No fixed timeframes or dollar amounts
- No tool names — we don't recommend specific software in the scorecard
- "Solution" not "systems" in any CTA or description

### Tone calibration

The scorecard should feel like the first 5 minutes of the assessment call: warm, curious, zero pressure. The owner should finish it thinking "these people get it" — not "these people are trying to sell me something."

---

## 11. Open Questions

1. **Dedicated page vs. homepage section?** Recommend dedicated `/scorecard` route for shareability and ad targeting, with a CTA on the homepage linking to it.

2. **Vertical-specific question variants?** v1 uses the same 18 questions for all verticals. Future: swap 2-3 questions per vertical for higher relevance (e.g., home services gets a question about estimate follow-up instead of generic lead follow-up).

3. **Retake behavior?** Allow unlimited retakes. Don't deduplicate by email in v1 — if someone retakes, create a new context entry. We can merge later.

4. **PDF generation on Cloudflare?** Puppeteer doesn't run on Workers. Options: (a) Cloudflare Browser Rendering API, (b) generate PDF on a separate Node service, (c) use a third-party API like PDFShift. Spike needed.

5. **Mobile experience?** One question per screen with swipe/tap. Progress bar at top. Must be fully functional on phone — many SMB owners will take this during a break or after hours.

---

## 12. Success Criteria

- 30%+ of visitors who land on `/scorecard` start the quiz
- 70%+ of starters complete all 18 questions
- 80%+ of completers submit their email
- 10-15% of email captures click through to book an assessment call
- Scorecard-originated entities convert to booked calls at 2x+ the rate of cold outbound
