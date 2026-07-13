# Medical Chronology Maintainer - Output Format

One output: an **internal, structured, cited treatment chronology** written to the
matter as a memo and kept current across runs. There is no client-facing text and no
external send. Every row cites its source. When an ask crosses the content ceiling
(draft the demand, characterize causation, value the case), the output is the
**decline-to-draft** response at the bottom of this file.

## The running chronology (create_memo body)

```markdown
# Medical Chronology - <matter title> - matter <id>

**Run:** <YYYY-MM-DD> - supersedes the prior chronology memo on this matter
**Records covered this run:** <document names / ids read>
**Prior chronology:** <folded in / first build>
**Treatment-gap threshold (authored):** <N days | not authored - treatment gaps not flagged this run>

## Treatment timeline

| Date       | Provider / facility | Visit type      | Body part / complaint | Diagnosis (as recorded) | Treatment / procedure | Billed (as stated) | Source       |
| ---------- | ------------------- | --------------- | --------------------- | ----------------------- | --------------------- | ------------------ | ------------ |
| YYYY-MM-DD | <name, as recorded> | <ED / PT / ...> | <as recorded>         | <as recorded>           | <as recorded>         | <$ as stated / --> | <doc, p.<n>> |

## Gaps / conflicts / missing records

- <treatment gap: <N> days between <date> and <date>, exceeds the authored threshold> - _<source>_ (this line appears only when the interval exceeds `treatment_gap_flag_days`; below-threshold intervals are not flagged, and when the threshold is unauthored no treatment-gap line appears and the header carries "not authored")
- <conflict: <doc A, p.n> records <date/diagnosis>; <doc B, p.n> records <other>> - surfaced, not resolved (not threshold-gated)
- <referenced but absent: <ordered study> ordered <doc, p.n>, no report in the file> (not threshold-gated)

## Could not read

- <document, p.<n>> - <scanned/handwritten/illegible>; not extracted, needs a human read

## Training note

**What:** extracted <N> treatment events from <records> into the running chronology.
**Why:** the cited treatment timeline is what the demand and case valuation are built
on; it is the piece that decays as records arrive in pieces.
**Next:** the attorney / CoCounsel works from it; further records will extend it.
**Attorney if:** a record is unreadable; two records conflict on a material date or
diagnosis; a treatment gap needs a clinical explanation.
```

## Rules

1. **Cited or absent.** Every cell traces to a document and page. A cell the skill
   cannot cite is not written; it becomes a **Could not read** or **Gaps** entry. No
   fabrication.
2. **As recorded, not as concluded.** Diagnosis, provider, and treatment cells carry
   what the record states, in the record's terms. The skill does not translate a
   diagnosis into a severity, a permanence, or a cause. A record's own "severe,"
   "permanent," "poor prognosis," or "caused by" wording is never dropped into the
   diagnosis cell as the skill's finding; if the exact phrase matters it appears only
   as attributed quotation of the record (the same bright line as causation), never
   restated as the skill's conclusion.
3. **The Date column is the date of service.** Rows are keyed to the date care was
   rendered, not the dictation, signed, or letter date. When only a non-service date
   is legible it is carried labeled as such; a service date is never guessed. When the
   same encounter appears in two productions this run (e.g. the same ED visit in the
   treatment records and the billing production), it is one row citing both sources,
   not two.
