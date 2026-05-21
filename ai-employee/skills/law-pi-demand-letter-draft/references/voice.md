# Voice Rules — Supervising Partner Voice (Layer 2 Match)

The draft's factual sections (case-history paragraph, exhibit captions, chronology lead-in, billing-tabulation prose) must read as if the supervising partner of the firm wrote them. The partner signs the letter and the partner is the sender per ADR 0005; the agent persona is invisible to the opposing carrier.

A failed voice match means the partner rewrites the prose, which means the agent saved no time on the part of the work where time-saving was the point (chronology and tabulation assembly took fifteen minutes; if rewriting the prose takes another twenty, the agent is net-negative).

Voice samples (Layer 2 anchor corpus) live in `customer.yaml` and must total at least thirty samples distributed across recipient cohorts before the skill is allowed to ship an external draft (PRD §9.6 Gate 1). The partner's prior demand letters, prior settlement-position correspondence, and prior opposing-counsel correspondence are the primary samples for this skill.

## Hard rules (mechanical, enforceable)

1. **No em dashes anywhere.** Use sentences. Use commas. Use periods. Never the long dash character (em dash, en dash). The rule applies to section headers, table delimiters, captions, and prose alike. Markdown tables that need a separator row use the standard pipe-and-hyphen syntax; the hyphens are ASCII hyphens, not em dashes or en dashes.
2. **No "I hope this email finds you well." No "Just wanted to touch base." No "Reach out."** These are AI-tells and opposing carriers read them as agent-drafted.
3. **No corporate filler vocabulary:** circle back, touch base, reach out, leverage, level-set, deep dive, double-click, sync up, alignment as a verb, table this, ping me, action item, bandwidth, per our records, at this time, please find attached.
4. **No legal conclusions in any section the skill authors.** Never "your insured was negligent," "liability is clear," "damages are obvious," "the law is on our side." Liability and damages characterization is the partner-authored TBD section.
5. **No commitment language in any section the skill authors.** Never "we will file suit," "we will accept anything less than," "our client demands," "we are prepared to," "we expect." All such language belongs in the partner-authored sections.
6. **No tentative hedges that fake certainty:** "I believe," "it appears," "in our view," "as best we can tell," "presumably." If the chronology row is sourced, the row is stated. If it is not, the row is TBD.
7. **Active voice.** "Dr. Chen examined the client on May 8" not "the client was examined on May 8." "Mercy General billed $14,200 for the four-day inpatient stay" not "the four-day inpatient stay was billed at $14,200."
8. **Short sentences.** One idea per sentence usually. Long sentences are reserved for nuanced chronology where breaking would obscure the sequence, not for sounding lawyerly. Target sentence length: twelve to twenty words. Max sentence length: thirty-five words.
9. **Sign-off uses the supervising partner's name and full signature block from `customer.yaml`.** Never "Best regards," "Warm regards," "Sincerely yours," "Cheers," "Respectfully submitted." The partner's actual close is what the customer's voice samples capture.
10. **No emojis. No exclamation points anywhere.**
11. **Numbers above ten are figures, not words.** "Twelve providers" if the firm's samples consistently spell out small numbers, otherwise "12 providers." The Layer 2 corpus governs the choice; the skill does not invent a house style.
12. **Currency renders as `$NN,NNN.NN` with thousands separators and explicit cents.** No "$14k", no "$14K", no "fourteen thousand dollars." Totals above $1,000 always show the cents.
13. **Dates render as `Month D, YYYY` in prose (e.g., "May 8, 2026") and as `YYYY-MM-DD` in tables.** No "5/8/26", no "8 May 26."

## Soft rules (judgment, the agent must learn)

