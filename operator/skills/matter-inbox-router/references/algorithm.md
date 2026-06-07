# Matter Inbox Router — Algorithm

The ordering that keeps routing fast, conflict-safe, and substance-free.

## Phase 1 — Fetch (mechanical, one `execute_code` block)

Resolve the Email command from `customer.yaml` (sandbox: `crane_gmail.py`; production: the M365 MCP wrapper) — read the binding, do not hardcode a provider. Enumerate `is:unread {window}`, fetch each body, accumulate in-process, `print()` one JSON document (`window`, `fetched`, `messages[]`). A single unparseable message becomes a `parse_failed` row; the batch continues. Only the final document enters context (ADR 0021 Stream A) — the same shape as `inbox-triage` Phase 1.

## Phase 2 — Reason (agent, in-context)

Per message, in this fixed order:

1. **Resolve sender.** `search_contacts(from_name_or_email)` → contact?; `list_matters(contact_id)` → matter(s)? Yields one of: known-client+matter, known-contact-no-matter, unknown. Record the resolution; never associate a matter the resolution did not return (invariant 3).

2. **Conflict cross-check — before any classification commits to a route.** Read-only `search_contacts` + `list_matters` over the sender and any parties named in the body, cross-checked against existing matters' parties. On a hit → set class `conflict-signal`, route to the human clearance surface, stop processing this message (no wedge handoff, no draft). This ordering is the point: the router decides "is this a conflict?" before it decides "who handles this?"

3. **Classify** into one inbound class (`references/routing-rubric.md` tells). Multi-intent → apply the tie-breaks: conflict wins; primary = the action that advances the matter furthest; record the secondary; a legal question routes to acknowledge-and-defer, never to "answer."

4. **Build the handoff.** Emit `{ target_skill, contact_id?, matter_id?, message_id, inbound_class, extracted_ask, secondary? }`. The `message_id` lets the routed-to skill reply in-thread under reviewer-as-sender; the resolved IDs save it a lookup.

5. **Surface.** One list for the team: each message, its class, its route; the conflict-held and ambiguous ones called out in their own sections so a human sees the exceptions first.

## What this algorithm is NOT

- Not an answerer — it routes substance to the skill that defers it, never resolves it.
- Not a guesser — unknown senders are classed unknown, not forced onto a matter.
- Not a sender or writer — zero outbound, zero Clio writes.
- Not blind to conflict — the cross-check precedes routing, structurally.
