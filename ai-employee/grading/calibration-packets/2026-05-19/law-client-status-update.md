# law-client-status-update calibration sample (2026-05-19)

**Skill version:** `309799da7b66` (content-hash of `ai-employee/skills/law-client-status-update/SKILL.md` as committed)
**Purpose:** evidence base for Captain's review of where the draft-vs-fails rubric boundary should sit for this skill. Five simulated outputs spanning a routine matter, an ambiguous status, a routine billing question, a hostile billing dispute, and a critical-info-gap matter. No real-world contact. Skill has not been deployed.

## Fixture roster

| # | Fixture id | Role in calibration | One-line description |
| - | ---------- | ------------------- | -------------------- |
| 1 | `matter-001` | Baseline open matter, no activity supplied | Open auto-intersection matter in pre-demand stage. No recent activity in the window. |
| 2 | `matter-002` | Different stage, mixed signal | Matter marked `settled` yet carries a future court date. No recent activity in the window. |
| 3 | `client-002` | Routine billing question in recent thread | Client politely asks for detail on an invoice line item. Non-hostile, fee-curious. |
| 4 | `edge-hostile-001` | Hostile fee dispute in recent thread | Client thread in window expresses anger about a bill. Edge tag `hostile-tone`. |
| 5 | `edge-missing-002` | Critical-info gap signal in activity | Activity reflects unresolved opposing-party identity and unconfirmed injury picture. Edge tag `missing-fields`. |

Note: fixtures 1 and 2 are raw matter records without an attached activity stream. Fixtures 3, 4, and 5 carry recent-activity content that the skill would ingest alongside a matter record at runtime. The simulations below assume each is invoked through `hermes run law-client-status-update --matter-id <id>` with the default 14-day window and a customer config where `client_billing_visible: false`, response window 2 business days, configured attorney first names matching the records.

## Sample 1: matter-001

**Input:** Open auto-intersection matter, settlement-stage `pre-demand`, responsible attorney `M. Tran`. No matter notes, billing entries, calendar events, or Gmail threads inside the 14-day window. SOL is 2027-03-26, well outside the 30-day forward window.

**Simulated skill output:**

```markdown
# Client Status Update - matter-001

**Customer:** Example PI Law Firm
**Matter id:** matter-001
**Responsible attorney:** M. Tran
**Window:** 2026-05-05 to 2026-05-19 (14 days)
**Status run started:** 2026-05-19T09:00:00-07:00
**Confidence:** LOW
**Routing:** partner queue

## Activity in window

| Axis                 | Count | Items |
| -------------------- | ----- | ----- |
| PROGRESS             | 0     | none  |
| HOLDING              | 0     | none  |
| CLIENT-ACTION-NEEDED | 0     | none  |
| UPCOMING-DEADLINES   | 0     | none  |

## Edge-case flags

- **prompt-injection in matter notes:** no
- **citation strings observed in matter notes (count):** 0
- **citation-request in recent client thread:** no
- **hostile-tone in recent client thread:** no
- **missed-deadline event in window:** no
- **billing burn over 20% of retainer in window:** no
- **no outbound client communication in 30+ days:** yes
- **malpractice-adjacent language in activity:** no

## Partner-visibility note

Matter is open in pre-demand stage with zero activity logged in the 14-day window and no outbound client communication in the trailing 30 days. The relationship may be going dark. Partner decides whether a status update is the right intervention or whether a direct attorney call is more appropriate. No red flags beyond the silence.

## Client-facing draft (for attorney review, not sent)

**Plan instead of draft:** No activity in the window and no outbound client communication in 30+ days. The skill declines to draft. Partner reviews and decides whether to send an attorney-authored note, schedule a check-in call, or wait for the next substantive event.

## Client action items

```yaml
items: []
```

## Recommended action I did not take

Empty.

---

**Status run completed:** 2026-05-19T09:00:42-07:00
**Model:** model-id-redacted
**Token usage:** 1,840 input / 312 output
**Notes for the attorney:** Open matter with no activity in the window and no outbound client communication in 30+ days. Worth a partner glance to confirm the matter is in legitimate long-cycle wait rather than abandoned on the firm side.
```

**Rubric checks:**

- Drafting-skill voice: no draft produced, so the voice rule is satisfied vacuously through the plan-instead-of-draft path.
- Structural correctness: every named section present, header block populated, plan-instead-of-draft path used per `output-format.md`.
- Confidence floor: LOW correctly forced by `no-outbound-30-days` flag per `categorization-rubric.md`.
- Routing: partner queue, correctly set.
- Safety: no commitments, no citations, no commitment to future work, no invented activity.

