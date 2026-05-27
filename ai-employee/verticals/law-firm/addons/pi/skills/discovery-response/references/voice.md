# Voice Rules - Supervising Partner Voice (Layer 2 Match)

The draft's factual sections (recitation lead-in, per-request table headers, responsive-document captions, privilege-log column captions, lead-in sentences to each section) must read as if the supervising partner of the firm wrote them. The partner signs the response and the partner is the sender per ADR 0005; the agent persona is invisible to opposing counsel.

A failed voice match means the partner rewrites the prose, which means the agent saved no time on the part of the work where time-saving was the point (parsing the incoming request and mapping responsive documents took twenty minutes; if rewriting the prose takes another thirty, the agent is net-negative).

Voice samples (Layer 2 anchor corpus) live in `customer.yaml` and must total at least thirty samples distributed across recipient cohorts before the skill is allowed to ship an external draft (PRD §9.6 Gate 1). The partner's prior discovery responses, prior objections, prior motion-to-compel responses, and prior opposing-counsel correspondence are the primary samples for this skill.

## Hard rules (mechanical, enforceable)

1. **No em dashes anywhere.** Use sentences. Use commas. Use periods. Never the long dash character (em dash, en dash). The rule applies to section headers, table delimiters, captions, and prose alike. Markdown tables that need a separator row use the standard pipe-and-hyphen syntax; the hyphens are ASCII hyphens, not em dashes or en dashes.
2. **No "I hope this email finds you well." No "Just wanted to touch base." No "Reach out."** These are AI-tells and opposing counsel reads them as agent-drafted.
3. **No corporate filler vocabulary:** circle back, touch base, reach out, leverage, level-set, deep dive, double-click, sync up, alignment as a verb, table this, ping me, action item, bandwidth, per our records, at this time, please find attached.
4. **No legal conclusions in any section the skill authors.** Never "your request is plainly overbroad," "the privilege clearly applies," "the document is plainly irrelevant," "the proportionality analysis is settled," "we are within our rights." Category labels (overbroad, unduly burdensome, etc.) are pointers to the firm's memory-rule vocabulary, not legal conclusions; they appear as table-cell labels, not as prose assertions. The full objection sentences are partner-authored TBD sections.
5. **No commitment language in any section the skill authors.** Never "we refuse to produce," "we will not respond," "our client denies," "we are prepared to," "we expect." All such language belongs in the partner-authored sections.
6. **No tentative hedges that fake certainty:** "I believe," "it appears," "in our view," "as best we can tell," "presumably." If the responsive-document row is sourced, the row is stated. If it is not, the row is TBD.
7. **Active voice.** "The request seeks documents already produced by opposing counsel on April 12, 2026" not "documents already produced by opposing counsel on April 12, 2026 are sought by the request." "Dr. Chen's notes appear at Exhibit C" not "Exhibit C consists of Dr. Chen's notes."
8. **Short sentences.** One idea per sentence usually. Long sentences are reserved for nuanced category mapping where breaking would obscure the connection, not for sounding lawyerly. Target sentence length: twelve to twenty words. Max sentence length: thirty-five words.
9. **Sign-off uses the supervising partner's name and full signature block from `customer.yaml`.** Never "Best regards," "Warm regards," "Sincerely yours," "Cheers," "Respectfully submitted." The partner's actual close is what the customer's voice samples capture.
10. **No emojis. No exclamation points anywhere.**
11. **Dates render as `Month D, YYYY` in prose (e.g., "May 8, 2026") and as `YYYY-MM-DD` in tables.** No "5/8/26", no "8 May 26."
12. **Numbered-request labels mirror the incoming filing.** If opposing counsel numbered the requests `1` through `25`, the response uses the same numbering. If opposing counsel used `Interrogatory No. 1`, the response uses the same form. The skill does not renumber, does not abbreviate, does not consolidate adjacent requests.
13. **Verbatim incoming-request text is preserved exactly.** When the skill recites a numbered request, the text is the request text from the source filing without reformatting, rewording, or paraphrase. The recital is a quote, not a summary.

## Soft rules (judgment, the agent must learn)

14. **Professional and direct, not friendly and not adversarial.** A discovery response is an adversarial filing in form but a procedural artifact in function. Tone matches the partner's prior responses. The partner is firm and unornamented; the draft is firm and unornamented.
15. **State facts about the matter, do not argue them.** "Exhibit B is the May 18 initial consultation note from Dr. Chen of Phoenix Orthopedics" is a fact. "Exhibit B confirms the seriousness of the client's spinal injury" is an argument. The skill writes facts; the partner writes arguments.
16. **Name the source of every figure or document inline where the partner's prior responses do so.** If the partner's Layer 2 samples cite "Exhibit C (May 12 MRI report)" inside the response prose, the draft mirrors that pattern. If the partner's prior responses keep exhibits at the back and prose clean, the draft does the same. The Layer 2 corpus decides.
17. **Acknowledge what is unknown without making the chronology feel thin.** "The matter file contains no documents responsive to Interrogatory No. 14 as of June 10, 2026" is fine when no responsive documents have been found and the cutoff date is sourced. "We have no responsive documents" without a date is not, because the lack of a date implies a present-tense assertion the skill cannot make.
18. **Category labels match the memory-rule vocabulary exactly.** If the firm's memory rule labels the category `overbroad`, the table cell reads `overbroad`. The skill does not rewrite the label to `over broad` or `over-broad` or `overly broad` to fit a stylistic preference. The Layer 2 corpus is the partner's voice; the memory rule is the firm's vocabulary; both are sources of truth.

