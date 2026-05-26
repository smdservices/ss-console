---
name: law-pi-discovery-response
description: 'Drafts factual PI discovery-response objections for partner.'
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: []
  commands: []
metadata:
  hermes:
    tags: [Law, PI, Discovery, Response, Draft]
  smd:
    vertical: law-firm-pi
    trust_ceiling: draft_for_review
    trust_ceiling_locked: true
    capabilities: [PracticeManagement, DocumentStorage, Email]
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
      - name: discovery_request_kind
        sourced_from: system_of_record
      - name: discovery_request_number_list
        sourced_from: system_of_record
      - name: discovery_request_text_per_number
        sourced_from: system_of_record
      - name: response_due_date
        sourced_from: system_of_record
      - name: responsive_document_index_per_request
        sourced_from: system_of_record
      - name: privilege_log_document_index
        sourced_from: system_of_record
      - name: objection_category_per_request
        sourced_from: memory_rule
      - name: substantive_answer_per_request
        sourced_from: none
      - name: privilege_claim_characterization
        sourced_from: none
      - name: admission_or_denial_per_request
        sourced_from: none
      - name: case_strategy_language
        sourced_from: none
      - name: partner_signoff
        sourced_from: memory_rule
---

# Law PI Discovery Response Draft (Factual Assembly)

Reads one inbound discovery request from opposing counsel on an active personal-injury matter and writes a factual response draft into the supervising partner's drafts folder. The skill writes the objections list (category labels only, no citations), the responsive-document list (every entry sourced from a specific `StoredDocument.id`), and the privilege log skeleton (per-document, privilege-claim type as TBD). The partner authors the substantive answers, the privilege-claim characterization, the admission or denial language, and any case-strategy language. The skill never sends. The skill never quotes case law, statutes, or court rules. The partner reviews, fills in the TBD sections, edits, and clicks send from their own mail client.

The skill is configured per-customer through `~/.hermes/customers/{customer_slug}/customer.yaml`, which supplies the firm name, the supervising partner's first name and signature block, the partner's reviewer email account ID for `Email.create_draft`, the firm's voice samples for Layer 2 voice match, the firm's standard objection-category vocabulary as a memory rule, and the practice-area filter.

## When to Use

Use when opposing counsel has served interrogatories, requests for production, or requests for admission on an active PI matter and the supervising partner needs a factual response draft assembled. The skill produces three artifacts inside one draft: an objections list (categorical, citation-free), a responsive-document list (sourced from DocumentStorage), and a privilege log skeleton with TBD privilege-claim type. The partner authors the substantive answers.

## Prerequisites

PracticeManagement, DocumentStorage, and Email capability adapters; per-customer config at `~/.hermes/customers/{customer_slug}/customer.yaml` including Layer 2 voice samples and the firm's objection-category vocabulary memory rule. See frontmatter.

## How to Run

Draft from a matter ID and an incoming discovery-request document already in the matter folder:

```
hermes run law-pi-discovery-response --matter-id <id> --request-document-id <doc_id>
```

Draft from a matter ID and a raw request file (PDF or text) the partner saves to the matter folder mid-invocation:

```
hermes run law-pi-discovery-response --matter-id <id> --request-file <path>
```

Dry-run (writes the draft to `~/.hermes/customer_notes/{customer_slug}/` and returns the path; does not call `Email.create_draft`):

```
hermes run law-pi-discovery-response --matter-id <id> --request-document-id <doc_id> --dry-run
```

## Procedure

The skill runs in three phases. Customer-config gating and request-load run in the parent. Three parallel subagents do the research. The parent validates an assembly-time schema contract before assembling the draft (ADR 0021 Stream C); on any incomplete return, the parent emits `SUBAGENT_INCOMPLETE` and refuses — a reviewer-as-sender never sees a quietly incomplete draft.

The detailed per-step rules, per-subagent required-key lists, and parent assembly logic live in `references/algorithm.md`. This section is the dispatch shape; that is the depth.

### Phase 1 — Parent preflight

1. **Load customer config** from `~/.hermes/customers/{customer_slug}/customer.yaml`. Refuse with `out_of_scope` if `practice_areas` does not include `personal-injury`. Refuse with `voice_samples_missing` if Layer 2 voice samples are below the PRD §9.6 Gate 1 minimum.
2. **Load the matter** via `practice_management.get_matter(matter_id)`. Refuse with `matter_not_found`, `matter_wrong_type`, or `matter_closed` per the refusal cases below.
3. **Load the discovery request document** via `document_storage.download_document(request_document_id)` (or read in-process if `--request-file` is supplied without `--stage-request`).
4. **Refusal preflight.** Check `objection_vocabulary_missing` (memory rule absent), `citation_in_source` (citation-shaped string in a partner-authored narrative field the skill would otherwise read into its prose), and `request_unparseable` (preflight parse fails to find any numbered items). Short-circuit before any delegation.

