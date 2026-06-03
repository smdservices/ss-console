# Dental pack — N=0 deliverability proof

The deliverability gate (per the build plan): with **no customer-specific data**, can the pack produce connective artifacts a real practice coordinator would send with only light edits? Below are five core connective tasks hand-drafted against two synthetic scenarios. Every one is **substance-free** — recall, benefits relay, treatment-plan follow-up, billing, and emergency routing. None gives clinical advice, recommends a procedure, guarantees coverage, or judges urgency (the boundaries in the brief).

Bracketed values are the only fields that need filling. These double as the pack's `templates[]` (see `vertical.yaml`).

---

## Synthetic scenario A — overdue recare and an unscheduled plan (`synthetic-recare-overdue`, `synthetic-unscheduled-treatment-plan`)

> Existing patient: [Marcus L.], last seen [date], the PMS marks him overdue for [a 6-month hygiene recall]. He also has a treatment plan presented [date] for [a crown on #19] that was accepted but never scheduled.

### 1. Recare recall reminder

> Subject: [Marcus], you're due for a cleaning
>
> Hi [Marcus],
>
> Our records show you're due for your [routine hygiene visit]. It's been a little while, so we wanted to help you get back on the schedule.
>
> Would a weekday or a Saturday work better? Reply here and I'll send a couple of times, or book online at [link].
>
> [Practice name]

_Substance-free: surfaces what the practice's recall interval marks due. No clinical claim about what care is needed._

### 2. Treatment-plan follow-up

> Subject: Ready to get your treatment scheduled?
>
> Hi [Marcus],
>
> When you were in on [date], [Dr. name] put together a treatment plan for you, and we have it ready to go whenever you are. We'd love to get it on the schedule so you don't have to think about it.
>
> Want me to send a few times that work? You can also reply with any questions and I'll get them to the right person.
>
> [Practice name]

_Connective: follows up on an accepted-but-unscheduled plan and offers to book. Does not describe, recommend, or upsell the procedure, and does not frame a clinical need._

### 3. Benefits summary (internal)

> _Internal note to the team, ahead of [Marcus]'s visit:_
>
> > Benefits check for [Marcus L.], plan [carrier / plan name], pulled [date]. Eligibility: [active per the payer]. Returned by the payer: [preventive at X%], [basic at Y%], [major at Z%], deductible [remaining], annual max [remaining]. This is what the payer returned, not a guarantee. Verify any specifics with [carrier] before quoting the patient.

_Connective: relays exactly what the payer returned, flagged as not a guarantee. Makes no coverage promise and quotes no out-of-pocket as fact._

---

## Synthetic scenario B — a balance and an after-hours emergency (`synthetic-recare-overdue`)

> [Marcus] has an open patient balance of [amount] after insurance. Separately, a different patient sends an after-hours message that may be an emergency.

### 4. Patient balance reminder

> Subject: A quick note about your account
>
> Hi [Marcus],
>
> After your insurance processed, there's a remaining balance of [amount] on your account. You can take care of it online at [link], or reply here and I'll send options.
>
> If anything looks off, let me know and I'll have the office manager take a look.
>
> [Practice name]

_Connective: states the ledger balance and offers payment paths. No pressure, no clinical framing._

### 5. Emergency holding acknowledgment (the safety path)

> Inbound, after hours: "I think I cracked a tooth and the pain is getting really bad, what should I do?"
>
> **Patient-facing holding note (sent immediately, no clinical advice):**
>
> > Hi [name], I want to get you to someone right away. Please call us at [practice number] and follow the prompts for the [after-hours / emergency] line so a member of our team can help you. If this is a medical emergency, please call 911 or go to the nearest emergency room. Please don't wait for an email reply, calling is the fastest way to get help.
>
> **Internal escalation (sent the same instant to the team channel):**
>
> > URGENT, possible dental emergency. [Patient] reports [a cracked tooth with worsening pain], message received [time]. Told to call the after-hours line, and to call 911 if it is a medical emergency. Needs a person.
>
> _The Operator does not assess how serious it is or tell the patient what to do for the tooth. It routes to a person and flags the team. Assessing urgency is clinical judgment the pack never performs, fail-open to a person by design._

---

## Gate result

Five connective artifacts, two synthetic scenarios, zero clinical advice, zero coverage guarantee, zero urgency judgment, zero customer-specific data. The four routine artifacts a coordinator would send with light edits (names, amounts, the link). The fifth demonstrates the hard line: a possible emergency routed to a person without a word of clinical content. **Pass.** And note the boundary against the phone-first competitor: this is the async connective and money work a voice receptionist does not run.
