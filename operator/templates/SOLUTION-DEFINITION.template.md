# {{CLIENT_NAME}} — Solution Definition & Open Determinations

> **Internal note (template).** Copy this to
> `operator/customers/<slug>/SOLUTION-DEFINITION.md` and fill it forward as the
> implementation progresses. It is the living, factual record of one client's
> Operator — **Part 1** is what is defined and concrete; **Part 2** is what remains
> to determine. A new client starts as nearly all Part 2 and fills toward all
> Part 1; **when Part 2 is empty and Part 1 is complete, the implementation is
> done.** In its empty state this document _is_ the intake instrument; the "still
> to determine" list is the live intake checklist.
>
> The playbook (`docs/runbooks/operator/implementation-playbook.md`) is the method
> that moves this document from empty to full — each phase fills specific sections.
> Part 1 is the human-legible mirror of `customer.yaml` (same facts, in prose);
> keep the two in step. The A&P instance
> (`operator/customers/ashton-price/SOLUTION-DEFINITION.md`) is the worked example.
> Keep this template vertical-neutral: no client, industry, or system named.

> **On judging the work (constant, every client).** On the client's real work the
> **client** judges the Operator's output — we do not, and cannot; it is their
> ground truth. We grade only on our own sandbox, where we authored every case. On
> the client's live account our role is to fix defects that need a code change,
> through the rehearsal-first pipeline. There is no phase where we grade their work.

_Snapshot: [date]._

---

## Part 1 — What is defined (the concrete solution)

### The client and the seat

_Capture: who they are (business, location, vertical); the people of use with
their roles (the decision-maker; the day-to-day contact; anyone else); and the
runtime facts the build sets (the Fly region nearest them, the model tier, the
business timezone and hours)._

- Client: {{CLIENT_NAME}} — [vertical], [location].
- People: [name] ([role — decision-maker]); [name] ([role — day-to-day]); [SMD
  operator for the pilot period].
- Seat: Fly region [ ]; [model] for the volume, escalating to [model] for heavy
  work; [timezone], business hours [ ].

### The Operator's identity (persona)

_Capture: the display name (neutral "Operator" unless the client authors one),
title, and tone; its own inbox; and who may reach it through Claude._

- Displays as [ ], titled [ ], tone [ ].
- Inbox: [ ].
- Reachable through Claude by: [who; default is the SMD operator only].

### What the Operator does — the [client] workflow, [N] skills

_Capture: every skill as a specific job plus its trigger — **W** webhook, **S**
scheduled, **P** person-invoked — grouped by the client's actual process phases.
This is the heart of the definition. Enumerate each job; do not summarize into
abstractions like "supports the workflow."_

- **[Process phase]:** [skill] ([W/S/P] — [the specific job it does]); [skill]
  ([W/S/P] — [job]); …
- **[Process phase]:** …
- **[Client's named asks / committed deliverables]:** [skill] ([trigger] — [job]).
- **Firm-wide surface:** [digest] ([trigger] — [job]); [inbox router]; …

_Note any gating (e.g., empty-seat gate so idle schedules do not bill) and the
schedule cadence._

### What it is allowed to do (recommended defaults, pending client sign-off)

_Capture: the dial the client will confirm — the exposure/initiation posture per
kind of work, and the reply roster (who it answers directly vs. only drafts for).
The integrity lines below are constant and are **not** on the dial._

- Posture: [ ].
- Roster: [who gets direct replies vs. drafted-only].
- Non-negotiable regardless of how the client sets the dial: it never moves money
  or posts to a ledger; never files or sends outside the client without a person;
  refuses rather than guesses when it cannot verify; and treats document contents
  as information, never as instructions.

### The systems, and each one's real connection state

_Capture: per system — its role, and its concrete state (ready connector / we
build / not wired / research / observed via another system). Call out any system
of record that lacks an API for something the workflow needs (e.g., no calendar
API), because that becomes an open determination in Part 2._

- **[System]** — [role]. [State].
- …

### Proven, not assumed

_Capture: what has been rehearsed and graded on our own sandbox (the synthetic +
adversarial cases), the evidence the client holds, and any lanes not yet runnable
and why. Before rehearsal: "not yet rehearsed."_

- [ ].

---

## Part 2 — What we still have to determine

_Each item: the specific unknown, why it matters, and who answers it. When an item
resolves, delete it here and fold the fact into Part 1. Items marked **(always)**
apply to every client; the rest are conditional on the client's systems and domain
— include the ones that apply._

**Always:**

- **Voice.** We need the client's own writing samples — real documents grouped by
  who they are written to — or the Operator's drafts read generically. → [contact].
- **The entitlement dial.** Does the client accept the recommended posture, want
  some work fully autonomous, or lock some tighter? → [decision-maker].
- **The persona.** Keep the neutral "Operator," or name it? → [client].
- **The starting scope.** Which real work or records does it watch first?
  → [contact].
- **Skill scope at launch.** All skills from the start, or some held back?
  → [decision-maker].

**Conditional (include per the client's systems and domain):**

- **Domain computation logic.** For any rule the domain computes (deadlines,
  eligibility, pricing, and the like): does the client have an existing
  engine/system the Operator should read, or does the Operator compute it?
  → [contact].
- **Where outputs land.** When the system of record has no API for an output
  (calendar, documents, tasks), which of the client's other systems receives it —
  and is it wired? → us (build) + client.
- **How inbound work reaches the Operator.** Forward to its inbox, watch a mailbox,
  or watch a shared folder? Any admin consent needed? → [contact] + IT.
- **Tool / drafting division.** If the client runs other generation or drafting
  tools, how does the work divide so there is no overlap or wasted cost?
  → [contact].
- **Access to each not-yet-wired system.** Confirm the client is on it and get us
  connected. → [contact].
- **The administrator / IT contact** for each system that needs consent.
  → [contact].
- **Trigger exceptions.** Whose activity, or which records, should be exempt from a
  trigger (for example, a principal's own edits). → [decision-maker].
