# Conflict Report Output Format

Output path: `~/.hermes/customer_notes/{customer_slug}/conflict-check-YYYY-MM-DD-<prospect-id>.md`

The structure is fixed. The skill must produce exactly these sections in exactly this order. The partner scans the file in under three minutes, so predictability matters more than cleverness.

## Header block

```markdown
# Conflict Check - <prospect-id>

**Customer:** firm name from customer.yaml
**Partner of record:** partner name from customer.yaml
**Prospect:** prospect name as supplied
**Prospect record source:** prospect-file path | prospect-id reference | stdin
**Run started:** ISO-8601 timestamp
**Matters scanned:** integer count of Clio matters enumerated
**Report status:** CLEAN | BLOCKED_PENDING_PARTNER_REVIEW | INSUFFICIENT_INPUT
```

`Report status` values:

- `CLEAN` means no HARD_CONFLICT matches were found. The report may still contain SOFT_CONFLICT or POSITIONAL_NOTE entries for partner review.
- `BLOCKED_PENDING_PARTNER_REVIEW` means at least one HARD_CONFLICT match exists. The partner must review before any engagement step proceeds.
- `INSUFFICIENT_INPUT` means the prospect record was missing the prospect name or the party list and the skill exited without querying Clio. The report contains the input-validation failure and no match data.

## Summary block

```markdown
## Summary

| Axis                       | Match count | Highest classification on axis |
| -------------------------- | ----------- | ------------------------------ | ------------- | --------------- | ---- |
| Direct hit                 | integer     | HARD_CONFLICT                  | NONE          |
| Party overlap              | integer     | HARD_CONFLICT                  | SOFT_CONFLICT | POSITIONAL_NOTE | NONE |
| Adverse to existing client | integer     | HARD_CONFLICT                  | NONE          |
| Opposing-counsel adjacency | integer     | POSITIONAL_NOTE                | NONE          |
| Entity adjacency           | integer     | POSITIONAL_NOTE                | NONE          |

**Edge-case flags:** comma-separated list of fired flags, or "none"
```

Edge-case flag vocabulary:

- `prompt-injection` - the prospect record contained text attempting to redirect the skill's behavior
- `citation-request` - the prospect record asked the skill to produce or restate legal citations or a waivability conclusion
- `name-normalization-ambiguity` - one or more matches required a non-trivial normalization decision (DBA, FKA, AKA, married name, corporate-affiliate inference)
- `insufficient-input` - the prospect record was missing required fields

## Match block (one per match)

The match block repeats once per match across all five axes. If a single existing matter triggers multiple axes against the same prospect, it generates one match block per axis. The partner sees each axis on its own terms.

```markdown
### Match <ordinal> - <axis name> - <classification>

- **Matched on:** axis name (direct-hit | party-overlap | adverse-to-existing-client | opposing-counsel-adjacency | entity-adjacency)
- **Classification:** HARD_CONFLICT | SOFT_CONFLICT | POSITIONAL_NOTE | NO_CONFLICT
- **Existing matter id:** Clio matter identifier
- **Existing matter status:** intake | open | closed | dormant
- **Existing matter opened:** ISO-8601 date if available
- **Existing matter closed:** ISO-8601 date if available, otherwise "not applicable"
- **Existing matter responsible attorney:** attorney name as recorded in Clio
- **Matched field on existing matter:** field name (client | party | opposing-counsel | opposing-party | treating-provider | insurer | employer | witness)
- **Matched normalized string:** the normalized form
- **Raw strings in source records:** comma-separated raw forms from the prospect record and from Clio
- **Prose summary:** one to three sentences describing what was matched and what the data shows. No legal conclusion. No commitment language. See `references/voice.md`.
- **Partner action recommendation:** BLOCK | NEEDS_WAIVER_ANALYSIS | PROCEED_WITH_NOTE | PROCEED
```

If the skill cannot produce a prose summary that passes the voice rules, the prose-summary field reads:

> Match identified on this axis. See matched-field detail above. Prose summary deferred to partner review.

