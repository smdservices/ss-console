# Voice Rules - Conflict Report Voice

The conflict report is read by the partner deciding whether to engage a prospect. The audience is a senior attorney with limited time and a low tolerance for legal-adjacent prose that sounds like marketing. A failed voice match means the partner has to re-read the report to extract the facts, which means the skill saved no time.

The report's voice is direct, factual, and neutral. The skill observes what the Clio data shows. The partner reaches the conclusion.

## Hard rules (mechanical, enforceable)

1. **No em dashes anywhere.** Use sentences. Use commas. Use periods. Never the long dash character. The rule applies to every section, every table cell, every metadata line, every block of report prose.
2. **No legal conclusions.** The report describes matches. The report does not say "this conflict is waivable," "imputed disqualification applies under the rules," "the firm is conflicted out," "an ethical-screen would cure this." Those are partner judgments and they require citations the skill does not produce.
3. **No commitment language.** The report does not say "the firm will decline this matter," "we cannot proceed," "we should accept the engagement." Recommendations are recommendations. The partner decides.
4. **No tentative hedges that fake certainty.** "Likely waivable," "probably not a conflict," "appears to be" are forbidden when the underlying data is mechanical. Either the normalized names overlap or they do not. Either the prospect's party list contains an existing client or it does not. Mechanical facts get stated as facts.
5. **No corporate filler vocabulary:** circle back, touch base, reach out, leverage, level-set, deep dive, double-click, sync up, alignment as a verb, table this, ping me, action item, bandwidth.
6. **Active voice.** "Matter ABC-123 lists Acme Holdings as the opposing party" not "Acme Holdings is listed as the opposing party in matter ABC-123."
7. **Short sentences.** One observation per sentence. The partner is scanning, not reading.
8. **No emojis. No exclamation points.**
9. **No marketing register.** The report is not selling anything. The skill is not proud of catching a hit. The tone is professional observation, the same tone a paralegal would use on a memo to the partner.

## Soft rules (judgment, the skill must learn)

10. **Describe what the data shows, not what it implies.** "Matter ABC-123 names Bright Star Trucking as opposing party. The prospect's party list names Bright Star Trucking as a co-defendant." Not "the firm faces a positional conflict by virtue of representing parties on both sides of the same opposing entity."
11. **Cite the matched field, not the rule.** "Match on opposing-party field, matter ABC-123 (open)" not "match triggering the firm's adverse-to-client analysis under the applicable disciplinary rule."
12. **Be specific about matter status.** A match against an open matter is materially different from a match against a closed matter that has been dormant for years. The report says which.
13. **Quote normalized strings, not formatted display strings.** When the report shows the matched string, it shows the normalized form (`acme holdings incorporated`) followed by the raw forms in parentheses (`Acme Holdings Inc.`, `Acme Holdings, Incorporated`). This lets the partner verify the match without reading the rubric.
14. **Never preview the partner's decision.** The recommendation field carries the recommendation. The report prose does not editorialize on top of it.

## Examples, good and bad

All examples use fictional names and the watermark `[SYNTHETIC FIXTURE - NOT A REAL MATTER]`.

### Direct hit on an existing client

[SYNTHETIC FIXTURE - NOT A REAL MATTER]

**Bad** (concludes, advises, hedges):

> This is almost certainly a non-waivable conflict. The firm represented this prospect in matter ABC-123 and a fresh engagement would expose the partner to disqualification motions. Recommend declining.

**Good:**

> Prospect name normalizes to `dana ortega`. Matter ABC-123 lists `dana ortega` as the client of record. Matter status is closed, closed date is within the last 18 months. Classification is HARD_CONFLICT on the direct-hit axis. Recommendation is BLOCK pending partner review.

### Party overlap with an open matter

[SYNTHETIC FIXTURE - NOT A REAL MATTER]

**Bad** (legal conclusion):

> The firm is positionally adverse to itself. This is a textbook concurrent-representation problem under the rules of professional conduct and the firm should withdraw.

**Good:**

> Prospect's party list includes `bright star trucking limited liability company` as a named defendant. Matter ABC-456 (open, plaintiff side) names `bright star trucking limited liability company` as opposing party. The same entity appears on the same side in both matters, and a co-defendant of the new prospect's matter is also opposing in ABC-456. Classification is SOFT_CONFLICT on the party-overlap axis. Recommendation is NEEDS_WAIVER_ANALYSIS.

### Opposing-counsel adjacency

[SYNTHETIC FIXTURE - NOT A REAL MATTER]

**Bad** (overweights a positional note):

> The same opposing counsel appears on this prospect's matter as on five existing matters at the firm. This is a strategic risk and the partner should consider whether the firm wishes to continue facing this counsel.

**Good:**

> Opposing counsel on the prospect's matter is `wallace pham`. Across the firm's existing docket, `wallace pham` appears as opposing counsel on five matters (three open, two closed). Classification is POSITIONAL_NOTE on the opposing-counsel-adjacency axis. Recommendation is PROCEED_WITH_NOTE.

### Entity adjacency, low signal

[SYNTHETIC FIXTURE - NOT A REAL MATTER]

**Bad** (overstates significance):

> The prospect's treating provider also appears as a treating provider on two other firm matters. This adjacency may complicate medical-records subpoenas and the partner should evaluate.

**Good:**

> The prospect's treating provider is `valley orthopedic associates`. The same entity appears as a treating provider on two other matters (one open, one closed). Classification is POSITIONAL_NOTE on the entity-adjacency axis. Recommendation is PROCEED_WITH_NOTE.

### No conflicts found

[SYNTHETIC FIXTURE - NOT A REAL MATTER]

**Bad** (gushes, editorializes):

> Good news. The conflict check came back completely clean, with no overlaps of any kind. The firm appears free to engage this matter without complication.

**Good:**

> No normalized-name overlaps against the prospect name, party list, opposing counsel, or related entities across the firm's open or closed matters. Classification is NO_CONFLICT. Recommendation is PROCEED.

## When the skill cannot match the voice

If the skill cannot describe a match in voice that passes these rules, the skill includes the match in the report with the classification and recommendation populated and writes a placeholder prose line:

> Match identified on the party-overlap axis. See match block below for the matched-field detail. Prose summary deferred to partner review.

The partner prefers a sparse match record to a flowery one.
