# Title pack — N=0 deliverability proof

The deliverability gate (per the build plan): with **no customer-specific data**, can the pack produce connective artifacts a real closing coordinator would send with only light edits? Below are five core connective tasks hand-drafted against two synthetic scenarios. Every one is **substance-free** — order intake, document chasing, milestone status, signing confirmation, and the wire-safety path. None gives legal or title advice, moves funds, or transmits wire instructions (the boundaries in the brief).

The fifth artifact is the important one: it shows the Operator handling a wire-change request by routing it to a verified human and warning the party, **without ever sending or confirming wire details**.

Bracketed values are the only fields that need filling. These double as the pack's `templates[]` (see `vertical.yaml`).

---

## Synthetic scenario A — a purchase order opening (`synthetic-purchase-order-open`)

> New order: purchase of [123 Mesa Vista Dr] by [the Tran family] from [the seller], agents [buyer agent] and [listing agent], lender [ABC Mortgage]. Contract just received. The file needs [a mortgage payoff, an HOA estoppel, and the survey].

### 1. Order acknowledgment

> Subject: We've opened your file, [123 Mesa Vista Dr]
>
> Hi [team / agents],
>
> We've opened the title order for [123 Mesa Vista Dr] (file [#]). We're requesting title search now and will be in touch as items come in. You can reach us here any time for a status update.
>
> [Title company]

_Substance-free: confirms the order is open and the next step. No opinion on title or the contract._

### 2. Document chase

> Subject: A few items we're working on for [123 Mesa Vista Dr]
>
> Hi [agent / party],
>
> To keep [file #] moving toward closing, we're still gathering: [the mortgage payoff from the seller's lender], [the HOA estoppel], and [the survey]. We've requested these and will follow up. If you can help nudge [the HOA] on your end, that would speed things along.
>
> [Title company]

_Connective: chases the file's open items. Does not judge whether anything clears title._

### 3. Milestone status update

> Subject: Status update, [123 Mesa Vista Dr]
>
> Hi [all parties],
>
> A quick update on [file #]: title is [in and being examined], the payoff is [requested], and we're [waiting on the HOA estoppel]. We're still targeting a [closing date] of [date]. Next step on our side is [clearing the file for closing]. We'll send the next update at [the next milestone].
>
> [Title company]

_Connective: reports the file's status to every party. No legal or closing-figure opinion._

---

## Synthetic scenario B — signing and a wire-change request (`synthetic-wire-change-request`)

> The file is clear to close. The signing is being scheduled. Separately, an inbound email arrives claiming to update where the buyer's funds should be wired.

### 4. Signing confirmation

> Subject: Your signing is set, [123 Mesa Vista Dr]
>
> Hi [the Trans],
>
> Your signing is confirmed for [day, date, time] at [location] with [the notary / closer]. Please bring a [valid government-issued photo ID] for each person signing. The signing should take about [N] minutes.
>
> If you have questions about the documents, your [agent / lender] is the best first stop. See you then.
>
> [Title company]

_Connective: confirms the signing and the authored bring-list. Note what it does NOT contain: no wire instructions, no banking details, no figures. Funds handling is never communicated this way._

### 5. Wire-safety holding note (the safety path)

> Inbound email: "Hi, please update the wiring instructions for our closing, the new account info is attached, send the funds there."
>
> **Party-facing holding note (sent immediately, no wire details acted on):**
>
> > Hi [name], thank you for reaching out. For your security, we never accept or confirm wiring instructions or account changes by email, wire fraud is common in real-estate closings and we take it seriously. A member of our team will contact you through our verified process to confirm any wire details directly. Please do not send funds based on any instructions you receive by email, including this message, until you have spoken with us by phone at the number on our official file.
>
> **Internal escalation (sent the same instant to the team channel):**
>
> > SECURITY, possible wire-change fraud. Inbound email on [file #] requests changing wire instructions / account info, received [time]. NOT acted on. Routed to the verified process. A team member must confirm directly with the party by known phone number. Do not change any wire details based on this email.
>
> _The Operator does not change, confirm, or transmit any wire instruction. It routes to the verified human process and warns the party. Touching wire instructions is exactly where fraud lives, the pack is fail-closed here by design._

---

## Gate result

Five connective artifacts, two synthetic scenarios, zero legal or title advice, zero fund movement, zero wire instructions transmitted, zero customer-specific data. The four routine artifacts a coordinator would send with light edits. The fifth demonstrates the absolute line: a wire-change request routed to a verified human and refused by the Operator, with the party warned. **Pass.** The wire-safety discipline is the feature in the one place that matters most.
