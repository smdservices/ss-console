# Surface Brief — the per-surface definition exercise

Every portal/admin surface is defined by a **Surface Brief** before it is designed
or built. The brief is the thing we agree and sign off; the page is downstream of
it. This exists so we stop guessing our way through pages one after the next —
each surface earns its shape from a repeatable exercise, not from a vibe.

The exercise is the **Core Model** (Are & Mona Halland,
[A List Apart](https://alistapart.com/article/the-core-model-designing-inside-out-for-better-results/)),
adapted to this console. Adopted 2026-07-08 (Captain decision).

## The template

Fill this out for a surface, agree it, then design to it.

```
Surface Brief — <page / route>

1. Target user        — who actually lands here (role + context).
2. User tasks         — what they're trying to get done, in their words:
                        "When I come here, I want to ___ so I can ___."
3. Business objective — why WE put this in front of them; what it must
                        accomplish for SMD.
4. Inward paths       — how they arrive (nav, an email link, a hand-off from
                        another surface). Catches orphan pages.
5. Core content       — the essential thing(s) this surface must show to satisfy
                        the task AND the objective. Anything not serving the task
                        or the objective gets cut. (This answers "why present
                        anything at all.")
6. Forward paths      — what they do next and what they can do here (actions,
                        exits). (This answers "what can they do.")
7. Verdict            — given 1–6, what this surface should BE: keep / cut / add /
                        reshape. This is the line we sign off before any design
                        or code.
```

## The loop (how we run it)

One surface at a time:

1. **Brief** — fill the template above from real ground truth (the code, the
   config model, the facet registry — never memory).
2. **Agree** — put it in front of the Captain; add/cut/correct fields; sign off
   the verdict. Nothing is built off an unsigned brief.
3. **Design** — mock the surface to the agreed brief; the Captain reacts to a
   real rendering, not a description.
4. **Build** — implement the signed-off design in the calm register
   ([UI-PATTERNS.md](./UI-PATTERNS.md) Rule 8), honest where data isn't wired
   ([empty-state-pattern.md](./empty-state-pattern.md)).
5. **Sign off** — the Captain confirms the built result, then we point at the
   next surface.

## Ground-truth discipline

Fill the brief from what actually exists, not from memory — memory is how facets
get orphaned. For operator surfaces the authoritative inventory is the **facet
registry** (`src/lib/portal/operator/facet-registry.ts`): the closed set of every
facet the operator has, each with a deliberate surface decision. If a brief needs
a facet, it is in the registry or it is not real.

Completed briefs live in `docs/design/<area>/surface-briefs/`.
