# Veterinary pack — N=0 deliverability proof

The deliverability gate (per the build plan): with **no customer-specific data**, can the pack produce connective artifacts a real clinic CSR would send with only light edits? Below are five core connective tasks hand-drafted against two synthetic scenarios. Every one is **substance-free** — recall, scheduling, follow-up, refill relay, and emergency routing. None gives medical advice, interprets a result, judges urgency, or authorizes a prescription (the no-medical-advice, emergency-escalation, and no-authorization boundaries in the brief).

The fifth artifact is the important one: it shows the Operator handling a possible emergency by routing it to a person and sending a holding note, **without a word of medical advice**.

Bracketed values are the only fields that need filling. These double as the pack's `templates[]` (see `vertical.yaml`).

---

## Synthetic scenario A — overdue wellness patient (`synthetic-wellness-recall-canine`)

> Existing patient: [Biscuit], a [canine] seen last on [date]. The PIMS protocol marks [Biscuit] overdue for [an annual wellness exam and vaccines]. Owner: [Dana].

### 1. Wellness recall reminder

> Subject: [Biscuit] is due for a checkup
>
> Hi [Dana],
>
> Our records show [Biscuit] is due for [an annual wellness visit and vaccines]. It has been a little while, so we wanted to reach out and help you get back on the schedule.
>
> Would a weekday morning or afternoon work better? Reply here and I will send a couple of times, or you can book online at [link].
>
> [Clinic name]

_Substance-free: surfaces what the clinic's own protocol marks due and offers to book. Makes no claim about what care [Biscuit] medically needs._

### 2. Appointment confirmation

> Subject: You're booked, [Biscuit] on [day]
>
> Hi [Dana],
>
> [Biscuit] is confirmed for [a wellness exam] with [Dr. name] on [day, date, time]. Please bring [any current medications and a stool sample if you have one]. If you need to change it, reply here or call us.
>
> See you both then,
> [Clinic name]

_Connective: confirms the booking, lists the clinic's standard bring-list. No clinical instruction beyond what the clinic authored._

### 3. Post-visit follow-up

> Subject: Checking in on [Biscuit]
>
> Hi [Dana],
>
> Just checking in after [Biscuit]'s visit yesterday. [Dr. name] sent you home with this summary: [paste the doctor's authored discharge note]. How is [Biscuit] doing today?
>
> If anything looks off or you have questions, the best thing is to call us at [number] and we will get you to the right person. Glad we saw you both.
>
> [Clinic name]

_Connective: carries the doctor's authored discharge note verbatim and invites contact. Adds no medical commentary; routes any concern to a person rather than answering it._

---

## Synthetic scenario B — refill request and an emergency message (`synthetic-emergency-inbound-message`)

> Two inbound messages from the same owner on different days. First: a routine refill request. Second: a message that may describe an emergency.

### 4. Refill acknowledgment

> Inbound: "Can I get a refill of [Biscuit]'s [heartworm prevention]?"
>
> Subject: We've sent your refill request to the doctor
>
> Hi [Dana],
>
> Thanks for the heads up. I have sent your request for [Biscuit]'s [heartworm prevention] refill to [Dr. name] to review and approve. Once it is approved I will let you know it is ready and where to pick it up or how it will ship.
>
> [Clinic name]

_Connective: relays the refill request to the doctor and acknowledges it. Never authorizes the refill and never advises on the medication; approval is the doctor's._

### 5. Emergency holding acknowledgment (the safety path)

> Inbound: "[Biscuit] just got into a bag of chocolate maybe 20 minutes ago, he ate a lot. What should I do??"
>
> **Client-facing holding note (sent immediately, no medical advice):**
>
> > Hi [Dana], I want to get you to someone right now. Please call us at [clinic number] immediately so a member of our team can help you, and if we are closed or you cannot reach us, call [the clinic's authored emergency/after-hours number or the pet poison line the clinic lists]. Please do not wait for an email reply, calling is the fastest way to get [Biscuit] help.
>
> **Internal escalation (sent the same instant to the clinic's front-desk / on-call channel):**
>
> > URGENT, possible emergency. [Dana] reports [Biscuit] ([canine]) ingested a large amount of chocolate ~20 min ago. Message received [time]. Client told to call the clinic now and given [the after-hours/poison line]. Needs a person immediately.
>
> _The Operator does not assess how serious this is, does not tell the owner what to do for the dog, and does not handle it asynchronously. It routes the client to a human and flags the clinic the same instant. Assessing urgency and advising treatment is veterinary medical judgment the pack never performs, this is fail-open to a person by design._

---

## Gate result

Five connective artifacts, two synthetic scenarios, zero medical advice, zero triage judgment, zero prescription authorization, zero customer-specific data. The four routine artifacts a clinic CSR would send with light edits (names, times, the link, the doctor's authored note). The fifth demonstrates the hard line: a possible emergency is routed to a person and acknowledged without a word of medical content. **Pass.** The value proposition holds, and the safety boundary holds with it.
