# Accounting pack — N=0 deliverability proof

The deliverability gate (per the build plan): with **no customer-specific data**, can the pack produce connective artifacts a real firm coordinator would send with only light edits? Below are five core connective tasks hand-drafted against two synthetic scenarios. Every one is **substance-free** — onboarding, document chasing, deadline relay, e-file-authorization chasing, and status. None gives tax or accounting advice, computes a due date, or interprets financials (the boundaries in the brief).

Bracketed values are the only fields that need filling. These double as the pack's `templates[]` (see `vertical.yaml`).

---

## Synthetic scenario A — new 1040 client onboarding (`synthetic-1040-onboarding`, `synthetic-pbc-open-items`)

> New engagement: [the Halvorsen family] for [individual tax return preparation]. Engagement letter to send. Prepared-by-client request list includes [W-2s, 1099s, mortgage interest statement, prior-year return]; the firm is waiting on [the 1099s and the mortgage interest statement].

### 1. Client welcome and engagement letter

> Subject: Welcome to [Firm name], let's get started
>
> Hi [the Halvorsens],
>
> We're glad to be working with you on [your tax return this year]. To get going, here are two things:
>
> 1. Your engagement letter is ready to sign here: [link].
> 2. A short list of documents we'll need from you: [W-2s, 1099s, mortgage interest statement, last year's return]. You can upload them to your portal at [link].
>
> Once the engagement letter is signed and those are in, we're off to the races. Reply any time with questions.
>
> [Firm name]

_Substance-free: relays the firm's authored engagement terms and request list. No tax advice, no scope opinion._

### 2. PBC document chase

> Subject: A couple of items we're still waiting on
>
> Hi [the Halvorsens],
>
> Thanks for what you've sent so far. To keep things moving, we're still waiting on two items: [your 1099s] and [your mortgage interest statement (Form 1098)]. You can upload them here: [link].
>
> Once we have those, we'll have what we need to move forward. Let me know if anything is hard to track down.
>
> [Firm name]

_Connective: chases the specific open items on the firm's request list. Does not judge whether what arrived is sufficient, that is the preparer's call._

### 3. Deadline reminder

> Subject: [Filing] date coming up for [the Halvorsens]
>
> Hi [the Halvorsens],
>
> A friendly reminder that [the filing date your engagement is targeting] is [date]. We have [the engagement letter signed / the 1099s and 1098 still outstanding]. To stay on track, the sooner we have the remaining items the better.
>
> Reply if you'd like to talk through timing.
>
> [Firm name]

_Connective: surfaces the date the firm entered for this engagement and the outstanding items. Does not compute a filing requirement or due date, those are the firm's authored values._

---

## Synthetic scenario B — return ready, authorization and status (`synthetic-1040-onboarding`)

> The [Halvorsen] return is prepared and ready for e-file authorization (Form 8879). The client also emails asking where things stand.

### 4. E-file authorization chase

> Subject: One signature and we can file
>
> Hi [the Halvorsens],
>
> Good news, your return is prepared and ready. The last step before we can file is your signature on the e-file authorization (Form 8879), here: [link].
>
> As soon as that's signed we'll submit. Reply if you have any questions about the process.
>
> [Firm name]

_Connective: chases the authorization signature and explains the process step. Says nothing about the return's contents or numbers._

### 5. Client status update

> Inbound: "Hi, just checking, where are we with our taxes?"
>
> Subject: Re: Where are we
>
> Hi [the Halvorsens],
>
> Happy to update you. Your return is [prepared and ready to file]. The one thing we're waiting on is [your signature on the e-file authorization] here: [link]. Once that's in, we'll [submit it]. Nothing else needed from you right now.
>
> Reply any time with questions.
>
> [Firm name]

_Connective: reports engagement status and the next step from the system of record. No tax opinion, no prediction of outcome or refund._

---

## Gate result

Five connective artifacts, two synthetic scenarios, zero tax advice, zero due-date computation, zero financial interpretation, zero customer-specific data. A firm coordinator would send each with light edits (names, the items, the link). **Pass.** This is exactly the chasing and coordination that stalls engagements and that a profession with no spare admin capacity cannot staff, the connective whole the work-focused AI is not building.
