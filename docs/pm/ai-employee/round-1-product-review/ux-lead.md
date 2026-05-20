# UX Lead Perspective — Round 1

**Author:** ux-lead. **Date:** 2026-05-20. **Scope:** UX-lens read of the full corpus — platform PRD, law-firm PRD, the 11 specs in PR #831, customer-zero substrate in PR #812, ADRs 0004–0009, prior PRD-round-1 UX critique. Goal is not to redo the 7-tab IA the prior critique already specified — it is to ask which UX commitments survive contact with the new specs and what beta-1 still cannot ship without.

## Stance on existing material

**REFINE_IN_PLACE.** The prior UX critique drove most of its recommendations directly into PR #831 specs — reviewer-as-sender, 7-tab IA, multi-user roles, 60-second mobile loop, "What Marcus used" sourcing, Day-1 walkthrough, voice-gate fallback are all spec'd. What remains is the small set of UX surfaces specs reference but do not yet design, and commitments specs locked that I would push back on before they become foundations. Close enough to demo, not yet close enough to **ship a paid customer**, and the gap is UX-shaped.

---

## What's right

- **Reviewer-as-sender is architecture now, not paragraph.** Platform PRD §9.2 + §13.1 + ADR 0005 + `spec-mobile-approval-flow.md` Screen 5 confirmation copy make the abstraction concrete and user-visible.
- **"What Marcus used to write this" survived from concept to spec.** Screen 4 names the sources and points to `audit_log.input_digest` resolution — most underrated trust mechanism in the product.
- **Multi-user role model is load-bearing v1.** `spec-dashboard-roles.md` resolves platform PRD §19 with a per-tab per-action permission matrix plus "Operator may approve" toggle (line 51). "Maria in the room" reads correctly.
- **Voice-gate fallback has operational doctrine.** `spec-voice-gate-fallback.md` Pass / Near-pass / Fail with Path A internal-drafts-only and Path B pause — right shape for the most likely beta-1 awkward moment.
- **Compliance packet has a Susan-readable first page.** `spec-compliance-evidence-packet.md` 00-README is plain-language and reads in 60 seconds — specifying it as a content artifact rather than "we will produce a packet" is the right move.
- **Day-1 onboarding is screen-by-screen, not prose.** `spec-day-1-onboarding.md` covers 9 screens, audit events per step, resume-on-abandon, operator/compliance divergence.

## What's wrong

- **9-screen walkthrough will be skipped, and the spec admits it in a footnote.** `spec-day-1-onboarding.md` line 267 acknowledges principals skip walkthroughs. Designing a 12-minute walkthrough the buyer will not run is a failure mode the spec should solve, not footnote. **Direction:** collapse principal walkthrough to two screens (Welcome + Go-live, ~90s). Operator gets the 7-screen substantive sequence.
- **"What Marcus used" is collapsed by default.** Screen 4 hides the sourcing block behind a tap. This is the trust mechanism the prior critique fought to get specified; collapsing it makes the product feel like every other AI-draft tool. **Direction:** show the top source line inline ("Sources: Hendricks matter, 2 memory rules"); tap-to-expand for full list.
- **Send-confirmation copy is technically wrong.** Architecture (platform PRD §9.2) drops the draft *into* Outlook drafts under the reviewer's identity — the reviewer still opens Outlook and presses send. The mobile "Send" button does not send to Karen Chen; it moves the draft from queue into drafts. **Direction:** rename button to "Approve & send to my drafts" and modal copy to "This puts the draft in your Outlook drafts under your account. You'll send it from there." Current copy collapses two distinct steps; partner will look for the sent message in Sent folder and not find it.
- **Morning digest is summary-only; per-item phone scan was lost.** Screen 1 shows totals + a "top item" callout, no per-draft preview list. The 60-second phone scan needs the five-item plain-text list so the partner can decide which to open first; current digest forces them into Queue for any decisioning. **Direction:** restore the prior critique's plain-text per-item digest with opening sentence per draft. "[Open Queue]" stays as primary action.
- **Voice cohort UX is spec'd at the data layer, not partner-facing.** Screen 4 surfaces "Voice cohort: anxious-client" as a sourcing field. Fine for operator. For the principal at 8am, "anxious-client" is a label they did not author and reads as the agent's editorial about the recipient. **Direction:** internally name the cohort but display as relationship descriptor — "Tone matched to: how you write to clients." Don't surface internal categorization vocabulary on the daily surface.

## What's missing

