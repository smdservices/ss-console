# Shared: Delivery Channels + Refusal Fallback (PI-litigation pack)

Authoring canon for every pack skill. The runtime copy of this rule lives in
each skill's SKILL.md ("Delivery channels + refusal fallback" section) because
only `operator/skills/` ships to the Machine image; keep the two in step.

Born from the first live lifecycle test (2026-07-03, issue #1641): a served-
discovery capture executed perfectly and then reached no human, because the
attorney-confirm email draft carried statute citations (the mail channel's
legal-citation filter, ADR 0028 safety invariant #6, refused it), the redrafts
repeated the same content, and the memo fallback was blocked by the tenant's
write entitlement. The floors did their job; the skill had no delivery
discipline. This canon is that discipline.

## Rule 1: email is a citation-free channel

Any output delivered by email (create_draft, a reply, a chase, an
attorney-confirm note) states the governing rule in plain words:

> "Responses are due 30 days from service by mail, plus five calendar days for
> mail service. Proposed deadline August 3, 2026. Confirm before relying."

and never as a citation: no section numbers, no "CCP" or "CRC" references, no
rule-format strings. The mail channel enforces the legal-citation filter and
will refuse the draft. Statute citations belong only in matter-internal
artifacts: memos, internal notes, tasks (per `_shared-training-output.md`,
which already keeps the teaching note out of client-facing sends).

This is not a loosening of the grounding rule. The derivation must still come
from the capture spec's verified statute set; the skill simply expresses it in
words on the email channel and cites it in the internal record.

## Rule 2: a refusal is a redraft instruction, not a stop

If a delivery tool refuses a draft or write (citation filter,
banned-typography gate, or any other content gate):

1. Do not retry the same content. The gate is deterministic; identical content
   is refused identically.
2. Redraft once with the flagged content class removed: citations become plain
   words; banned punctuation becomes plain punctuation.
3. If refused again, deliver a minimal factual note: the matter, the document
   or work item, the date and method read, and where the detail lives. A
   person must always learn the work happened.

A capture or chase that reaches no human is a failure, whatever refused it.
Silence is never an acceptable outcome of a completed piece of work.
