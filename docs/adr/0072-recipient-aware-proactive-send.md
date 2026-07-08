---
title: Recipient-Aware Proactive Send — external_send_internal + the roster classifier
date: 2026-07-08
---

# ADR 0072: Recipient-Aware Proactive Send

## Status

Accepted 2026-07-08. Amends [0055](./0055-operator-is-an-employee.md) (extends the
roster from reactive replies to proactive sends), [0025](./0025-autonomy-ceilings-configurable-exposure-vs-initiation.md)
and [0035](./0035-no-imposed-entitlement-defaults.md) (adds a per-recipient send
class). Related to [0031](./0031-content-sensitivity-send-floor.md) (content floor)
and [0071](./0071-confirm-ceiling-and-hosted-agent-tier-ladder.md) (the `confirm`
ceiling — orthogonal; it applies to either send class).

## Context — the "nothing ever sends" regression

The venture repeatedly regressed to a "drafts-only / nothing ever sends" posture.
On 2026-07-08 the `client-verification-tracker` cron on pilot-smokeball tried to
email an internal alert to `scott@smd.services` ("a client verification is unsigned,
due in 2 days") and it was **held at `draft_for_review`** — a legitimate internal
notification blocked as if it were an outbound client send.

Root cause, traced to code: the enforcement taxonomy had **one recipient-blind
`external_send` action class**. Every email — an internal alert to the firm's own
attorney and an outbound client email alike — resolved to a single flat ceiling that
safe-defaulted to draft. The doctrine (ADR 0055, `ENTITLEMENTS.template.md`) already
described two rows ("to firm staff" autonomous/recipient-locked vs "to outside"
draft) — but the taxonomy had one, so the distinction had no representation. The
reform (ADR 0005→0025→0031→0035) that retired the universal drafts-only floor landed
in the enforcement _code_ but never propagated to the doctrine prose or a
recipient-aware class, so **the fail-closed default and the bug were the same state**,
and every scrub of the doctrine decayed.

## Decision

Give the recipient distinction a **typed, schema-representable** home, and enforce it
in code.

1. **New action class `external_send_internal`** (both enforcement cores + the TS
   authoring surface). `external_send` is now explicitly the _outside_ (non-roster)
   ceiling; `external_send_internal` is the _rostered internal staff_ ceiling. Each is
   authored independently and **fail-closed when unauthored** (ADR 0035) — a rostered
   send is not autonomous by default; the engagement authors it.

2. **A recipient classifier decides which class a send is** (`recipient_classifier.py`,
   a byte-identical ss↔overlay twin, shared with the reply path). Strict matching
   (exact domain equality, no plus-tag widening, no display-name parsing,
   homoglyph-safe). The roster (`scope.inbound_allow_from`) is treated as
   **human-authored OUTBOUND authorization**, never grown from inbound. Tainted
   provenance never classifies INTERNAL. An **unresolvable** recipient is routed
   OUTSIDE (draft), never INTERNAL — a send is never promoted to autonomous on an
   unknown recipient. `send_draft` (which carries only a `draft_id`) resolves its
   recipient from a per-session registry recorded at `create_draft` time.

3. **The floors are unchanged and pin the outside class.** The law-firm vertical floor
   and the ADR 0031 content-sensitivity floor pin `external_send` (outside) only — an
   internal staff alert is deliberately not content-floored, because carrying the
   matter/deadline/dollar context to a colleague is its job. The taint gate and sticky
   stop cover both classes.

4. **The per-skill `metadata.smd.trust_ceiling` scalar is retired** (it was already
   superseded by persona exposure, ADR 0056; a code audit proved zero enforcement
   readers). Send posture is stated once in `operator/references/send-posture.md`;
   skills defer there.

## The enforcement is the tests and the guard — not this ADR

This is deliberate. The ADRs were _already_ correct (0025/0035 reformed drafts-only);
reality drifted from them because doctrine is not enforcement. So the mechanism that
keeps this removal from decaying is:

- **Behavioral golden tests** (`operator/adapter/tests/test_external_send_internal.py`,
  `test_recipient_classifier.py`, and the overlay `tests/test_recipient_aware_send.py`):
  internal→autonomous, outside→draft, unresolved→draft-never-autonomous,
  unauthored-internal→fail-closed, the outside floor does not pin the internal class,
  and the exact 2026-07-08 `create_draft → send_draft` flow now sends. Drop the
  recipient classification at any call site and these go red — with no banned string
  present.
- **A CI string-hygiene guard** (`tests/forbidden-strings.test.ts`) that fails the
  build if the retired universal drafts-only wording or the retired per-skill scalar
  reappears in any doctrine file.

Both enforcement cores (in-tree `operator/adapter/trust_ceiling.py` and the overlay
`hermes-smd-trust`) move together; the `recipient_classifier` twin is byte-identical
and hash-pinned in `operator/contracts/overlay-pairs.json`.

## Consequences

- Internal notifications to rostered staff send autonomously (when the seat authors
  `external_send_internal: autonomous`); outbound client/court/vendor mail stays gated
  exactly as before. The internal/external line is now enforced in code, not prose.
- `confirm` (ADR 0071), if/when merged, applies to either send class as a ceiling
  value — orthogonal to the recipient axis introduced here.
- Seats must author `external_send_internal` to get autonomous internal sends; an
  unconfigured seat still sends nothing (fail-closed).