- **No "first draft sent" moment.** Blind-test gate, go-live confirmation, audit events for promotions — no acknowledgement when the first real client-facing draft goes out. This is when beta-1 trust commits. Today tab the day after first external send should name what just happened, even one line; otherwise the dashboard treats it as the 48th routine event.
- **No fast path for "draft is wrong, client is waiting, I am on my phone."** Mobile flow has Edit / Flag / Send. Edit is hostile on mobile past three sentences. Flag hands to operator. Reject deletes and learns. No path for "I'll handle this from my desk in 20 minutes; remove from queue, do not learn from this rejection." **Direction:** "Snooze to desktop" action that dequeues without rejecting or learning.
- **No "where is the agent right now" signal.** Today shows volume, not current activity. In a flat-retainer productized service, "is it working right now" is a week-2 question. Captain-only telemetry (§15.1) is internal. **Direction:** live-activity line on Today — "Marcus is processing 3 new inbox items" or "Marcus is idle — waiting for inbox events." Cheapest possible aliveness signal; absence will be felt.
- **Onboarding has no place for the partner's "but what about" question.** Walkthrough assumes config is correct. Real partners have one question per screen. No inline "ask the Captain" affordance. First call comes Day-2 8:01am. **Direction:** every screen has a "Question for Scott?" footer that opens a one-line note → email to Captain. Cheap; kills a class of week-1 frustration.
- **Audit tab is designed for Susan but not for Margaret.** `spec-compliance-evidence-packet.md` is excellent for compliance counsel. The prior critique's "What Marcus saw this week" scope view is a different surface. Current spec collapses both into Audit. **Direction:** keep separate. Partner sees filterable read trail at human time scale. Compliance generates the packet from a different UI. Different products, one log.
- **No handling of "I see your draft Tuesday and it sounds nothing like me."** Voice violations get a self-corrected log entry. Edit-then-send updates voice models. No UI for "this whole draft is off; recalibrate." Memory tab's "What Marcus learned this week" has per-rule Revert but no "voice has drifted" escalation. **Direction:** "Voice feels off" affordance on draft detail flags the draft to Captain for an out-of-cycle voice review. Maps §9.6 quarterly adversarial drift metric, but customer-initiated.

## Top 5 UX risks to ship

1. **Principal abandons walkthrough; Captain has no fallback.** Mitigation: collapse principal walkthrough to 2 screens; operator gets the 7-screen flow; Captain-led demo close becomes the substantive walkthrough.
2. **Send-confirmation copy implies sending to client when it actually moves draft into Outlook drafts.** Mitigation: rewrite button label + modal copy to name the two-step pattern.
3. **Sourcing block hidden by default makes product feel like every other AI tool.** Mitigation: surface one source line inline; tap-to-expand for full list.
4. **Morning digest is summary-only; loses 60-second phone scan affordance.** Mitigation: restore per-draft plain-text preview list with opening sentence.
5. **No customer-facing "agent is alive right now" signal.** Mitigation: add live-activity line to Today tab.

## Sample screen flow: Margaret approves a draft from her phone, 8:04am, week 3

1. **iOS Mail inbox.** Digest email from marcus@smithfield-pi.com — five items plain text, one-line opening preview each, "[Open Queue]" at bottom. She sees item 2 is the Karen Chen follow-up she has been waiting for. **Trust signal present:** digest reads like Marcus, not a SaaS notification.
2. **Tap "[Open Queue]" → Clerk magic-link (already logged in, ≤2s) → Queue.** Five priority-dotted cards; tap card 2. **Trust signal present:** per-card preview matches the digest; no surprise items.
3. **Draft detail.** To/Subject up top. Body: 4-sentence draft in her voice. Below body, visible without expanding: "Sources: Hendricks matter, 2 memory rules. Tap for detail." **Trust signal currently weak:** sourcing is one tap away, not inline. *Fix above.*
4. **Tap "Approve & send to my drafts."** Modal: "This puts the draft in your Outlook drafts under your account. Send it from Outlook when you're ready." Tap Approve. **Trust signal currently weak:** spec copy says "Send to Karen" which is not what happens. *Fix above.*
5. **Next draft auto-loads.** Edits one sentence inline, Approve, confirm, next. End: "All caught up. Your Outlook drafts has 5 items waiting." **Trust signal present:** end-state names where to find the work, completing the two-step mental model.

Loop is 60-75 seconds with the sourcing-and-copy fixes; 90+ seconds as currently specified because she will read the modal twice on first send to figure out what happened.
