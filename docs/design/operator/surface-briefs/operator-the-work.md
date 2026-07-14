# Surface Brief — Operator › The work

Route: `portal.smd.services/portal/products/operator/<instance>/work`
Chapter: 2 of the locked console structure
([04-console-structure.md](../04-console-structure.md)) — the spine.
Facets absorbed: `workflow`, `skills` (as detail/fallback), `schedule`
(initiation column), `entitlements`/`authority` (per-routine tier),
`business-hours` (header line), `bundles`.
Data: `routine_grid_json` on the config projection (PR-B), the personas
projection (skills + initiation), the reviewed summary catalogs.
Status: **SIGNED OFF (descoped) — 2026-07-14.** Captain reset: the mission is
an accurate READ-ONLY depiction of the operator's configuration on both
portals; interaction design (graduation requests, per-routine buttons,
permanent-rules copy) is OUT of this build. Name locked: "The work". Tier
display locked: the Today / Can-become sentence pairing. §6's graduation
request and §5's Permanent-rules block are DEFERRED (the row structure does
not preclude adding them later, which fully satisfies the configurability
substrate for now). No new authored copy: rows render only the grid's own
authored fields plus the existing reviewed skill summaries. The shared viewer
mounts on BOTH portals (client + admin) in this build.

---

## 1. Target user

The client principal, staff member, or compliance role — but above all the
**owner deciding whether this employee is worth what it costs and how much
rope to give it**. Context: they want to read their operator's job the way
they would read a job description crossed with an authority matrix — because
that is literally what this page is (structure doc §2b).

## 2. User tasks

> "When I come here, I want to see everything my operator does for us, stage
> by stage, and how much it does on its own, so I can trust it, correct it,
> and decide when to give it more."

Secondary: "so I can check a specific duty before I rely on it" ("does it
watch service confirmations?"), and "so I can see what I could turn up next."

## 3. Business objective

This is the retainer, made visible. Nineteen named duties across the firm's
whole lifecycle is the strongest possible answer to "what am I paying for" —
and the per-routine dial is the trust engine: it shows the client exactly
where they can graduate the operator, which is both the ADR 0071 growth path
and the configurability substrate (§5b) in its first client-facing form.

## 4. Inward paths

- "The work" door on the operator landing (replaces the Skills, Schedule,
  Workflows, and Governance doors).
- Direct URL / bookmark; future onboarding hand-off ("here is the job we
  configured").

## 5. Core content

**Grid-backed seats** (a projected, validated routine grid exists):

- **Sections in grid order** — the 8 lifecycle sections, rendered as the
  letter names them (Discovery, Case Initiation, Medical Records and
  Chronology, Motions, Minor's Compromise, Trial Prep, Mediation / Settlement
  / Liens, Firm-wide). Vocabulary comes from the grid; the page carries no
  hardcoded lifecycle.
- **One row per routine**, each rendering only authored data:
  - **Name** — `routine` verbatim ("Records chase").
  - **What it does** — from a new hand-authored `routine-summaries.ts`
    catalog (one reviewed sentence per routine, compressed faithfully from
    the grid row + skill summaries; guard-tested like `skill-summaries.ts`:
    complete, no stale keys, no em dashes, length-capped). Never runtime
    paraphrase of `enforcement.notes`.
  - **Starts** — from `enforcement.initiation`, mapped to the established
    plain labels ("On request" / "On a schedule" / "When something happens")
    by parsing the authored initiation string's modes; the authored detail
    ("weekly provider chase") shows at detail level.
  - **Today** — `start_tier` in the locked plain sentence: _surfaces it_ /
    _prepares it for you_ / _handles it_.
  - **Can become** — shown **only when** `ceiling_tier` differs from
    `start_tier`: "You can allow: _handles it_" with the letter's verbatim
    ("Auto-handle once you are comfortable") at detail level. When ceiling
    equals start, show the cap instead: "This is its maximum" plus the
    letter's cap verbatim ("capped: before a judge").
  - **Detail (expand)** — the letter verbatims (`start_verbatim` /
    `ceiling_verbatim`), the implementing skill(s) with their existing
    skill summaries, and the always-true guarantees for that routine drawn
    from authored enforcement facts only: `banned_tools` (rendered via a
    small reviewed phrase map, e.g. `payments_*` → "never moves money"),
    `content_floor: true` → "sensitive content always goes through a
    person". `enforcement.notes` prose is NOT rendered (engineer-authored).
- **Permanent rules block** (top of page) — the named caps that are never
  client-raisable, derived from the grid's cap verbatims + banned tools:
  money, court filings, opposing counsel, deadlines. One short reviewed
  list; each item traceable to grid rows. This is the DoA matrix's "never
  above Z" line, and it must read as reassurance, not restriction.
- **Header line** — business hours: timezone only ("Works on Pacific time");
  days/hours are inert and never render (Lock 2).

**Gridless seats** (no grid authored — smd, Hosted Agent, any seat pre-grid):
the honest degradation — the existing skills + initiation inventory (the
current Skills page content, unchanged), introduced by one true sentence:
"Your operator's duties are listed here as configured." No invented tiers, no
empty grid scaffolding.

**NOT shown:** raw tier tokens, exposure-key names, `enforcement.notes`
prose, skill version/cost, anything about routines not in the grid.

## 6. Forward paths

- **Per-routine graduation request** — on every row where `ceiling_tier` >
  `start_tier`: "Ask us to let it handle this on its own" → the existing
  change-request pipe with structured context
  (`context_json: {kind:'routine_graduation', routine:<name>}`, PR-C1),
  surfaced in the admin change-request inbox with the routine named. Ships
  as request → Captain applies (a one-line exposure/initiation change per
  the grid's own enforcement notes); becomes self-service later by flipping
  the domain authority — no page rework (§5b).
- **Generic request-a-change** stays available (DomainSurface, configuration
  domain) for everything else ("can it also do X?").
- **Skills detail** — rows link to the existing Skills page as the
  implementing-skill detail view; breadcrumb back to the landing.

## 7. Verdict

**BUILD** as the console's centerpiece: the rendered job description +
authority matrix, lifecycle-grouped, every sentence backed by authored data
(grid, catalogs, projection), with the graduation request built in from day
one. Replaces four planned settings pages. Skills-facet build pattern
(shared resolver `src/lib/portal/operator/facets/work/` + shared viewer +
instance page + registry flips), loud register, `CALM_REGISTER_PENDING`.

---

## Open questions for sign-off

1. **Name.** "The work" (plain, fast) vs "Duties" (employment-artifact
   flavor). Recommend **"The work"** — reads faster, and §2b lets structure
   carry the correspondence.
2. **Graduation request wording.** Row action reads "Ask us to let it handle
   this on its own" (request framing, concierge-first). Confirm.
3. **Permanent rules copy.** The four permanent caps rendered as reassurance
   ("It never moves money. Nothing goes to a court or opposing counsel
   without a person sending it. Every deadline is confirmed by an
   attorney.") — reviewed sentences traceable to the grid. Confirm this
   block and its tone.
4. **The "Today / Can become" pairing** as the row's authority display
   (instead of a settings-style dial widget). Confirm.