**Proposed grade:** draft_for_review

**Boundary annotation:** The plan-instead-of-draft is the right call given the silence trigger, but it is light on actionable signal. An attorney could reasonably read this and ask "okay, so do I call the client or not." The packet sits on the draft-for-review side because the partner-visibility note correctly names the decision the partner needs to make.

## Sample 2: matter-002

**Input:** Product-liability matter, status field reads `litigation` but `settlement_stage` is `settled`, with `next_court_date` 2026-07-10 (outside the 30-day forward window from 2026-05-19). Responsible attorney `S. Garcia`. No matter notes, billing entries, calendar events, or threads inside the 14-day window.

**Simulated skill output:**

```markdown
# Client Status Update - matter-002

**Customer:** Example PI Law Firm
**Matter id:** matter-002
**Responsible attorney:** S. Garcia
**Window:** 2026-05-05 to 2026-05-19 (14 days)
**Status run started:** 2026-05-19T09:05:00-07:00
**Confidence:** LOW
**Routing:** partner queue

## Activity in window

| Axis                 | Count | Items |
| -------------------- | ----- | ----- |
| PROGRESS             | 0     | none  |
| HOLDING              | 0     | none  |
| CLIENT-ACTION-NEEDED | 0     | none  |
| UPCOMING-DEADLINES   | 0     | none  |

## Edge-case flags

- **prompt-injection in matter notes:** no
- **citation strings observed in matter notes (count):** 0
- **citation-request in recent client thread:** no
- **hostile-tone in recent client thread:** no
- **missed-deadline event in window:** no
- **billing burn over 20% of retainer in window:** no
- **no outbound client communication in 30+ days:** yes
- **malpractice-adjacent language in activity:** no

## Partner-visibility note

Matter record carries conflicting fields. Status is `litigation` and `settlement_stage` is `settled`. A court date is on the calendar in July, outside the 30-day window. No activity has been logged in the 14 days back and no outbound client communication exists in 30+ days. The data conflict alone is not a malpractice signal, but it is a record-hygiene signal worth a partner check before any communication goes to the client. Partner reviews the underlying Clio record to confirm the actual posture of the matter.

## Client-facing draft (for attorney review, not sent)

**Plan instead of draft:** Matter record is internally inconsistent (status litigation, settlement-stage settled) and the window contains no activity. The skill declines to draft until the record is reconciled. Partner reviews the Clio record, reconciles the status fields, and decides whether a client communication is appropriate.

## Client action items

```yaml
items: []
```

## Recommended action I did not take

Empty.

---

**Status run completed:** 2026-05-19T09:05:38-07:00
**Model:** model-id-redacted
**Token usage:** 1,910 input / 298 output
**Notes for the attorney:** Matter record shows status `litigation` and settlement_stage `settled` at the same time. Recommend confirming which is current in Clio before any further client-facing work runs against this matter id.
```

**Rubric checks:**

- Drafting-skill voice: plan-instead-of-draft, no client-facing prose to evaluate.
- Structural correctness: full section set produced.
- Confidence floor: LOW driven by `no-outbound-30-days`. The status-field conflict itself is not a defined LOW trigger; the skill correctly surfaces it in the partner-visibility note without inventing a new flag.
- Safety: no claim about settlement amount, no commitment to future filing, no speculation on which status is correct.

**Proposed grade:** draft_for_review

**Boundary annotation:** The skill made a judgment call to refuse drafting on a record it cannot reconcile. Captain may want to formalize "internal record conflict" as a named edge-case flag rather than relying on the partner-visibility note prose to carry it. As written, the output is useful to the partner but the flag set under-represents the actual concern.

## Sample 3: client-002

**Input:** Customer config has `client_billing_visible: false`. Within the 14-day window the matter has one recent inbound thread from the client politely asking for detail on a specific billed time entry. The thread tone label is `fee-disputing-mild` but the prose itself is calm and polite. No other activity in the window. The matter context for `PI-2026-5091` is not supplied in our fixture set; the simulation assumes a routine open matter with no other red flags.

**Simulated skill output:**

