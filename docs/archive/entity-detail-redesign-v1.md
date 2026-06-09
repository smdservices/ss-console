# Entity Detail Page Redesign — Two-Column Decision Surface (v1)

> **Status:** Plan approved 2026-05-07. Implementation handoff to Codex.
> **Mockup:** Approved static HTML at `/tmp/ss-entity-detail-mockup.html`
> (Captain's local machine — visual ground truth for Plainspoken Sign Shop
> conformance and Option B layout). Codex should run the static mockup
> locally for visual reference.
> **Related:** ADR 0003 (lead-gen pivot, wrong-actor pipeline), PR #745
> (entity-row-view composer + actor_role plumbing), PR #746 (validator
> enum alignment).

## Context

The production `/admin/entities/[id]` page has structural problems Captain
audited on 2026-05-07: three renders of the outreach draft, two of the
intelligence brief, two stale runs of `review_synthesis` / `review_analysis`,
no first-class identity check after the ADR 0003 wrong-actor pivot, AI-
generated "Outreach Hooks" that read as Pattern A claims, and a stale
"Phoenix area" outreach draft from before the AZ-wide pivot. Decision controls
(Promote / Dismiss) sit at the top while the evidence supporting that decision
is scattered across three competing layouts (Context Timeline, Enrichment
Status table, Dossier Summary).

Captain's job on this page is to decide in under 90 seconds: promote a real
opportunity, dismiss a false positive, or merge a duplicate. The current
layout fights that job.

A team of three Phase-1 agents (internal map, external research, JTBD
strategy) recommended a two-column "evidence + sticky decision rail" layout
(Option B). A high-fidelity static mockup rendering Scottsdale Icon Dental's
real data in the SMD Plainspoken Sign Shop visual language was approved by
Captain on 2026-05-07. This plan implements that design.

**Intended outcome:** the redesigned page renders in the existing admin chrome,
deduplicates AI artifacts at the data layer, surfaces ADR 0003 fields
(`actor_role`, structural flags, candidate-merge-log hits) above the fold,
replaces the 2-button decision with a 3-disposition rail (Promote / Dismiss
with reason taxonomy / Merge), structurally suppresses Pattern A surfaces
(dossier "Outreach Hooks") at Signal stage, and degrades gracefully on mobile
without a separate redesign.

**Captain decisions baked in:**

- Promote unconditionally — no contact / enrichment prerequisite.
- Hold disposition deferred to a follow-on PR. v1 ships 3 buttons, not 4.
- Merge in v1 = wire existing `/api/admin/entities/[id]/merge.ts` for
  Signal-stage entities only (see WS-6 for the gap that constrains the
  scope to Signal). The original draft of this plan punted to "anchor-link
  only" before realizing the merge endpoint already exists and works for
  the Signal-stage use case.
- Desktop-primary, mobile-tolerant. Single-column stack below the `lg`
  Tailwind breakpoint (1024px), sticky bottom action bar for the decision
  rail at narrow widths.

## Out of scope (explicit)

These were considered and deferred to keep v1 tight. Each becomes its own
follow-on issue, not "we'll get to it."

- **Hold disposition** — needs `entities.snoozed_until` column, queue filter,
  re-surface mechanism. Separate PR.
- **Extending `mergeEntities()` to cover meetings / quotes / engagements /
  invoices.** The existing implementation at `src/lib/db/entities-extra.ts:57`
  moves `context` and `contacts` rows but those four related tables are
  not touched. For v1 the Merge button is enabled only on Signal-stage
  entities (where these tables are typically empty), so the gap doesn't
  bite. Extending mergeEntities for later-stage merges is a separate PR
  with per-table migration tests.
- **Pattern A validator extension to dossier markdown** — at Signal stage v1
  simply does not render the dossier "Outreach Hooks" section at all. Post-
  Promote rendering with classifier verdict is a follow-on.
- **Stale-draft regeneration endpoint** — the existing per-module
  `/api/admin/entities/[id]/enrichment/outreach_draft/retry` already
  regenerates. v1 wires "Discard" + "Regenerate on Promote" but does not
  introduce a new endpoint for regeneration.
- **EntityListRow / list page changes** — already updated in PR #745 with the
  row-view composer. Detail page reuses those derivations.
- **Removal of `EntityDossierSummary.astro` / `EntityStageActions.astro`
  source files** — `[id].astro` stops importing them, but the files stay
  orphaned for now. Cleanup is a follow-on once nothing else imports them.
- **Mobile-optimized layouts beyond degradation** — single-column stack +
  sticky bottom bar is enough. No separate phone-first design.

