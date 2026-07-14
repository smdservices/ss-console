# Surface Brief: Operator › Needs you

Route (proposed): `portal.smd.services/portal/products/operator/<instance>/needs-you`
Facet: **none yet**. The queue is runtime behavior state, not an operator
config facet, so it is NOT in the closed facet registry
(`src/lib/portal/operator/facet-registry.ts`). Standing it up forces a
legibility call (see §7 and Question 1): either a new registry member
(`needs-you`, plane `runtime_seam`) or an explicit decision that action
surfaces sit outside the config-facet model. The closest existing member is
`activity` (plane `runtime_seam`, ADR 0043 read seam), of which this is the
actionable subset.
Status: **DESIGN DRAFT, for Captain walk. Not signed. No build in this pass.**
This brief exists because the escalation email walls are not the end state
(Captain: "this is an employee helping the organization"; output should become
interactive and actionable). Email stays the delivery channel near-term; this
designs the interactive destination those emails would eventually point at.

This is the first proposed console surface that is about the operator's **work**
rather than the operator's **configuration**. The console doctrine to date has
drawn the opposite line, on purpose: the operator landing brief states "This
console is about the OPERATOR itself, not the work it produces. Business work (a
draft to review) flows through the real channels, the mailbox, the alert, never
here," and the landing's Status question is scoped "operator health only; no
business-work queue"
(`src/pages/portal/products/operator/[instance]/index.astro:30`). ADR 0076's
six-chapter console (`docs/design/operator/04-console-structure.md`) has no work
chapter for the same reason. So this surface does not slot into the existing IA;
it reopens a founding boundary, which is a Captain decision, not a design detail
(Question 5).

---

## 1. Target user

The person who receives the operator's escalation emails today and has to act on
them. On pilot-smokeball and the future Ashton & Price seat that is the
responsible attorney and the firm's authored escalation recipients
(`escalation.red_flag_recipients`); on any seat it is whoever the config rosters
to be alerted. In portal terms these map to the `principal` and `staff` product
roles (`resolveOperatorAccess`, `src/lib/portal/operator-access.ts`); the
`compliance` role reads but does not act.

Context: they are mid-day, they got a triaged escalation email an hour ago
(post-WP-A), and they want to clear it without composing a reply, without
re-reading a 20-item wall, and without wondering whether their acknowledgment
actually landed. The email told them what needs them; this surface is where they
would act on it and see the result.

The critical identity fact for the whole brief: the roster is authored **by email
address** (`escalation_json`, `scope.outbound_roster`), while the portal
authenticates a **Clerk identity** with product roles. Those two are not
guaranteed to be the same set of people. A portal user who may read this queue is
not automatically an actor whose acknowledgment the seat will honor. That gap is
the root of the write-back question (§6, Question 2).

## 2. User tasks

> "When I come here, I want to see what my operator needs from me right now, and
> act on each item in one step, so I can clear it and trust that it landed."

Secondary tasks, in the user's words:

- "so I can silence the ones I have handled without muting the one that matters."
- "so I can tell it what to do with a stalled item (send it, hold it, or reach
  out informally first) instead of letting it re-ask me every morning."
- "so I can confirm a hand-off actually moved to the right person."

## 3. Business objective

Turn the escalation loop from a repeating text wall into an employee's worklist
you can clear. The WP-A/WP-B build already fixes the loop mechanically (per-item
ack, cadence, ceiling, triage) and keeps email as the delivery channel; the
remaining gap Captain named is **form**: an email cannot show current state, and
an acknowledgment typed into a reply is invisible until the next cron wake. The
objective for this surface is to make the operator's asks legible and actionable
in one place, so the client experiences an employee that hands them a short list
and takes direction, not a mailbot that repeats itself.

This is downstream of, not a replacement for, the email fix. If the loop still
re-fired daily, a portal queue would just be a second place to see the same wall.
The queue earns its place only once WP-A/WP-B land, which is why it is a separate
later decision.

## 4. Inward paths

- **The escalation email's per-item action.** The WP-A email carries a stable
  `[ACK-XXXXXX]` token per item. The natural inward path is a per-item link in
  that email that deep-links to this queue with the item focused. This is the
  honest near-term bridge: the email stays the delivery channel and the queue is
  the place the link lands.
- **The Status chapter's "needs me?" half.** ADR 0076 Question 1 is "is it OK,
  and does it need me?" Status answers the health half today and explicitly does
  not carry a work queue. If this surface ships, Status would gain a single
  count-and-link into it ("3 items need you"), not the list itself. Whether
  Status may reference work at all is part of Question 5.
