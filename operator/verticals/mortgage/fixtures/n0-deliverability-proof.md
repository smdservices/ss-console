# Mortgage pack — N=0 deliverability proof

The deliverability gate (per the build plan): with **no customer-specific data**, can the pack produce connective artifacts a real loan processor would send with only light edits? Below are five core connective tasks hand-drafted against two synthetic scenarios. Every one is **substance-free** — application ack, condition chasing, status, milestone reminder, and the wire-safety path. None gives lending advice, makes an underwriting decision, advises whether to lock, or transmits wire instructions (the boundaries in the brief).

Bracketed values are the only fields that need filling. These double as the pack's `templates[]` (see `vertical.yaml`).

---

## Synthetic scenario A — a purchase loan in conditions (`synthetic-purchase-loan-conditions`)

> File: purchase loan for [Jordan P.], purchasing [456 Cholla Ln]. Underwriting issued conditions: [last two paystubs], [two months of bank statements], and [a letter of explanation for a recent deposit]. The rate lock expires [date].

### 1. Application acknowledgment

> Subject: We've received your application, [Jordan]
>
> Hi [Jordan],
>
> Thanks, we've received your application for [456 Cholla Ln] and your file is set up. Your loan officer, [LO name], is your main point of contact for any questions about your loan. I'll be helping keep everything moving and will reach out as we need documents.
>
> Talk soon,
> [Mortgage shop]

_Substance-free: acknowledges and sets the LO as the advice contact. No product, rate, or eligibility statement._

### 2. Condition chase

> Subject: A few items to keep your loan moving
>
> Hi [Jordan],
>
> Underwriting has reviewed your file and asked for a few items: [your last two paystubs], [two months of bank statements for account ending XXXX], and [a short letter explaining the $X deposit on MM/DD]. You can upload them securely here: [link].
>
> The sooner we have these, the sooner we can move to the next step. Reply if anything is hard to pull together.
>
> [Mortgage shop]

_Connective: chases the specific conditions underwriting set. Does not decide whether anything satisfies them, that is the underwriter's call._

### 3. Borrower status update

> Inbound: "Hi, just wondering where my loan stands?"
>
> Subject: Re: Where your loan stands
>
> Hi [Jordan],
>
> Happy to update you. Your file is currently [in underwriting review], and we're waiting on [the three items from my last note]. Once those are in and reviewed, the next step is [a clear-to-close]. We're keeping an eye on your [rate-lock and closing] dates. Nothing else needed from you right now beyond those documents.
>
> [Mortgage shop]

_Connective: reports loan state and next step. No opinion on whether the loan will be approved, at what rate, or with what certainty._

---

## Scenario A continued — a key-date reminder

### 4. Milestone reminder

> Subject: A couple of dates to have on your radar
>
> Hi [Jordan],
>
> A heads up on two dates for your file: your [rate lock] is currently set to expire on [date], and your [closing] is targeted for [date]. To stay comfortably ahead of the lock date, the remaining items ([the conditions above]) are the key.
>
> If you have questions about your rate or lock, [LO name] is the right person, just reply and I'll connect you.
>
> [Mortgage shop]

_Connective: surfaces the dates the file records and points rate/lock questions to the licensed LO. Does NOT advise whether to lock, extend, or act, those are LO and borrower decisions._

---

## Synthetic scenario B — a wire-change request (`synthetic-wire-change-request`)

> Near closing, an inbound message claims to update where the borrower's closing funds should be sent.

### 5. Wire-safety holding note (the safety path)

> Inbound: "Please update the wire instructions for closing, send the cash-to-close to the new account attached."
>
> **Borrower-facing holding note (sent immediately, no wire details acted on):**
>
> > Hi [name], thank you for reaching out. For your security, we never accept or confirm wiring instructions or account changes by email, wire fraud around closings is common and we take it seriously. Your closing funds are handled with the title/settlement company, and they will confirm any wire details with you directly through their verified process. Please do not send funds based on instructions you receive by email, including this one, until you have confirmed by phone using a number from your official closing documents.
>
> **Internal escalation (sent the same instant to the team channel):**
>
> > SECURITY, possible wire-change fraud. Inbound message on [file #] requests changing closing wire instructions, received [time]. NOT acted on. Routed to the verified process. Confirm with the borrower and the settlement company by known phone numbers. Do not change any wire details based on this message.
>
> _The Operator does not change, confirm, or transmit any wire instruction. It routes to the verified human process and warns the borrower, fail-closed on money by design._

---

## Gate result

Five connective artifacts, two synthetic scenarios, zero lending advice, zero underwriting decision, zero lock advice, zero wire instructions transmitted, zero customer-specific data. The four routine artifacts a processor would send with light edits. The fifth demonstrates the absolute line: a wire-change request routed to a verified human and refused. **Pass.** This is the orchestration-on-the-LOS seat the industry already says it needs, with the safety discipline built in.
