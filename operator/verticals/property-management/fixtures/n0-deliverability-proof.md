# Property-management pack — N=0 deliverability proof

The deliverability gate (per the build plan): with **no customer-specific data**, can the pack produce connective artifacts a real leasing or tenant coordinator would send with only light edits? Below are five core connective tasks hand-drafted against two synthetic scenarios. Every one is **substance-free** — leasing inquiry, tour, maintenance, rent, and the habitability-emergency path. None infers protected-class status, makes a screening decision, gives eviction advice, or processes money (the boundaries in the brief).

The leasing reply demonstrates Fair-Housing discipline (same criteria for everyone, no protected-class handling), and the fifth artifact demonstrates the emergency path.

Bracketed values are the only fields that need filling. These double as the pack's `templates[]` (see `vertical.yaml`).

---

## Synthetic scenario A — a leasing inquiry (`synthetic-leasing-inquiry`)

> Inbound on a listing site: "Hi, is the 2-bedroom at [Maple Court] still available? When can I see it? — [Sam]." The company's published criteria: [income 3x rent, credit and background check, no prior evictions].

### 1. Leasing inquiry reply

> Subject: Yes, [the 2-bedroom at Maple Court] is available
>
> Hi [Sam],
>
> Thanks for your interest in [the 2-bedroom at Maple Court] ([$rent]/month). It's available as of [date]. Here is what to know up front, the same for every applicant: we look for [household income around 3x the rent], and we run [a credit and background check]; [prior evictions] may affect eligibility. Full details and the application are here: [link].
>
> Would you like to schedule a tour? I can send some times.
>
> [Company name]

_Substance-free and Fair-Housing-disciplined: states the same published criteria given to everyone, invites a tour. Asks nothing about protected-class status, does not steer toward or away from any unit or area._

### 2. Tour confirmation

> Subject: Your tour is set, [Maple Court]
>
> Hi [Sam],
>
> Your tour of [the 2-bedroom at Maple Court] is confirmed for [day, date, time]. [Self-show instructions / who will meet you]. If you need to reschedule, just reply.
>
> [Company name]

_Connective: confirms the tour. Same options offered to everyone._

---

## Synthetic scenario B — maintenance, rent, and an emergency (`synthetic-maintenance-emergency`)

> A current resident submits a routine maintenance request, has rent coming due, and later sends a message that may be a habitability emergency.

### 3. Maintenance work-order acknowledgment

> Inbound: "The garbage disposal in [unit 4B] stopped working."
>
> Subject: We've got your maintenance request
>
> Hi [resident],
>
> Thanks for letting us know about [the garbage disposal in 4B]. I've created work order [#] and we're coordinating a time with [our vendor]. Someone will reach out to schedule. If anything changes or it gets worse, reply here.
>
> [Company name]

_Connective: logs the work order and sets the next step. Does not diagnose the issue._

### 4. Rent reminder

> Subject: A friendly reminder, rent due [date]
>
> Hi [resident],
>
> A quick reminder that [rent of $X] for [unit 4B] is due on [date]. You can pay through your resident portal at [link]. If you've already paid, thank you and please disregard.
>
> [Company name]

_Connective: reminds per the company's process and points to the portal. The Operator never processes the payment, and gives no legal or eviction framing._

### 5. Maintenance-emergency holding note (the safety path)

> Inbound, evening: "There's water coming through the ceiling in [unit 4B] and it's getting worse fast."
>
> **Resident-facing holding note (sent immediately):**
>
> > Hi [name], thank you for reporting this right away. This needs immediate attention, please call our emergency maintenance line now at [number] so we can get someone out. If there is any risk to safety (electrical near the water, or it's a gas or fire issue), please call 911. I'm alerting our team now.
>
> **Internal escalation (sent the same instant to the on-call channel):**
>
> > URGENT, possible habitability emergency. [Resident] reports [active water intrusion through the ceiling, worsening] in [unit 4B], received [time]. Resident told to call the emergency line and 911 if any safety risk. Emergency vendor needed now.
>
> _The Operator does not assess the severity or attempt to handle it async. It routes the resident to the emergency line and alerts the on-call team, fail-open to a person by design._

---

## Gate result

Five connective artifacts, two synthetic scenarios, zero protected-class handling, zero screening decision, zero eviction advice, zero money processed, zero customer-specific data. The leasing reply shows the same criteria offered to everyone; the fifth shows a habitability emergency routed to a person immediately. **Pass.** Fair-Housing discipline and habitability escalation are the features a generic leasing bot cannot safely claim.
