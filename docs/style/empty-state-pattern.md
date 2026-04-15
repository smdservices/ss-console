# Empty-state pattern for client-facing surfaces

When authored data for a section is missing, render NOTHING or an explicit
"TBD in SOW" marker. Never synthesize content, never borrow brief copy, never
fall back to "sensible defaults". This is the only sanctioned alternative to
having authored data.

This document exists because the proposal page incident (#377, hotfix #378)
showed that agents (and reviewers) will accept fabricated content over a
visually empty section. Until the empty-state pattern is the path of least
resistance, the no-fabrication rule in the project [CLAUDE.md](../../CLAUDE.md)
will keep getting routed around. The two work as a pair: the rule prohibits
invention, this doc shows what to do instead.

## When to render nothing

Render nothing when the section's absence is not meaningful to the client and
they will not miss it. The surface still reads as complete because the section
was conditional on data the client never expected.

Use this pattern when:

- The section is one of several that a complete record will populate, and the
  client has no per-engagement reason to expect any specific one (for example,
  the timeline section on a portal home dashboard for an engagement that
  hasn't started yet).
- The section is purely additive (a "next check-in" callout, a consultant
  contact block, a deliverables list on a draft proposal) and the surface
  above and below it stands on its own.
- The section was not promised in any prior client communication. If the
  proposal email said "you'll see your kickoff date in the portal," do not
  silently omit the kickoff date. Use the explicit marker pattern instead.

## When to render "TBD in SOW"

Render an explicit "TBD in SOW" marker (or the surface-appropriate equivalent)
when the section's absence would confuse the client and they need a signal
that the gap is intentional. The marker tells the client "this is coming and
will be set in the signed SOW," which is true and bounded.

Use this pattern when:

- The section is a labeled field the client expects to see populated (project
  start date, end date, milestone names). Rendering an empty cell next to a
  populated one looks like a bug.
- The section is something the engagement contracted but has not yet
  finalized. The marker is a placeholder for authored content that will land,
  not a stand-in for content that may never exist.
- A signed legal document (SOW PDF) needs the field present for layout and
  audit reasons even if its value is not yet known. The existing
  `'TBD upon deposit'` and `'TBD based on scope'` markers at
  `src/pages/api/admin/quotes/[id].ts:111-112` are the precedent.

The marker text should be short, capitalized as a label, and never sound like
filler. `'TBD in SOW'` is the standard. `'TBD'` alone is acceptable inline
(see `src/pages/portal/engagement/index.astro:48`). Do not write
`'Coming soon'`, `'To be determined later'`, or any phrasing that implies
business behavior the engagement has not contracted.

## Implementation

The portal is Astro with React islands. Both render the same way for this
pattern.

**Render-nothing pattern.** Gate the entire section on the authored field, not
on a fallback:

```astro
{
  engagement?.next_step_text && (
    <p class="text-sm text-slate-600">Here's what happens next: {engagement.next_step_text}</p>
  )
}
```

Not this:

```astro
<p class="text-sm text-slate-600">
  Here's what happens next: {engagement?.next_step_text ?? "We'll reach out to schedule kickoff."}
</p>
```

The fallback string is a Pattern A violation. Even when the surrounding
sentence interpolates an authored value, the literal wrapper is a commitment
the engagement may not have contracted.

**TBD-marker pattern.** Render the label with the marker as the value:

```astro
<dl>
  <dt>Estimated Completion</dt>
  <dd>{engagement.estimated_end ? formatDate(engagement.estimated_end) : 'TBD in SOW'}</dd>
</dl>
```

The `formatDate` helper at `src/pages/portal/engagement/index.astro:48`
already implements this for date fields. Reuse it. For non-date fields, use
the same conditional shape, never a string literal as the fallback.

**Server-truth gating.** When the section's presence depends on a database
state (a `superseding` row exists, the quote is `accepted_at`-set, the
invoice is `paid_at`-set), gate on that row, not on a derived placeholder.
This is what `src/pages/portal/quotes/[id].astro:252-255` already does
correctly with `'A revised version is available.'` (the sentence renders only
when a superseding row exists).

**Component prop default note.** If a presentational component (for example
`ConsultantBlock`) takes optional props, the component's job is to omit the
sub-section when the prop is absent. The host page should pass through the
authored value or `null`, not a default string. Pattern A violations have
been entering the codebase via component-level defaults that look harmless
in isolation.

## Anti-patterns (from audit)

These are real instances from the 2026-04-15 audit
(`docs/audits/client-facing-content-2026-04-15.md`). Each shows the violation
and the empty-state pattern that should have been used.

**1. Fallback consultant identity at `src/pages/portal/quotes/[id].astro:85`.**

```ts
const consultantName = 'Scott Durgan'
```

This renders to every client whose engagement does not have
`engagements.consultant_name` populated. The SMD Services voice standard
(CLAUDE.md §6) is "we" / "our team," and a single hardcoded name runs
counter to that. Correct pattern: gate the consultant block on
`engagement?.consultant_name`. If absent, render nothing in that surface.

**2. Process-commitment fallback at `src/lib/portal/states.ts:138`.**

```ts
nextStepText ?? "We'll reach out to schedule kickoff."
```

Every client whose engagement does not have an authored next-step sentence
sees the same kickoff promise. Correct pattern: drop the fallback, return
`null`, and let the host page conditionally render the "what happens next"
sentence.

**3. SOW PDF overview at `src/pages/api/admin/quotes/[id].ts:110`.**

```ts
overview: 'Operations cleanup engagement as discussed during assessment.'
```

This sentence becomes the Page 1 "ENGAGEMENT OVERVIEW" body on every signed
SOW regardless of what was actually scoped. Correct pattern: require an
authored `quotes.engagement_overview` before SOW generation. If absent,
block generation rather than ship a SOW with a fabricated overview.

**4. SOW signature contact fallback at `src/pages/api/admin/quotes/[id].ts:101`.**

```ts
contactName: primaryContact?.name ?? 'Business Owner'
```

A SOW signed as "Business Owner" is a compliance risk. Correct pattern:
block SOW generation if no primary contact name is on file. There is no
acceptable empty-state for a signature line on a legal document.