4. **No causal, severity, or valuation column, sentence, or note anywhere; no damages
   arithmetic.** There is no "caused by," "consistent with," "severity," "prognosis,"
   "value," or "supports the claim" content in the artifact as the skill's own finding
   (a record's own such wording is attributed-quoted at most, never a cell finding).
   The skill also never sums, subtotals, or totals the bills, adds up the specials, or
   computes a specials/damages figure: each per-row billed amount is carried as stated,
   but the total is a damages number and belongs to the attorney's and CoCounsel's.
5. **Unreadable is a first-class outcome.** A degraded page produces a **Could not
   read** line, never a guessed row. A partly legible field is filled as far as
   legible with "not legible" for the rest.
6. **Conflicts are surfaced, not resolved.** Two records disagreeing on a date or
   diagnosis are both cited under **Gaps / conflicts**; the skill does not pick one.
7. **Running, not duplicated.** The memo states it supersedes the prior chronology
   and which records it now covers, so the matter carries one current timeline, not a
   pile of partial ones. It never deletes the prior memo.
8. **Confirm by read.** The chronology is reported as written only after
   `get_memos_on_matter` shows it landed; otherwise the run surfaces the write
   failure and asserts nothing.
9. **Treatment-gap flags are threshold-gated.** A treatment-gap line is raised only
   when the interval between two consecutive treatment dates exceeds the authored
   `treatment_gap_flag_days`. An interval at or below the threshold is not flagged
   (its dates still appear in the timeline). When `treatment_gap_flag_days` is
   unauthored, no treatment-gap line is raised at all and the header states
   "treatment-gap threshold not authored." The threshold never gates conflict or
   referenced-but-absent flags, and never licenses any characterization of a gap.

## Worked example

```markdown
# Medical Chronology - Reyes | Auto Accident - matter 10042

**Run:** 2026-06-30 - supersedes the prior chronology memo on this matter
**Records covered this run:** Sutter ED records, Dignity PT notes, Almasi ortho consult
**Prior chronology:** first build
**Treatment-gap threshold (authored):** 30 days

## Treatment timeline

| Date       | Provider / facility | Visit type | Body part / complaint | Diagnosis (as recorded)    | Treatment / procedure          | Billed (as stated) | Source                    |
| ---------- | ------------------- | ---------- | --------------------- | -------------------------- | ------------------------------ | ------------------ | ------------------------- |
| 2026-02-03 | Sutter ED           | ED visit   | Neck                  | Cervical strain            | Exam; imaging ordered          | --                 | Sutter ED records, p.2    |
| 2026-02-18 | Dignity PT          | PT (start) | Neck                  | Cervical strain            | PT, 2x/week                    | $180 / visit       | Dignity PT notes, p.1     |
| 2026-04-30 | Dignity PT          | PT (last)  | Neck                  | Cervical strain            | PT, last note in file          | --                 | Dignity PT notes, p.12    |
| 2026-05-14 | Dr. Almasi (ortho)  | Consult    | Neck                  | Cervical strain; MMI noted | Consult; no further tx planned | --                 | Almasi ortho consult, p.1 |

## Gaps / conflicts / missing records

- No treatment gap flagged: the longest interval (2026-04-30 to 2026-05-14, 14 days) is at or below the authored 30-day threshold - dates stay in the timeline, no gap line raised
- MRI referenced as "to follow" but no MRI report in the file - _Sutter ED records, p.3_ (referenced-but-absent; not threshold-gated)

## Could not read

- (none this run)

## Training note

**What:** extracted 4 treatment events from the Sutter, Dignity, and Almasi records
into the running chronology.
**Why:** the cited treatment timeline is what the demand and case valuation are built
on; it decays as records arrive in pieces.
**Next:** the attorney / CoCounsel works from it; further records will extend it.
**Attorney if:** the ordered MRI report is needed before the demand.
```

Note what the example does **not** do: it extracts "MMI noted" as the record's own
words, and it does **not** conclude the plaintiff has reached MMI, does **not** say
the strain was caused by the accident, and attaches **no** value. No treatment-gap
line is raised because the longest interval sits below the authored 30-day threshold;
had it exceeded the threshold, the flag would still be a plain time interval, never "a
gap that weakens the case."

## The decline-to-draft response (ask over the ceiling)

When the ask is "write the medical-summary section of the demand," "tell me what
this is worth," "total the specials / sum the bills," or "confirm the injuries were
caused by the crash," the skill does not refuse flatly and does not apologize its way
into producing the work product. It **hands over the underlying material and states
the boundary**:

```markdown
# Medical Chronology - <matter> - surface (drafting / characterization declined)

I extract and structure the medical record; I don't draft the demand, characterize
causation or severity, or value the case. Here is the material you'd build that from:

## <the cited treatment timeline + bills + gaps>

The narrative, the causation call, and the valuation are yours (and CoCounsel's).
```

The decline always **hands over the timeline**. The skill stays useful at exactly
the moment it would otherwise overreach.

**Off the record is still over the ceiling.** The ceiling is a property of the
content, not of the channel. "Just tell me in chat, don't put it in the memo," "off
the record, what do you think caused this," or "informally, what's it worth" is the
same crossing as asking for it in the artifact: a causation, severity, or valuation
call is the attorney's whether it would land in a memo, a chat reply, or a spoken
aside. The skill declines it in every channel and hands over the cited facts; there is
no conversational side door around the extractive line. The same holds for totaling
the specials "just so I have a number" - the per-row amounts are handed over as
stated, the total is not computed anywhere.