- **Direct URL / bookmark.**
- **No nav door today, deliberately.** The landing's door set (Persona · Scope ·
  Skills · Schedule · Workflows · Governance · Voice · Connections · Team ·
  Memory · Activity · Account) is entirely operator-configuration; none of them
  is a work queue. Adding a door is part of the doctrine decision, not a free
  action.

## 5. Core content

The essential thing this surface shows is **the set of items the operator has
escalated that are not yet resolved, each with what it is, why it was raised, and
what the reader can do about it.** Everything else is cut.

### The item set (source of truth)

Each row is one open escalation item. The authoritative source is the WP-A
escalation ledger: an append-only JSONL file on the seat's Fly volume
(`/opt/data/state/escalation-ledger.jsonl`), records shaped
`{ts, skill, matter_id, item_key, event, attempt, token}` with
`event in {fired, chased, acked, handed_off, resolved}`. The queue's row set is
the ledger folded to current per-item state: an item is "open" when its latest
event is `fired`/`chased`/`acked` (acked is a snooze, not terminal) and it has no
`resolved`/`handed_off` terminal event. The `token` is the row's stable id and
the same token the email shows.

Two skills feed the ledger and therefore the queue:

- **deadline-miss-escalator**: authored critical dates that are approaching or
  overdue (`operator/skills/deadline-miss-escalator/`). Never a computed date;
  the row shows the authored date and its source label verbatim.
- **client-verification-tracker**: discovery verifications that are unsigned,
  chased, at their attempt ceiling, or handed off to the attorney
  (`operator/skills/client-verification-tracker/`).

### Per-row content (authored signals only)

Rendered strictly from ledger + skill output, never paraphrased into new claims:

- **What it is**: matter number (never the case caption; the law-seat rule
  forbids captions in surfaced text) and the item's authored label
  (`<label> <date>` for a deadline; `<plaintiff> / <response-set>` for a
  verification). Vertical vocabulary is bounded by ADR 0052 §6 exactly as on the
  Scope viewer: authored values render as authored, the surrounding chrome stays
  vertical-neutral.
- **Why it was raised**: the skill's own reason, drawn from the authored triage
  signals the WP-A build ranks on: task-label markers (CRITICAL / URGENT / HIGH
  PRIORITY), category (deemed-admission exposure, money or disbursement blocker,
  opposing-counsel inbound held), and overdue age. The queue **displays** these
  ranked signals; it does not invent urgency. An item with no authored severity
  marker renders with no severity chrome, never a fabricated "high."
- **State**: for a chase: `attempt <#> of <max>` from the ledger (never a
  guessed count). For a deadline: the rung (re-surface / re-route / notify) in
  the WP-A reader-facing language. For a handed-off item: who it moved to and
  when.
- **When last raised**: the `last_fired`/`chased` timestamp, so the reader sees
  the item is under active escalation rather than new.

### Triage grouping

Mirror the WP-A email so the two channels agree: a top "Needs you today" group
(the 3 to 5 highest-ranked items by authored signal) and a lower group of the
rest, with admin-confirm items collapsed to per-matter counts. The ranking is the
same authored-signal ordering the email uses; the queue must not compute a
different order or the two channels contradict each other.

### Empty state (docs/style/empty-state-pattern.md)

