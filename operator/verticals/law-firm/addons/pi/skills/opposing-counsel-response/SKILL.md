---
name: opposing-counsel-response
description: 'Drafts factual PI opposing-counsel reply for partner.'
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: []
  commands: []
metadata:
  hermes:
    tags: [Law, PI, OpposingCounsel, Response, Draft]
  smd:
    vertical: law-firm-pi
    trust_ceiling: draft_for_review
    trust_ceiling_locked: true
    capabilities: [PracticeManagement, EmailThread, Email]
    client_facing_fields:
      - name: opposing_counsel_name
        sourced_from: matter_attribute
      - name: opposing_counsel_firm
        sourced_from: matter_attribute
      - name: opposing_counsel_email
        sourced_from: matter_attribute
      - name: client_name
        sourced_from: matter_attribute
      - name: claim_number
        sourced_from: matter_attribute
      - name: case_caption
        sourced_from: matter_attribute
      - name: case_number
        sourced_from: matter_attribute
      - name: correspondence_kind
        sourced_from: system_of_record
      - name: inbound_message_date
        sourced_from: system_of_record
      - name: inbound_message_verbatim_quote
        sourced_from: system_of_record
      - name: inbound_factual_claim_index
        sourced_from: system_of_record
      - name: settlement_history_log
        sourced_from: system_of_record
      - name: motion_correspondence_log
        sourced_from: system_of_record
      - name: scheduling_log
        sourced_from: system_of_record
      - name: response_due_date
        sourced_from: system_of_record
      - name: correspondence_tone_classification
        sourced_from: memory_rule
      - name: settlement_counter_substantive_response
        sourced_from: none
      - name: motion_substantive_response
        sourced_from: none
      - name: scheduling_substantive_response
        sourced_from: none
      - name: case_strategy_language
        sourced_from: none
      - name: partner_signoff
        sourced_from: memory_rule
---

# Law PI Opposing Counsel Response Draft (Factual Assembly)

Reads one inbound piece of opposing-counsel correspondence on an active personal-injury matter and writes a factual response draft into the supervising partner's drafts folder. The skill recites the inbound message's verbatim factual claims, assembles the matter's prior-correspondence record from the EmailThread system of record (settlement history for counter-offers, motion-correspondence history for motion responses, scheduling history for scheduling negotiations), and writes a structured response shell. The partner authors the substantive response to the offer, motion, or scheduling proposal, the legal-argument framing, and any case-strategy language. The skill never sends. The skill never quotes case law, statutes, or court rules. The skill never authors a settlement number, a counter-counter, an acceptance, a rejection, or any commitment that constitutes a negotiation position. The partner reviews, fills in the TBD sections, edits, and clicks send from their own mail client.

The skill is configured per-customer through `~/.hermes/customers/{customer_slug}/customer.yaml`, which supplies the firm name, the supervising partner's first name and signature block, the partner's reviewer email account ID for `Email.create_draft`, the firm's voice samples for Layer 2 voice match, the firm's correspondence-tone classification memory rule, and the practice-area filter. Per ADR 0008 the customer.yaml artifact is customer-owned. No partner names, firm names, settlement positions, or matter facts are hard-coded in this skill; every customer-facing value is sourced from the customer artifact at request time.

## When to Use

Use when opposing counsel has sent a settlement counter-offer, a motion-related letter or proposed order, or a scheduling-related letter or proposed stipulation on an active PI matter, and the supervising partner needs a factual response draft assembled. The skill identifies the correspondence kind, recites verbatim factual claims, assembles the matter's prior-correspondence record, and emits TBD markers for partner-authored substantive responses.

## Prerequisites

PracticeManagement, EmailThread, and Email capability adapters; per-customer config at `~/.hermes/customers/{customer_slug}/customer.yaml` including Layer 2 voice samples and the firm's correspondence-tone classification memory rule. See frontmatter.

## How to Run

Draft from a matter ID and an inbound opposing-counsel message already in the matter's correspondence thread:

