---
name: scope-creep-flagger
description: "Watches client Slack channels (and email threads) for requests that exceed the SOW. Surfaces to the owner with proposed disposition: in-scope clarification / extra-cost mention / decline."
version: pending
vertical: marketing-agency
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  connectors:
    - slack        # client channels (read)
    - gmail        # external send threads (read)
    - google_drive # SOW documents
metadata:
  hermes:
    tags: [Marketing, Agency, ScopeOps, DraftForReview]
    action_class: read + internal_write
trust_ceiling: draft_for_review # never responds to clients autonomously; always owner-decided
---

# Scope-Creep Flagger

Continuously watches the channels where clients make work requests (per-client Slack channels, the agency's shared email inboxes), compares incoming asks to the client's signed SOW, and surfaces requests that fall outside scope to the agency owner with a one-paragraph proposed disposition. The owner decides whether to absorb, clarify scope, or quote additional work.

## Why this exists

Scope creep is the canonical agency-retainer profit killer. Three patterns:

- **Drive-by asks** — client drops a Slack message: "Hey, can you also do X this month?" X is not in the SOW. The account manager says yes to keep the relationship warm. The agency eats the hours.
- **Re-scoped projects** — client says "actually let's swap the email campaign for a video," knowing the video is 3× the work but feeling like a "swap."
- **Buried in the brief** — client sends a project brief that, when read carefully, asks for deliverables the SOW didn't cover.

The owner can't read every channel every day; the AM can't always tell what's in-scope without re-reading the SOW. This skill catches it in near real-time and gives the owner the moment to decide before the AM has already said yes.

## How to invoke

Continuous watcher (subscribed to Slack channel events + Gmail inbox-watch). When a new message arrives in a client channel or thread:

```
# Invoked automatically per Slack/Gmail event by Hermes' watcher mechanism
hermes run scope-creep-flagger --message <message-id>
```

Manual look-back (e.g., catch up after a weekend):

```
hermes run scope-creep-flagger --since "yesterday"
```

## What the agent does

1. **Read the incoming message.** Get the full message + thread context. Note: this includes ALL messages in the channel, not just from the client — client + agency-team are in the same channel.
2. **Identify if it's a request.** Per `references/categorization-rubric.md`, classify the message:
   - REQUEST — client is asking for work
   - QUESTION — client wants information; no work implied
   - CONTEXT — sharing files / data / updates, no ask
   - SOCIAL — relationship maintenance, no ask
   - INTERNAL — agency team chatter, no client ask
3. **For REQUESTs only:** read the client's signed SOW (Drive path in `customer.yaml`). Identify the relevant deliverable/service line. Check if the request fits within it.
4. **Score scope-fit.** Per the rubric:
   - IN_SCOPE — clearly within the SOW; no flag needed; the AM responds normally
   - AMBIGUOUS — could be argued either way; surface to owner so they choose how the AM responds
   - OUT_OF_SCOPE_SMALL — clearly out, but small enough (< 2 hours) that the owner might absorb to maintain relationship; surface as such
   - OUT_OF_SCOPE_MATERIAL — clearly out, material work (> 2 hours); surface with "this needs to become a separate quote"
5. **Draft proposed disposition.** A one-paragraph note from agent to owner: what was asked, what the SOW says, why it's flagged, suggested AM response (in client voice).
6. **Surface in Slack.** Internal channel `scope-flags`: client name + permalink to the source message + flag category + proposed disposition. Tag `@<owner>` on OUT_OF_SCOPE_MATERIAL.
7. **Internal logging.** Append to per-client scope-history note for trend analysis (3+ flags in a week from the same client is a relationship-health signal).

## Trust ceiling

**draft_for_review** for everything. The agent never responds to the client. The AM and owner handle the actual conversation. The agent's job is to make sure the owner SEES the request before the AM commits.

The agent MAY:

- Read all messages in subscribed client channels + Gmail threads
- Read the SOW + supporting Drive documents
- Read the agency's per-client scope-history note
- Write to the agency's internal scope-flags Slack channel
- Update the per-client scope-history note

The agent MUST NOT:

- Reply to the client (Slack or email)
- Modify the SOW
- Send the proposed disposition to the AM (the surface is the Slack channel; AM reads if assigned to the client)
- Categorize as IN_SCOPE silently for a client whose history shows pattern of scope creep — if the relationship is degrading, every flag matters

## Voice rules specific to scope flags

The flag itself is internal-only (no client-facing text). Voice rules:

- Tight. Owner is busy. 3 lines max for the flag itself.
- Specific. Quote the client's exact ask. Quote the SOW line that's relevant.
- Suggested AM response: in the client's voice (formal/casual matching the channel's existing tone). Plainspoken. Don't write a defensive paragraph.
- For AMBIGUOUS: name the choice. "Could argue this is within deliverable D2 (paid social setup) OR is a new ask for ad creative refresh. AM should ask the owner before responding."

## What "good" looks like

1. Every REQUEST in a watched channel gets a verdict within ~2 minutes of arrival.
2. False-positive rate (flagging an IN_SCOPE as OUT) < 5%. Owners ignore noisy systems; calibration matters.
3. False-negative rate (missing an OUT_OF_SCOPE_MATERIAL) < 5%. The harder problem; surface generously when ambiguous.
4. Proposed disposition reads like the owner wrote it (or wishes they had).
5. Trend awareness: when a client crosses some threshold of flags-per-week, the agent escalates ("Aaron Co has had 4 scope flags this week; relationship-health signal worth your attention.").

## References

- `references/voice.md` — internal-flag voice + proposed-disposition voice
- `references/output-format.md` — Slack flag format + AM-response draft template
- `references/categorization-rubric.md` — message classification + scope-fit scoring
- `references/test-cases.md` — synthetic client channels (10 channels × 20 messages each, varied scope-fit patterns)

## Cost estimate (filled by grading)

- Typical tokens-in per message: ~4K (message + thread context + SOW lookup)
- Typical tokens-out per flag: ~600 (the flag + draft disposition)
- Tool calls per flag: ~5
- Typical cadence: continuous; varies by message volume per agency

Monthly per customer at typical volume: ~$3-8 in tokens, ~$1 in tool calls.
