# Law pack — N=0 deliverability proof

The deliverability gate (per the build plan): with **no customer-specific data**, can the pack produce connective artifacts a real small-firm practitioner would send with only light edits? Below are the five core connective tasks hand-drafted against two synthetic intakes. Every one is **substance-free** — intake, scheduling, chasing, status, logging. None gives legal advice or touches legal substance (the UPL boundary in the brief).

Bracketed values are the only fields that need filling. These double as the pack's `templates[]` (see `vertical.yaml`).

---

## Synthetic intake A — immigration inquiry (`synthetic-intake-immigration`)

> Inbound web-form message: "Hi, my employer wants to sponsor me for a green card and HR said I should talk to an immigration lawyer about the timeline and what I need to do. Are you taking new clients? — Priya R."

### 1. Intake acknowledgment

> Subject: Thanks for reaching out, [Priya]
>
> Hi [Priya],
>
> Thanks for getting in touch about employer-sponsored immigration. I've passed your note to our team and we'll take a look at whether we're the right fit and what a first step would look like.
>
> The best next step is a short consult so we can hear the specifics and you can ask questions. Are you generally available weekday mornings or afternoons? I'll send a couple of times that work.
>
> Talk soon,
> [Firm name]

_Substance-free: acknowledges, sets up the consult. Makes no claim about the case, the timeline, or what she should do._

### 2. Consult booking

> Subject: A few times for your consult
>
> Hi [Priya],
>
> Here are three times for a [30]-minute consult with [attorney]:
>
> - [Day, date, time]
> - [Day, date, time]
> - [Day, date, time]
>
> Reply with the one that works and I'll send a calendar invite with the call details. If none fit, tell me roughly when you're free and I'll find another.
>
> [Firm name]

_Connective: offers times, books, confirms. No advice._

---

## Synthetic intake B — estate matter in progress (`synthetic-matter-estate-simple`)

> Existing matter: estate plan for the [Alvarez] family. Engagement letter sent [date]; not yet signed. Awaiting a copy of the current deed from the client. Drafts in progress.

### 3. Engagement-letter / retainer chase

> Subject: Quick follow-up on your engagement letter
>
> Hi [Mr. Alvarez],
>
> Following up on the engagement letter we sent on [date] for your estate plan. Once it's signed we're clear to move ahead. You can sign it here: [link].
>
> If anything in it is unclear or you'd like to talk it through, just reply and we'll set up a few minutes.
>
> [Firm name]

_Connective: chases a signature, offers to talk. Does not interpret the letter's terms._

### 4. Matter-status update

> Subject: Where things stand on your estate plan
>
> Hi [Mr. Alvarez],
>
> A quick status update. We have your engagement letter out for signature and we're waiting on a copy of the current deed for the [property] to finish the drafts. Once we have both, the next step is [a review call to walk through the documents].
>
> Nothing needed from you today beyond the signature and the deed when you get a chance. Reply any time with questions.
>
> [Firm name]

_Connective: reports status drawn from the system of record, names the next step. No legal opinion._

### 5. Document-received logging

> Subject: Got the deed, thank you
>
> Hi [Mr. Alvarez],
>
> Confirming we received the deed for the [property] today and have added it to your file. That's the last item we were waiting on, so we'll pick the drafts back up. I'll be in touch when the next step is ready.
>
> [Firm name]
>
> _(Internal log: deed for [property] received [date], filed to [Alvarez] estate matter, drafts unblocked.)_

_Connective: acknowledges receipt, files, logs. No advice._

---

## Gate result

Five connective artifacts, two synthetic intakes, zero legal substance, zero customer-specific data. A practicing small-firm attorney or paralegal would send each with light edits (names, times, the link). **Pass.** The value proposition holds: the reviewer edits lightly and sends, rather than rewriting from scratch.