14. **Professional and direct, not friendly and not adversarial.** The demand letter is the opening move of a negotiation that may settle or may not. Tone matches the partner's prior demands. The partner is firm and unornamented; the draft is firm and unornamented.
15. **State facts, do not argue them.** "Dr. Chen documented an L4-L5 disc herniation on the May 12 MRI report" is a fact. "The May 12 MRI confirms a serious spinal injury" is an argument. The skill writes facts; the partner writes arguments.
16. **Name the source of every figure inline where the partner's prior letters do so.** If the partner's Layer 2 samples cite "Exhibit B (Mercy General billing)" inside the prose, the draft mirrors that pattern. If the partner's prior letters keep exhibits at the back and prose clean, the draft does the same. The Layer 2 corpus decides.
17. **Acknowledge what is unknown without making the chronology feel thin.** "Treatment continued through May 2026" is fine when the most recent record is dated April 30. "Treatment continued through the present" is not, because "the present" is not sourced.
18. **Never describe the client's pain or impairment beyond what the medical record states.** "The client reported a pain level of seven out of ten on the May 15 follow-up note" is sourced. "The client has suffered debilitating chronic pain" is characterization and belongs in the partner-authored TBD section.

## Examples, good and bad

The examples below use fictional names and the `.invalid` TLD. All sample content is marked `[SYNTHETIC FIXTURE — NOT A REAL MATTER]`.

### Case-history paragraph, full information sourced

`[SYNTHETIC FIXTURE — NOT A REAL MATTER]`

**Bad** (legal-marketing-toned, characterization-heavy):

> On the fateful afternoon of April 28, 2026, our client, an upstanding member of the Phoenix community, was tragically struck from behind by your insured's vehicle while peacefully waiting at a red light. The collision, which was entirely the fault of your reckless driver, caused severe and life-altering injuries that have devastated our client's livelihood and quality of life. We trust that you will recognize the gravity of this matter and respond appropriately.

**Good** (factual, partner voice):

> On April 28, 2026, our client was the operator of a 2021 Toyota Camry stopped at the intersection of Camelback Road and 24th Street in Phoenix, Arizona. Your insured's vehicle struck the rear of our client's Camry. Our client was transported by ambulance to Mercy General Hospital, where the emergency-department record (Exhibit A) documents a complaint of cervical and lumbar pain. Imaging on May 12, 2026 documented an L4-L5 disc herniation (Exhibit C). Treatment with Dr. Chen of Phoenix Orthopedics continued through April 30, 2026 (Exhibits D through G).

### Billing-tabulation lead-in

`[SYNTHETIC FIXTURE — NOT A REAL MATTER]`

**Bad** (AI-tells):

> Please find below a comprehensive summary of our client's significant medical expenses incurred as a result of the unfortunate incident, which we trust speaks for itself.

**Good**:

> Our client's medical specials to date total $24,837.42. The per-provider breakdown follows.

### Exhibit caption

`[SYNTHETIC FIXTURE — NOT A REAL MATTER]`

**Bad**:

> Exhibit A: Comprehensive medical records from Mercy General Hospital documenting the serious injuries our client sustained.

**Good**:

> Exhibit A: Mercy General Hospital, emergency-department record, April 28, 2026.

### TBD section, do not author

`[SYNTHETIC FIXTURE — NOT A REAL MATTER]`

**Bad** (skill authored what the partner should author):

> Based on the foregoing, we demand $185,000 to fully and finally settle this matter. This figure reflects the seriousness of our client's injuries and is well within the policy limits.

**Good** (skill renders the TBD marker, partner fills in):

> `[TBD: demand amount — partner authors]`
>
> `[TBD: settlement bracket and supporting framing — partner authors]`

## How the voice gate scores this draft

`ai-employee/voice-gate/` (gated through #855) scores each draft on:

- **Banned-pattern hits** — em dashes, AI-tell phrases, corporate filler, hedges. Each hit subtracts from the score.
- **Sentence-length distribution** — target twelve to twenty words, max thirty-five. Outliers subtract.
- **Layer 2 anchor similarity** — embedding similarity against the partner's voice samples. Below the configured threshold, the skill emits a conservative variant or omits the case-history paragraph entirely.
- **Citation-shape detection** — any citation-shaped string is a substrate-level block, not a voice-gate score reduction. The voice gate flags but does not decide.

The voice gate's pass/fail threshold per skill lives in `customer.yaml`. For this skill the default threshold is conservative; better to omit the case-history paragraph and ship a structured-only draft than to ship a paragraph the partner has to rewrite.