```
hermes run opposing-counsel-response --matter-id <id> --inbound-message-id <message_id>
```

Draft from a matter ID and a raw inbound message file (text, PDF, or .eml) the partner saves to the matter folder mid-invocation:

```
hermes run opposing-counsel-response --matter-id <id> --inbound-message-file <path>
```

Dry-run (writes the draft to `~/.hermes/customer_notes/{customer_slug}/` and returns the path; does not call `Email.create_draft`):

```
hermes run opposing-counsel-response --matter-id <id> --inbound-message-id <message_id> --dry-run
```

## Procedure

1. **Load customer config.** Read `~/.hermes/customers/{customer_slug}/customer.yaml` for firm name, supervising partner's reviewer account ID, partner's signature block, voice samples (Layer 2), the firm's correspondence-tone classification memory rule, and the practice-area filter. If `practice_areas` does not include `personal-injury`, the skill refuses with `out_of_scope` and writes no draft.
2. **Load the matter via PracticeManagement.** Call `practice_management.get_matter(matter_id)`. If the matter is null or its `matter_type` does not indicate PI, refuse with `matter_not_found` or `matter_wrong_type`. The skill never creates or modifies a matter.
3. **Load the inbound message via EmailThread.** Call `email_thread.get_message(inbound_message_id)` (or load the file at `--inbound-message-file` and parse it in-process). The skill never modifies a matter document or thread.
4. **Detect the correspondence kind.** Inspect the inbound message body and subject for the kind: settlement counter-offer, motion-related correspondence, or scheduling-related correspondence. The skill sets `correspondence_kind` to one of `settlement_counter_offer`, `motion_correspondence`, or `scheduling_correspondence`. Detection heuristics live in `references/correspondence-kind-detection.md`. If the inbound mixes kinds (e.g., a single letter that proposes both a scheduling change and a settlement number), the skill processes each kind in a separate response section but emits one consolidated draft. If the kind cannot be resolved with confidence above the configured threshold, the skill refuses with `kind_unresolvable` and surfaces the inbound to the partner for triage.
5. **Quote the inbound factual claims verbatim.** Extract the inbound's factual claims: for settlement counter-offers, the offer amount, the proposed payment timing, the proposed release terms, and any conditions; for motion correspondence, the motion title, the relief sought, the filing date, and any factual statements about the matter's procedural posture; for scheduling correspondence, the proposed dates, the proposed venues, the affected deadlines, and any conditional proposals. Each factual claim is recorded verbatim with a sentence-level pointer back to the inbound message. The skill does NOT paraphrase. The skill does NOT summarize. The recital is a quote.
6. **Identify the response due date.** The skill reads the inbound's served date (from the EmailThread metadata or the inbound message header) and computes the response due date using the firm's per-matter rule (settlement-counter responses default to no fixed deadline; motion responses follow the per-jurisdiction rule from customer.yaml; scheduling responses follow the proposing party's stated deadline or the firm's default). If the deadline cannot be sourced, the response-due-date field renders as `[TBD: response due date - partner confirms]`.
7. **Assemble the prior-correspondence record from EmailThread.** Call `email_thread.list_messages_for_matter(matter_id)` and filter to the relevant subset by correspondence kind. For settlement counter-offers, the relevant subset is every prior message in the matter's `settlement_thread_id` (a custom_field on the matter) plus every prior message tagged `settlement` in the matter's thread metadata. For motion correspondence, the relevant subset is every prior message in the matter's `motion_correspondence_thread_id` plus every prior message tagged `motion`. For scheduling correspondence, the relevant subset is every prior message in the matter's `scheduling_thread_id` plus every prior message tagged `scheduling`. The skill emits the resulting record as a chronological table (date, direction, sender, subject, one-line synopsis sourced from the message's `synopsis` field if present, or `[no synopsis recorded]` if absent). The skill never authors a synopsis. If the relevant thread is empty, the prior-correspondence record renders as a one-sentence note that this is the first inbound on this thread.
8. **Tag the inbound's correspondence-tone classification (memory-rule sourced).** The skill matches the inbound message body against the firm's correspondence-tone classification memory rule. Categories are label-only: `routine`, `contested`, `hostile`, `procedural`, `urgent`. Detection is mechanical (keyword and pattern matching against the memory-rule vocabulary). The skill emits the matched category as a single label in the draft header. The skill DOES NOT characterize tone in prose; the label is a pointer to the firm's memory-rule vocabulary, not a legal or tactical conclusion.
9. **Insert TBD markers for partner-authored sections.** Substantive response to the inbound's offer or proposal: one TBD marker per correspondence section (one for settlement counter-offer, one for motion, one for scheduling). Legal-argument framing for motion responses: one TBD marker. Settlement-posture language for counter-offer responses: one TBD marker, with explicit language reminding the partner that no number is authored. Alternative-date proposals for scheduling responses: one TBD marker. Closing case-strategy language: one TBD marker at the end of the response.
10. **Voice match against Layer 2 partner samples.** Run the assembled factual prose (the recitation lead-in, the prior-correspondence table captions, the inbound-claim quote captions) through the voice-gate harness (gated through #855 and not runtime-active at this skill version; the harness contract is honored at fixture-test time). A failing voice score causes the skill to emit a structured-table-only variant with no prose lead-ins; the partner authors the lead-ins.
11. **Call `Email.create_draft` per ADR 0005.** Construct `DraftInput`:
    - `reviewer_account_id`: the supervising partner's account ID from `customer.yaml`. Adapter routing per ADR 0005, must resolve to the partner's mailbox, not the agent's AgentMail identity. Adapter throws `validation_failed` if it cannot enforce.
    - `to`: the opposing counsel's email from `matter.custom_fields.opposing_counsel_email`. If absent, the draft renders as a new-thread draft with `to: []` and the partner fills in the recipient.
    - `subject`: `Re: <inbound message subject>` if the inbound has a parseable subject; otherwise `<correspondence kind label> regarding <case caption>, <case number>`. Every component sourced from matter attributes or the parsed inbound; absences render as TBD.
    - `thread_id`: the inbound's `thread_id` if the matter recorded the thread, so the response threads natively in the partner's mail client.
    - `body_text` and `body_html`: the assembled draft (see `references/output-format.md` for the exact section order).
    - `matter_ref`: the matter ID, for the dashboard's "what Marcus used to write this" sourcing block.
    - `drafted_by_skill`: `opposing-counsel-response`.
12. **Write the matter-internal sourcing note.** In parallel, write `~/.hermes/customer_notes/{customer_slug}/pi-opposing-counsel-response-YYYY-MM-DD-<matter-id>.md` containing the section-by-section sourcing index (which EmailThread message ID populated which row, which custom_field populated which named field, which memory rule populated the tone classification, which fields rendered as TBD and why). This is the audit trail the dashboard's sourcing block reads from.
13. **Emit telemetry.** A skill-invocation event records: matter id (hashed), correspondence kind, inbound-claim count, prior-correspondence row count, TBD-marker count by section, voice-gate score, draft size in bytes, adapter calls made. No matter content leaves the customer's machine boundary.

### Trust Ceiling

`draft_for_review`. The ceiling is **locked at v1 and cannot be promoted to `autonomous`** per PRD §11.2 ("anything touching trust accounting, court filing, settlement authority, judgment-bearing work: `draft_for_review` permanently"). Opposing-counsel correspondence on a PI matter routinely touches all three: settlement counter-offers ARE settlement-authority work; motion responses ARE court-filing work; scheduling negotiations touch deadlines that affect court filings. Promotion is architecturally blocked.

The agent MAY:

- Read the matter via `PracticeManagement.get_matter` (read-only).
- Read prior-correspondence threads via `EmailThread.list_messages_for_matter` and `EmailThread.get_message` (read-only).
- Write the draft via `Email.create_draft` into the supervising partner's drafts folder (the only outbound surface in the Email interface; per ADR 0005 there is no send path).
- Write the matter-internal sourcing note inside `~/.hermes/customer_notes/{customer_slug}/`.

The agent MUST NOT, without explicit partner instruction in a different invocation:

- Modify or create any PracticeManagement record (matter, contact, time entry, document).
- Modify, send, or delete any EmailThread message. Reads only.
- Send any email. The Email interface has no send method by design (ADR 0005); attempting to send via any side channel is a critical safety violation and the runtime refuses.
- Author any settlement number, including a counter-counter offer, an acceptance, a rejection, a range, an anchor, or any language that constitutes a negotiation position. The substantive settlement response is partner work.
- Author any legal-argument response to a motion, including a procedural position, a concession, an opposition framing, or any tactical posture toward the motion.
- Author any substantive response to a scheduling proposal, including an agreement, a refusal, an alternative-date proposal, or a conditional acceptance.
- Author any case-strategy language, including statements about settlement posture, motion-to-compel risk, sanctions exposure, or forward-looking negotiation framing.
- Quote, restate, or augment any case law, statute, court rule, or treatise reference.
- Characterize opposing counsel's tone in prose. The tone classification is a memory-rule label only.
- Compute or assert a response deadline beyond what the matter custom_fields, the inbound metadata, and the firm's per-jurisdiction rule supply. If the deadline cannot be sourced, the field is TBD.

If the skill cannot find a piece of source data the partner expects (e.g., the opposing-counsel email, the prior settlement-thread), the draft renders the corresponding section as a TBD marker and the matter-internal sourcing note lists the missing item. The partner sees the TBD on review and fills it in. The skill does not guess.

### Voice Rules (Layer 2 partner corpus match)

The factual prose sections (recitation lead-in, prior-correspondence table captions, inbound-claim quote captions) must read as if the supervising partner wrote them. Voice samples from `customer.yaml` Layer 2 provide the anchor corpus. The partner's prior opposing-counsel correspondence and prior settlement, motion, and scheduling responses are the primary samples for this skill. See `references/voice.md` for the long form. Hard rules:

- **No em dashes anywhere.** Commas, periods, short sentences. The dash character is banned in section headers, table delimiters, captions, and prose alike.
- **No "I hope this email finds you well." No "Just wanted to touch base." No "Reach out."** No "Please don't hesitate." No "Per our records." No "At this time."
- **No corporate filler vocabulary:** circle back, leverage, level-set, deep dive, double-click, table this, ping me, action item, bandwidth.
- **No legal conclusions in any section the skill authors.** Never "your offer is plainly inadequate," "the motion clearly lacks merit," "the proposed schedule is unreasonable." Tone-classification labels are facts about which category the inbound matches against the firm's vocabulary; the legal characterization is the partner-authored TBD section.
- **No commitment language.** Never "we counter," "we accept," "we reject," "we agree," "we oppose," "we will not extend." All such language is the partner-authored sections.
- **No tentative hedges that fake certainty:** "I believe," "it appears," "in our view." If the prior-correspondence row is sourced, the row is stated. If it is not, the row is TBD.
- **Active voice.** "Opposing counsel proposed a settlement of [verbatim quote] on May 12, 2026" not "a settlement was proposed by opposing counsel on May 12, 2026."
- **Short sentences.** One idea per sentence usually. Long sentences are reserved for nuanced section captioning, not for sounding lawyerly.
- **Sign-off uses the supervising partner's name and signature block from `customer.yaml`.** Never "Best regards," "Warm regards," "Sincerely yours," "Cheers." The partner's actual close is what the customer's voice samples capture.
- **No emojis. No exclamation points anywhere.**

If the assembled prose cannot pass these rules, the skill omits the prose and emits only the structured tables, captions, and TBD markers. The partner prefers structured rows to expand than a flawed paragraph to dismantle.

### Citation Policy (law-firm vertical, invariant #6)

The skill must never produce, repeat, or reformulate legal citations. Case-name-shaped strings with reporter cites (e.g., `Smith v. Jones, 123 F.3d 456 (3d Cir. 2010)`), statute references (e.g., `42 U.S.C. § 1983`), court rule references (e.g., `Fed. R. Civ. P. 56`, `Ariz. R. Civ. P. 16`), and treatise pinpoints are all in scope. The skill renders tone-classification labels only; the legal-argument framing that often cites a court rule (motion responses) is partner-authored TBD.

If the inbound correspondence contains citations supplied by opposing counsel (e.g., a motion-related letter citing a recent case on summary judgment), the skill carries them through verbatim only inside the "inbound message recital" section (which is a verbatim quote of the inbound message, not skill prose) and inside partner-authored TBD section markers. The skill never paraphrases, restates, or summarizes such citations in its own prose. If the matter record contains citations in partner-authored narrative notes that the skill would otherwise read into its own factual prose (e.g., a `case_summary` custom_field), the skill triggers the readiness rubric's `PROPAGATION_RISK` value (see `references/categorization-rubric.md` axis 5) and refuses with `citation_in_source`.

If the assembled draft would otherwise contain a citation-shaped string in skill-authored prose, the skill replaces the string with `[CITATION REMOVED - partner inserts after review]` and logs a citation-refusal event. Code-level enforcement lives in the citation-refusal substrate at `operator/safety-substrate/citation_filter.py`; the skill's prompt-level discipline is defense in depth. See `references/citation-policy.md`.

### Fabrication Policy (platform invariant #8)

Every client-facing field is declared in the skill's frontmatter `client_facing_fields` block with one of: `matter_attribute`, `system_of_record`, `memory_rule`, `none`. Fields tagged `none` MUST render as a TBD marker; rendering plausible content into a `none`-tagged field is a `block`-severity fabrication-filter violation per the spec at `docs/specs/operator/fabrication-filter.md`. The four legal-judgment fields the partner authors (`settlement_counter_substantive_response`, `motion_substantive_response`, `scheduling_substantive_response`, `case_strategy_language`) are all tagged `none` for exactly this reason: the skill cannot author them, the runtime filter enforces non-rendering, and the draft surfaces a TBD marker the partner fills in.

The `correspondence_tone_classification` field is tagged `memory_rule` rather than `none`: the firm authors a tone-classification vocabulary in customer.yaml's memory rules, and the skill matches inbound text against that vocabulary. The category labels are not legal or tactical conclusions; they are pointers to the partner-authored memory rule. The substantive responses that frame the firm's posture toward the inbound are partner-authored TBD sections.

See `references/fabrication-policy.md` for the per-section sourcing contract.

### Refusal Cases

The skill emits a refusal (writes no draft, returns a structured error) under any of:

- `out_of_scope`: the customer's `practice_areas` does not include `personal-injury`.
- `matter_not_found`: `PracticeManagement.get_matter(id)` returns null.
- `matter_wrong_type`: `matter.matter_type` is not a PI variant.
- `matter_closed`: `matter.status` is `closed`. Opposing-counsel responses are not issued on closed matters; the partner re-opens the matter or declines to respond.
- `kind_unresolvable`: the correspondence kind cannot be detected with confidence above the configured threshold. The partner triages the inbound and re-invokes with explicit `--kind` argument.
- `tone_vocabulary_missing`: `customer.yaml.memory_rules.correspondence_tone_categories` is missing or empty. The firm authors the vocabulary; the skill refuses rather than ship a draft with no tone classification.
- `voice_samples_missing`: `customer.yaml` Layer 2 voice samples count is below the PRD §9.6 Gate 1 minimum (30 samples). The skill refuses rather than ship an externally-bound draft against an uncalibrated voice envelope.
- `citation_in_source`: a citation-shaped string appears in a matter custom_field that the skill would otherwise carry through into a non-quoted section. The substrate-level citation filter blocks; the skill refuses and escalates to the partner.

When the skill can author a partial draft (some sections sourced, some TBD), it proceeds. When it cannot meet a refusal criterion, it writes no draft and logs the refusal.

### Settlement-Authority Policy (law-firm-prd §5 third-rail)

Settlement-counter responses are the highest-risk correspondence kind this skill handles. Per the §5 third-rail map, settlement authority belongs to the partner; the agent never proposes a settlement number, never accepts, never rejects, never counter-counters, and never frames a negotiation posture. The skill's settlement-counter behavior:

- The inbound's offer amount is recited verbatim, in quotes, sourced to the inbound message.
- The matter's settlement-history log (every prior demand, every prior counter, every prior offer, with dates and amounts sourced from EmailThread) is recited as a chronological table.
- The substantive response is a TBD marker with the language: `[TBD: substantive settlement-counter response - partner authors. The skill emits no number, no acceptance, no rejection, no counter-counter, and no negotiation framing. Settlement authority is partner work per the firm's authority matrix.]`
- No section the skill authors contains a dollar amount that is not a verbatim quote sourced to the inbound message or to a prior EmailThread message.

The fabrication filter's `specific_dollar_amount` marker is configured to `block` on any skill-authored render of a dollar amount outside the verbatim-quote exemption (per `references/fabrication-policy.md`). The substrate enforces; the skill's discipline is defense in depth.

## Pitfalls

See `### Refusal Cases` in Procedure. The highest-risk failure mode for this skill is authoring any settlement number, acceptance, rejection, or counter-counter outside the verbatim-quote exemption; see `### Settlement-Authority Policy`. Other common failure modes include paraphrasing inbound factual claims (must be verbatim), characterizing tone in prose, and emitting commitment language ("we counter," "we accept").

## Verification

A successful run satisfies all of:

1. The draft lands in the supervising partner's drafts folder (not the agent's AgentMail identity), confirmed by the adapter's `DraftRef.folder` field matching the partner's drafts path.
2. The inbound message's factual claims are quoted verbatim with sentence-level pointers back to the source message. No paraphrasing. No summarization.
3. The prior-correspondence record is a chronological table sourced from EmailThread message IDs. No invented messages. No invented dates. No invented synopses.
4. The correspondence-tone classification is a label from the firm's memory-rule vocabulary. No skill-authored tone prose.
5. The four legal-judgment sections (`settlement_counter_substantive_response`, `motion_substantive_response`, `scheduling_substantive_response`, `case_strategy_language`) all render as TBD markers. None contain plausible-but-inferred prose. None contain dollar amounts.
6. No citation-shaped string appears anywhere in skill-authored sections (citation-refusal substrate verifies post-emit). Citation strings inside the verbatim-quoted inbound message and inside partner-authored TBD sections are not the skill's authoring and are out of scope for the substrate's authoring check.
7. The fabrication filter returns `clean` (no `none`-tagged field rendered non-empty; every `matter_attribute`/`system_of_record` field has a present source_id; every `memory_rule` field has a present rule_id; no dollar amount outside the verbatim-quote exemption).
8. The voice-gate score against the Layer 2 partner corpus is above the configured threshold.
9. The draft is scannable by the partner in under ten minutes: header, recipient, response-due-date line, inbound-message recital (verbatim claims), prior-correspondence table, tone-classification label, TBD substantive-response section, TBD closing, sign-off block. Every TBD marker is one line, in brackets, with a hint to what the partner authors.

## References

- `references/voice.md` partner-corpus voice rules with positive and negative examples specific to opposing-counsel correspondence; banned patterns; sentence-length envelope; Layer 2 match criterion.
- `references/output-format.md` exact section order and section templates for the draft, with one example per correspondence kind (settlement counter-offer, motion response, scheduling negotiation) and one prior-correspondence-record example.
- `references/categorization-rubric.md` rules for classifying a matter as ready or not-ready for opposing-counsel response draft; severity gates; missing-data thresholds; the tone-classification memory-rule contract; the correspondence-kind detection rubric.
- `references/citation-policy.md` the absolute prohibition on legal citations and the standard refusal language; the verbatim-quote carve-out for inbound correspondence; pointer to the citation-refusal substrate.
- `references/fabrication-policy.md` the per-section sourcing contract; the mapping between `client_facing_fields` frontmatter and rendered sections; TBD-marker language by section; the dollar-amount and commitment-phrase markers that are load-bearing for this skill.
- `references/test-cases.md` which fixtures exercise which behaviors and what the skill must produce for each.

## Related PRD and ADR references

- ADR 0005 (reviewer-as-sender) `Email.create_draft` into the partner's drafts folder, no send method, no agent persona externally.
- ADR 0006 (capability-adapter pattern) the skill calls `PracticeManagement`, `EmailThread`, and `Email` interfaces, never vendor SDKs.
- ADR 0008 (customer-owned memory artifact) every customer-facing value is sourced from the customer artifact at request time; no hard-coded partner names, firm names, or matter facts.
- Platform PRD §7.5 invariant #6 citation-refusal (vertical: law-firm).
- Platform PRD §7.5 invariant #8 fabrication discipline; this skill is one of the load-bearing test cases for the dollar-amount and commitment-phrase markers.
- Platform PRD §8.4 skill anatomy. Voice rules front-loaded in description per Phase A.6.
- Platform PRD §9 persona and voice model; Layer 2 anchor corpus minimum.
- Platform PRD §11.2 default trust ceiling `draft_for_review`, locked for judgment-bearing work.
- Law-firm PRD §5 third-rail map (settlement authority, court-filing submission, citation-bearing legal arguments). All three are touched by this skill's three correspondence kinds; the skill's structural TBD discipline is what allows it to ship.
- Law-firm PRD §6.2 pillar map; this skill operationalizes the cross-pillar opposing-counsel correspondence work.
- Law-firm PRD §11.2 demo scenario list; opposing-counsel correspondence is the scenario this skill addresses for non-discovery inbound.

## Scope alignment with law-firm-prd §6.2 and §5

The law-firm PRD §6.2 organizes PI work across seven pillars; opposing-counsel correspondence cuts across Pillar 5 (Discovery + investigation), Pillar 6 (Motion practice + court filings), and Pillar 7 (Settlement + resolution). The PRD does not list a specific `pi-opposing-counsel-response` skill name; this skill operationalizes the opposing-counsel correspondence scenario from §11.2 ("an opposing counsel discovery request: needs triage and partner review") for the non-discovery-request subset, where the inbound is a settlement counter-offer, a motion-related letter or proposed order, or a scheduling-related letter or proposed stipulation.

The factually-narrow scope:

- Identifying the correspondence kind from the inbound message body and metadata is authored by the skill.
- Reciting the inbound message's verbatim factual claims (offer amount, motion title, proposed dates) under partner authorship is authored by the skill.
- Assembling the matter's prior-correspondence record (settlement-history log, motion-correspondence log, scheduling log) from the EmailThread system of record is authored by the skill.
- Tagging the inbound's correspondence-tone classification from the firm's memory-rule vocabulary (routine, contested, hostile) is authored by the skill.
- The substantive response to a settlement counter-offer (any number, any acceptance, any rejection, any counter-counter), the legal-argument response to any motion, the substantive response to any scheduling proposal, and any case-strategy framing are NOT authored by the skill. They render as TBD markers for the partner to author.

The skill name `opposing-counsel-response` is operational shorthand for this factually-narrow variant. If Captain decides this scope creeps too close to settlement-authority authoring, motion-argument authoring, or scheduling-commitment authoring, the fix is configuration: narrow the inbound-claim recital to a flat-quote block (no skill-authored framing prose), narrow the prior-correspondence record to a chronological index with no captioning, or hold the skill for Phase 3. Per the §5 third-rail map, settlement authority sits on the third rail; this skill's structural commitment to leave every settlement-substantive cell as TBD is what allows it to ship at all.
