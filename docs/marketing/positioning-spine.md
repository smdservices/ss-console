# Marketing Positioning Spine — Source of Truth

_Status: **LIVING / LOCKED.** This is the single authority for marketing-site positioning, the per-surface narrative, and the copy spine. If a marketing PR disagrees with this file, this file wins. A locked item in §2 and §4 is not re-litigated inside a build PR; it is changed only by a recorded Captain decision appended to §6._

_Authored 2026-06-29. Promotes the M2 diagnosis (`SMD-marketing-M2-diagnosis.md`, with the Captain decisions LOCKED 2026-06-27) into the repo so the next builder is checked against it instead of re-deriving positioning from the code. Supersedes `.design/marketing-ux-brief.md` for everything about message, narrative, and conversion. That brief predates the Operator pivot and is retained only as a stale historical artifact (see §7)._

---

## Why this file exists

The marketing site went in circles. In one ~8-hour window on 2026-06-27/28 four PRs shipped (#1534, #1538, #1541, #1543), and #1541 **rejected and rebuilt** #1538 — reversing decisions that were already locked: it deleted the greenlit gap visual motif, flipped `/why` from the conviction piece to a pure FAQ, and swung the home hero from the gap to named symptoms. None of those reversals were wrong on the merits. The problem is that **nothing held the line**, so each pass swung the pendulum and re-decided the core.

Two structural causes, both addressed here:

1. **No living source of truth in the repo.** The real spec lived on a Desktop file; the repo's marketing brief was stale. Every agent re-derived positioning from the code and its own taste. → _This file is now the in-repo authority._
2. **The locks were prose, not guardrails.** `forbidden-strings` catches banned phrases, but nothing asserted "the home hero leads symptom→gap" or "/why earns belief." A rebuild could silently reverse a Captain-locked decision and still pass `npm run verify`. → _The load-bearing locks are now encoded as guard tests (see §5)._

---

## 1. The flag (locked)

SMD owns one quadrant the entire competitor field has left empty: **the gap between capable people and capable software.** Everyone else leads with a _role_ (BDR, CX, SDR) and a mascot. SMD names a _category_.

> Capable people and capable software are **both genuinely good**. The problem is structural and universal: between even the best people and the best systems there is a **gap** where work falls through — the handoff between systems, the step that is everyone's job and no one's, the follow-up that slips. Today it is bridged by hand. **The Operator is a new kind of worker that fills the space in between.** It is a **managed** service: we build it around how you run, and we run it for you, as the field keeps moving. (Grounded in ADR 0037 Tenets 1 + 2. Category name locked as "Managed Operator" — see `src/lib/category.ts`.)

**Voice laws (non-negotiable, enforced in `tests/forbidden-strings.test.ts` and `tests/landing-page.test.ts`):**

- **Never disparage people or software.** Both are capable. The enemy is the gap and the teaching-tax, not either resource. No "off the shelf," no AI-vs-human comparison table, no "the role you keep meaning to fill" accusation.
- **"Managed" is load-bearing.** We do not sell-and-leave. "A guide in this wilderness, here to see you to your destination." Give it prominent placement as a top differentiator.
- Transience ("it won't walk out the door") is **one quiet closing factor**, never the theme.
- "Substrate" stays internal doctrine; on the page it is "a new kind of worker."
- No em dashes. No published dollar amounts. No first-person "I" outside the test-excluded `About.astro`. No "from day one."

---

## 2. The narrative synthesis (locked — this ends the abstraction-vs-symptom fight)

Every prior pass oscillated between leading with **the gap** (abstraction) and leading with **a named symptom** (the leak). Both instincts are right; they are not alternatives, they **nest**. The canonical order, on the home and reused everywhere the full argument is made:

> **1. Hook the symptom (the leak)** — a nameable leak in the buyer's own words: _the follow-up nobody sent, the handoff that stalled, the work that's everyone's job and no one's._
> **2. Name the gap** — that leak is not a people failure or a software failure. It falls into **the gap between your people and your software.**
> **3. The worker that fills it** — the Operator is a new kind of worker that fills that gap, across the tools you already run.
> **4. Managed by us, the guide** — you set the limits; we build it around how you run and we run it for you.

**Resolution of the specific reversals:**

- **Home hero: symptom-led, gap-resolved.** Lead the hero with the concrete leak (step 1), resolve to the gap in the very next beat (step 2). This keeps #1541's instinct and ends the swing. _Do not_ revert the hero to a bare gap abstraction with no symptom hook, and _do not_ strip the gap resolution so it becomes a generic pain list.
- **`/why`: the FAQ is kept, plus one conviction beat.** #1541's comparison/answer-engine FAQ (with `FAQPage` schema) is good SEO and stays. But `/why` must still **earn belief**: it carries one short conviction beat that states the gap (step 2) and the guide (step 4) respectfully, so a skeptic or a referral source doing diligence leaves convinced, not just informed.
- **`/operator`: bridge from the gap, then go to mechanism.** `/operator` assumes the sale and opens at the machine — but it must **bridge from the home's gap framing** in its first "what it is" beat rather than introducing a disconnected fresh metaphor. The buyer arriving from the home should feel one continuous argument.

---

## 3. Per-surface jobs (locked)

Each idea is argued in exactly one place. The distinctness test: a visitor who reads all four core pages should find `/why` changes _what they believe_, `/operator` _what they picture_, the home makes them _act_, `/consulting` catches the one-in-five with a bounded need.

| Surface           | Job                                                                                                                                                    | Carries                                                                                                             | Must NOT do                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **`/` home**      | The spine. Make a visitor believe a new category exists and move them to one conversation. Surface one forwardable definition for the referral source. | Symptom→gap→worker→managed (the §2 nesting), light; the industry router; the consulting second door; About; one CTA | Re-run the full manifesto; lead with hire-cost; expose §-number seams                   |
| **`/why`**        | Earn belief for the skeptic and the referrer doing diligence; double as the answer-engine surface. End forwardably.                                    | The comparison FAQ + `FAQPage` schema **and** one conviction beat (gap + guide)                                     | Describe the mechanism; restate pricing mechanics; become a pure FAQ with no conviction |
| **`/operator`**   | The mechanism — how the worker works, for someone already sold. Bridge from the gap, then assume the sale.                                             | One gap-bridge beat, then: what you get, the memory, the leash, the guide, where-it-fits, verticals                 | Re-argue the category from scratch; open on a disconnected new metaphor                 |
| **`/consulting`** | The honest second door — bounded scoped work. _"Not everything is a seat."_                                                                            | Objectives-first consulting spine, clearly subordinate                                                              | Compete with the Operator CTA at equal weight; bleed Operator language in               |
| **`/packs/*`**    | Recognition by vertical; self-contained warm-arrival surface (referred buyers deep-link here).                                                         | Role-specificity, the line/boundary, one conversation, at the home's craft bar                                      | Read generic; drop the per-vertical specificity                                         |
| **`/ai`**         | Single-funnel AI-house capability/SEO surface. SMD is an AI house, owned not downplayed, still solution-first.                                         | Confident AI capability framing draining to one conversation                                                        | Double-pitch the Operator; live in a foreign visual era                                 |

**Conversion model (locked):** one primary verb site-wide, **"Start the conversation"** → `/book?interest=<source>`, attribution always preserved. One lower-weight secondary, **"Read the argument"** → `/why`. Everything else is navigation, never a third co-equal CTA. The **assessment is the single front door**; consulting is an _outcome_ of the assessment, not a competing door (Captain decision #3). Refuse the SaaS reflexes: no signup/trial, no pricing table, no second contact form as a peer door.

---

## 4. Captain decisions — LOCKED 2026-06-27

Carried verbatim from the M2 diagnosis. These are settled. Reopen only via §6.

1. **Palette:** keep & tighten the warm "sign-shop" system. No dark/editorial pivot.
2. **Industries/packs:** promote packs to a real Industries index (warm vertical arrivals get a real door). Packs reach toward the depth of the Ashton & Price litigation-lifecycle review — the recognizable _shape_ of the carrying work per vertical; generalized marketing, never client-contracted promises.
3. **Conversion model:** the **assessment is the single front door.** Outcomes range from a recommendation to a single engagement to the Operator (the flagship outcome). "The right solution for the situation." Consulting is an outcome of the assessment, not a competing door. The site leads Operator-forward; the ask is always the assessment/conversation.
4. **`/ai`:** rebuild into the design system as a confident capability surface. SMD is an AI house — owned, not downplayed. Still solution-first.
5. **Managed service / guide promise (core message):** the Operator is a **managed** service — "a guide in this wilderness, here to see you to your destination." We don't sell-and-leave; we run it and guide as the field changes. "Managed" is load-bearing and gets prominent placement as a top differentiator.
6. **Gap visual motif:** greenlit, **but prove it small on 2–3 static references before committing the rebuild** (visual-thinker calibration). See §6 — currently unbuilt.

---

## 5. What is enforced in CI

The load-bearing locks are guard tests in `tests/landing-page.test.ts` (`describe('locked positioning spine')`). They fail the build if a future pass silently reverses a lock:

- **Home hero is symptom-led and gap-resolved** — `OperatorHero.astro` carries both the named symptom and the gap resolution.
- **The home surfaces the forwardable "fills the gap" definition.**
- **`/operator` bridges from the gap** — it references the gap framing, not only a standalone "remote worker" metaphor.
- **`/why` keeps the FAQ _and_ carries a conviction beat** — `FAQPage` schema present **and** the gap-conviction line present.
- **Single primary verb** — the spine surfaces all use "Start the conversation."

Plus the pre-existing guards that remain in force: no dollar amounts (`landing-page.test.ts`), retired-villain and banned phrases (`forbidden-strings.test.ts`), the eyebrow-system guard (`operator-section-badges.test.ts`), and the firm-voice "no first-person I" scan.

---

## 6. Open / deferred — the deliberate next steps

These are tracked here so they are not lost and not silently executed inside an unrelated rebuild.

- **Gap visual motif (decision #6).** Greenlit, built in #1538, deleted in #1541, **currently at zero.** This is the single biggest differentiation lever and the highest-craft/highest-risk piece. Per the Captain's own calibration rule it must be **proven small on 2–3 static reference artifacts before any rebuild commits to it.** Do not rebuild it as a side effect of a copy pass, and do not leave it permanently dropped by default. It gets its own de-risked effort and a recorded go/no-go.
- **Design-system docs are stale (newly surfaced 2026-06-29).** `.design/DESIGN.md` and `.design/theme.css` describe a retired "Modern Institutional" identity — navy `#2C5282`, Crimson Pro / Public Sans, `--color-*` tokens. The **live** site is the "Plainspoken Sign Shop" — burnt-orange accent, cream/ink, Archivo Black + JetBrains Mono, `--ss-color-*` tokens defined via `src/styles/global.css` and the design-system package. `global.css` itself still points its token documentation at the stale `DESIGN.md`. An agent that "follows the design system" today builds the wrong thing. **Reconcile the design docs to the live system in a dedicated pass** (out of scope for the positioning anchor that created this file).
- **Remaining M2 cohesion items not yet verified done:** `/consulting` weight (full subordinate page vs. thin door — Captain open decision #3 in M2 §6), category-vs-product reconciling line on the home (M2 #17), CaseStudies taxonomy two-layer cleanup (M2 #19). Check each against §3 before closing.

---

## 7. Superseded / stale artifacts

- **`.design/marketing-ux-brief.md`** — first-pass brief from 2026-04-19, written for the pre-Operator **consulting** site (Crimson Pro, navy, "Book a conversation," the scorecard quiz). Superseded by this file for all positioning, narrative, and conversion. Its identity/anti-pattern notes are also stale (see the design-system bullet in §6). Replaced with a pointer header.
- **`.design/DESIGN.md`, `.design/theme.css`** — stale "Modern Institutional" identity; see §6.

---

## Change control

A lock in §2, §3, or §4 changes only by a Captain decision recorded as a dated entry appended here, followed by updating the guard tests in the same PR. A build PR that needs to deviate stops and gets the decision first. That is the whole point of this file: the argument is sound, so the site should stop moving except by intent.
