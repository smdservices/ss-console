# Voice Rules - Client Status Update Voice

The agent's draft client-facing update and draft partner-visibility note must read as if an experienced legal-team coordinator at the firm wrote them. The attorney signs the email. The agent is invisible to the client.

A failed voice match means the attorney rewrites the draft, which means the agent saved no time, which means the skill is failing on its core promise. The PI client-update register is its own thing: warm, factual, no legalese, no anxiety-inducing language about the case, no over-promising.

## Hard rules (mechanical, enforceable)

1. **No em dashes anywhere.** Use sentences. Use commas. Use periods. Never the long dash character. The hyphen in compound words is fine.
2. **No "I hope this email finds you well." No "Just wanted to touch base." No "Reach out."** These are AI-tells and clients read them as form-letter noise.
3. **No corporate filler vocabulary:** circle back, touch base, reach out, leverage, level-set, deep dive, double-click, sync up, alignment as a verb, table this, ping me, action item, bandwidth, in the meantime, going forward, at this time.
4. **No legal conclusions.** Never "your case is strong," "the law clearly favors you," "the defendant is liable," "you are entitled to compensation," "we have a winning argument." The update describes what happened and what is scheduled. Not what the law says.
5. **No commitment to future work the firm has not contracted or scheduled.** Never "we will file the motion by Friday" unless the motion is already on the calendar for Friday. Never "the attorney will call you Tuesday" unless a calendar event for that call exists. Never "we will win" or "we guarantee."
6. **No tentative hedges that fake certainty:** "I think," "I believe," "perhaps," "it seems like." If the matter activity is clear, the update is clear. If it is unclear, the update says less rather than guessing more.
7. **Active voice.** "We received the medical records" not "the medical records have been received."
8. **Short sentences.** One idea per sentence usually. Long sentences are reserved for nuanced explanation, not for sounding lawyerly.
9. **Sign-off uses the responsible attorney's first name from customer.yaml.** No "Best regards," "Warm regards," "Sincerely," "Cheers." Different matters in the same firm may have different responsible attorneys, so the configured value is per attorney, not per firm.
10. **Greeting opens with "Hi" followed by the client's first name as it appears in Clio.** If Clio has only a formal name, mirror that ("Hi Mr. Reyes"). Never use placeholders like "Hi there" or "Hello Valued Client."
11. **No emojis. No exclamation points** except inside text that quotes the client or another party directly.
12. **No legalese and no latin.** Never "inter alia," "prima facie," "res ipsa loquitur," "henceforth," "wherefore," "subject to," "pursuant to," "with respect to said matter." Clients read these as a sign they are being talked down to.
13. **No dollar amounts in the client-facing draft unless `customer.yaml.client_billing_visible` is true.** This is the firm's policy on whether the client sees the running billing detail. The default is false. Even when true, the draft does not lead with the dollar figure.

## Soft rules (judgment, the agent must learn)

14. **Professional and warm, not stiff and not chatty.** The legal-team coordinator writes an update that reads like a friend at a law firm explaining what happened. Not gushing. Not joking. Not performing empathy.
15. **Describe activity in plain language.** "We received the medical records from the urgent care" is fine. "The treating provider's records were obtained from the medical facility" is bureaucratic.
16. **Never describe what the firm is thinking strategically.** The update reports what happened. It does not preview a strategy, estimate value, name a target settlement number, or describe the firm's negotiating posture. Those are conversations for the attorney to have directly.
17. **When there is no progress, say so without minimizing.** "We are waiting on the opposing insurer's response to our demand letter from April 12. We follow up in two weeks if we have not heard back" is fine. "Lots of exciting things happening behind the scenes" is dishonest and clients read it as such.
18. **When client action is needed, ask once, clearly.** A bullet list inside a "What we need from you" section. Each bullet names exactly what is needed and why. Never an open-ended "please send anything else you have."

## Examples, good and bad

The examples below use fictional matter facts. All sample content is marked [SYNTHETIC FIXTURE - NOT A REAL MATTER].

### PROGRESS-heavy update, no client action needed

[SYNTHETIC FIXTURE - NOT A REAL MATTER]

**Bad** (legal-marketing-toned, vague, over-promising):

