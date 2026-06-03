---
title: Operator Pack Hand-off Prompt (template)
date: 2026-06-02
status: draft
captain: Scott Durgan
related-adr: 0022-vertical-pack-architecture.md, 0035-operator-thesis.md
---

# Operator Pack Hand-off Prompt

Fill the brackets and hand to an agent team to build one vertical pack's **ss-console side**. The Law pack is the worked reference; the team copies its shape.

---

Build the Operator vertical pack for **[VERTICAL]** (slug: `[slug]`). Produce the five ss-console artifacts, using the Law pack as the worked reference. Do not invent client-facing claims; pass the copy guards.

**Read first:**

- `docs/pm/pack-production-operating-model.md` — the operating model and the one hard rule.
- `docs/specs/verticals/law-firm.md` and `operator/verticals/law-firm/` — the worked reference (spec, manifest, addon, N=0 fixtures).
- `src/pages/packs/law-firm.astro` — the marketing surface to clone.
- `docs/specs/operator/vertical-manifest-schema.md` — the manifest schema.
- `docs/adr/0035-operator-thesis.md` — the positioning doctrine (compete-with-a-hire; system-features are connection targets, not rivals).

**Produce:**

1. **Vertical spec** at `docs/specs/verticals/[slug].md` from `docs/specs/verticals/_template.md`: the role digitized, residual connective layer, the 5-7 connective tasks, system stack + connector plan (MCP-first; flag any `build:` adapter as overlay work), compliance floor, labor-dislocation hook, employee-replacer rivals (exclude system-features), the wedge, the channel.
2. **Manifest** at `operator/verticals/[slug]/vertical.yaml` (+ `addons/[addon]/addon.yaml` if specialized) from `operator/verticals/_template/`. If `[slug]` is not in `ACCEPTED_VERTICALS` (`src/lib/operator/customer-yaml/types.ts`), add it (and any addon to `ACCEPTED_ADDONS`). Reuse spine skills; name vertical-specific ones.
3. **N=0 proof** at `operator/verticals/[slug]/fixtures/n0-deliverability-proof.md`: hand-draft the connective artifacts against synthetic inputs. They must read as sendable with light edits, and be substance-free per the compliance floor.
4. **Marketing surface** at `src/pages/packs/[slug].astro`: clone `law-firm.astro`, reskin the copy. Add `interest=[slug]` to the allow-list in `src/pages/book.astro` and `src/pages/api/intake/send.ts` (with a label), and add the page to `readMarketingFiles()` in `tests/landing-page.test.ts`. **Coordinate these shared-file edits with the integrator** so parallel packs do not collide.
5. **Delivery notes** against `docs/templates/delivery-sops/operator-pack-delivery-sop.md`.

**Verify:** `npx vitest run tests/forbidden-strings.test.ts tests/landing-page.test.ts` and `npm run typecheck` must pass. No em dashes, no dollar amounts, no fixed timeframes, no "coming soon", "we" voice.

**Out of scope (the overlay hand-off):** the vertical-specific skill bodies and any `build:` connector adapter live in `hermes-smd-overlay`. Declare their identifiers in the manifest; do not implement them here.

**Return:** one ss-console PR with the five artifacts.