When the folded ledger has no open items, render the honest empty state ("Nothing
needs you right now."), never a fabricated row and never a placeholder. This
matches the admin "Needs you today" precedent
(`src/pages/admin/index.astro:168`, "Nothing needs you right now."). When the
runtime read path is unconfigured or unreachable, the surface is **empty, not
wrong**: it says the record could not be read, it does not imply zero items exist.
The distinction matters here more than anywhere, because a silent-empty queue on
a seat that actually has an overdue deemed-admission deadline is the exact failure
the escalator exists to prevent.

### Data plane (the honest read seam)

This is where the surface is furthest from buildable, and the brief must say so
plainly.

- **What exists today:** the email channel (post-WP-A) and the escalation ledger
  on the seat's Fly volume. Nothing more.
- **What the facet would need to read:** the ledger state has to reach the portal.
  The config-projection seam that Scope and Skills use (`customer_configs`,
  merge-time projection) is the **wrong** seam: the ledger is live runtime state
  that changes every cron wake, not merge-time config, so a merge-triggered
  projection would be stale by construction. The correct seam is the ADR 0043
  runtime read path, the same one `activity` uses
  (`src/lib/portal/operator/activity-read.ts`): a live per-customer HTTP read of
  the Machine, served by the overlay `shared/runtime_read.py`, parsed defensively
  (parse, never cast; drop a malformed row rather than render a misleading one).
- **What does NOT exist yet:** that seam is **unwired**. `OPERATOR_RUNTIME_READ_URL`
  / `_SECRET` are unset, so the read fails closed to empty
  (`isRuntimeReadConfigured` short-circuits before any read). And there is no
  `needs_you` read-kind: `activity-read.ts` reads `kind: 'audit_log'`; a new kind
  (`escalation_queue` or `needs_you`) would have to be added to the runtime-read
  contract and served by the overlay, shaped to a parser this facet owns. So even
  the read half of this surface is a real build with an overlay dependency, not a
  projection consume.
- **Freshness caveat to state on the page:** the ledger is only as current as the
  last cron wake and the last seat write. The queue shows the operator's last
  known asks, not a live poll of Smokeball. "Resolved in Smokeball" is decided by
  the seat's pre_run on its next wake, not by the portal. The surface must not
  imply it reflects real-time matter state.

### Not shown (out of scope for this surface)

- The full activity record. That is the `activity` facet, a read-only lens by
  doctrine (ADR 0052 §4). This queue is only the open, actionable subset; it links
  to Activity for history rather than reproducing it.
- Any business-work artifact (a draft to review, a document, matter contents).
  Those stay in the mailbox and Smokeball per the console doctrine. The queue
  shows the operator's **ask about** an item, never the work product itself.
- Configuration of the skills that produce these items (cadence, ceiling,
  windows). That is the eventual "The work" chapter (ADR 0076 chapter 2) and its
  per-routine graduation control, not this queue.

## 6. Forward paths

This is the half that makes the surface interactive, and the half that is hardest
and least resolved. Every action below is a **state write back toward the seat**,
which is a capability the portal does not have today in any form.

### The actions the surface wants

- **Acknowledge / snooze**: the portal equivalent of replying with the item's
  ACK token. Per the WP-A design, ack is a snooze (`ack_snooze_days`), not a
  tombstone; only "resolved in Smokeball" is terminal. The button acks exactly one
  item, and the confirmation enumerates what was acked and what remains, mirroring
  the WP-A email footer so under-acking stays visible.
- **Decide**: for a stalled chase or a held item, direct the next step: send now,
  hold, or reach out informally first. This maps to the operator's authored
  posture (draft-for-review vs. graduated send) and must respect the routine grid
  (ADR 0075): a decision the reader is not authorized to make (for example
  releasing a court-bound or opposing-counsel send, which has no roster class and
  can never graduate) is not offered as an action at all, not offered-then-denied.
- **Confirm hand-off**: acknowledge that a ceiling-reached item has moved to the
  responsible person, closing the loop the WP-B stop-and-escalate opens.

### Why every one of these is blocked on an unbuilt seam

The escalation ledger's writes go through a broker verb on the seat
(`escalation_event_append`, per the WP-A design), which is schema-validated,
serialized, and rejects an `acked` event whose token has no prior `fired` event.
The LLM turn never writes the ledger directly; the state that silences a deadline
alarm must not be writable by an injectable surface without validation. A portal
action has to land in that same broker verb with equivalent authorization. Two
routes exist, and choosing between them is the Captain-walk decision:

- **Route A, reuse the email inbound path (near-term bridge).** The portal button
  composes and sends the exact ACK-token email the human would have typed, from
  the reader's rostered address, so the existing WP-A inbound ack machinery (inbox
  skill dispatches the token to the ack procedure, which calls the broker) does
  the state write. No new seat-write seam is built. The portal is a convenience
  layer over the channel that already works. Cost: it only covers acknowledge (the
  action the email path already supports), it is asynchronous (the write lands on
  the next inbound turn, not instantly), and it requires the portal to send mail as
  the user, which is its own consent question.
- **Route B, a direct authenticated runtime write seam (end state).** The portal
  calls an authenticated HTTP write endpoint on the Machine, the inverse of the
  ADR 0043 read seam, which delivers the action to the broker verb directly. This
  is the real interactive surface and the only route that supports Decide and
  Confirm hand-off. It requires building an inbound runtime-write seam that does
  not exist (ADR 0043 is read-only; the config write-back spine, Tier 0 in the
  ground-truth matrix, is git-bound config, a different seam and also unbuilt), and
  it makes that endpoint a security boundary: it must fail closed, validate every
  action against the routine grid, and never let a portal identity author a state
  change the seat would not accept over email.

### The authorization seam (the hard question, unresolved by design)

