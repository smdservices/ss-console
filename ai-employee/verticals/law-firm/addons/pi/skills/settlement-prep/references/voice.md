# Voice Rules - Partner Internal-Memo Voice (Layer 2 Match)

The memo's factual sections (matter-facts summary, chronology lead-in, damages-table captions, strengths and weaknesses list lead-ins, comparable-verdict table caption, prior-pattern table captions) must read as if the supervising partner wrote them to themselves. The memo is internal and the recipient is the partner; the audience is one person who wrote half the corpus that sourced the memo.

The internal-memo voice envelope differs from the external-correspondence envelope used by `demand-letter-draft` and `discovery-response`. Internal memos are dense, plain, partner-to-self prose. They strip ceremony. They name people by last name on first reference and first name thereafter when the partner's prior memos do so. They omit polite framing. They are written to be scanned in fifteen minutes, not read in twenty-five.

Voice samples (Layer 2 anchor corpus) live in `customer.yaml` and must total at least thirty samples for the customer overall. For this skill specifically, at least five samples should be tagged `internal_prep_memo` or `case_strategy_memo` to anchor the internal-memo register; if fewer than five are tagged, the skill emits a "voice envelope thin" warning in the sourcing note but proceeds, because the internal-memo audience (the partner themselves) is lower-risk than an external recipient.

## Hard rules (mechanical, enforceable)

1. **No em dashes anywhere.** Use sentences. Use commas. Use periods. Never the long dash character (em dash, en dash). The rule applies to section headers, table delimiters, captions, and prose alike. Markdown tables that need a separator row use the standard pipe-and-hyphen syntax; the hyphens are ASCII hyphens, not em dashes or en dashes.
2. **No "I hope this email finds you well." No "Just wanted to touch base." No "Reach out."** These are AI-tells. Internal memos do not contain greetings, sign-offs, or audience-management language; they open with the matter and close with the partner's own action items.
3. **No corporate filler vocabulary:** circle back, touch base, reach out, leverage, level-set, deep dive, double-click, sync up, alignment as a verb, table this, ping me, action item, bandwidth, per our records, at this time, please find attached.
4. **No legal conclusions in any section the skill authors.** Never "the comparative-negligence defense is plainly meritless," "policy limits are obviously inadequate," "causation is settled," "the carrier will absolutely fold at mediation." The fact lists are facts; the characterization is the partner-authored TBD section.
5. **No commitment language in any section the skill authors.** Never "we will open at," "we will not accept below," "our floor is," "the partner will recommend." All such language belongs in the partner-authored bracket-recommendation and posture sections.
6. **No tentative hedges that fake certainty:** "I believe," "it appears," "in our view," "as best we can tell," "presumably." If the chronology event is sourced, the event is stated. If it is not, the event is TBD.
7. **Active voice.** "Dr. Chen documented the disc herniation on the May 12 MRI" not "the disc herniation was documented by Dr. Chen on the May 12 MRI." "The police report names Kerr as the at-fault operator" not "Kerr is named as the at-fault operator in the police report."
8. **Short sentences.** One idea per sentence usually. Long sentences are reserved for nuanced chronology where breaking would obscure the connection, not for sounding lawyerly. Target sentence length: ten to eighteen words. Max sentence length: thirty words. Internal memos run shorter than external correspondence.
9. **No emojis. No exclamation points anywhere.**
10. **Dates render as `Month D, YYYY` in prose (e.g., "May 8, 2026") and as `YYYY-MM-DD` in tables.** No "5/8/26", no "8 May 26."
11. **Dollar figures appear only in the damages tabulation (sourced from billing statements and lost-wages documents) and in the comparable-verdict table (verbatim from memory-rule rows).** They never appear in skill-authored prose. The bracket-recommendation section is TBD and contains no figure; the skill does not generate a placeholder figure.
12. **People are named per the partner's prior-memo convention.** If the partner's Layer 2 internal-memo samples introduce people by last name on first reference and use first name thereafter, the memo does the same. If samples use full name on first reference, the memo does that. The Layer 2 corpus decides.
13. **No verdicts are surfaced that are not verbatim rows from the firm's memory-rule corpus.** The skill does not reword, summarize, or extrapolate from memory-rule rows. A row that surfaces, surfaces verbatim. A row that does not match the matter's profile does not surface.

## Soft rules (judgment)

