# Marketing — UX Brief (SUPERSEDED)

> **Stale. Do not build from this file.** This was the first-pass brief authored 2026-04-19 for the **pre-Operator consulting site** (Crimson Pro serif, deep-navy accent, "Book a conversation," the scorecard quiz). The venture pivoted to the **Operator** and the site moved to the "Plainspoken Sign Shop" identity. Almost every concrete instruction below (fonts, palette, page list, CTA copy) is now wrong.
>
> **For positioning, narrative, per-surface jobs, and the conversion model →** `docs/marketing/positioning-spine.md` (the living source of truth).
>
> **For the live visual identity →** read `src/styles/global.css` (the `--ss-color-*` tokens and `@theme` mapping) and the design-system package. Note: `.design/DESIGN.md` and `.design/theme.css` are **also stale** — they still describe the retired navy/Crimson-Pro "Modern Institutional" identity and are flagged for reconciliation in `positioning-spine.md` §6.

---

## Current identity quick facts (so this file no longer misleads)

The live marketing site, as shipped:

- **Type:** Archivo / Archivo Black (brutalist uppercase display), Archivo Narrow, JetBrains Mono (eyebrow labels). **Not** Crimson Pro / Public Sans.
- **Palette:** warm cream background, graphite/ink text, a **single burnt-orange accent**. **Not** the deep-navy single accent.
- **Shape:** zero radius, flat, hairline + heavy (3px) rules. No shadows, no gradients, no glow.
- **Motion:** minimal; `prefers-reduced-motion` respected.
- **Tokens:** `--ss-color-*` via `src/styles/global.css`.

## Marketing anti-patterns (still valid, identity-independent)

These survive the pivot and remain in force:

- Hero video autoplay or background video loops; parallax / scroll-driven reveals.
- Gradient-text headlines, text shadows, text-with-outline.
- Testimonial carousels with autoplay; trust-badge "As seen in…" rows unless real and earned.
- Countdown timers / urgency tickers; live chat widgets.
- Email-gated content (the marketing _is_ the read; intake comes after).
- Stock photography of business owners with laptops; mascots.
- Numerical hype without specifics ("10x your operations").
- A second contact form standing as a peer conversion door (one front door — the assessment).

## Approver

Scott Durgan.