Both routes collide on the same wall: **which portal identity is allowed to
acknowledge or decide, and how does the seat trust that?** Portal auth is Clerk
(principal / staff / compliance roles); the seat's notion of an authorized actor
is a rostered email address. Route A finesses this by sending as the user's
rostered address (the seat trusts the address, and mis-mapping degrades to "the
button does nothing" rather than "a stranger acked your deadline"). Route B has to
map Clerk identity to an authorized internal actor explicitly, and get it right,
because an over-broad mapping means a portal role could silence an escalation the
firm never authorized that person to touch. This mapping does not exist and is not
resolvable by fiat in this brief. It is the primary sign-off question (§ Open
questions, Question 2).

### The read-only fallback that is always honest

Even with zero write capability, the surface has standalone value as a **read-only
triaged queue**: it shows what needs the reader and links each item back to the
email (which already works) or to Activity. That fallback is worth naming because
it lets the surface ship its read half honestly before any write seam exists, the
same way `activity` shipped read-only. Acting stays in email until a write route
is chosen and built.

### UI patterns

- **Status display by context** (UI-PATTERNS.md Rule 1;
  `patterns/01-status-display.md`): severity and state are list-row context, the
  one pill-legitimate place, but only from authored signals; no pill for an item
  with no authored marker (Rule 2, one signal per fact).
- **Button hierarchy** (UI-PATTERNS.md Rule 3; `patterns/03-button-hierarchy.md`):
  one primary action per row (the acknowledge), Decide and its options as
  secondary, so a dense list does not become a wall of equal-weight buttons.
- **Actions and menus** (`patterns/08-actions-and-menus.md`): the Decide options
  (send now / hold / informal-first) group as one menu, not three loose buttons.
- **Calm register** (UI-PATTERNS.md Rule 8): build in the operator area's current
  loud register to match siblings, register the new files in
  `CALM_REGISTER_PENDING` so the area flips together later, exactly as the Scope
  viewer did.

## 7. Verdict

**DESIGN ONLY. Do not build in this pass.** The surface is worth building, but it
depends on decisions above the design layer and on two unbuilt seams, so it is
not a next-build the way Scope was.

What this brief resolves:

- The surface is the **actionable subset of the escalation ledger**, triaged by
  the same authored signals the WP-A email uses, read-honest and empty-honest.
- Its natural home is a runtime action surface adjacent to `activity`, not a
  config facet; the read seam is ADR 0043 (unwired) with a new `needs_you`
  read-kind, never the config projection.
- It ships its **read half first and honestly** (read-only triaged queue) if built
  at all, before any write route.

What this brief deliberately does not resolve, and hands to the Captain walk:

- Whether the console may carry a work surface at all (doctrine reversal).
- Which write route (A email-bridge vs. B runtime-write seam) and the Clerk to
  rostered-actor authorization mapping under it.
- Whether this becomes a registry facet or an explicit out-of-model action
  surface.

If built, the pattern follows Lock 4 exactly (shared resolver → shared viewer →
instance-addressed `[instance]/needs-you/index.astro`, gated by
`resolveOperatorAccess` with the cross-tenant ownership guard, roles
`principal`/`staff`/`compliance`), the same shape as Scope and Activity.

---

## Open questions for sign-off (the Captain walk)

1. **Does the console get to carry the work?** Every console surface to date is
   about the operator's configuration, on purpose (landing brief: "not the work it
   produces … never here"; Status is "operator health only; no business-work
   queue"). This queue is the operator's work asks, surfaced for action. Blessing
   it reverses a founding boundary and implies a seventh chapter (or an expansion
   of Status) that ADR 0076 does not currently have. Is that the intended
   direction, and if so, where does it live: a new chapter, or inside Status?

2. **The write-back seam and its authorization (the hard one).** Acknowledging or
   deciding from the portal is a validated state write to the seat's escalation
   broker, which the portal cannot do today. Route A (portal sends the ACK email as
   the user, reusing the working inbound path, ack-only, asynchronous) or Route B
   (a new authenticated runtime-write endpoint on the Machine, supports Decide and
   hand-off, is a security boundary)? And under either: how does a Clerk portal
   identity map to an actor the seat will trust, given the roster is by email and
   the portal is by Clerk role? This is unresolved by design; it is the decision
   the walk exists to make.

3. **Is this a registry facet or an out-of-model action surface?** The closed facet
   registry is "a map of the operator's own configuration/behavior facets only."
   The queue is neither config nor a passive lens. Add a `needs-you` member (plane
   `runtime_seam`, forcing the exhaustiveness legibility call) or declare action
   surfaces a separate category outside the registry?

4. **Does the read half ship before any write route?** A read-only triaged queue is
   honest and useful the day the ADR 0043 seam and a `needs_you` read-kind exist,
   with acting still done in email. Ship that increment first (matching how
   `activity` shipped read-only), or hold the whole surface until a write route is
   chosen so it never appears without its actions?

5. **Does the surface pull the seam-wiring forward?** This queue, `activity`, and
   the eventual "The work" chapter all depend on the same unwired ADR 0043 runtime
   read path. If the queue is wanted, wiring that seam (currently fails-closed to
   empty) becomes the shared enabling build, the runtime-read analog of the Tier 0
   write-back spine. Is that sequencing right, or does the seam wait behind other
   work?
