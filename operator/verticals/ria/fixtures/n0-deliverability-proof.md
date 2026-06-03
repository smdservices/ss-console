# RIA pack — N=0 deliverability proof

The deliverability gate (per the build plan): with **no customer-specific data**, can the pack produce connective artifacts a real client service associate would send with only light edits? Below are five core connective tasks hand-drafted against two synthetic scenarios. Every one is **substance-free** — onboarding, NIGO chasing, a money-movement request, a required-action reminder, and the money-movement safety path. None gives investment advice, moves money, or computes a distribution amount (the boundaries in the brief, the heaviest in the dozen).

Bracketed values are the only fields that need filling. These double as the pack's `templates[]` (see `vertical.yaml`).

---

## Synthetic scenario A — new account onboarding (`synthetic-new-account-onboarding`)

> New client: [the Okonkwo family] opening [a joint brokerage account] at [the custodian]. Account-opening paperwork sent. The custodian flagged [the joint owner's signature and a missing date] as not-in-good-order (NIGO).

### 1. Client welcome and onboarding

> Subject: Welcome to [Firm name], let's get your accounts set up
>
> Hi [the Okonkwos],
>
> We're glad to be working with you. To get your [joint brokerage account] opened, your account-opening paperwork is ready to sign here: [link]. [Advisor name] is your advisor for anything about your planning or investments, and I'll be helping with the paperwork and getting everything in order.
>
> Reply any time with questions about the process.
>
> [Firm name]

_Substance-free: relays the firm's authored onboarding paperwork and names the advisor as the advice contact. No account or investment opinion._

### 2. NIGO chase

> Subject: Two quick items to finish your account opening
>
> Hi [the Okonkwos],
>
> Thanks for submitting your paperwork. [The custodian] needs two small fixes before the account can open: [the joint owner's signature on page 3] and [a date next to the signature on page 4]. You can take care of both here: [link].
>
> Once those are in, we'll get the account opened. Let me know if anything is unclear.
>
> [Firm name]

_Connective: chases the specific NIGO items the custodian flagged. Does not decide whether the paperwork is in good order, that is the firm and custodian's call._

---

## Synthetic scenario B — a distribution request and a money-movement instruction (`synthetic-money-movement-instruction`)

> The client emails asking to take a distribution. Separately, a message arrives instructing that funds be sent to a new bank account.

### 3. Money-movement request acknowledgment

> Inbound: "We'd like to take [$10,000] out of our account this month."
>
> Subject: We've got your request, here's what happens next
>
> Hi [the Okonkwos],
>
> Thanks for letting us know you'd like to take a distribution. I've passed your request to our operations team and [advisor name] so we can process it properly and make sure it's set up the right way for your situation. Someone will follow up to confirm the details and the paperwork.
>
> If you have questions about timing or the impact of a distribution, [advisor name] is the right person, just reply and I'll connect you.
>
> [Firm name]

_Connective: gathers the request and routes it to the human team. The Operator does NOT move the money, confirm an amount as final, or advise on whether or how to take the distribution, those are operations and the advisor._

### 4. Required-action reminder

> Subject: A required item on your account this year
>
> Hi [the Okonkwos],
>
> A friendly reminder that our records show a [required minimum distribution] is due on your [account] by [date the firm tracks]. [Advisor name] will walk you through the details and the amount, this note is just to make sure it's on your radar so nothing is missed.
>
> Would you like me to set up a time with [advisor name] to go over it? Reply and I'll find a slot.
>
> [Firm name]

_Connective: surfaces the required action the firm tracks and routes the details to the advisor. Does NOT compute or state the amount, or advise on how to take it._

### 5. Money-movement safety holding note (the safety path)

> Inbound: "Please send our next distribution to this new bank account, routing and account number below."
>
> **Client-facing holding note (sent immediately, no instruction acted on):**
>
> > Hi [name], thank you for letting us know. For your security, we never change banking instructions or move funds based on an email, this protects you against fraud. A member of our team will reach out through our verified process to confirm any banking change with you directly before anything is processed. Please don't consider the change in effect until you've heard from us by phone.
>
> **Internal escalation (sent the same instant to the operations / compliance channel):**
>
> > SECURITY, money-movement / banking-change instruction received by email on [client account], [time]. NOT acted on. Routed to the verified process. Confirm directly with the client by known phone number before any change. Retain per books-and-records.
>
> _The Operator does not execute, confirm, or change any banking detail or move any funds. It routes to the firm's verified human process, fail-closed on money by design, and the exchange is retained for SEC books-and-records._

---

## Gate result

Five connective artifacts, two synthetic scenarios, zero investment advice, zero money movement, zero amount computation, zero customer-specific data. The four routine artifacts a CSA would send with light edits. The fifth demonstrates the absolute line: a banking-change instruction routed to a verified human and refused, and retained. **Pass.** In the most regulated vertical in the dozen, the compliance floor is the product: advice fail-closed, money fail-closed, comms retained.