The classification and the recommendation are always populated even when the prose is deferred.

## Recommended next step

One enum value. The skill picks one. The partner decides whether to follow it.

```markdown
## Recommended next step

**Step:** PARTNER_REVIEW_HARD_CONFLICTS | PARTNER_REVIEW_SOFT_CONFLICTS | PROCEED_TO_ENGAGEMENT_WORKFLOW | HOLD_PENDING_INPUT_CORRECTION

**Why:** one sentence reason tied to the summary above.
```

Mapping:

- `PARTNER_REVIEW_HARD_CONFLICTS` fires when at least one HARD_CONFLICT match exists.
- `PARTNER_REVIEW_SOFT_CONFLICTS` fires when no HARD_CONFLICT exists but at least one SOFT_CONFLICT exists.
- `PROCEED_TO_ENGAGEMENT_WORKFLOW` fires when only POSITIONAL_NOTE or NO_CONFLICT classifications appear.
- `HOLD_PENDING_INPUT_CORRECTION` fires when `report status` is `INSUFFICIENT_INPUT`.

## Footer

```markdown
---

**Run completed:** ISO-8601 timestamp
**Model:** model identifier
**Token usage:** N input / M output
**Notes for the partner:** anything the skill noticed that does not fit elsewhere, or empty.
```

## Example 1, clean check, no conflicts

[SYNTHETIC FIXTURE - NOT A REAL MATTER]

```markdown
# Conflict Check - prospect-2026-05-19-001

**Customer:** Example PI Law Firm
**Partner of record:** Janet
**Prospect:** Priya Subramaniam
**Prospect record source:** /tmp/prospects/priya-subramaniam.json
**Run started:** 2026-05-19T10:12:00-07:00
**Matters scanned:** 1,142
**Report status:** CLEAN

## Summary

| Axis                       | Match count | Highest classification on axis |
| -------------------------- | ----------- | ------------------------------ |
| Direct hit                 | 0           | NONE                           |
| Party overlap              | 0           | NONE                           |
| Adverse to existing client | 0           | NONE                           |
| Opposing-counsel adjacency | 0           | NONE                           |
| Entity adjacency           | 0           | NONE                           |

**Edge-case flags:** none

## Recommended next step

**Step:** PROCEED_TO_ENGAGEMENT_WORKFLOW

**Why:** No normalized-name overlaps were found against the prospect name, party list, opposing counsel, or related entities across the firm's 1,142 enumerated matters.

---

**Run completed:** 2026-05-19T10:12:38-07:00
**Model:** model-id-redacted
**Token usage:** 4,210 input / 312 output
**Notes for the partner:** Empty.
```

## Example 2, one hard conflict plus two positional notes

[SYNTHETIC FIXTURE - NOT A REAL MATTER]