### Phase 2 — Delegate three subagents in parallel

Use Hermes' `delegate_task` to spawn three isolated subagents concurrently. Each gets a restricted toolset (default Hermes delegation policy blocks `delegation`, `memory`, `code_execution`, `send_message`, and write capabilities for leaf subagents).

| Sub-role | Goal | Required return keys |
|---|---|---|
| `interrogatory_map` | Parse numbered requests from incoming request body; detect request kind; identify response due date; map each numbered item to firm's categorical objection vocabulary | `numbered_requests` (≥1 row), `request_kind` (one of `interrogatories` \| `requests_for_production` \| `requests_for_admission` \| `combined`), `response_due_date` (ISO date OR explicit-TBD marker), `per_request_objections` (one entry per numbered request, may carry empty category list per-request) |
| `privilege_log_findings` | Scan matter folder for documents that may be withheld under privilege; build the privilege log skeleton (no privilege-claim characterization — that's TBD per the fabrication contract) | `privilege_candidates` (list of `{document_id, classification, reason_for_flag}`, may be empty if no candidates), `privilege_log_rows` (one row per candidate with `document_id`, `filename`, `date`, `author`, `recipient`; `privilege_claim_type` is NOT returned — it's a partner-authored TBD) |
| `supporting_docs` | Map each numbered request to a responsive-document list from the matter folder (for RFPs and for RFA/interrogatory requests that reference documents) | `per_request_responsive_docs` (one entry per numbered request; each entry is `{request_number, responsive_docs: [...]}` where responsive_docs may be empty per-request) |

The Hermes runtime emits one `SUBAGENT_STOPPED` audit row per child via the overlay's `hermes-smd-audit` plugin (`subagent_stop` hook). The parent waits for all three to return before proceeding.

### Phase 3 — Parent assembly with schema contract

1. **Validate each subagent's return against its required-keys list.** Strict: missing key OR empty required value triggers refusal.
2. **On any contract failure:** emit one `audit_action="SUBAGENT_INCOMPLETE"` row with metadata (`subagent_role`, `missing_key`, `matter_ref` hashed, `expected_min`). Write a refusal note to `~/.hermes/customer_notes/{customer_slug}/pi-discovery-incomplete-YYYY-MM-DD-<matter-id>.md`. **Do NOT call `Email.create_draft`.** Surface the failure via the same escalation channel as `request_unparseable`.
3. **Cross-subagent consistency check.** `interrogatory_map.numbered_requests` count MUST equal `supporting_docs.per_request_responsive_docs` count. A mismatch is a `SUBAGENT_INCOMPLETE` refusal — the parent does not paper over the inconsistency by assembling a draft with mismatched rows.
4. **On contract pass:**
   - Insert TBD markers for the partner-authored sections per the `client_facing_fields` frontmatter: `substantive_answer_per_request`, `privilege_claim_characterization`, `admission_or_denial_per_request`, `case_strategy_language`. One TBD marker per applicable numbered request or privilege-log row.
   - Voice-gate check against the Layer 2 partner corpus (per `voice-gate-fallback.md`). Failing voice score → emit the structured-table-only variant; partner authors the lead-ins.
   - Call `Email.create_draft` per ADR 0005 (`reviewer_account_id` = supervising partner; `to` = opposing counsel email or empty; `subject` from matter attributes + parsed `request_kind`; `body_text` + `body_html` from `references/output-format.md`).
   - Write the matter-internal sourcing note enumerating which `StoredDocument.id` populated each responsive-document row, which `custom_field` populated each named field, which memory rule populated each objection category, and which fields rendered as TBD with the source-absence reason.
   - Emit telemetry (matter id hashed, request kind, numbered-request count, TBD-marker count by section, voice-gate score, privilege-log row count, draft size, adapter calls, per-subagent `duration_ms`).

The full per-subagent contract, per-row source policy, cross-subagent consistency rules, and assembly-rule detail live in `references/algorithm.md`.

### Trust Ceiling

`draft_for_review`. The ceiling is **locked at v1 and cannot be promoted to `autonomous`** per PRD §11.2 ("anything touching trust accounting, court filing, settlement authority, judgment-bearing work: `draft_for_review` permanently"). A discovery response is a court filing once served, touches privilege claims by definition, and shapes the case's evidentiary record; promotion is architecturally blocked.

The agent MAY:

- Read the matter via `PracticeManagement.get_matter` (read-only).
- Read matter documents via `DocumentStorage.list_folder` and `DocumentStorage.download_document` (read-only).
- Write the draft via `Email.create_draft` into the supervising partner's drafts folder (the only outbound surface in the Email interface; per ADR 0005 there is no send path).
- Write the matter-internal sourcing note inside `~/.hermes/customer_notes/{customer_slug}/`.

The agent MUST NOT, without explicit partner instruction in a different invocation:

- Modify or create any PracticeManagement record (matter, contact, time entry, document).
- Upload, modify, or delete any document via DocumentStorage. Reads only, except for the optional `--stage-request` path that uploads the partner-supplied request file into the matter folder so the response thread references a stable document id.
- Send any email. The Email interface has no send method by design (ADR 0005); attempting to send via any side channel is a critical safety violation and the runtime refuses.
- Author the substantive answer to any interrogatory.
- Author the substantive objection prose. Category labels are authored from the memory-rule vocabulary; the objection sentences are partner work.
- Author the privilege claim type for any privilege-log row.
- Author the admission or denial for any request for admission.
- Author any case-strategy language, including statements about discovery posture, motion-to-compel risk, or sanctions exposure.
- Quote, restate, or augment any case law, statute, court rule, or treatise reference.
- Compute or assert a response deadline beyond what the matter custom_fields and the firm's per-jurisdiction rule supply. If the deadline cannot be sourced, the field is TBD.

If the skill cannot find a piece of source data the partner expects (e.g., the opposing-counsel email), the draft renders the corresponding section as a TBD marker and the matter-internal sourcing note lists the missing item. The partner sees the TBD on review and fills it in. The skill does not guess.

### Voice Rules (Layer 2 - partner corpus match)

The factual prose sections (recitation lead-in, request-by-request table headers, responsive-document captions, privilege-log column captions) must read as if the supervising partner wrote them. Voice samples from `customer.yaml` Layer 2 provide the anchor corpus. The partner's prior discovery responses and prior opposing-counsel correspondence are the primary samples for this skill. See `references/voice.md` for the long form. Hard rules:

- **No em dashes anywhere.** Commas, periods, short sentences. The dash character is banned in section headers, table delimiters, captions, and prose alike.
- **No "I hope this email finds you well." No "Just wanted to touch base." No "Reach out."** No "Please don't hesitate." No "Per our records." No "At this time."
- **No corporate filler vocabulary:** circle back, leverage, level-set, deep dive, double-click, table this, ping me, action item, bandwidth.
- **No legal conclusions in any section the skill authors.** Never "your request is plainly overbroad," "the privilege clearly applies," "the document is plainly irrelevant." Category labels are facts about which objection category the request matches against the firm's vocabulary; the legal characterization is the partner-authored TBD section.
- **No commitment language.** Never "we refuse to produce," "we will not respond," "our client denies." All such language is the partner-authored sections.
- **No tentative hedges that fake certainty:** "I believe," "it appears," "in our view." If the responsive-document row is sourced, the row is stated. If it is not, the row is TBD.
- **Active voice.** "The request seeks documents already in opposing counsel's possession" not "documents already in opposing counsel's possession are sought by the request."
- **Short sentences.** One idea per sentence usually. Long sentences are reserved for nuanced category mapping, not for sounding lawyerly.
- **Sign-off uses the supervising partner's name and signature block from `customer.yaml`.** Never "Best regards," "Warm regards," "Sincerely yours," "Cheers." The partner's actual close is what the customer's voice samples capture.
- **No emojis. No exclamation points anywhere.**

If the assembled prose cannot pass these rules (e.g., the category mapper produces awkward lead-ins for a hybrid interrogatories-plus-RFP filing), the skill omits the prose and emits only the structured tables, captions, and TBD markers. The partner prefers structured rows to expand than a flawed paragraph to dismantle.

### Citation Policy (law-firm vertical, invariant #6)

The skill must never produce, repeat, or reformulate legal citations. Case-name-shaped strings with reporter cites (e.g., `Smith v. Jones, 123 F.3d 456 (3d Cir. 2010)`), statute references (e.g., `42 U.S.C. § 1983`), court rule references (e.g., `Fed. R. Civ. P. 26(b)(1)`, `Ariz. R. Civ. P. 33`), and treatise pinpoint cites are all in scope. The skill renders objection category labels only; the formal-response objection sentences that often cite a court rule are partner-authored TBD sections.