## Workstreams

Eleven workstreams across five phases. Phases sequential because of view-model
and component dependencies; workstreams within a phase are parallelizable.

### Phase 1 — View-model layer (one PR)

**WS-1. Read-side query for `candidate_merge_log`.** File:
`src/lib/db/candidate-merge-log.ts` (currently has only the append query).
Add `getCandidateMergesForEntity(db, orgId, entityId): Promise<CandidateMergeRow[]>`
that selects rows where `existing_entity_id = ? AND review_status = 'pending'`
ordered by `score DESC, created_at DESC`. Return shape: `id, candidateName,
candidateAddress, score, reason, sourcePipeline, createdAt`. Used by the
Merge dropdown in the decision rail.

**WS-2. Extend `LOST_REASONS` with Signal-stage codes.** File:
`src/lib/db/lost-reasons.ts`. Add five codes:

- `wrong-actor` — "Wrong actor (contractor / vendor / staffing agency, not the operating business)"
- `out-of-buy-box` — "Outside buy box (chain franchise / enterprise / government / non-profit / holding LLC)"
- `out-of-geography` — "Outside Arizona"
- `no-signal` — "Insufficient signal to qualify"
- `duplicate` — "Duplicate of another entity"

Update the `LostReasonCode` union and the `LOST_REASONS` array. The
`isLostReasonCode` validator picks up the additions automatically. Existing
post-engagement codes still apply at later stages.

**Chip styling for the 5 new codes:** all five fall through to the existing
default branch in `lostReasonChipClass` (`bg-[color:var(--ss-color-border-subtle)]
text-[color:var(--ss-color-text-secondary)]`). Do **not** invent new color
families. Rationale: the existing 7 codes already use 7 distinct colors and
adding 5 more would degrade scanability on the entities list and the lost
tab. Structural disqualifications (the new codes) intentionally read as
"neutral / structural" rather than "warm / cool" — the chip is for record-
keeping, not visual urgency. This change ships as part of WS-2 with a
screenshot of the entities list at the `stage=lost` filter included in the
PR description for visual review.

**WS-3. Compose decision evidence in `entity-detail-page.ts`.** File:
`src/lib/admin/entity-detail-page.ts`. Extend `EntityDetailPageResult` and
`loadEntityDetailPage` with three new derived bundles:

```ts
export interface EntityDetailPageResult {
  // ...existing fields...
  decisionEvidence: {
    actorRole: 'business' | 'contractor' | 'unknown'
    actorRoleConfidence: 'high' | 'medium' | 'low'
    signalEvidence: string | null // reuse composeSignalEvidence
    enrichmentSummary: string | null // first sentence from latest enrichment, sourced
    structuralFlags: string[] // e.g. ['Single-tenant suite', 'Arizona']
    missingForOutreach: Array<{
      key: 'contact' | 'website' | 'public-web-signal'
      label: string
      reason: string // the cited reason ("Google Places no_match", etc.)
    }>
    staleDraftWarning: {
      isStale: boolean
      reason: string | null // e.g. "Generated 2026-05-07 — pre-statewide pivot"
    }
  }
  mergeCandidates: CandidateMergeRow[]
  deduplicatedTimeline: ContextEntry[] // see WS-4
}
```

**Source of `actor_role`.** `actor_role` is written by the new-business
worker into the `metadata` JSON of the original ingest context entry — see
`workers/new-business/src/index.ts:65` where
`{ actor_role: permit.actor_role, ... }` is bound into the signal-creation
metadata, and the four soda.ts call sites (`soda.ts:256`, `soda.ts:303`,
`soda.ts:350`, `soda.ts:396`) that produce the value. The existing parser
at `src/lib/db/entity-signal-metadata.ts:21` (`parseSignalMetadataRow`)
reads other fields from this same metadata JSON but does NOT currently
extract `actor_role`. Pre-pivot entities have no `actor_role` key.

**WS-3a (additive to WS-3). Extend `EntitySignalMetadata`.** Add two fields
to the interface at `entity-signal-metadata.ts:5-14`:

```ts
actor_role: 'business' | 'contractor' | 'unknown' | null
actor_role_confidence: 'high' | 'medium' | 'low' | null
```

