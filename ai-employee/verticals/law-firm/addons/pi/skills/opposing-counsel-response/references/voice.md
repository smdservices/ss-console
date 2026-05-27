# Voice Rules: Supervising Partner Voice (Layer 2 Match)

The draft's factual sections (recitation lead-in, inbound-claim quote captions, prior-correspondence table headers, tone-classification label caption, lead-in sentences to each section) must read as if the supervising partner of the firm wrote them. The partner signs the response and the partner is the sender per ADR 0005; the agent persona is invisible to opposing counsel.

A failed voice match means the partner rewrites the prose, which means the agent saved no time on the part of the work where time-saving was the point. If quoting the inbound and assembling the prior-correspondence table took twenty minutes, and rewriting the prose takes another thirty, the agent is net-negative.

Voice samples (Layer 2 anchor corpus) live in `customer.yaml` and must total at least thirty samples distributed across recipient cohorts before the skill is allowed to ship an external draft (PRD §9.6 Gate 1). The partner's prior opposing-counsel correspondence, prior settlement-counter responses, prior motion-related correspondence, and prior scheduling letters are the primary samples for this skill.

## Hard rules (mechanical, enforceable)

1. **No em dashes anywhere.** Use sentences. Use commas. Use periods. Never the long dash character (em dash, en dash). The rule applies to section headers, table delimiters, captions, and prose alike. Markdown tables that need a separator row use the standard pipe-and-hyphen syntax; the hyphens are ASCII hyphens, not em dashes or en dashes.
2. **No "I hope this email finds you well." No "Just wanted to touch base." No "Reach out."** These are AI-tells and opposing counsel reads them as agent-drafted.
3. **No corporate filler vocabulary:** circle back, touch base, reach out, leverage, level-set, deep dive, double-click, sync up, alignment as a verb, table this, ping me, action item, bandwidth, per our records, at this time, please find attached.
4. **No legal conclusions in any section the skill authors.** Never "your offer is plainly inadequate," "the motion clearly lacks merit," "the proposed schedule is unreasonable," "the negotiation posture is unrealistic," "we are within our rights." Tone-classification labels (routine, contested, hostile) are pointers to the firm's memory-rule vocabulary, not legal conclusions; they appear as a single header label, not as prose assertions. The full response framing is partner-authored TBD sections.
5. **No commitment language in any section the skill authors.** Never "we counter," "we accept," "we reject," "we agree," "we oppose," "we will not extend," "our client demands," "our position is." All such language belongs in the partner-authored sections.
6. **No tentative hedges that fake certainty:** "I believe," "it appears," "in our view," "as best we can tell," "presumably." If the prior-correspondence row is sourced from EmailThread, the row is stated. If it is not, the row is TBD.
7. **Active voice.** "Opposing counsel proposed a settlement of [verbatim quote] on May 12, 2026" not "a settlement was proposed by opposing counsel on May 12, 2026." "The prior counter offer of [verbatim quote] was sent on April 18, 2026" is acceptable when "was sent" is the only natural phrasing for a passive-tense email-history event.
8. **Short sentences.** One idea per sentence usually. Long sentences are reserved for nuanced section captioning where breaking would obscure the connection, not for sounding lawyerly. Target sentence length: twelve to twenty words. Max sentence length: thirty-five words.
9. **Sign-off uses the supervising partner's name and full signature block from `customer.yaml`.** Never "Best regards," "Warm regards," "Sincerely yours," "Cheers," "Respectfully submitted." The partner's actual close is what the customer's voice samples capture.
10. **No emojis. No exclamation points anywhere.**
11. **Dates render as `Month D, YYYY` in prose (e.g., "May 8, 2026") and as `YYYY-MM-DD` in tables.** No "5/8/26", no "8 May 26."
12. **Inbound message claims are quoted verbatim.** When the skill recites a factual claim from the inbound message, the text is the inbound text without reformatting, rewording, or paraphrase. The recital is a quote, not a summary. The quote is wrapped in quotation marks and attributed to the inbound message with a sentence-level pointer (e.g., "Inbound, paragraph 3, sentence 2").
13. **No dollar amounts in skill-authored prose.** Dollar amounts appear only inside the verbatim-quoted inbound message recital and inside verbatim-quoted prior-correspondence message bodies. The skill does NOT author a dollar amount in any caption, header, or framing sentence. Settlement-counter substantive response renders as a TBD marker, full stop.

## Soft rules (judgment, the agent must learn)

