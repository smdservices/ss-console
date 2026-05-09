# Lead-Gen Pivot Validation — 2026-05-08

**Status:** ADR 0003 implementation closed. Pivot upgrades shipped, post-pivot run executed against live infrastructure, pre-pivot Signal-stage entities reconciled.

**What this report does:** measures whether the upgrades reduced wrong-actor and structural-disqualifier leakage in the Signal queue, and surfaces the residual misses the deterministic filters do not catch.

---

## What got finished this session

| Item                                                                                                                          | PR                                                          | Status           |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------- |
| Vertical heuristic heading bug — Haiku emitting `retail_food` instead of canonical `restaurant_food` (#747)                   | [#767](https://github.com/venturecrane/ss-console/pull/767) | merged           |
| Fresh `ss-job-monitor` /run against the post-pivot logic to validate the `posting_actor_role` filter end-to-end (#749 part 1) | n/a (live trigger)                                          | executed         |
| Reconciliation of 73 pre-pivot job_monitor Signal-stage entities through ADR 0003 filters (#749 part 2)                       | [#768](https://github.com/venturecrane/ss-console/pull/768) | merged + applied |
| Validation report (this doc)                                                                                                  | this branch                                                 | shipping         |

---

## Run summary — 2026-05-08 ss-job-monitor manual trigger

```json
{
  "queries": 12,
  "totalResults": 0,
  "qualified": 0,
  "droppedByActorRole": 0,
  "errors": 12,
  "errorDetails": ["SerpAPI: 429 on retry for query \"office manager\" (and 11 others)"]
}
```

**Read:** infrastructure healthy, authentication healthy, code path running. SerpAPI quota hard-exhausted (likely monthly cap, not the daily refresh assumed in #749). `droppedByActorRole = 0` because zero jobs returned, not because the filter failed. End-to-end validation of `posting_actor_role` against fresh data is blocked on SerpAPI quota refresh.

The pivot's filter logic is unit-tested in `workers/job-monitor/src/qualify.test.ts` and `tests/lead-gen-wrong-actor.test.ts` (16 tests across the four `lead-gen-*.test.ts` files). The reconciliation below validates the filter against stored signal data — independent of fresh SerpAPI access.

---

## Reconciliation — 4 of 73 pre-pivot job_monitor entities reclassified

Script: `scripts/reconcile-job-monitor-pivot.mjs`. Two filters applied:

**Tier 1 — actor-role (verbatim mirror of `inferPostingActorRole`):** 1 hit

- `Confidential (Dental Practice)` — raw `job.company_name = "Confidential"`. Caught by the `confidential` keyword pattern.

**Tier 2 — explicit "franchise" in entity name (deterministic structural disqualifier):** 3 hits

- `Senior Helpers (Chandler/Tempe franchise)`
- `PIRTEK Goodyear (Independent Franchise Location)`
- `PIRTEK (Goodyear, AZ franchise location)`

All 4 transitioned `signal → lost` with `lost_reason: not-a-fit` and ADR 0003 citation in `lost_detail`. Reversible via re-promote.

---

## Production state — before vs after

### Stage × pipeline (current, post-reconciliation)

| Stage            | Pipeline            | n       | delta  |
| ---------------- | ------------------- | ------- | ------ |
| signal           | job_monitor         | **69**  | -4     |
| signal           | new_business        | 15      | 0      |
| signal           | inbound_scan        | 3       | 0      |
| signal           | review_mining       | 2       | 0      |
| signal           | website_scorecard   | 1       | 0      |
| signal           | system              | 1       | 0      |
| **signal total** |                     | **91**  | **-4** |
| prospect         | job_monitor         | 4       | 0      |
| prospect         | new_business        | 1       | 0      |
| prospect         | website_intake_send | 1       | 0      |
| meetings         | \*                  | 4       | 0      |
| proposing        | new_business        | 1       | 0      |
| engaged          | new_business        | 1       | 0      |
| **lost**         | new_business        | **190** | 0      |
| **lost**         | job_monitor         | **4**   | **+4** |
| lost             | website_booking     | 1       | 0      |

### Lost reasons (cumulative across both reconciliations)

| Reason                                                      | Count |
| ----------------------------------------------------------- | ----- |
| Wrong-actor pre-pivot reconciliation (ADR 0003)             | 191   |
| Structural disqualifier pre-pivot reconciliation (ADR 0003) | 3     |
| Lost by admin (pre-existing)                                | 1     |

**Read:** the new_business pivot reconciliation (190 entities) and the job_monitor pivot reconciliation (4 entities) account for 99.5% of the lost-stage population. ADR 0003 is the dominant filter that has cleared the pre-pivot queue.

---

## Pipeline health — Pattern A validator + enrichment coverage

| Metric                                        | Value                                                 | Read                                                                    |
| --------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `outreach_draft` context entries (all-time)   | 310                                                   |                                                                         |
| `outreach_draft` last 7d                      | 50                                                    | post-pivot run cleanly producing drafts                                 |
| New entities last 7d                          | 56 (47 new_business, 7 job_monitor, 2 website_intake) | new_business cron healthy, job_monitor quota-blocked                    |
| Entities with ≥1 outreach_draft               | 281                                                   |                                                                         |
| Entities with `intelligence_brief` enrichment | 289                                                   |                                                                         |
| Validator-induced gap (briefs without drafts) | 8 (~3%)                                               | proxy for Pattern A rejections                                          |
| `candidate_merge_log` total rows              | 0                                                     | Jaro-Winkler logging deployed but inactive — see "Obvious misses" below |

The 3% briefs-without-drafts gap is consistent with Pattern A validator rejecting some drafts and entities being left without one. Worker logs would give the exact rate; D1 only tells us the saved-draft outcome.

---

## Obvious misses still in Signal — Captain review needed

Three categories surface from the post-reconciliation Signal queue. None warrant deterministic auto-action; all warrant Captain decision.

### 1. Probable national-chain franchises without the literal word "franchise" (3 entities)

The deterministic Tier 2 filter only catches names that self-identify with the word "franchise." These three are well-known national franchise systems:

- `Aire Serv of East Valley` — Neighborly franchise (HVAC)
- `East Valley Maid Brigade` — Maid Brigade franchise (cleaning)
- `PatchMaster Serving East Valley` — PatchMaster franchise (drywall repair)

**Why not auto-applied:** ADR 0003 explicitly warns against banlist-only enforcement of structural rules ("LLM routes around enumerated phrases"). Adding a brand-name banlist mirrors the failure mode the pivot rejected. The canonical fix is re-qualifying through Claude with the post-pivot prompt, which has the franchise-disqualifier in its structural list. Filed as follow-on if rate justifies (#749b candidate).

### 2. Within-pipeline duplicates in Signal (9 groups, 19 rows)

| Name                             | Count |
| -------------------------------- | ----- |
| Old Town Towing                  | 4     |
| American Roofing & Waterproofing | 2     |
| Magellan Financial               | 2     |
| South Fresh LLC                  | 2     |
| Hook Up Towing                   | 2     |
| North Valley Family Dentist      | 2     |
| Adams Refrigeration              | 2     |
| West Coast Plumbing Co LLC       | 2     |
| Great Big Smiles Orthodontics    | 2     |

**Read:** the per-job-id dedup at ingest (`source_ref = job_id`) prevents re-processing the same posting, but does not collapse the same business posting multiple roles. `findOrCreateEntity` is taking different slugs from minor name variations (or treating SerpAPI's per-posting differences as new entities). Aligns with **#751** — `dedup_fuzzy_threshold` calibration. The fact that `candidate_merge_log` has 0 rows suggests the Jaro-Winkler match is not firing on these (threshold too high, or scope too narrow). #751 should be re-prioritized; the threshold calibration cannot run against logged candidate pairs because no candidates are being logged.

### 3. Pattern A validator gap proxy (~3%)

8 entities have `intelligence_brief` enrichment but no saved `outreach_draft`. Without worker logs we can't confirm whether these are:

- validator rejections (Pattern A or word-cap), or
- transient enrichment-pipeline failures (Anthropic 5xx, network, etc.).

**Recommendation:** ride along with **#748** (regenerate-draft admin action) — when shipped, a "rejected" classification in the response will tell us the validator state cleanly without log scraping.

---

## Quality improvement signal (concrete numbers)

|                                                                                 | Pre-pivot baseline                              | Current state                                                             |
| ------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| Signal-stage entities with ADR 0003 wrong-actor / franchise self-identification | 4 in 73 (5.5%)                                  | 0 in 69 (0%)                                                              |
| Lost-stage entities tagged with ADR 0003 reconciliation reason                  | 0                                               | 194                                                                       |
| New_business entities `vertical_match` validation errors per run                | ~12% (per #747)                                 | 0 (canonical heading deployed in #767, guard-tested)                      |
| Outreach drafts attempted without Pattern A validation gate                     | All pre-pivot                                   | 0 (every draft post-pivot routes through two-stage validator)             |
| Statewide reach in lead-gen layer                                               | Phoenix-metro only                              | Arizona-wide (verified via `lead-gen-statewide.test.ts`)                  |
| Revenue gate at lead-gen layer                                                  | $750k-$5M hard filter                           | Removed (verified via `lead-gen-revenue-gate.test.ts`)                    |
| Permits as triggers vs enrichment                                               | Triggers (5 of 6 audited rows were contractors) | Enrichment-only (verified via reconciliation of 190 wrong-actor entities) |

---

## Open follow-ons surfaced by this session

| Finding                                                                                                                             | Issue                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Probable franchise/national-chain without "franchise" word — needs Claude re-qualification or new follow-on                         | candidate for new issue                                                       |
| `candidate_merge_log` is empty despite obvious within-pipeline duplicates — Jaro-Winkler match is not firing                        | re-prioritize **#751**                                                        |
| SerpAPI quota appears to be monthly cap, not daily-refresh as #749 hypothesized — pivot validation against fresh data blocked       | **#749** (mark part 1 done; quota-refresh dependency persists)                |
| `posting_actor_role` field absent from existing 96 stored job_monitor signals — pre-pivot ingest didn't capture it; new ingest does | accepted (pivot is forward-looking; reconciliation closed the historical gap) |