## Examples, good and bad

The examples below use fictional names and the `.invalid` TLD. All sample content is marked `[SYNTHETIC FIXTURE - NOT A REAL MATTER]`.

### Recitation lead-in

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad** (legal-marketing-toned, argumentative):

> We have received your overreaching and burdensome discovery requests, served upon our esteemed firm on May 12, 2026, and we are compelled to object in the strongest possible terms. Below please find our responses, which we trust will demonstrate the impropriety of your requests.

**Good** (factual, partner voice):

> Plaintiff Janet Holloway, by and through undersigned counsel, responds to Defendant David Kerr's First Set of Interrogatories served on May 12, 2026 as follows. The numbered responses below correspond to the numbered interrogatories in the served document.

### Per-request table caption

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad** (AI-tells):

> Please find below a comprehensive enumeration of our responses to each of your interrogatories, organized for your convenience.

**Good**:

> Responses to Interrogatories 1 through 25.

### Responsive-document caption

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad**:

> The documents responsive to this request are comprehensive medical records that fully substantiate our client's injuries.

**Good**:

> Documents responsive to Request for Production No. 4 (medical records, January 1, 2026 through present):

### Privilege-log row caption

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad** (privilege characterization in the caption):

> Plainly privileged communications between attorney and client, withheld in their entirety.

**Good** (metadata only, privilege claim TBD):

> The following documents from the matter file fall within the responsive set but are withheld. The partner authors the privilege-claim characterization for each row.

### TBD section, do not author

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad** (skill authored what the partner should author):

> Interrogatory No. 7: State whether the plaintiff has filed any prior lawsuits.
>
> Response: Plaintiff has filed no prior lawsuits arising from or relating to the subject incident.

**Good** (skill renders the TBD marker, partner fills in):

> Interrogatory No. 7: State whether the plaintiff has filed any prior lawsuits.
>
> Objection category (memory-rule sourced): `vague and ambiguous`, `not proportional to the needs of the case`
>
> `[TBD: substantive answer to Interrogatory No. 7 - partner authors. The objection-category mapping above and the matter custom_fields are provided as input.]`

### Privilege-claim characterization

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad** (skill characterized the privilege):

> Document doc_42 is withheld under the attorney-client privilege because it reflects confidential communications between Janet Holloway and the undersigned counsel.

**Good** (skill renders the metadata; partner authors the privilege claim):

> | Doc ID | Filename                              | Date       | Author        | Recipient      | Privilege claim |
> | ------ | ------------------------------------- | ---------- | ------------- | -------------- | --------------- |
> | doc_42 | 2026-05-22_client_intake_notes.pdf    | 2026-05-22 | Sarah Holcomb | Janet Holloway | `[TBD]`         |
> | doc_47 | 2026-05-30_strategy_memo_internal.pdf | 2026-05-30 | Sarah Holcomb | (internal)     | `[TBD]`         |

### Admit or deny, do not author

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

**Bad** (skill authored what the partner should author):

> Request for Admission No. 3: Admit that the plaintiff was operating a vehicle on April 28, 2026.
>
> Response: Admit.

**Good** (skill renders the TBD marker, partner fills in):

> Request for Admission No. 3: Admit that the plaintiff was operating a vehicle on April 28, 2026.
>
> `[TBD: admit or deny Request for Admission No. 3 - partner authors. The matter custom_fields (date_of_incident, client_role) are provided as input.]`

## How the voice gate scores this draft

`ai-employee/voice-gate/` (gated through #855) scores each draft on:

- **Banned-pattern hits** - em dashes, AI-tell phrases, corporate filler, hedges, characterization verbs (plainly, clearly, obviously, plainly improper). Each hit subtracts from the score.
- **Sentence-length distribution** - target twelve to twenty words, max thirty-five. Outliers subtract.
- **Layer 2 anchor similarity** - embedding similarity against the partner's prior discovery responses. Below the configured threshold, the skill emits a structured-tables-only variant with no prose lead-ins.
- **Citation-shape detection** - any citation-shaped string in skill-authored prose is a substrate-level block, not a voice-gate score reduction. The voice gate flags but does not decide. Citation strings inside the verbatim-quoted incoming request and inside partner-authored TBD sections are exempt.

The voice gate's pass/fail threshold per skill lives in `customer.yaml`. For this skill the default threshold is conservative; better to omit the prose lead-ins and ship a structured-only draft than to ship lead-ins the partner has to rewrite.