Update `parseSignalMetadataRow` to extract them — `actor_role` from the
top-level metadata key, `actor_role_confidence` from a sibling key (write
path may need a small workers-side update if confidence isn't currently
persisted; if not, default to `'high'` when role is `'business'` or
`'contractor'`, and `'low'` when role is `'unknown'` or absent). Update
`buildEmptyMetadata` to set both to `null`. This makes `actor_role`
available to **both** the list view (`EntityRowView` already consumes
`EntitySignalMetadata`) and the detail page through one parser, single
source of truth, no second fetch path. The list view automatically gains
the `actor_role` chip when rows render it (deferrable — list-view chip
rendering is out of v1 scope, but the data is now there).

Implementation helpers in WS-3 (all new, exported for testing):

- `resolveActorRole(metadata: EntitySignalMetadata): { role, confidence }` —
  reads the now-populated `metadata.actor_role` and `metadata.actor_role_confidence`.
  When `actor_role` is null (pre-#745 entities), returns
  `{ role: 'unknown', confidence: 'low' }`.
- `composeMissingForOutreach(entity, contextEntries, contacts, enrichmentRuns)` —
  derives the three-item list. Each item only appears when actually missing.
- `detectStaleDraft(outreachEntry, entity)` — returns true when
  `outreachEntry.created_at < ADR_0003_DEPLOY_DATE` (constant: `'2026-05-07T00:00:00Z'`)
  OR draft body matches `/Phoenix\s+(area|metro)/i`. The body-pattern check is
  belt-and-suspenders; once the date threshold ages out (~30 days post-merge),
  it becomes the only check.
- `composeEnrichmentSummary(reviewSynthEntry, websiteMeta, intelligenceBriefEntry)` —
  picks the most-sourced single sentence available. Priority: review_synthesis
  one-line summary, then deep_website summary, then first paragraph of
  intelligence_brief (stripped of "Engagement Hypotheses" / "Outreach Hooks"
  markdown sections). Never invents.

**WS-4. Deduplicate the timeline in the view-model.** File:
`src/lib/admin/entity-detail-page.ts` — add `composeDeduplicatedTimeline()`.
Rules:

- Drop ALL `outreach_draft` entries from the timeline (they're surfaced via
  `staleDraftWarning` + diagnostics drawer; never in the timeline body).
- Drop ALL `intelligence_brief`-source entries from the timeline (surfaced
  via `enrichmentSummary` derivation + diagnostics drawer).
- For `review_synthesis` and `review_analysis` sources, keep only the most
  recent entry per source.
- For all other context types, keep all entries (notes, stage_change, etc.).
- Preserve reverse-chronological order.

The `dossierBrief` and `outreachEntry` fields stay populated on the result
for the diagnostics drawer, but they no longer appear in `filteredEntries` /
`deduplicatedTimeline`.

### Phase 2 — Components (one PR, five new files)

All five components match the existing admin convention: `.astro`,
PascalCase, ARIA roles, Tailwind v4 utilities backed by `@venturecrane/tokens`,
no rounded corners, no shadows. Visual reference is the approved mockup —
match the mockup precisely.

**WS-5. `EntityIdentityStrip.astro`.** Above-the-fold identity panel.

```ts
interface Props {
  entity: Entity // .name, .vertical, .area, .stage
  actorRole: 'business' | 'contractor' | 'unknown'
  actorRoleConfidence: 'high' | 'medium' | 'low'
  signalEvidence: string | null // pre-composed line
  signalSourceLabel: string | null // for the eyebrow
  daysInStage: number
  structuralFlags: string[]
}
```

Render: 3px ink-bordered card. Eyebrow ("Signal · scottsdale_license", Archivo
Narrow 12px uppercase). Entity name (Archivo display 36px, weight 900,
letter-spacing -0.02em, uppercase). Chip row: actor_role chip first
(green/red/amber per role), vertical chip, then up to 3 structural flag
chips, then stage chip. Signal evidence line in JetBrains Mono 15px.
Meta line ("Filed today · 0 days in Signal · actor_role: business (high
confidence)") in 14px secondary text. Chips follow Pattern 01 — 0 radius,
1px border, Archivo Narrow uppercase.

**WS-6. `EntityDecisionRail.astro`.** Sticky right-rail card with 3
dispositions. Mobile becomes fixed bottom bar at the `lg` breakpoint.

```ts
interface Props {
  entityId: string
  entityStage: EntityStage
  mergeCandidates: CandidateMergeRow[]
  staleDraft: { isStale: boolean; reason: string | null }
  outreachEntry: ContextEntry | undefined // for the diagnostics-drawer link
}
```

Render: 3px ink-bordered card. Eyebrow "DISPOSITION".

- **Promote** — primary button (burnt orange). `<form method="POST"
action="/api/admin/entities/[id]/stage">` with hidden `stage=prospect`,
  `reason="Promoted to prospect by admin."`. Reuses existing endpoint.
- **Dismiss…** — `<details>` dropdown. Opens to a list of 12 reasons
  (the 5 new structural codes from WS-2 + 7 existing). Each is a
  `<form method="POST" action="/api/admin/entities/[id]/stage">` with
  `stage=lost`, `lost_reason=<code>`, `reason="<label> by admin."`.
  Optional `lost_detail` textarea per existing pattern in
  `EntityStageActions.astro:104-140`. Visually group structural codes (top)
  vs. post-engagement codes (bottom) with an `<optgroup>`-style separator.
- **Merge into…** — `<details>` dropdown. Wires the existing
  `/api/admin/entities/[targetId]/merge.ts` endpoint at
  `src/pages/api/admin/entities/[id]/merge.ts:14`, which calls
  `mergeEntities()` from `src/lib/db/entities-extra.ts:57`. Lists
  `mergeCandidates` with candidate name + address + score. Each row is a
  `<form method="POST" action="/api/admin/entities/<candidate.targetId>/merge">`
  with hidden `source_id=<this entity's id>` — so this entity becomes the
  source (deleted), the candidate becomes the target (kept). Endpoint
  redirects to the target's detail page on success.

  **Constraint: enabled at Signal stage only.** `mergeEntities()` moves
  `context` and `contacts` rows but does NOT move `meetings`, `quotes`,
  `engagements`, or `invoices`. Signal-stage entities typically have none
  of those, so the gap doesn't bite. For all other stages, render the
  Merge button as **disabled** with tooltip "Merge available at Signal
  stage only — extending mergeEntities is a follow-on." Wire this stage
  check (`entityStage === 'signal'`).

  **Empty state** when `mergeCandidates.length === 0`: render the dropdown
  trigger normally but display "No candidates from candidate_merge_log"
  inside.

Below the buttons, a divider, then "Outreach status" section. When
`staleDraft.isStale`: render the amber-bordered warning per the mockup with
"View draft" (links to diagnostics drawer anchor) + "Discard now" (POSTs to
the small new endpoint from WS-7). When `entityStage !== 'signal'` and an
outreach entry exists with no staleness: render a 1-line "Latest draft
generated <relative time>" link. At Signal stage with no draft: render
"Will be generated post-Promote and validated against Pattern A doctrine."

**Sticky vs. fixed positioning at the breakpoint.** The rail's positioning
lives entirely in the rail component, not split between the component and
the page's inline style block. Use Tailwind v4 responsive utilities at the
`lg:` breakpoint (Tailwind default 1024px):
`lg:sticky lg:top-20 max-lg:fixed max-lg:bottom-0 max-lg:left-0 max-lg:right-0
max-lg:border-t-[3px] max-lg:border-[color:var(--ss-color-text-primary)]
max-lg:bg-[color:var(--ss-color-background)] max-lg:px-4 max-lg:py-3 max-lg:z-40`.
At `lg` and above the rail sticks at top:5rem inside its grid column; below
`lg` the rail detaches into a fixed bottom bar. The breakpoint is exactly
1024px (Tailwind default), not 1100px — the mockup's 1100 was arbitrary.

Below `lg` the rail collapses to 3 buttons side-by-side (Promote / Dismiss /
Merge), each `flex-1`. The stale-draft section is hidden on the bottom bar
itself (it moves into the body content area above the bar to avoid
crowding). Disposition `<details>` dropdowns at this breakpoint open
upward (`max-lg:[&_>summary+*]:bottom-full max-lg:[&_>summary+*]:top-auto`)
so they don't appear below the screen edge.

Page-side: WS-11 must add `lg:pb-0 max-lg:pb-20` to the `<main>` element so
content isn't occluded by the fixed bar. The 5rem (80px) bottom padding
matches the bar height including the 3px ink top border.

**WS-7. Discard-stale-draft endpoint (small).** New file:
`src/pages/api/admin/entities/[id]/outreach-draft/discard.ts`. POST with no
body. Updates the latest `outreach_draft` context entry's `metadata.superseded =
true`. Used by the rail's "Discard now" link. Idempotent — multiple discards
on the same already-superseded entry are no-ops. The "Discard" affordance
exists because Captain may want to clear the stale Phoenix-area draft before
deciding; it doesn't change the disposition logic.

**Auth:** reuses the existing admin-session middleware applied to
`/api/admin/*` routes. Verify session in handler exactly the same way as
`src/pages/api/admin/entities/[id]/stage.ts:46-51`
(`if (!session || session.role !== 'admin') return 401`). No additional
CSRF wiring required — same as every other admin POST in the project.

(Author's note: this is the smallest possible new endpoint. If a metadata
write through the existing `/api/admin/entities/[id]/context` endpoint is
preferred, that endpoint appends rather than updates, so a tiny dedicated
route is cleaner.)

**WS-8. `EntityMissingPanel.astro`.** Amber-rule warning block listing the
gaps that prevent credible outreach.

```ts
interface Props {
  items: Array<{ key: string; label: string; reason: string }>
}
```

Render: amber left-border (3px solid `--ss-color-warning`), warning eyebrow
("MISSING FOR CREDIBLE OUTREACH"), bullet list. Each bullet renders as
"<strong>{label}</strong> — {reason}". When `items.length === 0`, render
nothing (component returns null).

**WS-9. `EntityEnrichmentSummary.astro`.** Single-paragraph factual summary +
4-cell facts grid.

```ts
interface Props {
  summary: string | null // composed by WS-3 helper
  source: string // e.g. "scottsdale_license"
  signalDate: string // ISO
  address: string | null
  vertical: string | null
  generatedAt: string // for the eyebrow aside
}
```

Render: block title "ENRICHMENT SUMMARY" eyebrow, aside with relative time +
source-of-summary attribution ("2 hours ago · review_synthesis"), one
paragraph in body text (16px, 1.55 line-height), 2-column dl grid with
Archivo Narrow eyebrow keys + JetBrains Mono values. Render an empty-state
sentence when `summary === null`: "Enrichment in progress — summary will
appear once review or website signals resolve."

**WS-10. `EntityDiagnosticsDrawer.astro`.** Collapsed `<details>` containing
operational data: 13-module status table (extracted from existing
`EnrichmentStatusPanel.astro`) + raw `intelligence_brief` markdown.

```ts
interface Props {
  entityId: string
  intelligenceBriefEntry: ContextEntry | undefined
}
```

Render: `<details>` with summary "ENRICHMENT DIAGNOSTICS (13 MODULES)" using
Archivo Narrow eyebrow style. When open: existing `EnrichmentStatusPanel`
table (or its inline equivalent — decide whether to compose or inline; the
existing component is reusable). Below the table, a horizontal hairline
divider, then "RAW INTELLIGENCE BRIEF" eyebrow and the brief's markdown
rendered via `renderSimpleMarkdown` (already exists in
`entity-detail-page.ts:108`). The brief contains the dossier "Outreach
Hooks" Pattern A surface — that's acceptable HERE because diagnostics is
operational data for retry/debugging, not decision-supportive UI. Add a
small visible note above the markdown: "Raw model output for retry /
debugging — not for outreach use." The markdown is not surfaced anywhere
else on the page.

### Phase 3 — Page integration (one PR)

**WS-11. Rewrite `src/pages/admin/entities/[id].astro`.** This is the
biggest workstream — most existing code is replaced.

- Imports: drop `EntityStageActions`, `EntityDossierSummary`. Add the five
  new components from Phase 2 + `EntityContactsPanel` (kept) +
  `EntityTimelineEntry` (kept) + `LogReplyDialog` (kept) +
  `EntitySendBookingDialog` (kept) + `AdminFlashNotice` (kept).
- Layout: AdminLayout with `maxWidth="max-w-6xl"` (was `max-w-5xl`; the new
  layout needs the wider container). Verified at
  `src/layouts/AdminLayout.astro:13` — the `maxWidth` prop type is
  `'max-w-5xl' | 'max-w-6xl'`, so this is a supported value, not a
  freeform string.
- Above-the-fold (full width): flash notices + back link.
- Two-column grid: `lg:grid lg:grid-cols-[1fr_22rem] lg:gap-stack`. Below
  `lg` the layout is implicit single column (no grid required).
- **Left column (evidence) order:** EntityIdentityStrip, EntityMissingPanel,
  EntityEnrichmentSummary, "Pain observations" block (existing data
  surface, see WS-12), EntityContactsPanel, "Timeline" block (existing
  EntityTimelineEntry components fed by `deduplicatedTimeline`),
  EntityDiagnosticsDrawer.
- **Right column (decision):** EntityDecisionRail. Positioning lives in
  the rail itself — see WS-6 for the exact Tailwind utility chain.
- Below-the-fold full-width sections (kept as-is): Meetings, Engagements,
  Quotes, Invoices `<details>` collapsibles. These render only when their
  arrays are non-empty (existing condition).
- The "Add a note" form moves out of body real estate to a small
  `<details>` collapsible above the timeline list with summary "+ Add note",
  containing the existing form. Captain can still add notes; they're just
  no longer competing with decision evidence at the top of the page.

**WS-12. "Pain observations" block.** Currently absent — the existing page
renders review_synthesis content via the dossier. New block reuses
`reviewMeta.top_themes`, `reviewMeta.operational_problems`, and signals from
job-monitor metadata if present (file `src/lead-gen/schemas/job-signal.ts`).
At Signal stage with no review/job data, render the empty-state sentence:
"No public review or job-post signal yet. License filed today; nothing has
been written about this practice externally. Expect this to fill in over 30–60
days as the practice opens." (See mockup.) Implement inline in `[id].astro`
or as a thin component `EntityPainObservations.astro` — implementer's call.

### Phase 4 — Tests (same PR as Phase 2/3 ideally)

**WS-13. View-model unit tests.** New file:
`tests/entity-detail-decision-evidence.test.ts`. Cases:

- `composeDeduplicatedTimeline` strips outreach_draft, intelligence_brief,
  keeps latest review_synthesis only, keeps notes / stage_change.
- `composeMissingForOutreach` returns `contact` when contacts.length === 0,
  `website` when entity.website is null AND no enrichment website resolved,
  `public-web-signal` when no review_analysis or job-monitor signal.
- `detectStaleDraft` returns true for created_at < ADR_0003_DEPLOY_DATE,
  false for newer drafts, true for any draft containing "Phoenix area".
- `resolveActorRole` returns `{role: 'unknown', confidence: 'low'}` when
  metadata field is missing.
- `composeEnrichmentSummary` priority: review_synthesis → deep_website →
  intelligence_brief first paragraph (stripped of Hypotheses / Hooks).

**WS-14. Render test.** New file:
`tests/entity-detail-page-render.test.ts`. Astro container API or SSR-render
test asserting:

- Signal-stage entity: `outreach_draft` body content does NOT appear in the
  page HTML **outside the `EntityDiagnosticsDrawer` `<details>` block**.
  The diagnostics drawer's collapsed `<details>` markup contains the raw
  intelligence-brief markdown (which may include Pattern A "Outreach
  Hooks") — that's intentional per WS-10. The assertion scopes against the
  body region, not the operational drawer. Practical implementation: parse
  the rendered HTML and assert the substring is absent in
  `document.querySelector('main').innerHTML.replace(/<details[^>]*data-diagnostics[^>]*>[\s\S]*?<\/details>/, '')`,
  or use `data-test="decision-evidence"` wrappers on the body sections and
  assert against those only.
- `intelligence_brief` body content does NOT appear outside the diagnostics
  drawer (same scoping).
- Identity strip renders the `actor_role` chip text.
- Decision rail has exactly 3 buttons: Promote, Dismiss…, Merge into….
- New `LOST_REASONS` codes render as options in the Dismiss dropdown.
- Pain Observations renders empty state when no review data.
- Merge button is **disabled** when `entityStage !== 'signal'` (per WS-6
  constraint).

**WS-15. Update existing tests.** Grep for tests touching `[id].astro`,
`EntityDossierSummary`, `EntityStageActions`, `dossierBrief`,
`outreachEntry`, and `outreachAngle` and update assertions to match the new
shape. The forbidden-strings test (`tests/forbidden-strings.test.ts`) gets a
new entry catching any reintroduction of "outreach_angle" or
"Pre-dossier draft" in source files.

### Phase 5 — Verify

1. `npm run lint && npm run typecheck && npm run test`
2. `npm run dev` → navigate to
   `admin.localhost:4321/admin/entities/<id>` for an existing Signal-stage
   entity (Scottsdale Icon Dental, ID
   `cba10031-5e26-42b9-8872-3d03bba60f45`).
3. Visual confirmation against the approved mockup.
4. Promote → confirms transition to Prospect, redirect, flash notice.
5. Dismiss with `wrong-actor` → confirms `lost_reason` persisted in
   stage_change metadata.
6. Merge dropdown → confirms candidates surface (or empty state if none).
7. Discard stale draft → confirms metadata mutation.
8. Resize browser to 800px → decision rail moves to bottom bar; chip row
   wraps; timeline grid stacks; main element has 5rem bottom padding.
9. `npm run verify` — all green.

## Critical files

| File                                                          | Action                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/pages/admin/entities/[id].astro`                         | Rewrite (compose new components, new layout)                                          |
| `src/lib/db/entity-signal-metadata.ts`                        | Extend interface + parser to extract `actor_role` and `actor_role_confidence` (WS-3a) |
| `src/lib/admin/entity-detail-page.ts`                         | Add 5 helpers + extend result type                                                    |
| `src/lib/db/candidate-merge-log.ts`                           | Add `getCandidateMergesForEntity()` reader                                            |
| `src/lib/db/lost-reasons.ts`                                  | Add 5 new codes + chip class entries                                                  |
| `src/components/admin/EntityIdentityStrip.astro`              | NEW                                                                                   |
| `src/components/admin/EntityDecisionRail.astro`               | NEW                                                                                   |
| `src/components/admin/EntityMissingPanel.astro`               | NEW                                                                                   |
| `src/components/admin/EntityEnrichmentSummary.astro`          | NEW                                                                                   |
| `src/components/admin/EntityDiagnosticsDrawer.astro`          | NEW                                                                                   |
| `src/components/admin/EntityPainObservations.astro`           | NEW (optional — may inline)                                                           |
| `src/pages/api/admin/entities/[id]/outreach-draft/discard.ts` | NEW (small endpoint)                                                                  |
| `tests/entity-detail-decision-evidence.test.ts`               | NEW                                                                                   |
| `tests/entity-detail-page-render.test.ts`                     | NEW                                                                                   |
| `tests/forbidden-strings.test.ts`                             | Extend banlist                                                                        |

## Reusable utilities

Reuse before reimplementing.

- `composeSignalEvidence()` from `src/lib/admin/entity-row-view.ts:106` —
  same composer for the identity strip's evidence line.
- `EntitySignalMetadata` type from `src/lib/db/entity-signal-metadata.ts` —
  extended in WS-3a to include `actor_role`, `actor_role_confidence`.
- `LOST_REASONS` registry from `src/lib/db/lost-reasons.ts` — extend, don't
  parallel-implement.
- `lostReasonChipClass()` from `src/lib/db/lost-reasons.ts` — fall through
  to default branch for the 5 new codes (no new color families).
- `appendCandidateMergeLog()` exists at
  `src/lib/db/candidate-merge-log.ts:17` — pair the new reader with it,
  same file.
- `mergeEntities()` from `src/lib/db/entities-extra.ts:57` — wire to the
  decision rail's Merge dropdown for Signal-stage entities only.
- `renderSimpleMarkdown()` from `src/lib/admin/entity-detail-page.ts:108` —
  reuse in the diagnostics drawer.
- `relativeTime()` from `src/lib/admin/relative-time.ts` — already used in
  the existing `EntityStageActions`.
- `parseMetadata()` from `src/lib/admin/entity-detail-page.ts:91`.
- Existing `EnrichmentStatusPanel.astro` component — compose into the
  diagnostics drawer rather than reimplement the 13-row table.
- AdminLayout chrome (header, breadcrumb, nav) is unchanged.
- `@venturecrane/tokens/ss.css` — all design tokens are token-driven; no
  new hex values, no new font sizes outside the type scale.

## Visual conformance

All new components MUST honor the SMD design system (Plainspoken Sign Shop):

- Cream `#f5f0e3` paper, ink `#1a1512` text, single accent burnt orange
  `#c5501e`. No new colors.
- **No rounded corners.** All new elements use `--ss-radius-*` tokens which
  are 0. Do not introduce literal `rounded-*` Tailwind classes.
- **No drop shadows.** Hairline borders (`--ss-color-border`) and 3px ink
  rules (`border-[3px] border-[color:var(--ss-color-text-primary)]`) carry
  the page.
- Typography: Archivo display, Archivo Narrow for eyebrows / tags / labels,
  JetBrains Mono for IDs / signal evidence / fact values.
- Spacing tokens: section 48 / card 32 / stack 16 / row 12 px. No literal
  spacing values outside the scale.
- Material Symbols Outlined for icons, axis 400/24/0/0.
- Pattern 01 (status display by context) for chips. Pattern 02 (redundancy
  ban) is the load-bearing rationale for this entire redesign — every fact
  on the page should appear once.

The approved mockup is the visual ground truth. When in doubt, match the
mockup.

## Risks + mitigations

- **`actor_role` write-path coverage.** Confirmed: written by the
  new-business worker into context.metadata at four call sites in
  `workers/new-business/src/soda.ts`. NOT written by job-monitor or
  review-mining workers (those have their own `posting_actor_role` field
  for the staffing-agency filter; not the same field). Detail page
  identity strip will therefore render "Business" / "Contractor" chips
  for new-business-pipeline entities only; entities from job_monitor /
  review_mining pipelines will fall through to the amber "Unknown" chip.
  This is acceptable for v1 — the wrong-actor problem ADR 0003 solves is
  scoped to the new-business pipeline.
- **`actor_role` missing on pre-#745 entities.** Identity strip falls back
  to amber "Unknown" chip with confidence: low. WS-3 helper handles the
  null case; do not throw. WS-3a's parser update extends
  `EntitySignalMetadata` so this is resolved at the data layer.
- **Stale-draft body-text heuristic false positives.** `Phoenix area` /
  `Phoenix metro` might legitimately appear in a draft for a Phoenix-located
  prospect post-pivot. Mitigation: the date threshold check is the primary;
  body text is secondary. Drop body check 30 days post-merge.
- **Mobile sticky bottom bar occluding content.** Decision rail at <`lg` is
  `position: fixed; bottom: 0`; main element gets `padding-bottom: 5rem`
  matching the bar height. Test at 800px viewport before merge.
- **`EntityStageActions` still imported elsewhere.** Grep before removing
  — confirmed only `[id].astro` imports it on 2026-05-07, but reverify
  pre-merge.
- **Dismiss reasons proliferation.** 12 reasons (7 + 5) in a single dropdown
  may overwhelm. Mitigation: visually group structural (top) vs.
  post-engagement (bottom) with a small `<optgroup>`-style separator.
- **Diagnostics drawer rendering the dossier markdown re-introduces the
  Pattern A surface.** That's intentional — diagnostics is operational, not
  decision-supportive. The visible "Raw model output for retry / debugging
  — not for outreach use" note above the markdown clarifies it.

## Verification (end-to-end)

After all phases land:

1. `npm run lint && npm run typecheck && npm run test` — green.
2. `npm run dev` then `open http://admin.localhost:4321/admin/entities/cba10031-5e26-42b9-8872-3d03bba60f45`
   (Scottsdale Icon Dental).
3. Identity strip: green BUSINESS chip first, then HEALTHCARE, structural
   flags, SIGNAL stage chip. Signal evidence line in mono. Days-in-stage = 0. Side-by-side with the approved mockup — visual parity.
4. Missing panel: lists Contact email, Website, Public-web signal with
   reasons.
5. Enrichment summary: one paragraph, facts grid populated.
6. Pain observations: empty-state sentence (newly licensed, no review data).
7. Contacts: 0 with empty state and "Add contact manually" link.
8. Timeline: ≤5 events, no outreach_draft entry, no intelligence_brief
   entry. Note-add `<details>` collapsible above the list works.
9. Diagnostics drawer: collapsed by default. Click reveals 13-module status
   table + raw intelligence brief.
10. Decision rail: Promote (primary burnt orange), Dismiss…, Merge into….
    Promote posts to existing endpoint, redirects, flash notice.
11. Dismiss with `wrong-actor` → entity.stage = lost, lost_reason persisted
    in stage_change metadata. Verify in D1 console.
12. Merge dropdown: empty state for this entity (no candidate_merge_log
    rows). For an entity with pending merge candidates, candidates surface
    correctly and link to target's detail page.
13. Stale draft warning: rendered (this entity has a pre-pivot draft).
    "View draft" anchors to diagnostics drawer; "Discard now" POSTs to the
    new discard endpoint and reloads with the warning gone.
14. Resize browser to 800px: rail moves to fixed bottom bar; main has
    bottom padding; chip row wraps; timeline grid stacks; everything
    readable.
15. `npm run verify` — green.

## Handoff to Codex

This plan is self-contained and references only canonical files. Codex
should:

1. Read this plan in full.
2. Read the approved mockup HTML for visual ground truth (Captain will
   share it directly — it's not committed to the repo).
3. Read `src/lib/admin/entity-row-view.ts` (PR #745 reference for the
   composer pattern).
4. Read the SMD design spec via `crane_doc('ss', 'design-spec.md')` for
   tokens.
5. Implement Phase 1 (view-model) in a single PR. Verify with WS-13 tests.
6. Implement Phase 2 (components) + Phase 3 (page integration) in a second
   PR. Visual verify against the mockup at desktop and 800px widths. Phase
   4 tests land in the same PR.
7. Run `npm run verify` before requesting review.

Captain reviews each PR. Open follow-on issues for: Hold disposition, full
merge logic, dossier-hooks Pattern A validator, and `EntityDossierSummary`
/ `EntityStageActions` source-file removal.
