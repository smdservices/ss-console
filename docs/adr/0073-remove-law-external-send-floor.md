---
title: Remove the law-firm external-send draft floor — outside-send is the firm's authored dial
date: 2026-07-13
status: accepted
captain: Scott Durgan
related: 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0035-no-imposed-entitlement-defaults.md, 0071-confirm-ceiling-and-hosted-agent-tier-ladder.md, 0072-recipient-aware-proactive-send.md
---

# ADR 0073 — Remove the law-firm external-send draft floor

## Decision

The law-firm pack's `external-send-draft-floor` — the non-raisable vertical
floor that pinned `external_send` (outside recipients) to `draft_for_review`
regardless of what the firm authored — is **removed**. The same declarative
slug is removed from every other vertical manifest that carried it
(accounting, dental, home-services, insurance, marketing-agency, mortgage,
property-management, ria, title, veterinary); none of those was ever backed by
a runtime floor entry, so for them this deletes a claimed-but-unenforced
constraint rather than changing behavior.

Outside-send is now what ADR 0035 says every entitlement is: **the customer's
authored dial**, fail-closed (refused) when unauthored. `draft_for_review`
remains the **recommended starting posture** for a new engagement — a
recommendation the customer confirms or changes, never a pin they cannot
raise.

## Why

**There are no "we know better than the client" ceilings.** (Captain,
2026-07.) The floor was the last survivor of the retired universal
draft-for-review doctrine (ADR 0005, itself superseded by ADR 0025 + 0035).
ADR 0005's own retirement text reserves a vertical pin for "where regulation
requires a human signer" — and the law pack's own compliance index
(`operator/verticals/law-firm/compliance-floor.md`) states that the ABA Model
Rule 5.3 / Formal Opinion 512 supervision obligation is discharged by **the
combination of the append-only action journal, per-action attribution, and
fail-closed entitlement** — not by a send gate. No regulation compels the pin;
a licensed attorney authoring the firm's exposure _is_ the supervision
decision. Keeping the floor was paternalism wearing a compliance costume.

Concretely: a law customer that wants the Operator to own its client-
verification chase and records-vendor chase end-to-end could author
`external_send: autonomous` and still be silently downgraded to draft by
`_resolve_vertical_floors()`. The product promise ("you set the dial per
routine, and some routines can graduate to auto-handle") was not deliverable
to the vertical most likely to buy it.

## What is NOT changed

These are integrity controls, not autonomy dials. They stay:

- **Principal-identity send ban** — the Operator never sends from a human's
  own mailbox identity (`email_send`, `email_reply`, … in `BANNED_TOOLS`).
  A send from the principal's mailbox forges authorship and destroys the
  attribution the supervision record depends on. Hard ban.
- **Trust-account write ban** — `mcp_smokeball_create_transaction` /
  `protect_funds` / `unprotect_funds` and the `payments_*` movement tools.
  Hard ban; the `trust-funds-read-only` floor slug stays in the pack.
- **Content-sensitivity floor (ADR 0031)** — money / contract / scope /
  legal-substance content bound outside drops an autonomous send to draft.
  This is what makes an autonomous ceiling safe to author.
- **Taint gate** — a turn that ingested untrusted inbound content cannot fire
  an autonomous send.
- **Citation gate** — fabricated legal citations block before any draft tool
  runs.
- **Fail-closed unauthored exposure (ADR 0035)** — removing the floor grants
  nothing; an unconfigured seat still sends nothing.
- **The other law floors** — `upl-boundary`, `privilege`, `conflict-routing`,
  `trust-funds-read-only`, `aba-512-supervision`.
- **The floor machinery itself** — `VERTICAL_FLOORS` (overlay
  `shared/action_classes.py`, mirrored in portal `config-governance.ts`) is
  now empty but stays live, with tests, for any future genuinely
  regulation-compelled floor. Re-adding an entry is a Captain decision made in
  both maps in the same breath, never a drive-by.

## Enforcement surfaces changed

1. **Runtime + apply-time** — overlay `shared/action_classes.py`
   `VERTICAL_FLOORS`: law-firm entry removed (hermes-smd-overlay #152). Both
   `hermes-smd-trust/enforce.py` and `config_applier/safety.py` derive from
   that one map.
2. **Portal governance** — `src/lib/portal/operator/config-governance.ts`
   `VERTICAL_FLOORS` mirror: law-firm entry removed; the portal exposure
   editor no longer rejects a raise to `autonomous` for law customers.
3. **Pack authoring + doctrine** — `external-send-draft-floor` slug removed
   from all vertical manifests; `compliance-floor.md` (six floors → five, with
   a removed-floor section), `wedge.md` invariant #4, `send-posture.md`,
   `data-handling-and-privilege.md`, `smokeball-surface.md`, and
   `docs/specs/verticals/*.md` reconciled.

## Follow-ons

- **Skill-prose pass**: ~10 law skill bodies (`operator/skills/*/SKILL.md`)
  still restate "drafted, never sent" as a skill invariant. Under
  `send-posture.md`'s own rule they must state the _authored_ ceiling and
  defer. Tracked separately — skill contracts have graded fixtures and deserve
  their own reviewed pass.
- **`confirm` in the portal**: ADR 0071 added the `confirm` ceiling to the
  runtime; the portal `Ceiling` type does not yet offer it. Once threaded
  through, `confirm` is a strong candidate recommended posture for law
  outside-send (show-then-one-click), between draft and autonomous.