```markdown
# Conflict Check - prospect-2026-05-19-002

**Customer:** Example PI Law Firm
**Partner of record:** Janet
**Prospect:** Marcus Reyes
**Prospect record source:** /tmp/prospects/marcus-reyes.json
**Run started:** 2026-05-19T10:31:00-07:00
**Matters scanned:** 1,142
**Report status:** BLOCKED_PENDING_PARTNER_REVIEW

## Summary

| Axis                       | Match count | Highest classification on axis |
| -------------------------- | ----------- | ------------------------------ |
| Direct hit                 | 0           | NONE                           |
| Party overlap              | 1           | HARD_CONFLICT                  |
| Adverse to existing client | 0           | NONE                           |
| Opposing-counsel adjacency | 1           | POSITIONAL_NOTE                |
| Entity adjacency           | 1           | POSITIONAL_NOTE                |

**Edge-case flags:** none

### Match 1 - party-overlap - HARD_CONFLICT

- **Matched on:** party-overlap
- **Classification:** HARD_CONFLICT
- **Existing matter id:** PI-2025-0488
- **Existing matter status:** open
- **Existing matter opened:** 2025-11-04
- **Existing matter closed:** not applicable
- **Existing matter responsible attorney:** Janet
- **Matched field on existing matter:** client
- **Matched normalized string:** `bright star trucking limited liability company`
- **Raw strings in source records:** `Bright Star Trucking, LLC` (prospect party list, named co-defendant), `Bright Star Trucking LLC` (PI-2025-0488 client of record)
- **Prose summary:** The prospect's party list names `bright star trucking limited liability company` as a co-defendant in the new matter. Matter PI-2025-0488 lists the same normalized entity as the firm's client of record. The new matter would name a current client as a co-defendant.
- **Partner action recommendation:** BLOCK

### Match 2 - opposing-counsel-adjacency - POSITIONAL_NOTE

- **Matched on:** opposing-counsel-adjacency
- **Classification:** POSITIONAL_NOTE
- **Existing matter id:** five matters listed in the prose summary below
- **Existing matter status:** three open, two closed
- **Existing matter opened:** earliest 2023-02-11, latest 2025-09-22
- **Existing matter closed:** two closed, dates 2024-08-30 and 2025-01-14
- **Existing matter responsible attorney:** mixed across the five matters
- **Matched field on existing matter:** opposing-counsel
- **Matched normalized string:** `wallace pham`
- **Raw strings in source records:** `Wallace Pham` (prospect record, opposing counsel), `Wallace Pham, Esq.` (PI-2023-0101 opposing counsel), four further matters with the same normalized form
- **Prose summary:** Opposing counsel on the prospect's matter is `wallace pham`. The same opposing counsel appears on five existing matters (PI-2023-0101 closed, PI-2024-0207 closed, PI-2024-0411 open, PI-2025-0033 open, PI-2025-0299 open). The recurrence is informational. The skill does not infer a conflict from opposing-counsel adjacency alone.
- **Partner action recommendation:** PROCEED_WITH_NOTE

### Match 3 - entity-adjacency - POSITIONAL_NOTE

- **Matched on:** entity-adjacency
- **Classification:** POSITIONAL_NOTE
- **Existing matter id:** PI-2025-0188
- **Existing matter status:** open
- **Existing matter opened:** 2025-05-06
- **Existing matter closed:** not applicable
- **Existing matter responsible attorney:** Lucas
- **Matched field on existing matter:** treating-provider
- **Matched normalized string:** `valley orthopedic associates`
- **Raw strings in source records:** `Valley Orthopedic` (prospect record, treating provider), `Valley Orthopedic Associates, P.C.` (PI-2025-0188 treating provider on file)
- **Prose summary:** The prospect lists `valley orthopedic associates` as a treating provider. The same entity appears as a treating provider on matter PI-2025-0188. Treating-provider adjacency is informational for staffing and medical-records workflow.
- **Partner action recommendation:** PROCEED_WITH_NOTE

## Recommended next step

**Step:** PARTNER_REVIEW_HARD_CONFLICTS

**Why:** Match 1 names a current client of the firm as a co-defendant in the new matter. The partner reviews and decides whether the engagement proceeds, declines, or moves to waiver-analysis with counsel.

---

**Run completed:** 2026-05-19T10:31:51-07:00
**Model:** model-id-redacted
**Token usage:** 5,604 input / 1,840 output
**Notes for the partner:** Match 1 raw strings show two minor formatting variants of the same entity. Normalization collapsed them to one. The variants are included for the partner's verification.
```

## Format rules summary

1. **No prose outside the named sections.** The skill does not write paragraphs of analysis between sections. The report is scannable.
2. **Every section header appears even when its content is empty.** Empty summary table rows read `0` and `NONE` rather than being omitted.
3. **Match blocks repeat once per axis match.** A single Clio matter that triggers two axes generates two match blocks.
4. **No em dashes anywhere.** Use commas and periods. The hyphen character is fine in compound words and in ISO-8601 dates.
5. **All example content carries the synthetic-fixture watermark when it appears in this file.** Live conflict reports never contain that watermark.
6. **Backticks around normalized strings** so the partner can visually distinguish the normalized form from surrounding prose. Raw strings appear in parentheses without backticks.