If the incoming request body contains citations supplied by opposing counsel (e.g., a cover letter citing a recent case on proportionality), the skill carries them through verbatim only inside the "incoming request recital" section (which is a verbatim quote of the request, not skill prose) and inside partner-authored TBD section markers. The skill never paraphrases, restates, or summarizes such citations in its own prose. If the matter record contains citations in partner-authored narrative notes that the skill would otherwise read into its own factual prose (e.g., a `case_summary` custom_field), the skill triggers the readiness rubric's `PROPAGATION_RISK` value (see `references/categorization-rubric.md` axis 5) and refuses with `citation_in_source`.

If the assembled draft would otherwise contain a citation-shaped string in skill-authored prose, the skill replaces the string with `[CITATION REMOVED - partner inserts after review]` and logs a citation-refusal event. Code-level enforcement lives in the citation-refusal substrate at `ai-employee/safety-substrate/citation_filter.py`; the skill's prompt-level discipline is defense in depth. See `references/citation-policy.md`.

### Fabrication Policy (platform invariant #8)

Every client-facing field is declared in the skill's frontmatter `client_facing_fields` block with one of: `matter_attribute`, `system_of_record`, `memory_rule`, `none`. Fields tagged `none` MUST render as a TBD marker; rendering plausible content into a `none`-tagged field is a `block`-severity fabrication-filter violation per the spec at `docs/specs/ai-employee/fabrication-filter.md`. The four legal-judgment fields the partner authors (`substantive_answer_per_request`, `privilege_claim_characterization`, `admission_or_denial_per_request`, `case_strategy_language`) are all tagged `none` for exactly this reason: the skill cannot author them, the runtime filter enforces non-rendering, and the draft surfaces a TBD marker the partner fills in.

The `objection_category_per_request` field is tagged `memory_rule` rather than `none`: the firm authors a categorical objection vocabulary in customer.yaml's memory rules, and the skill matches request text against that vocabulary. The category labels are not legal conclusions; they are pointers to the partner-authored memory rule. The objection sentences that cite Fed. R. Civ. P. 26 or its state-court analogues are partner-authored TBD sections.

See `references/fabrication-policy.md` for the per-section sourcing contract.

### Refusal Cases

The skill emits a refusal (writes no draft, returns a structured error) under any of:

- `out_of_scope`: the customer's `practice_areas` does not include `personal-injury`.
- `matter_not_found`: `PracticeManagement.get_matter(id)` returns null.
- `matter_wrong_type`: `matter.matter_type` is not a PI variant.
- `matter_closed`: `matter.status` is `closed`. Discovery responses are not issued on closed matters; the partner re-opens the matter or declines to respond.
- `request_unparseable`: the discovery request body cannot be parsed into discrete numbered items. The partner surfaces a clean copy or re-OCRs the source.
- `objection_vocabulary_missing`: `customer.yaml.memory_rules.objection_categories` is missing or empty. The firm authors the vocabulary; the skill refuses rather than ship a draft with no category labels.
- `voice_samples_missing`: `customer.yaml` Layer 2 voice samples count is below the PRD §9.6 Gate 1 minimum (30 samples). The skill refuses rather than ship an externally-bound draft against an uncalibrated voice envelope.
- `citation_in_source`: a citation-shaped string appears in a matter custom_field that the skill would otherwise carry through into a non-quoted section. The substrate-level citation filter blocks; the skill refuses and escalates to the partner.

When the skill can author a partial draft (some sections sourced, some TBD), it proceeds. When it cannot meet a refusal criterion, it writes no draft and logs the refusal.

## Pitfalls

See `### Refusal Cases` in Procedure. Common failure modes also include emitting a citation-shaped string in skill-authored prose, authoring objection prose rather than just category labels, and inventing responsive documents when none match.

## Verification

A successful run satisfies all of:

1. The draft lands in the supervising partner's drafts folder (not the agent's AgentMail identity), confirmed by the adapter's `DraftRef.folder` field matching the partner's drafts path.
2. Every numbered request from the incoming filing appears as one row in the response table, with the verbatim request text carried through unchanged.
3. Every responsive-document row is sourced from a `StoredDocument.id` recorded in the sourcing note. No invented documents. No invented filenames. No invented dates.
4. Every privilege-log row records the metadata the partner needs (document ID, filename, date, author, recipient) and renders the privilege-claim type as a TBD marker. None contain a partner-authored privilege characterization.
5. The four legal-judgment sections (`substantive_answer_per_request`, `privilege_claim_characterization`, `admission_or_denial_per_request`, `case_strategy_language`) all render as TBD markers. None contain plausible-but-inferred prose.
6. No citation-shaped string appears anywhere in skill-authored sections (citation-refusal substrate verifies post-emit). Citation strings inside the verbatim-quoted incoming request and inside partner-authored TBD sections are not the skill's authoring and are out of scope for the substrate's authoring check.
7. The fabrication filter returns `clean` (no `none`-tagged field rendered non-empty; every `matter_attribute`/`system_of_record` field has a present source_id; every `memory_rule` field has a present rule_id).
8. The voice-gate score against the Layer 2 partner corpus is above the configured threshold (per `voice-gate-fallback.md` spec).
9. The draft is scannable by the partner in under ten minutes: header, recipient, response-due-date line, incoming-request recital, per-request response table (with category labels and responsive-document rows), privilege log skeleton, TBD sections, sign-off block. Every TBD marker is one line, in brackets, with a hint to what the partner authors.