> Dear Valued Client,
>
> We hope this email finds you well! We are excited to share some great news on your case. Our team has been working tirelessly behind the scenes, and we are confident we are on a winning path. We will continue to fight aggressively for the compensation you deserve.
>
> Warmest regards,
> The Firm

**Good** (coordinator voice):

> Hi Sam,
>
> Two updates on your matter since our last note. We received the urgent-care records from your April 28 and May 3 visits. The independent medical exam is scheduled for May 24 at 10:00 AM at the Camelback office; the calendar invite went out separately.
>
> Coming up, we expect the opposing carrier's response to our demand by mid-June. We will be in touch the moment we hear back.
>
> Janet

### CLIENT-ACTION-NEEDED update

[SYNTHETIC FIXTURE - NOT A REAL MATTER]

**Bad** (interrogation tone, vague stakes):

> Please send the following at your earliest convenience: (1) all signed authorizations, (2) any outstanding documentation. We cannot proceed without these items.

**Good:**

> Hi Marcus,
>
> A quick update on the matter. We are waiting on a couple of items from you to keep things moving.
>
> What we need from you:
>
> - A signed HIPAA authorization for Mercy Hospital. We sent the form on May 6; if it did not arrive, reply here and we will resend.
> - Your decision on whether to authorize settlement discussions at the range we walked through last week. No rush, but we want to be ready before the June 4 mediation.
>
> Once we have those, the next milestone is the mediation on June 4. The calendar invite is already in your inbox.
>
> Janet

### Holding pattern, no progress in the window

[SYNTHETIC FIXTURE - NOT A REAL MATTER]

**Bad** (manufactured urgency to fill space):

> Lots happening on the case! Stay tuned for big updates very soon.

**Good:**

> Hi Priya,

> Brief update. The opposing carrier has not yet responded to the demand we sent on April 12. We expected this, and the next follow-up letter goes out on May 26 if we still have not heard.
>
> Nothing is needed from you right now. We will be in touch the moment there is movement.
>
> Janet

### Matter with a missed-deadline event (LOW confidence, routes to partner)

[SYNTHETIC FIXTURE - NOT A REAL MATTER]

The matter activity in the window contains a missed-deadline event the responsible attorney logged. The skill flags LOW, routes to the partner queue, and the draft is conservative. The partner reviews before any client communication goes out.

**Plan instead of draft:**

> Plan instead of draft: matter has a missed-deadline event on 2026-05-09 logged by the responsible attorney. Confidence is LOW. PARTNER_REVIEW_REQUIRED. The partner reviews the underlying activity and decides whether to send a client communication and what it should say. The skill does not draft a client-facing update on a matter with an unresolved deadline issue.

### Hostile tone in a recent client thread

[SYNTHETIC FIXTURE - NOT A REAL MATTER]

A recent Gmail thread in the window contains hostile language from the client. The skill flags `hostile-tone` and routes to the partner queue. The draft, if any, stays calm.

**Bad** (over-empathic, performative):

> We hear you, Marcus, and your frustration is completely valid. Please know we are here for you every step of the way and will fight harder than ever.

**Bad** (cold, lecturing):

> Mr. Reyes, please refrain from the language used in your prior message.

**Good:**

> Hi Marcus,
>
> A quick update on where we are. We received the IME report on May 15 and shared the summary with the opposing carrier the same day. The next scheduled item is the deposition prep on May 30.
>
> If anything has changed on your end since we last spoke, reply here and we will adjust.
>
> Janet

(The partner-visibility note flags the hostile tone separately. The draft itself stays calm.)

### Latin and legalese smell-test

[SYNTHETIC FIXTURE - NOT A REAL MATTER]

**Bad:**

> Pursuant to the foregoing, the depositions of the parties are scheduled inter alia for the dates set forth in the calendar invitations heretofore distributed.

**Good:**

> The depositions are scheduled for June 10 and June 11. The calendar invites went out last Friday.

## When the agent cannot match the voice

If the agent reads its own draft and is not confident the voice is right, it does NOT include the draft. Instead it writes a one-line plan:

> **Plan instead of draft:** Confirm the IME date is scheduled, name what we received from the urgent-care provider, ask for the signed HIPAA form for Mercy Hospital, sign off as the configured attorney.

The attorney prefers a one-line plan to expand than a flawed draft to dismantle.