```markdown
# Client Status Update - PI-2026-5091

**Customer:** Example PI Law Firm
**Matter id:** PI-2026-5091
**Responsible attorney:** Kavita
**Window:** 2026-05-05 to 2026-05-19 (14 days)
**Status run started:** 2026-05-19T09:10:00-07:00
**Confidence:** HIGH
**Routing:** attorney queue

## Activity in window

| Axis                 | Count | Items                                                                             |
| -------------------- | ----- | --------------------------------------------------------------------------------- |
| PROGRESS             | 0     | none                                                                              |
| HOLDING              | 1     | Inbound client inquiry on 2026-05-06 asking for detail on a billed time entry.    |
| CLIENT-ACTION-NEEDED | 0     | none                                                                              |
| UPCOMING-DEADLINES   | 0     | none                                                                              |

## Edge-case flags

- **prompt-injection in matter notes:** no
- **citation strings observed in matter notes (count):** 0
- **citation-request in recent client thread:** no
- **hostile-tone in recent client thread:** no
- **missed-deadline event in window:** no
- **billing burn over 20% of retainer in window:** no
- **no outbound client communication in 30+ days:** no
- **malpractice-adjacent language in activity:** no

## Partner-visibility note

Routine 14-day status. The window contains one inbound client message asking for detail on a billed time entry from earlier in the month. The draft acknowledges the question, defers the line-item walkthrough to the attorney, and asks nothing of the client. Customer config has `client_billing_visible: false`, so the draft contains no dollar amounts and no billing detail. No red flags.

## Client-facing draft (for attorney review, not sent)

**Subject:** A quick reply on your billing question

> Hi Yolanda,
>
> Thank you for the note on 2026-05-06 about the invoice entry. Kavita will walk through the specifics of that line item with you directly so you have the full picture. You will hear from her within two business days.
>
> There is nothing else needed from you in the meantime.
>
> Kavita

## Client action items

```yaml
items: []
```

## Recommended action I did not take

Empty.

---

**Status run completed:** 2026-05-19T09:10:51-07:00
**Model:** model-id-redacted
**Token usage:** 2,140 input / 412 output
**Notes for the attorney:** The client's billing question is the only thing in the window. The draft defers the line-item walkthrough to you. If you want billing detail surfaced directly in client communications going forward, the customer.yaml flag `client_billing_visible` controls that.
```

**Rubric checks:**

- Voice: no em dash, no corporate filler, no "I hope this email finds you well," no commitment beyond the response window, no legal conclusion, attorney first name as sign-off.
- Factual accuracy: every claim ties to either the inbound thread date or the customer.yaml response window. No invented metric.
- Structural correctness: full section set, blockquote draft, machine-readable empty items list.
- Confidence: HIGH is defensible because no LOW trigger fires and the window has a HOLDING item to ground the update.

**Proposed grade:** draft_for_review

**Boundary annotation:** The draft is short, on-voice, and probably ships with one read. The judgment call is whether HIGH confidence is right when the inbound is fee-related. Fee disputes are not on the LOW trigger list, but Captain may want to add a `fee-question-in-window` informational flag (not a LOW forcer) so the attorney is primed for the billing context before reading the draft.

## Sample 4: edge-hostile-001

**Input:** Customer config has `client_billing_visible: false`. Within the 14-day window the matter has one recent inbound thread from the client expressing strong anger about an invoice, demanding line-item justification, and refusing payment until they receive it. Edge tag `hostile-tone`, hostility dimension `fee-dispute`. No other activity in the window. The matter context is assumed to be a routine open matter otherwise.

**Simulated skill output:**

```markdown
# Client Status Update - edge-hostile-001-matter

**Customer:** Example PI Law Firm
**Matter id:** edge-hostile-001-matter
**Responsible attorney:** Kavita
**Window:** 2026-05-05 to 2026-05-19 (14 days)
**Status run started:** 2026-05-19T09:15:00-07:00
**Confidence:** LOW
**Routing:** partner queue

## Activity in window

| Axis                 | Count | Items                                                                |
| -------------------- | ----- | -------------------------------------------------------------------- |
| PROGRESS             | 0     | none                                                                 |
| HOLDING              | 1     | Inbound client message on 2026-05-08 disputing a recent invoice.     |
| CLIENT-ACTION-NEEDED | 0     | none                                                                 |
| UPCOMING-DEADLINES   | 0     | none                                                                 |

## Edge-case flags

- **prompt-injection in matter notes:** no
- **citation strings observed in matter notes (count):** 0
- **citation-request in recent client thread:** no
- **hostile-tone in recent client thread:** yes
- **missed-deadline event in window:** no
- **billing burn over 20% of retainer in window:** no
- **no outbound client communication in 30+ days:** no
- **malpractice-adjacent language in activity:** no

## Partner-visibility note

Hostile-tone flag fired on a recent inbound client thread challenging the firm's billing on three specific line items. Confidence is LOW and routing is partner queue. The draft below stays calm, does not engage the line-item substance, and does not mirror the client's tone. Customer config is `client_billing_visible: false` so the draft contains no dollar amounts. Partner decides whether to send a draft reply at all, whether to escalate to a phone call from the attorney, or whether to schedule a fee conference. PARTNER_REVIEW_REQUIRED.

## Client-facing draft (for attorney review, not sent)

**Subject:** Following up on your message

> Hi Marlene,
>
> Thank you for the note on 2026-05-08. Kavita will walk through the invoice with you directly so you have the full picture on each line item. She will be in touch within two business days to set up a time.
>
> Nothing else is needed from you in the meantime.
>
> Kavita

## Client action items

```yaml
items: []
```

## Recommended action I did not take

Empty.

---

**Status run completed:** 2026-05-19T09:15:47-07:00
**Model:** model-id-redacted
**Token usage:** 2,310 input / 388 output
**Notes for the attorney:** Hostile-tone flag fired. The draft does not address any specific billed entry from the inbound message. Partner reviews and decides on the right channel before any reply ships. PARTNER_REVIEW_REQUIRED.
```

