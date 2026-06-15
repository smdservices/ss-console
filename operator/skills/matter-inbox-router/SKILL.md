---
name: matter-inbox-router
description: Classifies inbound firm mail and routes each message to the wedge skill that handles it — dispatches, never answers, never decides legal substance.
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: []
  commands: [python3]
metadata:
  hermes:
    tags: [Law, Inbox, Routing, Dispatch, DraftForReview]
  smd:
    vertical: law-firm
    skill_type: decision/surfacing (routing)
    trust_ceiling: draft_for_review
    action_class: read + route
    connectors:
      - email # customer-bound (mcp:m365-mail in prod; build:google-gmail in the sandbox)
      - smokeball # PracticeManagement — contact/matter lookup to resolve sender → matter (read)
    # Shared-core candidate. This is law's concrete realization of the inbox
    # "spine" role. The customer-zero `inbox-triage` (a Gmail drafter) and the
    # marketing `status-report-assembler` are NOT generic — each is its own
    # vertical's skill. Per ADR 0038 §7, the shared inbox-router core is EARNED
    # at vertical-2 (marketing), not designed up front. Extract the common
    # router shell then; until then this is the law delta.
---

# Matter Inbox Router

Reads the firm's inbound mail, classifies each message into a law inbound class, and routes it to the wedge skill that completes that job. It is a **dispatcher, not a drafter** — it never answers the client itself; it hands the message (with the matter/contact context it resolved) to `new-matter-intake`, `consult-scheduler`, `engagement-letter-chaser`, `matter-status-responder`, or `trust-balance-nudge`, or surfaces it for a human when no skill owns it. The reply, when one is warranted, is drafted by the routed-to skill under the draft-for-review posture.

This is the connective tissue of the wedge's named job — _move a new inquiry to an active, current matter_ (`operator/verticals/law-firm/wedge.md`). Without a reliable router, every inbound message is a human triage decision; with it, the loop starts itself.

## When to Use

Inbound mail arrives at the firm continuously: new-client inquiries, clients asking "where are we," signed engagement letters, scheduling back-and-forth, payment questions. A coordinator reads each one and decides _who/what handles this_. This skill does that decision — fast, conflict-aware, and without ever crossing into legal substance — so the right wedge skill picks the message up.

