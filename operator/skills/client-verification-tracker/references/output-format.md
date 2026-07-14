# Client Verification Tracker — Output Format

The decision determines the shape. Every verification is keyed to
`(plaintiff, response-set, version)`.

## Shape A — Prepare & route for authenticated approval

```markdown
# Verification — <plaintiff> — <response-set> (v<version>) — matter <id> — YYYY-MM-DD

**Signer:** <party | GAL for minor <name> | successor-in-interest <name>>
**Response type:** <interrogatories | RFP | RFA> — attorney-flagged for verification
**Decision:** prepared; routed to <responsible attorney> for approve-and-send.

## Verification request (DRAFT — sent only on authenticated attorney approval, by the firm's method)

> <plain-language request to the signer per voice.md — asks them to sign the
> attached verification; interprets nothing; states no legal consequence>

## Approve-and-send to <attorney> (internal)

> The verification for <plaintiff> / <response-set> is ready. Approve to send it to
> <signer> by <firm method>. <one-time approval token / bound to this verification>

## Internal log (create_memo body)

> Verification for <plaintiff>/<response-set> v<version> prepared, routed to <attorney>
> for approval; not yet sent. Response deadline <date, from the deadline lane>.
```

## Shape B — Chase (open, unsigned, authored cadence due, attempt ceiling not yet reached)

```markdown
# Verification Chase — <plaintiff> — <response-set> — matter <id> — YYYY-MM-DD

**Status:** sent <date> by <method>, unsigned (<N> days); attempt <#> of <escalate_after_attempts>
**Cadence:** authored `chase_cadence_days` = <days>; next chase due <date>
**Decision:** cadence due, attempt ceiling not reached — chase the signer via `send_message` (never `reply_to_message`).

## Reminder (proactive send to the signer per voice.md — subject to the authored exposure)

> <short, warm reminder to the signer — points to where to sign>

## Internal log (create_memo body)

> Verification chase attempt <#> of <escalate_after_attempts> for <plaintiff>/<response-set>; still unsigned. Sent via send_message.
```

State-read note: this turn reads matter metadata only (`list_tasks`, `get_files_on_matter`, `get_memos_on_matter`) — no message body — so the proactive chase send is not fenced by the taint gate.

## Shape C — Signed, logged & closed (ONLY on a confident match)

```markdown
# Verification Signed — <plaintiff> — <response-set> — matter <id> — YYYY-MM-DD

**Decision:** signed verification observed in the matter and matched with confidence
to <response-set> v<version>; item closed; cadence stopped.

## Internal log (create_memo body)

> Verification for <plaintiff>/<response-set> v<version> signed <date>; item closed.
```

## Shape D — Surface to a human (ambiguous / unauthenticated / say-so / unconfirmed)

```markdown
# ⚠ Verification — needs a human — <plaintiff> — matter <id> — YYYY-MM-DD

**Situation:** <signer ambiguous | approval not authenticated | client says-signed but no
matching document | firm file-naming convention not yet confirmed | RFA near deadline unsigned |
chase attempts reached `escalate_after_attempts` (stop chasing the client) | chase cadence or
escalation attempt-count not authored>
**Decision:** surfaced for a person. Not sent / not closed. When the situation is the attempt
ceiling, the client chase is stopped and the open item is handed to the responsible attorney;
the skill does not send another nudge. This is a judgment the skill does not make on its own.
```

## Rules

1. **Only Shapes A and B contain outbound drafts** (blockquotes, drafted for review; sending follows the firm's authored ceiling).
2. **The skill never decides whether a response needs verification** — it acts on the
   attorney's flag; objections-only responses are excluded (the attorney signs those).
3. **Shape C is reachable ONLY on a confident document match** — the firm's file-naming
   convention is unknown until confirmed on real matters; until then, an observed signed
   document is Shape D (surface), never Shape C (auto-close).
4. No verification term, response, or legal consequence appears interpreted anywhere.
5. The decision and its reason are always stated, so the cadence is auditable.
6. **The chase cadence is the authored `chase_cadence_days`; the attempt ceiling is the
   authored `escalate_after_attempts`.** Both are fail-closed when unauthored (no chase;
   surface the missing-setting note). A chase is sent with `send_message`, never
   `reply_to_message`, and the chase-send turn reads matter metadata only (no message
   body), so the send is not fenced by the taint gate.
7. **Attempt-count and deadline-proximity escalation are independent** — either sends the
   open item to the attorney; reaching `escalate_after_attempts` also stops the client
   chase (Shape D), it does not draft another Shape B nudge.