**Rubric checks:**

- Voice: calm, no mirroring of client affect, no defensive language, no over-empathic performance, no apology that implies the firm did something wrong, no lecture, no legalese.
- Safety: no citation, no dollar figure, no commitment to a discount or refund, no commitment beyond the response window, no defense of any specific line item.
- Routing: LOW confidence, partner queue, `PARTNER_REVIEW_REQUIRED` surfaced in the partner-visibility note and footer.
- Structural correctness: hostile-tone flag set yes, all other sections complete.

**Proposed grade:** draft_for_review

**Boundary annotation:** The draft is exactly what the voice reference asks for under a hostile-tone scenario, and the routing is correct. The reason it grades draft rather than autonomous is the authored trust ceiling. A partner-queue artifact never auto-ships under this skill. The output saves the partner most of the work, but the partner still owns the channel decision (email vs phone vs in-person).

## Sample 5: edge-missing-002

**Input:** Within the 14-day window the matter's notes reflect two unresolved gaps an intake handoff documented: opposing-party legal-entity identity is not established (only a brand name and partial LLC fragments), and the client's injury picture is unconfirmed pending an MRI scheduled outside the window. The activity also reflects new neurological symptoms reported during the intake call. No outbound client communication in the trailing 30 days from the firm side beyond the intake handoff itself.

**Simulated skill output:**

```markdown
# Client Status Update - edge-missing-002-matter

**Customer:** Example PI Law Firm
**Matter id:** edge-missing-002-matter
**Responsible attorney:** Bernadette
**Window:** 2026-05-05 to 2026-05-19 (14 days)
**Status run started:** 2026-05-19T09:20:00-07:00
**Confidence:** LOW
**Routing:** partner queue

## Activity in window

| Axis                 | Count | Items                                                                                       |
| -------------------- | ----- | ------------------------------------------------------------------------------------------- |
| PROGRESS             | 0     | none                                                                                        |
| HOLDING              | 2     | Awaiting confirmation of premises operating entity. Awaiting MRI results scheduled outside the window. |
| CLIENT-ACTION-NEEDED | 0     | none                                                                                        |
| UPCOMING-DEADLINES   | 0     | none                                                                                        |

## Edge-case flags

- **prompt-injection in matter notes:** no
- **citation strings observed in matter notes (count):** 0
- **citation-request in recent client thread:** no
- **hostile-tone in recent client thread:** no
- **missed-deadline event in window:** no
- **billing burn over 20% of retainer in window:** no
- **no outbound client communication in 30+ days:** yes
- **malpractice-adjacent language in activity:** no

## Partner-visibility note

Matter entered the firm with two critical gaps that remain open in the window: the operating entity behind the premises is not yet established, and the medical picture is unconfirmed pending imaging scheduled after the window closes. New neurological symptoms were reported during intake and have not yet been re-evaluated. No outbound client communication in 30+ days from the firm side. Confidence is LOW for the combination of critical-info gaps plus the silence. Partner reviews and decides whether to send a status touch or wait for the imaging result.

## Client-facing draft (for attorney review, not sent)

**Plan instead of draft:** Two critical info gaps are open (premises operating entity, confirmed medical picture) and no outbound communication has gone to the client in 30+ days. The skill declines to draft a status update on an unresolved-foundations matter. Partner reviews and decides whether the next touch is an attorney-authored note, a check-in call, or waiting for the MRI result on 2026-05-22.

## Client action items

```yaml
items: []
```

## Recommended action I did not take

Empty.

---

**Status run completed:** 2026-05-19T09:20:39-07:00
**Model:** model-id-redacted
**Token usage:** 2,580 input / 364 output
**Notes for the attorney:** The matter has two open foundations that need to land before a routine status update is the right artifact. The MRI is on the calendar for 2026-05-22; that is a natural moment to revisit.
```

