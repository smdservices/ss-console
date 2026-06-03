# Insurance pack — N=0 deliverability proof

The deliverability gate (per the build plan): with **no customer-specific data**, can the pack produce connective artifacts a real agency CSR would send with only light edits? Below are five core connective tasks hand-drafted against two synthetic scenarios. Every one is **substance-free** — renewal logistics, billing status, FNOL routing, certificate cover, endorsement relay. None gives coverage advice, quotes a premium, binds a change, or opines on whether a loss is covered (the coverage-advice and no-binding boundaries in the brief).

Bracketed values are the only fields that need filling. These double as the pack's `templates[]` (see `vertical.yaml`).

---

## Synthetic scenario A — personal auto renewal (`synthetic-personal-auto-renewal`)

> Existing policy: personal auto for [the Okafor household], renewing in [45] days. The AMS flags a [premium increase] at renewal. Client has [auto only], no home policy on file.

### 1. Renewal review outreach

> Subject: Your auto policy renews soon, anything changed?
>
> Hi [Ms. Okafor],
>
> Your auto policy is coming up for renewal on [date], and I want to make sure it still fits before it does. A few quick questions: any new or replaced vehicles, a new driver in the household, a move, or a change in how far you drive to work?
>
> Reply whenever it is convenient and I will update the file. If nothing has changed, just let me know and we are set.
>
> [Agency name]

_Substance-free: asks for facts that affect the renewal. Makes no coverage recommendation and does not characterize the premium change._

### 2. Billing-status reply

> Subject: Re: Did my payment go through?
>
> Hi [Ms. Okafor],
>
> Checking the record now: your payment of [amount] posted on [date], and the next installment is scheduled for [date]. The policy shows current.
>
> If you would like me to send the payment confirmation or the schedule, just say the word.
>
> [Agency name]

_Connective: reports billing status from the record. No advice on payment, reinstatement, or coverage consequences._

### 3. FNOL acknowledgment

> Subject: We have your accident report, here is what happens next
>
> Hi [Ms. Okafor],
>
> Thanks for letting us know about the [parking-lot incident] on [date]. I have reported it to [carrier] and opened the first notice of loss. Your claim reference is [number], and a [carrier] adjuster will reach out to you directly, usually within [the carrier's stated window].
>
> If you have photos or the other party's information, you can reply here and I will add them to the file. I am glad you are alright.
>
> [Agency name]

_Connective: captures and routes the notice, names the claim path. Never says whether the loss is covered or what the client should do about it._

---

## Synthetic scenario B — commercial certificate request (`synthetic-commercial-coi-request`)

> Existing commercial account: [Riverbend Contracting], general liability in force. A general contractor ([the holder]) has requested a certificate of insurance naming themselves before [Riverbend] can start on a job. The client forwards the holder's requirements and asks us to "add them as additional insured and send the cert."

### 4. Certificate cover note

> Subject: Certificate of insurance for [the holder]
>
> Hi [Mr. Vance],
>
> Attached is the certificate of insurance for [Riverbend Contracting], reflecting the coverage currently on your general liability policy, sent to [the holder] as requested.
>
> One thing to flag for you: the holder's paperwork asks for [the holder] to be added as an additional insured. That is a change to the policy itself, not something the certificate can do on its own, so I have started that request with [carrier] separately (see the next note). The certificate attached reflects the policy as it stands today.
>
> [Agency name]

_Connective: assembles the certificate from coverage on record and sends a cover note. Does not add coverage or additional-insured status the policy does not already carry, and flags the difference instead of papering over it._

### 5. Endorsement acknowledgment

> Subject: Request to add [the holder] as additional insured
>
> Hi [Mr. Vance],
>
> Following up on the additional-insured request for [the holder]. I have sent the change request to [carrier] to add them to your general liability policy. This is in their hands now; I will confirm the moment they process it and send you the updated certificate showing the change.
>
> Until [carrier] confirms, the additional-insured status is not yet in effect, so please hold off on relying on it for the job start. I will chase them and keep you posted.
>
> [Agency name]

_Connective: relays the change request and acknowledges it. Never binds or confirms the change before the carrier does, and says so plainly._

---

## Gate result

Five connective artifacts, two synthetic scenarios, zero coverage advice, zero binding, zero customer-specific data. A practicing agency CSR would send each with light edits (names, dates, the claim number, the attachment). **Pass.** The value proposition holds: the reviewer edits lightly and sends, rather than rewriting from scratch, and the artifacts demonstrate the hard line, certificate on record only, endorsement relayed not confirmed, FNOL routed not adjudicated.
