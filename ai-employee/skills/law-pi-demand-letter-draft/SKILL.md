---
name: law-pi-demand-letter-draft
description: "Demand-letter draft assembler for personal-injury law firms. Reads a single active PI matter through the PracticeManagement capability and the matter's medical and economic records through DocumentStorage, then writes a draft into the supervising partner's drafts folder via Email.create_draft. The draft is FACTUAL ONLY. The skill writes the chronology, billing tabulation, lost-wages tabulation, exhibit list, and factual case-history prose, all sourced from the matter record. The skill DOES NOT author the demand amount, the settlement bracket prose, the liability characterization, or any case-strategy language; those sections render as TBD markers for the partner to author. Per ADR 0005 the partner is the sender; per PRD §7.5 invariant #8 every authored figure and named person is sourced from the matter record or rendered as TBD, never inferred; per law-firm PRD §9 the citation-refusal substrate forbids any case-law, statute, or court-rule reference in any section. STRICT VOICE RULE: no em dashes anywhere in output, including section headers and table delimiters. Commas, periods, short sentences. No corporate filler. The partner signs the letter; the agent's persona is invisible to the recipient. CITATION POLICY: the skill must never produce, repeat, or reformulate legal citations (case-name-shaped strings with reporter cites, statute references, court rule references, treatise pinpoints). All citation work defers to human legal research. If the matter record contains citations supplied by the partner in narrative notes, the skill carries them through verbatim as quoted text only; it does not validate, restate, or augment them."
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: []
  commands: []
client_facing_fields:
  - name: recipient_name
    sourced_from: matter_attribute
  - name: recipient_carrier
    sourced_from: matter_attribute
  - name: claim_number
    sourced_from: matter_attribute
  - name: client_name
    sourced_from: matter_attribute
  - name: date_of_incident
    sourced_from: matter_attribute
  - name: incident_location
    sourced_from: matter_attribute
  - name: medical_provider_list
    sourced_from: system_of_record
  - name: medical_specials_total
    sourced_from: system_of_record
  - name: per_provider_billing
    sourced_from: system_of_record
  - name: lost_wages_total
    sourced_from: system_of_record
  - name: employer_name
    sourced_from: matter_attribute
  - name: treatment_chronology
    sourced_from: system_of_record
  - name: exhibit_index
    sourced_from: system_of_record
  - name: liability_characterization
    sourced_from: none
  - name: settlement_bracket_prose
    sourced_from: none
  - name: demand_amount
    sourced_from: none
  - name: case_strategy_language
    sourced_from: none
  - name: partner_signoff
    sourced_from: memory_rule
metadata:
  hermes:
    tags: [Law, PI, Demand, Draft]
    vertical: law-firm-pi
    trust_ceiling: draft_for_review
    trust_ceiling_locked: true
    capabilities: [PracticeManagement, DocumentStorage, Email]
---

# Law PI Demand-Letter Draft (Factual Assembly)

Reads one active personal-injury matter and writes a factual demand-letter draft into the supervising partner's drafts folder. The skill writes only what the matter record and document store contain. The partner authors the demand amount, the liability characterization, the settlement bracket, and any case-strategy language. The skill never sends. The skill never quotes case law, statutes, or court rules. The partner reviews, fills in the TBD sections, edits, and clicks send from their own mail client.

The skill is configured per-customer through `~/.hermes/customers/{customer_slug}/customer.yaml`, which supplies the firm name, the partner's first name and signature block, the partner's reviewer email account ID for `Email.create_draft`, the firm's voice samples for Layer 2 voice match, and the practice-area filter.

## Scope alignment with law-firm-prd §6.2

The law-firm PRD §6.2 defers a generic "demand letter text" skill (`pi-demand-letter-text-only`) to Phase 3+ on the grounds that factual demand-letter prose still carries implicit legal-judgment characterization (impact framing, liability framing, settlement-value framing). This skill implements the **factually-narrow** subset that is safe in v1:

- Chronology, tabulation, exhibit assembly, and factual case-history prose are authored by the skill.
- Demand amount, settlement bracket, liability characterization, and case-strategy language are NOT authored by the skill. They render as TBD markers for the partner to fill in.

