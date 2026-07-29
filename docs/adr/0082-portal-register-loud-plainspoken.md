# ADR 0082: The client portal's settled register is loud Plainspoken; the calm migration is retired

- **Status:** Accepted (Captain, 2026-07-29)
- **Supersedes:** the calm-register end state declared by UI-PATTERNS Rule 8 as shipped in PR #1817 (2026-07-07)
- **Related:** ADR 0069 (operator legibility rebuild), PR #1821 (loud revert, 2026-07-08), `docs/style/UI-PATTERNS.md` Rule 8 (rewritten by this ADR's PR)

## Context

The portal's visual register has flip-flopped once already:

1. **2026-07-07.** The Captain flagged that the client portal and admin console "look like two different products off the same tokens." A calm Plainspoken register (white raised cards, hairline borders, sentence case) was declared the portal-wide end state, shipped as UI-PATTERNS Rule 8 plus `Card`/`CardHeader`/`StatusDot` primitives and a `CALM_REGISTER_PENDING` migration guard.
2. **2026-07-08.** The first calm surface (the operator landing) shipped washed-out due to a CSS-variable scoping bug, the styling iteration burned the Captain's patience, and the Captain reverted the surface to loud, keeping the content (PR #1821). Every portal surface built since has been loud, each added to the pending list.
3. **2026-07-29.** Reviewing the entitlement control UI, the Captain stated the actual objection was never the loud register ("I am not reacting to bold or bold borders... the text all looks fine to me") but the **form controls**: dropdowns, text boxes, and buttons at three different heights, intrinsic-width selects raggeding down the page, a squat reason box beside an oversized submit. The calm proposal is remembered as "too minimal."

The codebase said "loud for now"; Rule 8 still said "calm eventually." That unresolved fork is what kept sessions oscillating.

## Decision

**Loud Plainspoken is the client portal's settled identity.** Bold ink rules (`border-[3px]`), weight-900 uppercase section heads on the Plainspoken display scale, mono eyebrow labels, cream paper — the same family as the marketing site. This is a ratified identity, not a temporary state.

Consequences:

- The calm migration is **retired**: the `CALM_REGISTER_PENDING` guard family is removed, and the unused calm card primitives (`Card.astro`, `CardHeader.astro`) are deleted. `StatusDot.astro` stays — it has a live consumer (`AlivenessHeader`) and is register-neutral.
- UI-PATTERNS **Rule 8 is rewritten** to govern what was actually broken: form-control consistency. Portal form controls render through a shared control kit (`src/components/portal/form/`) with one control height, one border weight, full-width (never intrinsic-width) selects, and aligned columns. Enforcement mirrors Rule 7: a presence test with a shrinking `FORM_KIT_PENDING` list.
- The **admin console is out of scope** for this ruling. It keeps its current quieter treatment; no migration is mandated in either direction. If the 2026-07-07 "two products" concern is to be resolved by unifying the consoles, that is a separate Captain decision.
- The marketing site is untouched; it was always loud.

## What would reopen this

Only an explicit Captain reversal. Agents must not re-derive a calm (or any other) portal register from design-system first principles; the register question is settled here.
