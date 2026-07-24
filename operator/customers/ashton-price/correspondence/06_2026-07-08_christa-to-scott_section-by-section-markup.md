---
date: 2026-07-08T22:27:15Z
from: Christa@ashtonandprice.com
to: smdurgan@smdurgan.com
subject: RE: Litigation Lifecycle Solution
gmail_message_id: 19f43d7c650e482b
status: CANONICAL inbound — async acceptance-with-refinements (the M2 working session, in writing)
---

# Christa → Scott: section-by-section markup of the proposal

_Verbatim body. This is her markup of `../CLIENT-PROPOSAL.md`. It accepts the lifecycle model
and refines it, and resolves several open forks (deadline engine, CoCounsel, intake inbox). She
also asks for written answers on three open items: data handling/retention, the refusal-behavior
spec, and confirmation of the permission-tier structure. See `README.md` note on the
"data-handling questions" — they are not present in any prior email she sent._

Hi Scott,

This is a strong translation of what we walked through — you've got the shape of the practice right. Reacting section by section, plus the decisions on our end so you can keep moving.

Overall structure
The "you set the dial" framing is the right model, and I want it more granular than a single per-task setting. For each routine, I want three tiers available from day one: auto-handle, prepare-and-route-for-approval, and flag-only (no draft, just surface it). Discovery deadline calendaring and lien tracking start at flag-only or prepare-and-route across the board, full stop, regardless of how much trust it earns — nothing touching a deadline or money moves to auto-handle. Routine, non-time-sensitive items (folder setup, chronology entries, records intake logging) can graduate faster.

Discovery — the deadline question
We do not currently run Smokeball's court-rules calendaring tied to InfoTrack. Use that engine if it's available and accurate — I'd rather deadline math live in software built and maintained for that specific purpose than in a routine we're tuning by hand. If it doesn't cover a discovery type or service method cleanly, the Operator's own logic can fill the gap, but every date is confirmed by the attorney either way, no exceptions, and I want that confirmation logged with a timestamp and the attorney's name for the file.

Client verification — own it end to end as described. This is the leak we most want closed. Confirm the follow-up cadence is configurable per matter and that after a set number of unanswered attempts it escalates to a person rather than nagging indefinitely.

Separate statement — approved as described. Confirm the "reasons to compel" cells stay empty by default and there's no mode where it fills in an argument for the attorney.

Discovery you propound / meet-and-confer — agreed the decision to send anything stays with the attorney. That holds permanently, not something that graduates to auto-handle as trust builds — meet-and-confer letters and anything addressed to opposing counsel always require an explicit send action from a person.

Medical chronology — approved as described. One addition: flag treatment gaps over a set number of days automatically, since that's a recurring valuation and causation issue, not just a data-entry one.

Case initiation — approved. Confirm the folder/task templates are configurable per matter type (auto, premises, product liability, etc.).

Motions — approved for tracking and packet assembly. On drafting-tool division: we've opted not to move forward with CoCounsel, so that's no longer an open variable on our end. Proceed with BriefPoint and Claude as the drafting tools and build the routing accordingly.

Minor's compromise — approved. Keep the posture from the rehearsal: name what's missing (a GAL, a blocked account), don't infer it.

Trial prep — approved.

Mediation and settlement / liens — approved as described. To confirm: it never computes a net-to-client figure or fee reduction, only lays out the inputs as recorded. That line doesn't move even as trust builds.

Paralegal training layer — build the explanation visible by default, not a toggle someone forgets to turn on, at least for the first 90 days for anyone new to a task type.

Access and setup

- Smokeball connection: I'll coordinate the one-time authorization with our Smokeball owner.
- Discovery intake routing: set up a dedicated monitored inbox rather than routing through an existing staff inbox, so there's a clean audit trail of what the Operator saw and when.
- InfoTrack connection: approved to proceed.
- Tuning documents: I'll pull a representative set of served discovery and 2-3 closed matters spanning our case types. Confirm in writing how those documents are stored/processed during tuning and whether they're retained afterward or purged — this ties to the data-handling questions from my last email, which still stand.

Given my schedule, I'd rather not add a standing meeting right now. Please proceed on the items above and anything else that doesn't require my input, and send written answers on the open items (data handling/retention, the refusal-behavior spec, and confirmation on the permission-tier structure) so I can review and approve async. If something genuinely can't move without a live conversation, tell me specifically what it is and why, and I'll make time for that narrow item only.

Thanks,

C. Barrera
Operations Manager
Ashton & Price, LLP
(916) 727-9027 Direct
(916) 726-0678 Fax