The skill name `law-pi-demand-letter-draft` is operational shorthand for this factually-narrow variant. It is functionally adjacent to the `pi-demand-letter-evidence-packet` capability described in law-firm-prd §6.2 and §12.1, with one addition: the factual sections are assembled as prose in the partner's voice envelope rather than as standalone spreadsheets, so the partner edits a draft letter rather than re-typing from a packet.

If Captain decides this scope creeps too close to the deferred `pi-demand-letter-text-only` skill, the fix is one of: (1) narrow the factual prose to bulleted assembly only and remove the "case history" paragraph, or (2) hold the skill for Phase 3 per the PRD's stated deferral. Both fixes are configuration, not architecture.

## How to invoke

Draft from a matter ID:

```
hermes run law-pi-demand-letter-draft --matter-id <id>
```

Draft from a Hermes-side matter slug (when the matter is known by its internal slug rather than the PM-system ID):

```
hermes run law-pi-demand-letter-draft --matter-slug <slug>
```

Dry-run (writes the draft to `~/.hermes/customer_notes/{customer_slug}/` and returns the path; does not call `Email.create_draft`):

```
hermes run law-pi-demand-letter-draft --matter-id <id> --dry-run
```

## What the agent does, in order

1. **Load customer config.** Read `~/.hermes/customers/{customer_slug}/customer.yaml` for firm name, supervising partner's reviewer account ID, partner's signature block, voice samples (Layer 2), and practice-area filter. If `practice_areas` does not include `personal-injury`, the skill refuses with `out_of_scope` and writes no draft.
2. **Load the matter via PracticeManagement.** Call `practice_management.get_matter(matter_id)`. If the matter is null or its `matter_type` does not indicate PI, refuse with `matter_not_found` or `matter_wrong_type`. The skill never creates or modifies a matter.
3. **Read the matter's custom_fields.** PI-adapter populated fields the skill expects: `client_name`, `date_of_incident`, `incident_location`, `claim_number`, `opposing_carrier`, `opposing_adjuster_name`, `opposing_adjuster_email`, `employer_name`. Each field that is missing from `custom_fields` is recorded as a TBD source; the corresponding draft section renders the TBD marker rather than inferring a plausible value.
4. **Read matter documents via DocumentStorage.** Call `document_storage.list_folder({folder_path: matter.documents_folder_path})` recursively. Filter for medical records, billing statements, employment verification, and photographs. Build the document index from `StoredDocument.filename`, `mime_type`, `current_version`, `modified_at`. The skill never modifies a document; it reads metadata and (where the adapter supports it) reads PDF/text bodies to extract structured facts.
5. **Build the medical chronology.** From medical-record filenames and adapter-extracted bodies, build a per-provider, per-date chronology of treatment. Every row is sourced from a specific `StoredDocument.id`. Rows without a sourced date or provider are dropped from the chronology and added to a "could not source" list at the bottom of the matter-internal triage note. The chronology never invents a date or a provider.
6. **Build the billing tabulation.** Sum billed charges per provider from billing-statement documents. The total medical specials line in the draft is the sum of sourced provider lines. Where a billing statement is missing or its total cannot be extracted, the per-provider line renders as `[TBD: source billing statement at <document path>]` and is excluded from the specials total; the specials total then renders as `[TBD: medical specials total — partner verifies after sourcing missing billing statements]`. The skill never estimates.
7. **Build the lost-wages tabulation.** Sum lost wages from employment-verification documents (W-2, pay stubs, employer letter). Where employer-verification is absent, render `[TBD: lost wages — partner supplies after employer verification received]`. The skill never imputes wages from the client's stated occupation.
8. **Build the exhibit list.** Enumerate every sourced document as an exhibit, numbered. Photo exhibits are listed with filename and modified date; medical exhibits with provider and date range; billing exhibits with provider; employment exhibits with employer.
9. **Author the factual case-history paragraph.** Three to five sentences. Sourced from `date_of_incident`, `incident_location`, the client's documented role in the incident (driver / passenger / pedestrian, as recorded in matter custom_fields), and the documented sequence of medical treatment. No characterization of fault. No characterization of severity beyond what the medical record states. No quoted client testimony unless it appears verbatim in a matter note authored by the partner.
10. **Insert TBD markers for partner-authored sections.** Demand-amount line: `[TBD: demand amount — partner authors]`. Settlement-bracket prose: `[TBD: settlement bracket and supporting framing — partner authors]`. Liability characterization paragraph: `[TBD: liability characterization — partner authors. The factual chronology above is provided as input.]`. Closing case-strategy language: `[TBD: closing paragraph — partner authors per firm template]`.
11. **Voice match against Layer 2 partner samples.** Run the assembled factual prose through the voice-gate harness (`ai-employee/voice-gate/` — gated through #855 and not runtime-active at this skill version; the harness contract is honored at fixture-test time). Voice gate scores tone register, sentence length, banned-pattern hits, and Layer 2 anchor similarity. A failing voice score causes the skill to emit a shorter, more conservative variant; if the conservative variant also fails, the skill writes only the chronology and tabulations and omits the factual case-history paragraph (the partner authors it instead).
12. **Call `Email.create_draft` per ADR 0005.** Construct `DraftInput`:
    - `reviewer_account_id`: the supervising partner's account ID from `customer.yaml`. Adapter routing per ADR 0005 — must resolve to the partner's mailbox, not the agent's AgentMail identity. Adapter throws `validation_failed` if it cannot enforce.
    - `to`: the opposing carrier adjuster's email from `matter.custom_fields.opposing_adjuster_email`. If absent, the draft renders as a new-thread draft with `to: []` and the partner fills in the recipient.
    - `subject`: `Demand for <client name>, claim <claim number>, date of loss <date>` — every field sourced from matter attributes; absences render as TBD.
    - `thread_id`: null (demand letters open a new correspondence thread).
    - `body_text` and `body_html`: the assembled draft (see `references/output-format.md` for the exact section order).
    - `matter_ref`: the matter ID, for the dashboard's "what Marcus used to write this" sourcing block.
    - `drafted_by_skill`: `law-pi-demand-letter-draft`.
13. **Write the matter-internal sourcing note.** In parallel, write `~/.hermes/customer_notes/{customer_slug}/pi-demand-draft-YYYY-MM-DD-<matter-id>.md` containing the section-by-section sourcing index (which `StoredDocument.id` populated which row, which `custom_field` populated which named field, which fields rendered as TBD and why). This is the audit trail the dashboard's sourcing block reads from.
14. **Emit telemetry.** A skill-invocation event records: matter id (hashed), TBD-marker count by section, voice-gate score, draft size in bytes, adapter calls made. No matter content leaves the customer's machine boundary.

## Trust ceiling

`draft_for_review`. The ceiling is **locked at v1 and cannot be promoted to `autonomous`** per PRD §11.2 ("anything touching trust accounting, court filing, settlement authority, judgment-bearing work: `draft_for_review` permanently"). A demand letter touches settlement authority by definition; promotion is architecturally blocked.

The agent MAY:

- Read the matter via `PracticeManagement.get_matter` (read-only).
- Read matter documents via `DocumentStorage.list_folder` and `DocumentStorage.download_document` (read-only).
- Write the draft via `Email.create_draft` into the supervising partner's drafts folder (the only outbound surface in the Email interface; per ADR 0005 there is no send path).
- Write the matter-internal sourcing note inside `~/.hermes/customer_notes/{customer_slug}/`.

The agent MUST NOT, without explicit partner instruction in a different invocation:

- Modify or create any PracticeManagement record (matter, contact, time entry, document).
- Upload or modify any document via DocumentStorage. Reads only.
- Send any email. The Email interface has no send method by design (ADR 0005); attempting to send via any side channel is a critical safety violation and the runtime refuses.
- Author the demand amount, the settlement bracket, the liability characterization, or any case-strategy language.
- Quote, restate, or augment any case law, statute, court rule, or treatise reference.
- Estimate, impute, or infer any medical or economic figure absent from the source documents.

If the skill cannot find a piece of source data the partner expects (e.g., the opposing-adjuster email), the draft renders the corresponding section as a TBD marker and the matter-internal sourcing note lists the missing item. The partner sees the TBD on review and fills it in. The skill does not guess.

## Voice rules (Layer 2 — partner corpus match)

The factual prose sections (case-history paragraph, exhibit captions, chronology lead-in) must read as if the supervising partner wrote them. Voice samples from `customer.yaml` Layer 2 provide the anchor corpus. See `references/voice.md` for the long form. Hard rules:

- **No em dashes anywhere.** Commas, periods, short sentences. The dash character is banned in section headers, table delimiters, captions, and prose alike.
- **No "I hope this email finds you well." No "Just wanted to touch base." No "Reach out."** No "Please don't hesitate." No "Per our records." No "At this time."
- **No corporate filler vocabulary:** circle back, leverage, level-set, deep dive, double-click, table this, ping me, action item, bandwidth.
- **No legal conclusions in any section the skill authors.** Never "your insured was negligent," "liability is clear," "damages are obvious." Liability and damages characterization is the TBD section.
- **No commitment language.** Never "we will file suit," "we will accept anything less than," "our client demands." All such language is the partner-authored sections.
- **No tentative hedges that fake certainty:** "I believe," "it appears," "in our view." If the chronology row is sourced, the row is stated. If it is not, the row is TBD.
- **Active voice.** "Dr. Chen examined the client on May 8" not "the client was examined on May 8."
- **Short sentences.** One idea per sentence usually. Long sentences are reserved for nuanced chronology, not for sounding lawyerly.
- **Sign-off uses the supervising partner's name and signature block from `customer.yaml`.** Never "Best regards," "Warm regards," "Sincerely yours," "Cheers." The partner's actual close is what the customer's voice samples capture.
- **No emojis. No exclamation points anywhere.**

If the assembled prose cannot pass these rules (e.g., the chronology only supports a vague paragraph), the skill omits the prose and writes only the structured chronology, tabulations, and exhibit list. The partner prefers structured rows to expand than a flawed paragraph to dismantle.

## Citation policy (law-firm vertical, invariant #6)

The skill must never produce, repeat, or reformulate legal citations. Case-name-shaped strings with reporter cites (e.g., `Smith v. Jones, 123 F.3d 456 (3d Cir. 2010)`), statute references (e.g., `42 U.S.C. § 1983`), court rule references (e.g., `Fed. R. Civ. P. 26(b)(1)`), and treatise pinpoint cites are all in scope. If the matter record contains citations in partner-authored narrative notes, the skill carries them through verbatim as quoted text inside the partner-authored TBD section markers only; it does not validate, restate, or augment them. If the assembled draft would otherwise contain a citation-shaped string, the skill replaces the string with `[CITATION REMOVED — partner inserts after review]` and logs a citation-refusal event. Code-level enforcement lives in the citation-refusal substrate at `ai-employee/safety-substrate/citation_filter.py`; the skill's prompt-level discipline is defense in depth. See `references/citation-policy.md`.

## Fabrication policy (platform invariant #8)

Every client-facing field is declared in the skill's frontmatter `client_facing_fields` block with one of: `matter_attribute`, `system_of_record`, `memory_rule`, `none`. Fields tagged `none` MUST render as a TBD marker; rendering plausible content into a `none`-tagged field is a `block`-severity fabrication-filter violation per the spec at `docs/specs/ai-employee/fabrication-filter.md`. The four legal-judgment fields the partner authors (`liability_characterization`, `settlement_bracket_prose`, `demand_amount`, `case_strategy_language`) are all tagged `none` for exactly this reason: the skill cannot author them, the runtime filter enforces non-rendering, and the draft surfaces a TBD marker the partner fills in. See `references/fabrication-policy.md` for the per-section sourcing contract.

## Refusal cases

The skill emits a refusal (writes no draft, returns a structured error) under any of:

- `out_of_scope`: the customer's `practice_areas` does not include `personal-injury`.
- `matter_not_found`: `PracticeManagement.get_matter(id)` returns null.
- `matter_wrong_type`: `matter.matter_type` is not a PI variant.
- `matter_closed`: `matter.status` is `closed`. Demand letters are not issued on closed matters.
- `insufficient_source_data`: the matter has fewer than three sourced rows across the medical, billing, and employment categories combined. A draft built on fewer than three sourced rows is closer to fabrication than to assembly; the partner is escalated to either populate the matter record or author the letter from scratch.
- `voice_samples_missing`: `customer.yaml` Layer 2 voice samples count is below the PRD §9.6 Gate 1 minimum (30 samples). The skill refuses rather than ship an externally-bound draft against an uncalibrated voice envelope.
- `citation_in_source`: a citation-shaped string appears in a matter custom_field that the skill would otherwise carry through into a non-quoted section. The substrate-level citation filter blocks; the skill refuses and escalates to the partner.

When the skill can author a partial draft (some sections sourced, some TBD), it proceeds. When it cannot meet a refusal criterion, it writes no draft and logs the refusal.

## What good looks like

A successful run satisfies all of:

1. The draft lands in the supervising partner's drafts folder (not the agent's AgentMail identity), confirmed by the adapter's `DraftRef.folder` field matching the partner's drafts path.
2. Every authored figure (medical specials total, per-provider billing, lost-wages total, treatment dates, provider names, dates of incident) is sourced from a `StoredDocument.id` or a `matter.custom_fields.<key>`, recorded in the sourcing note.
3. The four legal-judgment sections (`liability_characterization`, `settlement_bracket_prose`, `demand_amount`, `case_strategy_language`) all render as TBD markers. None contain plausible-but-inferred prose.
4. No citation-shaped string appears anywhere in the draft (citation-refusal substrate verifies post-emit).
5. The fabrication filter returns `clean` (no `none`-tagged field rendered non-empty; every `matter_attribute`/`system_of_record` field has a present source_id).
6. The voice-gate score against the Layer 2 partner corpus is above the configured threshold (per `voice-gate-fallback.md` spec).
7. The draft is scannable by the partner in under five minutes: header, recipient, recitals (factual), chronology, tabulations, exhibit list, TBD sections, sign-off block. Every TBD marker is one line, in brackets, with a hint to what the partner authors.

