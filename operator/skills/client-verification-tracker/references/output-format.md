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

## Shape B — Chase (open, unsigned, cadence due)

```markdown
# Verification Chase — <plaintiff> — <response-set> — matter <id> — YYYY-MM-DD

**Status:** sent <date> by <method>, unsigned (<N> days); nudge <#> of <max>
**Decision:** cadence due — reminder drafted to the signer.

## Reminder (DRAFT — reviewer/firm sends)

> <short, warm reminder to the signer per voice.md — points to where to sign>

## Internal log (create_memo body)

> Verification chase <#> for <plaintiff>/<response-set>; still unsigned.
```

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
matching document | firm file-naming convention not yet confirmed | RFA near deadline unsigned>
**Decision:** surfaced for a person. Not sent / not closed. This is a judgment the skill
does not make on its own.
```

## Rules

1. **Only Shapes A and B contain outbound drafts** (blockquotes, drafted, never sent
   without authenticated approval).
2. **The skill never decides whether a response needs verification** — it acts on the
   attorney's flag; objections-only responses are excluded (the attorney signs those).
3. **Shape C is reachable ONLY on a confident document match** — the firm's file-naming
   convention is unknown until confirmed on real matters; until then, an observed signed
   document is Shape D (surface), never Shape C (auto-close).
4. No verification term, response, or legal consequence appears interpreted anywhere.
5. The decision and its reason are always stated, so the cadence is auditable.