14. **Professional and direct, not friendly and not adversarial.** Opposing-counsel correspondence is an adversarial relationship in form but a procedural artifact in function. Tone matches the partner's prior correspondence. The partner is firm and unornamented; the draft is firm and unornamented.
15. **State facts about the matter, do not argue them.** "Opposing counsel proposed a settlement of [verbatim quote] on May 12, 2026" is a fact. "Opposing counsel's offer reflects a clear undervaluation of the matter" is an argument. The skill writes facts; the partner writes arguments.
16. **Name the source of every figure or document inline where the partner's prior responses do so.** If the partner's Layer 2 samples cite "Inbound at p. 2" or "Prior counter dated April 18, 2026" inside the response prose, the draft mirrors that pattern. If the partner's prior responses keep citations to the prior-correspondence table at the back and prose clean, the draft does the same. The Layer 2 corpus decides.
17. **Acknowledge what is unknown without making the chronology feel thin.** "The matter file contains no prior settlement correspondence as of June 10, 2026" is fine when no prior thread is recorded and the cutoff date is sourced. "We have no prior settlement correspondence" without a date is not, because the lack of a date implies a present-tense assertion the skill cannot make.
18. **Tone-classification labels match the memory-rule vocabulary exactly.** If the firm's memory rule labels the category `routine`, the header reads `routine`. The skill does not rewrite the label to `Routine` or `routine-tone` or `standard` to fit a stylistic preference. The Layer 2 corpus is the partner's voice; the memory rule is the firm's vocabulary; both are sources of truth.

## Examples, good and bad

The examples below use fictional names and the `.invalid` TLD. All sample content is marked `[SYNTHETIC FIXTURE - NOT A REAL MATTER]`.

### Recitation lead-in

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad** (argumentative, characterizes opposing counsel's position):

> We are in receipt of your wholly inadequate settlement counter-offer of May 12, 2026, and we are compelled to respond. Your offer fails to account for the severity of our client's injuries and reflects a misunderstanding of the case's value.

**Good** (factual, partner voice):

> Plaintiff Janet Holloway, by and through undersigned counsel, responds to opposing counsel's letter of May 12, 2026 regarding settlement. The factual claims in the inbound message are quoted in the section below; the response posture is set out under separate cover.

### Inbound-claim quote caption

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad** (skill paraphrased the inbound):

> Opposing counsel offered a low settlement and proposed standard release terms with a 30-day payment timeline.

**Good** (verbatim quote):

> Inbound, paragraph 2: "Defendant offers the sum of [verbatim quote of dollar amount as written in the inbound message] in full and final settlement of all claims arising from the subject incident, payable within thirty days of execution of a standard mutual release."

### Prior-correspondence table caption

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad** (skill characterized the prior thread):

> The settlement negotiations to date have been marked by significant gaps between the parties' positions.

**Good** (factual, sourced):

> Prior settlement correspondence on this matter, sourced from EmailThread message IDs in the matter's settlement thread.

### Tone-classification label

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad** (skill characterized in prose):

> The tone of the inbound letter is plainly hostile and reflects an entrenched negotiation posture.

**Good** (label only):

> Inbound tone classification (memory-rule sourced): `contested`

### TBD section, do not author

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad** (skill authored a settlement number):

> Opposing counsel's offer is rejected. We counter at $185,000 inclusive of all liens.

**Good** (skill renders the TBD marker, partner fills in):

> `[TBD: substantive settlement-counter response - partner authors. The skill emits no number, no acceptance, no rejection, no counter-counter, and no negotiation framing. Settlement authority is partner work per the firm's authority matrix.]`

### Motion response, do not author

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad** (skill authored a legal-argument framing):

> Defendant's motion for summary judgment is without merit and will be opposed in full. The factual record plainly supports denial.

**Good** (skill renders the TBD marker):

> `[TBD: substantive motion response - partner authors. The skill emits no concession, no opposition framing, no procedural posture, and no characterization of the motion's merits. Legal-argument authoring is partner work.]`

### Scheduling response, do not author

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad** (skill authored an alternative-date proposal):

> The proposed deposition date of June 15, 2026 does not work for our schedule. We counter-propose June 22, 2026 at 10:00 AM at our offices.

**Good** (skill renders the TBD marker):

> `[TBD: substantive scheduling response - partner authors. The skill emits no agreement, no refusal, no alternative date, and no conditional acceptance. Scheduling commitments are partner work.]`

## How the voice gate scores this draft

`ai-employee/voice-gate/` (gated through #855) scores each draft on:

- **Banned-pattern hits** em dashes, AI-tell phrases, corporate filler, hedges, characterization verbs (plainly, clearly, obviously, plainly improper). Each hit subtracts from the score.
- **Sentence-length distribution** target twelve to twenty words, max thirty-five. Outliers subtract.
- **Layer 2 anchor similarity** embedding similarity against the partner's prior opposing-counsel correspondence. Below the configured threshold, the skill emits a structured-tables-only variant with no prose lead-ins.
- **Citation-shape detection** any citation-shaped string in skill-authored prose is a substrate-level block, not a voice-gate score reduction. The voice gate flags but does not decide. Citation strings inside the verbatim-quoted inbound message and inside partner-authored TBD sections are exempt.
- **Dollar-amount detection** any dollar-amount string in skill-authored prose outside the verbatim-quoted inbound recital or verbatim-quoted prior-correspondence table is a substrate-level block. The skill's structural commitment is no dollar amounts outside the quote envelope.

The voice gate's pass/fail threshold per skill lives in `customer.yaml`. For this skill the default threshold is conservative; better to omit the prose lead-ins and ship a structured-only draft than to ship lead-ins the partner has to rewrite.
