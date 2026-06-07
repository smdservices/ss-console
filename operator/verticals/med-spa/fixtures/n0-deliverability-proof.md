# Med-spa pack — N=0 deliverability proof

The deliverability gate (per the build plan): with **no customer-specific data**, can the pack produce connective artifacts a real patient coordinator would send with only light edits? Below are five core connective tasks hand-drafted against two synthetic scenarios. Every one is **substance-free** — lead intake, the good-faith-exam gate, membership renewal, reactivation, and adverse-event routing. None gives medical advice, recommends a treatment, clears a client for a procedure, or assesses a reaction (the boundaries in the brief).

Bracketed values are the only fields that need filling. These double as the pack's `templates[]` (see `vertical.yaml`).

---

## Synthetic scenario A — a new injectable consult lead (`synthetic-injectable-consult-lead`)

> Inbound lead from an ad: "Hi, I'm interested in [Botox] and maybe filler, do you have any availability this month? — [Renée]." The spa requires a good-faith medical exam before a first treatment.

### 1. New-lead acknowledgment

> Subject: Thanks for reaching out, [Renée]
>
> Hi [Renée],
>
> Thanks for your interest in [our injectable services]. We'd love to have you in for a consultation to talk through your goals and answer your questions.
>
> Are you generally free on weekdays or weekends? Reply here and I'll send a couple of times, or you can book online at [link].
>
> [Spa name]

_Substance-free: acknowledges and offers to book a consult. Makes no treatment recommendation and no claim about what [Renée] needs._

### 2. Good-faith-exam prompt

> Subject: One quick step before your first treatment
>
> Hi [Renée],
>
> Looking forward to seeing you. Before a first treatment, our [medical provider] meets with every new client for a brief medical exam, it's a standard step and part of how we keep you safe. I've set it up so we can do that at your consult.
>
> Your consult and exam are on [day, date, time] with [provider]. Reply if you need to change it.
>
> [Spa name]

_Connective: ensures the required exam is scheduled. Does not substitute for the exam, clear [Renée] for treatment, or imply she will be a candidate, that is the provider's call._

---

## Synthetic scenario B — a membership renewal and an adverse-event message (`synthetic-adverse-event-message`)

> Existing member [Renée] has a membership renewing in [2 weeks]. Separately, a different client sends a message after a treatment that may describe an adverse reaction.

### 3. Membership renewal reminder

> Subject: Your membership renews soon
>
> Hi [Renée],
>
> A heads up that your [membership] renews on [date]. Nothing you need to do, it will continue automatically, but I wanted you to have it on your radar. You still have [N treatments / credits] available on your current package.
>
> If you'd like to make any changes, just reply and I'll take care of it.
>
> [Spa name]

_Connective: states the renewal date and package balance. No pressure and no treatment upsell._

### 4. Reactivation win-back

> Subject: We'd love to see you again, [Renée]
>
> Hi [Renée],
>
> It's been a little while since your last visit and we wanted to check in. If you'd like to come back in, reply here and I'll find a time that works, or book at [link].
>
> [Spa name]

_Connective: a simple reconnect. No medical claim about what she is due for._

### 5. Adverse-event holding acknowledgment (the safety path)

> Inbound, after a treatment: "The area around my [lip filler] is really swollen and looks kind of white, and it's painful. Is that normal??"
>
> **Client-facing holding note (sent immediately, no medical advice):**
>
> > Hi [name], thank you for telling us right away, I want to get you to our [provider] now. Please call us at [spa number] immediately so [provider] can help you, and if you can't reach us or it's getting worse, please seek medical care or call 911. Please don't wait for an email reply.
>
> **Internal escalation (sent the same instant to the provider / medical-director channel):**
>
> > URGENT, possible adverse event. [Client] reports [swelling, blanching, and pain at a lip-filler site], message received [time]. Told to call now and to seek care / 911 if worsening. Needs the provider immediately.
>
> _The Operator does not assess whether this is normal or tell the client what to do. Blanching after filler can be time-critical, and assessing it is medical judgment the pack never performs. It routes to the provider and flags the channel, fail-open to a person by design._

---

## Gate result

Five connective artifacts, two synthetic scenarios, zero medical advice, zero clearance, zero reaction assessment, zero customer-specific data. The four routine artifacts a coordinator would send with light edits. The fifth demonstrates the hard line: a possible adverse event routed to the provider without a word of medical content. **Pass.** The compliance gates (the good-faith exam and the adverse-event escalation) are coordination a generic booking bot cannot safely do.
