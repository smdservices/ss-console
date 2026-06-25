# Matter Inbox Router — Routing Rubric

Source of truth for _which wedge skill owns an inbound message_. The router classifies each message into exactly one inbound class; the class names the target skill. This rubric is the tells, the tie-breaks, and the guards.

## Sender resolution (runs before classification)

Resolve the from-address/name against Smokeball:

- **Known client + open matter** — `get_contacts` hits a contact who is on a `list_matters` result. Most inbound is this.
- **Known contact, no matter** — a contact exists but no matter (a prior consult, a referral source). Treat as non-client unless context says otherwise.
- **Unknown** — no Smokeball hit. A candidate new inquiry, or noise.

Resolution gates both the class and the conflict check. A message is never associated with a matter the router did not resolve from Smokeball (invariant 3).

## The conflict cross-check (runs FIRST, before routing)

Read-only `get_contacts(sender + any named parties)` + `list_matters` name/entity cross-check — the same invariant `new-matter-intake` carries. **On any hit** (the sender or a named party is adverse to an existing matter, or the same party appears on an opposing side), **HALT**: route only to the human conflict-clearance surface, start no wedge-skill handoff, draft nothing. Clearance is definitionally human. Advancing a flagged message is a `fails` violation. The router is never structurally blind to a conflict.

## Inbound classes → target skill

| Class                     | Target                                         | Tells (owner/client statements that map here)                                                                                                                                                                                                                                                              |
| ------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **new-client-inquiry**    | `new-matter-intake`                            | a non-client (unknown sender, or known contact with no matter) describing a problem and asking the firm to take it on: "I was referred to you," "do you handle…," "I need a lawyer for…"                                                                                                                   |
| **scheduling**            | `consult-scheduler`                            | a request to book, move, or confirm a time: "can we set up the consult," "does Tuesday work," "I need to reschedule"                                                                                                                                                                                       |
| **engagement-letter**     | `engagement-letter-chaser`                     | anything about the engagement letter: "I signed it," "I have a question about section 4," "haven't gotten to it yet," a signature-platform notification                                                                                                                                                    |
| **status-request**        | `matter-status-responder`                      | an existing client asking the state of their matter: "any update," "where are we," "did we hear back," "what's next"                                                                                                                                                                                       |
| **payment-trust**         | `trust-balance-nudge`                          | a balance/invoice/retainer question: "did my payment go through," "do I owe anything," "you said the retainer was low"                                                                                                                                                                                     |
| **document-received**     | surface + (deferred `document-receipt-logger`) | an inbound document/attachment to be filed. No wedge step depends on it this phase — surface it; do not block the loop.                                                                                                                                                                                    |
| **conflict-signal**       | **HALT → human clearance**                     | opposing party, adverse party, or a conflict cross-check hit. Overrides every other class.                                                                                                                                                                                                                 |
| **general / operational** | **respond directly** (employee default)        | a colleague or known correspondent with a question, heads-up, or coordination ask that owes no matter action: "can you pull X," "got it, thanks," "are you around Thursday." Reply by creating a draft (`create_draft`) to the sender; the reply channel sends it to a roster member, drafts it otherwise. |
| **no-reply / surface**    | surface for human                              | spam/solicitation, a cold vendor, or a message that genuinely needs a person's judgment and warrants no answer. Do not force-fit a class — and do not waste a reply on an obvious non-correspondent (an off-roster reply is held to draft anyway).                                                         |

## Multi-intent tie-breaks

A message often carries more than one ask ("I signed the letter — also, when's my hearing?"). Do not collapse it to one class blindly:

1. **Conflict-signal wins over everything.** If any part trips the conflict check, the whole message halts.
2. **Primary = the action that advances the matter furthest.** Signing the letter (engagement-letter) outranks a status question riding along; a new-inquiry outranks a scheduling aside inside it (intake precedes scheduling).
3. **Note the secondary.** The route carries a `secondary` note so the routed-to skill (or the team) sees the rider. The router never silently drops the second ask.
4. **A legal question is never a route to "answer."** "What does this clause mean," "do I qualify," "what are my chances" → routed to the skill whose job is acknowledge-and-defer (engagement-letter-chaser for letter terms; matter-status-responder for outcome questions), or surfaced for the attorney. The router does not answer it.

## UPL guard (applies to every class)

The router carries no legal substance. It does not characterize a matter's merits, name a cause of action, or decide what a matter "needs." It moves the message to the skill that handles it; substance stays with the routed-to skill's deferral logic and, ultimately, the attorney.

## Worked examples

- _Unknown sender: "I got hurt at work and HR is stonewalling — can you help?"_ → conflict cross-check (clear) → **new-client-inquiry** → `new-matter-intake`. The router does not assess the claim.
- _Known client on an open estate matter: "just checking where things stand."_ → **status-request** → `matter-status-responder`.
- _Known client: "signed! also what does the indemnification clause mean?"_ → **engagement-letter** (primary: signed) with a `secondary` legal-question note → `engagement-letter-chaser`, whose job is to log the signature and route the clause question to the attorney (never interpret it).
- _Sender shares a surname/entity with the adverse party on an active matter_ → conflict cross-check **hit** → **HALT** → human clearance surface; no wedge handoff.
- _"Re: Invoice 1042 — did you receive my payment?"_ → **payment-trust** → `trust-balance-nudge` (read-only on funds).
