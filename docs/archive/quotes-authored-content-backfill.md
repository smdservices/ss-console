# Backfill plan — quotes authored content (#377)

**Status:** Captain decision pending. Do not execute backfill SQL until a path is chosen.

**Context.** Migration 0021 added four nullable columns to `quotes` for authored client-facing content (`schedule`, `deliverables`, `engagement_overview`, `milestone_label`). New draft quotes are gated — they cannot be sent until `schedule` and `deliverables` are populated. Existing rows (sent, accepted, declined, expired, superseded) carry NULL values today.

**The question.** What should happen when an existing client visits a quote whose `schedule` and `deliverables` columns are NULL?

The portal currently does the right thing: when `schedule` is null/empty, the "How we'll work" section renders nothing (matches the empty-state pattern from #377 Move 4). Deliverables fall back to the line-item-derived list because removing that mid-flight would break sent quotes that have not been resigned. So the immediate-rendering risk is bounded — but every existing quote sits in a fragile state where any future render path that synthesizes content (a new email template, a PDF re-render, an admin-side preview) could re-introduce fabrication.

Three options below. Recommendation at the end.

## Option A — null backfill + portal flag (do nothing, accept friction)

**Mechanics.** Leave `schedule` / `deliverables` NULL for all existing rows. Portal continues to render nothing for "How we'll work" on legacy quotes. Deliverables continue to fall back to line items. Admins are required to author both fields before the next time they re-send (e.g. on a status change to `superseded -> sent` for a revised version).

**Pros.**

- Zero data risk. No write touches any signed-quote row.
- Preserves the original signed artifact's source-of-truth fidelity. The signed PDF stays the contractual document; the portal landing is read-only context.
- Aligns with the empty-state pattern Track C is documenting.

**Cons.**

- Every existing client landing on their proposal sees a slightly thinner page than they did pre-#378 (the "How we'll work" block is gone, deliverables come from parsed line items instead of authored copy).
- The line-item-deliverables fallback is the same Pattern B class we are trying to eliminate — leaving it in place indefinitely is debt.
- Admins have to remember to author the new fields before any resend; nothing reminds them at non-resend touchpoints.

**Effort.** Zero migration work. Some discipline cost on the team.

## Option B — backfill with explicit TBD markers

**Mechanics.** Run a one-shot UPDATE for every existing quote row, populating `schedule` and `deliverables` with explicit "TBD" payloads:

```sql
UPDATE quotes
   SET schedule     = '[{"label":"Schedule","body":"Defined in the signed Statement of Work."}]',
       deliverables = '[{"title":"Deliverables","body":"Defined in the signed Statement of Work."}]'
 WHERE schedule IS NULL OR deliverables IS NULL;
```

Or render-side: detect `engagement_overview IS NULL` and substitute an explicit `"See signed SOW for engagement overview."` marker.

**Pros.**

- Every row has SOMETHING in the field, so no future render path can mistake null for "render fabricated default" — there is always a concrete string the page can show.
- The "TBD" wording is explicit and verifiable (an attorney looking at the page sees a deferral, not a commitment).

**Cons.**

- Every backfilled row carries a sentence that the business never authored for that engagement. Even though the sentence is explicit and harmless, "rendering uniform copy across many clients" is the exact pattern the #377 audit flagged.
- The send-gate becomes meaningless for backfilled rows: `getMissingAuthoredContent()` returns `[]` because the field has length, even though no one authored it. The validator can't distinguish "real authored" from "TBD-filler-from-backfill" without an additional flag.
- If we ever add a flag to distinguish them, we are halfway to Option C with worse ergonomics.

**Effort.** One UPDATE statement; easy to run, hard to reverse cleanly.

## Option C — block old quotes from re-rendering until reauthored

**Mechanics.** Add a fifth column in a follow-on migration:

```sql
ALTER TABLE quotes ADD COLUMN requires_authoring INTEGER NOT NULL DEFAULT 0;
UPDATE quotes SET requires_authoring = 1 WHERE schedule IS NULL OR deliverables IS NULL;
```

Portal renders a banner on `requires_authoring = 1` rows: _"This proposal predates our updated proposal format and is being refreshed. Please contact your consultant for the current version."_ The signed PDF download remains available (signed quotes), but the marketing surface is hidden.

The admin-side authoring flow clears `requires_authoring` once `schedule` and `deliverables` are populated.

**Pros.**

- Hardest possible enforcement. Eliminates the chance that a legacy quote ever renders Pattern B content again.
- Forces the team to reauthor old quotes proactively rather than only-on-resend.
- Makes the "what is authored vs. what was backfilled" distinction explicit and queryable.

**Cons.**

- Every existing client who lands on their proposal page right after merge sees the "being refreshed" banner — a worse experience for accepted/signed clients who have a contractual relationship and are using the portal as a reference.
- Adds schema migration + render-side branching for a transient state.
- Most blunt of the three options.

**Effort.** Migration + portal banner + admin-side clearer. Moderate.

## Recommendation: **Option A** (null backfill + portal flag), with a follow-on issue to remove the line-items-deliverables fallback.

Reasoning:

1. The acute risk (the fabricated 3-week schedule) is already gone via #378 + the rendering changes in this PR. The remaining gap is the line-items-deliverables fallback, which is bounded — it shows the same content the line items were already authored with.
2. Option B introduces uniform sentences across many clients, which is the original Pattern B violation in disguise. It would also defeat the send-gate. The cure is worse than the disease.
3. Option C punishes the user (the signed-and-paying client) for an internal data-hygiene gap. A banner saying "your proposal is being refreshed" on a quote that has been signed and paid for damages trust for no proportional safety gain.
4. Option A leaves us with one open debt (the line-items fallback) and one operational habit (author new fields before any resend). Both are addressable with a single follow-on issue tracked against #377.

**Suggested follow-on work** (to file as a sub-issue if Option A is chosen):

- A migration that adds a non-null `authored_at` timestamp set when both `schedule` and `deliverables` are populated. Lets the admin index distinguish authored-vs-legacy quotes at a glance.
- Drop the line-items-deliverables fallback once all visible-status quotes (`sent`, `accepted`) carry non-null `deliverables`. Until then the fallback prevents legacy regressions while bounding the Pattern B surface.
- A `crane_status`-style report that flags any visible-status quote with NULL authored content, so the team can sweep them as part of a routine pass.

Captain to choose A / B / C and apply the chosen path in a follow-on PR.
