# Selector test — matter-memo-on-update

This skill is **webhook-dispatched, not selector-routed.** It is invoked only by the webhook router on `{source: smokeball, event_type: matter.updated}` (`customer.yaml.webhook_triggers`), never chosen by Hermes' conversational skill selector in response to a user query. The assertion here is the inverse of the usual one: the skill's `description` must **not** cause it to be mis-selected for an ad-hoc conversational request.

## Synthetic queries (should NOT select this skill)

> "What's changed on the Reyes matter lately?" → should select a status/digest skill (`matter-status-responder` / `matter-status-digest`), **not** this one. This skill writes a log on an event; it does not answer "what changed" on demand.

> "Add a note to this matter." → a human note is not this skill's job; this skill logs _automatic_ change memos from webhook events.

## Expected behavior

- No conversational query routes to `matter-memo-on-update`.
- The only invocation path is the webhook trigger.

## Result

Pending — to be verified once the law wedge selector simulation is re-run with this skill's compressed `description` added to the pool (confirm it does not steal `matter-status-responder` / `matter-status-digest` queries). The `description` is deliberately scoped to "when a matter changes … logs a memo," not "answer questions about a matter," to keep it out of the conversational selection space.