14. **Dense and plain, not friendly and not adversarial.** A prep memo is a scanning document. The partner is reading it while pacing, while drinking coffee, while waiting for the conference room to open. Tone matches the partner's prior internal memos. The partner writes for themselves; the memo reads as the partner wrote it.
15. **State facts, do not argue them.** "Three months of physical therapy at Valley PT documented in Exhibit C" is a fact. "The treatment history shows commitment to recovery" is an argument. The skill writes facts; the partner writes arguments.
16. **Name the source of every figure inline.** "Medical specials total $24,500 across five providers, sourced from the billing exhibits at the back of the memo" is sourced. "Medical specials total approximately $24,500" is not.
17. **Acknowledge what is unknown without making the chronology feel thin.** "The matter file contains no employer's lost-wages verification as of the conference date" is fine when the absence is sourced (the chronology shows the partner has not yet requested the verification). "We have no employer verification" without a chronology anchor is not.
18. **Comparable-verdict rows surface verbatim with the partner's authored citation; the skill does not validate the citation, does not augment it, does not add a parallel cite.** The partner authored the corpus; the partner is responsible for the citation's accuracy.

## Examples, good and bad

The examples below use fictional names and the `.invalid` TLD. All sample content is marked `[SYNTHETIC FIXTURE - NOT A REAL MATTER]`.

### Matter-facts summary

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad** (greeting, ceremony, soft-spoken framing):

> I hope this finds you well. I wanted to put together a quick summary of the Holloway matter ahead of Friday's settlement conference. As you know, Janet Holloway was involved in an unfortunate incident on April 28, 2026 at the intersection of Camelback Road and 24th Street.

**Good** (dense, partner-to-self, scannable):

> Holloway v. Kerr. Auto-accident matter, opened May 1, 2026. Client: Janet Holloway, operator of stopped 2021 Camry struck from behind at Camelback and 24th. Opposing party: David Kerr. Opposing counsel: Theodora Whitfield, Whitfield Reardon, PLLC. Carrier: Statewide Mutual. Settlement conference scheduled June 24, 2026 at Maricopa County Superior Court.

### Chronology lead-in

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad** (narrative voice, embellishment):

> The chronology of treatment paints a picture of a client who took her recovery seriously from the very first hours after the collision. Janet was rushed to Mercy General within an hour of impact, where the ED team immediately recognized the severity of her injuries.

**Good** (factual list, scannable):

> Chronology of treatment and matter milestones, every event sourced to a document at the back of the memo or to a matter custom_field.

### Strengths fact-list entry

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad** (legal characterization, advocacy):

> The May 12 MRI showing disc herniation is a powerful piece of evidence that confirms the seriousness of Janet's injuries and supports a strong causation argument.

**Good** (sourced fact, no characterization):

> May 12, 2026 MRI at Phoenix Imaging documents L4-L5 disc herniation. Source: doc_02 (Phoenix Imaging MRI report, dated 2026-05-12).

### Weaknesses fact-list entry

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad** (legal-exposure characterization):

> The five-day gap between the incident and the first medical contact is a weakness that opposing counsel will undoubtedly exploit to argue that the injury is not as serious as claimed.

**Good** (sourced fact, no characterization):

> Five-day gap between incident date (April 28, 2026) and first medical contact (May 3, 2026 at Mercy General). Source: matter custom_field date_of_incident and doc_01 (Mercy General ED record, dated 2026-05-03). The skill emits no characterization of how this gap reads to opposing counsel; the partner authors the legal-argument framing in the TBD weaknesses-prose section.

### Comparable-verdict table caption

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad** (interpretive framing):

> Comparable verdicts in similar disc-herniation matters in Maricopa County suggest the appropriate settlement range is between X and Y.

**Good** (mechanical reference to memory-rule corpus):

> Comparable verdicts surfaced from the firm's memory-rule corpus that match the matter profile (auto-accident, disc herniation, Maricopa County, clear liability). Rows are verbatim from the corpus the partner authored. The skill produces no derived range; the partner authors the bracket recommendation in the TBD section below.

### Closing

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad** (skill authoring strategy):

> Recommendation: open at $185,000. Walk-away point: $95,000. The carrier's prior pattern of mid-conference settlement suggests this matter resolves in the first session.

**Good** (TBD marker):

> `[TBD: closing recommendation - partner authors. The skill emits no language about negotiation posture, settlement authority, walk-away triggers, or any forward-looking case-strategy framing.]`

## Voice gate scoring

The voice gate harness (`ai-employee/voice-gate/`, issue #855) scores the assembled prose along four axes:

1. **Tone register match.** Internal-memo register is plainer and denser than external-correspondence register. Sentence length distribution, formality markers, and ceremony language are scored against the Layer 2 internal-memo samples specifically.
2. **Sentence length envelope.** Target ten to eighteen words per sentence; max thirty. Outliers count against the score.
3. **Banned pattern hits.** Em dashes, corporate filler vocabulary, hedge phrases, legal-conclusion adverbs. Any hit drops the score; the substrate-level filter also blocks.
4. **Layer 2 anchor similarity.** Cosine-similarity against the internal-memo and case-strategy-memo samples in the Layer 2 corpus.

A failing score causes the skill to emit a structured-table-only variant (matter-facts as a one-line table, chronology as a structured list, no narrative lead-ins). The partner authors the lead-ins. The fallback path is documented in `ai-employee/voice-gate/voice-gate-fallback.md`.