## References

- `references/algorithm.md` - detailed parent preflight rules, per-subagent contracts (required return keys + per-row source policy), cross-subagent consistency rules, and parent assembly logic. The source of truth for what "good discovery-response assembly" looks like (ADR 0021 Stream C - extracted from the prior 14-step `## Procedure` after the `delegate_task` migration).
- `references/voice.md` - partner-corpus voice rules with positive and negative examples specific to PI discovery responses; banned patterns; sentence-length envelope; Layer 2 match criterion.
- `references/output-format.md` - exact section order and section templates for the draft, with one example per request kind (interrogatories, RFPs, RFAs) and one privilege-log skeleton.
- `references/categorization-rubric.md` - rules for classifying a matter as ready / not-ready for discovery-response draft; severity gates; missing-data thresholds; the objection-category memory-rule contract.
- `references/citation-policy.md` - the absolute prohibition on legal citations and the standard refusal language; the verbatim-quote carve-out for incoming requests; pointer to the citation-refusal substrate.
- `references/fabrication-policy.md` - the per-section sourcing contract; the mapping between `client_facing_fields` frontmatter and rendered sections; TBD-marker language by section.
- `references/test-cases.md` - which fixtures exercise which behaviors and what the skill must produce for each.

## Related PRD and ADR references

- ADR 0005 (reviewer-as-sender) - `Email.create_draft` into the partner's drafts folder, no send method, no agent persona externally.
- ADR 0006 (capability-adapter pattern) - the skill calls `PracticeManagement`, `DocumentStorage`, and `Email` interfaces, never vendor SDKs.
- Platform PRD §7.5 invariant #6 - citation-refusal (vertical: law-firm).
- Platform PRD §7.5 invariant #8 - fabrication discipline; this skill is one of the load-bearing test cases.
- Platform PRD §8.4 - skill anatomy. Voice rules front-loaded in description per Phase A.6.
- Platform PRD §9 - persona and voice model; Layer 2 anchor corpus minimum.
- Platform PRD §11.2 - default trust ceiling `draft_for_review`, locked for judgment-bearing work.
- Law-firm PRD §5 - third-rail map (discovery + investigation is Pillar 5; medium third-rail risk; the load-bearing risks are privilege-waiver and sanctions exposure, both of which this skill avoids by leaving the substantive answer and privilege-claim characterization as TBD).
- Law-firm PRD §6.2 - pillar map; this skill operationalizes the discovery-response scenario.
- Law-firm PRD §11.2 - demo scenario list; "an opposing counsel discovery request - needs triage and partner review" is the scenario this skill addresses.

## Scope alignment with law-firm-prd §6.2 and §5

The law-firm PRD §6.2 places discovery work in Pillar 5 (Discovery + investigation) and characterizes it as agent-suitable with medium third-rail risk. The PRD does not list a specific `pi-discovery-response` skill name; this skill operationalizes the discovery-response scenario from §11.2 ("an opposing counsel discovery request - needs triage and partner review") as a factually-narrow draft assembler.

The factually-narrow scope:

- Parsing the incoming request into numbered items is authored by the skill.
- Mapping each item to a categorical objection label from the firm's memory-rule objection vocabulary is authored by the skill.
- Mapping each item to a responsive-document list (with specific `StoredDocument.id` per entry) is authored by the skill.
- Building the privilege log skeleton (one row per withheld document, with filename, date, and author from DocumentStorage metadata) is authored by the skill.
- Substantive answers to interrogatories, the legal characterization of each privilege claim, the admit or deny language for each request for admission, and any case-strategy framing are NOT authored by the skill. They render as TBD markers for the partner to author.

The skill name `law-pi-discovery-response` is operational shorthand for this factually-narrow variant. If Captain decides this scope creeps too close to substantive-answer authoring, the fix is configuration: narrow the objection list to a pure category-label table (no draft objection sentence), narrow the responsive-document mapping to a flat index, or hold the skill for Phase 3.
