# Home-services pack — N=0 deliverability proof

The deliverability gate (per the build plan): with **no customer-specific data**, can the pack produce connective artifacts a real office CSR would send with only light edits? Below are five core connective tasks hand-drafted against two synthetic scenarios. Every one is **substance-free** — request intake, scheduling, en-route status, estimate follow-up, and the emergency-dispatch path. None diagnoses the problem, commits a price, or processes money (the boundaries in the brief).

The fifth artifact is the important one: a possible gas emergency routed to a person and to 911, with **no diagnosis and no async handling**.

Bracketed values are the only fields that need filling. These double as the pack's `templates[]` (see `vertical.yaml`).

---

## Synthetic scenario A — an HVAC service request (`synthetic-hvac-service-request`)

> Inbound: "Our AC stopped cooling sometime last night, can someone come out? — [the Reyes household]." Estimate later sent for [a capacitor replacement] and not yet approved.

### 1. Service-request acknowledgment

> Subject: We've got your request, [the Reyes household]
>
> Hi [the Reyeses],
>
> Thanks for reaching out about [your AC not cooling]. I've set up a service request and we'll get you on the schedule. I'll follow up shortly with the soonest available windows.
>
> [Company name]

_Substance-free: logs the request and sets the next step. Does not diagnose the AC or estimate a cost._

### 2. Job confirmation

> Subject: You're scheduled, [date]
>
> Hi [the Reyeses],
>
> You're booked for [a service visit] on [day, date], and our technician will arrive between [arrival window]. We'll text you when they're on the way. If you need to change it, just reply.
>
> [Company name]

_Connective: confirms the visit and the arrival window. No diagnosis, no price._

### 3. Dispatch en-route update

> Subject: Your technician is on the way
>
> Hi [the Reyeses],
>
> Good news, [tech first name] is on the way to you now and should arrive within about [N] minutes. They'll take a look and walk you through what they find.
>
> [Company name]

_Connective: relays the board's en-route status. Does not say what the tech will find or what it will cost._

### 4. Estimate follow-up

> Subject: Following up on your estimate
>
> Hi [the Reyeses],
>
> Just following up on the estimate [tech name] left for [the recommended repair]. Whenever you're ready to move forward, reply here or call us and I'll get you scheduled. Happy to answer any logistics questions about timing.
>
> [Company name]

_Connective: follows up on the company's estimate and offers to schedule. Does NOT quote, adjust, or commit a price, the estimate is the company's authored number._

---

## Synthetic scenario B — a possible gas emergency (`synthetic-gas-smell-emergency`)

> An inbound message describes a gas smell.

### 5. Emergency-dispatch holding note (the safety path)

> Inbound: "I keep smelling gas near my furnace, it's pretty strong. Can someone come today?"
>
> **Customer-facing holding note (sent immediately, no diagnosis):**
>
> > Hi [name], please treat this as urgent. If you smell gas, leave the home now and, once you are safely outside, call your gas utility's emergency line or 911. Do not turn anything electrical on or off. Once you are safe, call us at [number] and we will get a technician to you as a priority. Please don't wait for an email, your safety comes first.
>
> **Internal escalation (sent the same instant to the on-call channel):**
>
> > URGENT, possible gas emergency. [Customer] reports [a strong gas smell near the furnace], received [time]. Customer told to leave the home and call the gas utility / 911, and to call us once safe. Priority dispatch needed.
>
> _The Operator does not assess the hazard, tell the customer how to fix or check it, or schedule it as a routine job. It points to life-safety (leave, call the utility / 911) and alerts the on-call team, fail-open to a person by design._

---

## Gate result

Five connective artifacts, two synthetic scenarios, zero diagnosis, zero price committed, zero payment processed, zero customer-specific data. The four routine artifacts an office CSR would send with light edits. The fifth demonstrates the line: a possible gas emergency pointed to life-safety and a person, never handled async. **Pass.** This is the async office the phone bots do not run, with the safety discipline built in.