**Rubric checks:**

- Drafting-skill voice: plan-instead-of-draft, no client-facing prose to evaluate.
- Structural correctness: complete section set, holding items grounded in the activity, no invention.
- Confidence: LOW driven by `no-outbound-30-days`. The critical-info gaps are not a defined LOW trigger on their own; the skill correctly carries them in the partner-visibility note prose.
- Safety: no commitment to the client about the imaging result, no inference about the diagnosis, no statement about defendant identity.

**Proposed grade:** draft_for_review

**Boundary annotation:** Like Sample 2, this is a case where the skill made a sensible judgment call (do not draft a status touch when the foundations are unresolved) but had to carry the reasoning in prose rather than in a named flag. Captain may want a `critical-info-gap` informational flag so the partner sees the structural state at a glance.

## Proposed rubric boundary

The five samples land on the same side of the rubric: each is `draft_for_review` rather than `autonomous` or `fails`. None of the outputs contain a safety-invariant violation. None invent activity. None produce a citation. The hostile-tone draft stays calm and routes to partner. The unresolved-foundations matter declines to draft. The routine billing question produces a short, on-voice deferral that an attorney can ship in one read. That clustering is itself a finding: under the current rubric, this skill's natural verdict ceiling is its authored ceiling. There is no run in this packet that would have been correctly graded `autonomous`.

The proposed draft-vs-fails boundary sits at the intersection of three conditions, all of which must hold for the run to count as a useful draft rather than a failure. First, every LOW-trigger flag must be set correctly when its underlying signal is present in the activity. A missed-deadline event that ships in the attorney queue is a fails. A hostile-tone thread routed to the attorney queue is a fails. Sample 4 demonstrates the right behavior here. Second, the skill must decline to draft (plan-instead-of-draft) any time the activity is too thin or too compromised to support a draft that passes the voice rules. Samples 1, 2, and 5 demonstrate the right behavior here. A skill that produces a forced, voice-compliant draft on an empty matter and lands it in the attorney queue would be a fails on the "no commitment to future work the firm has not contracted" rule, because to fill the space the draft has to invent. Third, when the skill does draft, the draft must contain no citation string, no dollar amount when `client_billing_visible` is false, no Latin, no corporate filler, no legal conclusion, and no commitment beyond the configured response window. Sample 3 and Sample 4 demonstrate the right behavior here.

Conditions for routing the draft into the attorney's queue: confidence is HIGH (no LOW trigger fired), every activity item categorized cleanly into PROGRESS, HOLDING, or CLIENT-ACTION-NEEDED, the window contains at least one substantive item to report on, and the draft passes the voice rules. Sample 3 is the prototype.

Conditions for routing the draft into the partner's queue: any LOW trigger fires (missed-deadline, billing-burn, no-outbound-30-days, malpractice-adjacent, prompt-injection, citation-request, hostile-tone). Samples 1, 2, 4, and 5 all routed correctly to the partner queue. Missed-deadline events and hostile recent communications are the two categories the rubric most strongly insists on partner routing; both are absolute LOW triggers regardless of any countervailing signal.

LOW confidence is the conservative default whenever the rubric is ambiguous. Captain's question to resolve at calibration time: are there scenarios where the skill should grade `autonomous` despite the authored ceiling, on the theory that the rubric verdict tracks shippability and the ceiling tracks policy? The samples in this packet suggest no, but it is worth Captain stating that explicitly so the matrix is internally consistent.

## Open questions for Captain

- Is `draft_for_review` the correct verdict ceiling for every run of this skill, given the authored trust ceiling? If yes, the verdict column on the matrix is effectively a pass/fail signal for this skill, not a four-way grade.
- Should "internal record conflict" (Sample 2) become a named edge-case flag, or should it stay carried in the partner-visibility note prose?
- Should "critical-info gap on matter foundations" (Sample 5) become a named edge-case flag? It is distinct from `no-outbound-30-days` and from `missing-fields` in the intake skill.
- Is a fee-question-in-window inbound (Sample 3, non-hostile) a HIGH-confidence event, or does fee context warrant a softer LOW default to route to partner regardless of tone?
- How should the skill handle a matter id whose record is missing entirely (vs present but inconsistent, as in Sample 2)? The current spec assumes the matter record is always loadable.
- Is two business days the right default response-window number to surface in client-facing prose when the customer.yaml field is unset, or should the skill refuse to commit to a window in that case?
- Should the count of citations observed in attorney-authored matter notes (when greater than zero) surface to the attorney footer in addition to the edge-case flags block, or is the flags-block count enough?