## References

- `references/voice.md` — partner-corpus voice rules with positive and negative examples specific to PI demand letters; banned patterns; sentence-length envelope; Layer 2 match criterion.
- `references/output-format.md` — exact section order and section templates for the draft, with one fully-sourced example and one heavily-TBD example.
- `references/categorization-rubric.md` — rules for classifying a matter as ready / not-ready for demand letter draft; severity gates; missing-data thresholds.
- `references/citation-policy.md` — the absolute prohibition on legal citations and the standard refusal language; pointer to the citation-refusal substrate.
- `references/fabrication-policy.md` — the per-section sourcing contract; the mapping between `client_facing_fields` frontmatter and rendered sections; TBD-marker language by section.
- `references/test-cases.md` — which fixtures exercise which behaviors and what the skill must produce for each.

## Related PRD and ADR references

- ADR 0005 (reviewer-as-sender) — `Email.create_draft` into the partner's drafts folder, no send method, no agent persona externally.
- ADR 0006 (capability-adapter pattern) — the skill calls `PracticeManagement`, `DocumentStorage`, and `Email` interfaces, never vendor SDKs.
- Platform PRD §7.5 invariant #6 — citation-refusal (vertical: law-firm).
- Platform PRD §7.5 invariant #8 — fabrication discipline; this skill is one of the load-bearing test cases.
- Platform PRD §8.4 — skill anatomy. Voice rules front-loaded in description per Phase A.6.
- Platform PRD §9 — persona and voice model; Layer 2 anchor corpus minimum.
- Platform PRD §11.2 — default trust ceiling `draft_for_review`, locked for judgment-bearing work.
- Law-firm PRD §6.2 / §12.1 — scope-alignment note above explains the relationship between this skill and the deferred `pi-demand-letter-text-only` skill.