It runs scheduled (poll the inbox on the firm's cadence) and event-driven (an inbound webhook delivers one message).

## The routing decision

Each message is classified into exactly one **inbound class**, which names the **target skill**. The full rubric — the owner-statement tells that map to each class, the multi-intent tie-breaks, and the conflict/UPL guards — is `references/routing-rubric.md`. Summary:

| Inbound class                         | Routes to                                      | One-line tell                                                         |
| ------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| New-client inquiry                    | `new-matter-intake`                            | a non-client asking the firm to take something on                     |
| Scheduling / consult                  | `consult-scheduler`                            | a request to book, move, or confirm a meeting time                    |
| Engagement letter / signature         | `engagement-letter-chaser`                     | anything about the engagement letter going out, signed, or its terms  |
| Status request ("where are we")       | `matter-status-responder`                      | an existing client asking the state of their matter                   |
| Payment / trust / retainer            | `trust-balance-nudge`                          | a question about a balance, invoice, or replenishing the retainer     |
| Document received                     | surface + (deferred `document-receipt-logger`) | an inbound document to be filed; no wedge step depends on it          |
| Conflict signal                       | **HALT + surface for human**                   | opposing party, adverse mention, or a hit on the conflict cross-check |
| Ambiguous / multi-intent / non-client | surface for human                              | no single skill owns it, or it needs a person                         |

**Routing is not answering.** A message that asks a legal question ("do I have a case?", "what does this clause mean?") is routed to the skill whose job is to _acknowledge-and-defer_ it (or surfaced for the attorney) — the router never answers the legal question itself.

## Prerequisites

Reads the customer-bound **Email** connector (resolved from `customer.yaml`: `mcp:m365-mail` in production, `build:google-gmail` in the sandbox) and Smokeball (`get_contacts`, `list_matters`, `get_matter`) to resolve a sender to a known contact/matter. Requires `python3` for the fetch block. Connector-agnostic by design — the router reads whatever Email adapter the customer binds; it does not hardcode a provider.

## How to Run

```
hermes run matter-inbox-router               # poll the inbox on cadence
hermes run matter-inbox-router --window "newer_than:1d"
hermes run matter-inbox-router --max 25
```

## Procedure

Two phases, mirroring the established fetch/reason split (ADR 0021 Stream A): the mechanical inbox fetch runs inside one `execute_code` block so per-message bodies never flood context; classification and routing stay in the agent's reasoning loop.

### Phase 1 — Fetch (single `execute_code` block)

Enumerate unread messages in the window via the customer-bound Email CLI, fetch each body, and emit one JSON payload. The Email command is resolved from `customer.yaml` (the sandbox binds `crane_gmail.py`; production binds the M365 MCP) — the skill reads the binding rather than hardcoding it. The shape matches `inbox-triage` Phase 1: accumulate in-process, `print()` one document. A single unparseable message is recorded as `parse_failed` and the batch continues; it never aborts.

### Phase 2 — Reason (agent, in-context)

Per `references/routing-rubric.md` and `references/algorithm.md`:

1. **Resolve the sender** against Smokeball (`get_contacts` on the from-address/name; `list_matters` for that contact). Known client + matter, known contact no matter, or unknown — this gates class and conflict.
2. **Run the conflict cross-check FIRST.** Before any routing, a read-only `get_contacts` + `list_matters` name/entity check (the same invariant `new-matter-intake` carries). On any hit — the sender or a named party is adverse to an existing matter — **HALT**: the message routes to the human conflict-clearance surface, not to a wedge skill, and no downstream draft is started. Advancing a flagged message is a `fails` safety violation.
3. **Classify** into exactly one inbound class (rubric tells + tie-breaks).
4. **Route**: emit the target skill plus the handoff context it needs (resolved contact_id / matter_id, the inbound message_id for in-thread reply, the extracted ask). The routed-to skill owns the draft.
5. **Surface** the routing decisions as a list for the team — what came in, where each went, and the held/ambiguous ones called out separately.

## Trust Ceiling

**Routing + surfacing autonomous; zero sends, zero writes.**

The agent MAY: read inbound mail; read Smokeball for sender/matter resolution and the conflict cross-check; classify; emit a routing decision + handoff context; surface the list.

The agent MUST NOT: send or reply to any message; write to Smokeball or any system; answer a legal question; route a conflict-flagged message to anything but the human clearance surface; invent a matter/contact association it did not resolve from Smokeball.

## Safety invariants (any violation → `fails`, no recovery)

1. **Routes, never answers.** No legal substance, no advice, no "you have a case" — a substantive question is routed/deferred, never answered by the router.
2. **Conflict halt precedes routing.** A conflict hit stops the chain and goes to human clearance; no auto-clear, no wedge-skill handoff.
3. **No fabricated association.** A sender is linked to a matter only via a real Smokeball resolution; an unresolved sender is classed unknown, not guessed onto a matter.
4. **External-send draft floor preserved.** The router sends nothing; it dispatches to skills that draft under a human reviewer's identity.
5. **Privilege.** Resolved matter detail stays in the handoff to firm-internal skills; it never leaves firm surfaces.

## Pitfalls

Answering a question instead of routing it; routing a conflict-flagged message to a wedge skill; guessing a matter for an unknown sender; collapsing a multi-intent message to one class without the rubric's tie-break (a "sign the letter and also when's my hearing" message has a primary route and a noted secondary).

## Verification

1. Every inbound message gets exactly one class and a route (or an explicit human-surface).
2. Conflict cross-check runs before routing; any hit halts and surfaces, with no downstream handoff.
3. No legal question is answered by the router.
4. Sender→matter associations are all Smokeball-sourced; unknowns are classed unknown.
5. The surfaced list lets a human see, in under a minute, what came in and where it went.

## References

- `references/routing-rubric.md` — the inbound-class tells, target-skill map, multi-intent tie-breaks, and conflict/UPL guards (the load-bearing logic)
- `references/algorithm.md` — sender resolution, the conflict-first ordering, the fetch/reason split
- `references/output-format.md` — the routing-decision list + held/ambiguous surface _(parity fast-follow)_
- `references/test-cases.md` — fixtures incl. the cross-skill selector test + conflict-bait + multi-intent _(parity fast-follow)_
