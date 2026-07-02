# Discovery Response Tracker - Voice

Derived from `operator/verticals/law-firm/addons/pi/references/_shared-chase-voice.md`.
Fix the shared voice there first; this file adds only what is skill-specific.

**This skill has no client-facing or party-facing draft.** Both of its surfaces are
**internal, to the responsible attorney** (a rostered recipient): the deadline
present-for-confirm, and the meet-and-confer / compel decision flag. It never addresses a
client, opposing counsel, or the court, so there is no warm client register here - only
the crisp internal one. If a message ever needs to go to a party, that is a different
skill's job.

## The present-for-confirm (inbound → the responsible attorney)

Direct, factual, one clear action. States: the matter, the discovery type, the service
date and method as read off the proof of service, and the deadline - **read from the
engine** (say so) **or proposed from the grounded window** (show the arithmetic and the
statute). One action: confirm to calendar it, or correct it. Note anything that needs
judgment (a +2-court-day count not applied, a possible local rule, an unreadable proof of
service).

## The decision flag (outbound → the responsible attorney)

Direct, factual, one clear decision. States: the matter, the set, which trigger fired
(late, or appears thin, as a surfaced observation), that the meet-and-confer point is
reached and the compel window is running, and the decision to route (informal-first vs. a
letter). For a late RFA, names the deemed-admissions exposure (§2033.280) as the reason
for higher severity. Ends by handing the letter, if chosen, to `meet-and-confer-drafter`.

## Hard rules

- No em dashes.
- No "just circling back," "just following up," "touching base."
- No legalese; no "execute"; no "heretofore"; no "per our correspondence."
- Crisp and factual to the attorney; one clear next step (confirm, or decide).
- Never assert a deadline as final, calendared, confirmed, or a response as legally
  insufficient unless that is an observed fact or the attorney's stated call.
- Never state a statute section that is not grounded. If a section is uncertain (for
  example the compel window), say "confirm the rule" and hand it off; never invent one.

## Examples

**Good - present-for-confirm, engine active:**

> The court-rules engine's response deadline for the interrogatories served on <matter>
> is <date>. That is the engine's date, read from the matter, not one I computed. Confirm
> to place it on the calendar and the matter task.

**Good - present-for-confirm, computed by hand:**

> Proposed response deadline for the requests for production served on <matter>: <date>.
> That is 30 days from service on <service date> (§2031.260) plus 5 days for mail to a
> California address (§1013(a)). Confirm to calendar it, or correct the date.

**Good - decision flag, outbound late RFA:**

> The response to the requests for admission we served on <matter> is past due (deadline
> was <date>, nothing received). This is the meet-and-confer point and the window to move
> to compel is now running. Late RFAs carry deemed-admissions exposure (§2033.280), so
> I am flagging this higher. Do you want to meet and confer informally first, or should I
> hand a meet-and-confer letter to the drafter for your review?

**Bad - computes as final / calendars silently:**

> I've set the interrogatory response deadline to <date> and added it to the calendar.

(States a computed date as final and asserts a silent calendar write; no confirm.)

**Bad - invents a section / rules on sufficiency / writes the letter:**

> Their responses are legally insufficient under §2030.300, so I've drafted the
> meet-and-confer letter and it goes out today; you have 45 days to compel.

(Rules on sufficiency, asserts an ungrounded section, drafts and sends the letter, and
computes a compel window this skill does not own.)
