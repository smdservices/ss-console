---
name: settlement-prep
description: 'Drafts internal PI settlement-prep memo for partner.'
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: []
  commands: []
metadata:
  hermes:
    tags: [Law, PI, Settlement, Prep, InternalMemo, Draft]
  smd:
    vertical: law-firm-pi
    trust_ceiling: draft_for_review
    trust_ceiling_locked: true
    capabilities: [PracticeManagement, DocumentStorage, Email]
    client_facing_fields:
      - name: client_name
        sourced_from: matter_attribute
      - name: claim_number
        sourced_from: matter_attribute
      - name: case_caption
        sourced_from: matter_attribute
      - name: case_number
        sourced_from: matter_attribute
      - name: date_of_incident
        sourced_from: matter_attribute
      - name: incident_location
        sourced_from: matter_attribute
      - name: opposing_counsel_name
        sourced_from: matter_attribute
      - name: opposing_counsel_firm
        sourced_from: matter_attribute
      - name: opposing_carrier_name
        sourced_from: matter_attribute
      - name: settlement_conference_date
        sourced_from: matter_attribute
      - name: medical_provider_list
        sourced_from: system_of_record
      - name: medical_specials_total
        sourced_from: system_of_record
      - name: billing_document_index
        sourced_from: system_of_record
      - name: lost_wages_total
        sourced_from: system_of_record
      - name: employment_verification_document_index
        sourced_from: system_of_record
      - name: incident_evidence_document_index
        sourced_from: system_of_record
      - name: chronology_event_list
        sourced_from: system_of_record
      - name: strengths_fact_list
        sourced_from: system_of_record
      - name: weaknesses_fact_list
        sourced_from: system_of_record
      - name: comparable_verdict_table
        sourced_from: memory_rule
      - name: opposing_counsel_prior_pattern_table
        sourced_from: memory_rule
      - name: carrier_prior_pattern_table
        sourced_from: memory_rule
      - name: settlement_bracket_recommendation
        sourced_from: none
      - name: recommended_posture
        sourced_from: none
      - name: strengths_legal_argument_prose
        sourced_from: none
      - name: weaknesses_legal_argument_prose
        sourced_from: none
      - name: case_strategy_language
        sourced_from: none
      - name: partner_signoff
        sourced_from: memory_rule
---

# Law PI Settlement Negotiation Prep Memo (Internal, Factual Assembly)

Reads one active personal-injury matter at the pre-settlement-conference stage and writes a factual prep memo into the supervising partner's drafts folder. The memo is internal. The recipient is the partner's own mailbox. The skill never addresses opposing counsel, the mediator, the carrier, or the client. The partner reviews the assembled facts, fills in the TBD sections (settlement bracket recommendation, recommended posture, legal-argument framing), edits, and uses the memo to walk into the settlement conference prepared.

The skill is configured per-customer through `~/.hermes/customers/{customer_slug}/customer.yaml`, which supplies the firm name, the supervising partner's first name and signature block, the partner's reviewer email account ID for `Email.create_draft`, the firm's voice samples for Layer 2 voice match, the firm's comparable-verdict memory rule (the cited verdict corpus the firm has authored), the firm's opposing-counsel and carrier prior-pattern memory rules, and the practice-area filter.

## When to Use

Use when the supervising partner has a settlement conference scheduled for one active PI matter and needs an internal prep memo assembled. The skill writes the matter-facts summary, chronology, damages tabulation, sourced strengths and weaknesses fact lists, comparable-verdict table from the firm's memory rule, and opposing-counsel and carrier prior-pattern tables. The partner authors the settlement bracket recommendation, recommended posture, and legal-argument framing as TBD sections.

## Prerequisites

PracticeManagement, DocumentStorage, and Email capability adapters; per-customer config at `~/.hermes/customers/{customer_slug}/customer.yaml` including Layer 2 voice samples (with internal-memo-tagged samples), the firm's comparable-verdict memory rule, and the opposing-counsel and carrier prior-pattern memory rules. See frontmatter.

## How to Run

Generate a prep memo from a matter ID and a settlement-conference date already in `matter.custom_fields`:

```
hermes run settlement-prep --matter-id <id>
```

Generate from a matter ID with an explicit conference date the partner supplies at invocation (overrides the matter custom_field):

```
hermes run settlement-prep --matter-id <id> --conference-date <YYYY-MM-DD>
```

Dry-run (writes the memo to `~/.hermes/customer_notes/{customer_slug}/` and returns the path; does not call `Email.create_draft`):

```
hermes run settlement-prep --matter-id <id> --dry-run
```

## Procedure

The skill runs in three phases. Customer-config gating, matter load, and conference-date verification run in the parent. Three parallel subagents do the research (opposing-counsel + carrier history from EmailThread and memory rules; damages tabulation from documents; liability + strengths/weaknesses fact-list from custom_fields + documents). The parent validates an assembly-time schema contract before assembling the memo (ADR 0021 Stream C); on any incomplete return, the parent emits `SUBAGENT_INCOMPLETE` and refuses — a reviewer-as-sender never sees a quietly incomplete prep memo.

The detailed per-step rules, per-subagent required-key lists, parent-level memory-rule lookups (comparable-verdict table), and assembly logic live in `references/algorithm.md`. This section is the dispatch shape; that is the depth.

### Phase 1 — Parent preflight

1. **Load customer config** from `~/.hermes/customers/{customer_slug}/customer.yaml`. Read firm name, supervising partner's reviewer account ID, signature block, voice samples (Layer 2), the firm's comparable-verdict memory rule, the firm's opposing-counsel prior-pattern memory rule, the firm's carrier prior-pattern memory rule, and the practice-area filter. Refuse with `out_of_scope` if `practice_areas` does not include `personal-injury`. Refuse with `voice_samples_missing` if Layer 2 samples are below the PRD §9.6 Gate 1 minimum.
2. **Load the matter** via `practice_management.get_matter(matter_id)`. Refuse with `matter_not_found`, `matter_wrong_type`, or `matter_closed` per the refusal cases below.
3. **Verify the conference date.** Read `matter.custom_fields.settlement_conference_date` or the `--conference-date` override. Refuse with `conference_date_missing` if neither is present. The skill never invents a conference date. If the date is in the past, proceed but flag in the sourcing note.
4. **Refusal preflight.** Check `comparable_verdict_corpus_missing` (and honor the partner's `--no-comparable-verdicts` opt-in flag), `citation_in_source` (citation-shaped string in a partner-authored narrative field the skill would otherwise read into prose). Short-circuit before any delegation.

### Phase 2 — Delegate three subagents in parallel

Use Hermes' `delegate_task` to spawn three isolated subagents concurrently. Each gets a restricted toolset (default Hermes delegation policy blocks `delegation`, `memory`, `code_execution`, `send_message`, and write capabilities for leaf subagents).

| Sub-role                   | Goal                                                                                                                                                                           | Required return keys                                                                                                                                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opposing_counsel_history` | Pull all prior correspondence threads with opposing counsel via EmailThread; match `opposing_counsel_name` + `opposing_carrier_name` against firm's prior-pattern memory rules | `thread_summary` (≥1 sourced thread row OR explicit-TBD if no prior correspondence), `prior_offers` (list of `{offer_amount, offer_date, source_doc_id}`, may be empty), `opposing_counsel_pattern` (memory-rule row OR explicit corpus-absent marker), `carrier_pattern` (memory-rule row OR explicit corpus-absent marker) |
| `damages_summary`          | Tabulate medical specials (per-provider, per-date) and lost wages (per-pay-period) from documents in the matter folder                                                         | `medical_specials_total` (numeric OR explicit-TBD), `per_provider_billing` (≥1 row OR explicit-TBD), `lost_wages_total` (numeric OR explicit-TBD), `other_damages` (list of `{kind, amount, source_doc_id}`, may be empty)                                                                                                   |
| `liability_summary`        | Assemble matter-facts summary, chronology, and sourced strengths + weaknesses fact lists from custom_fields + incident docs                                                    | `date_of_incident`, `incident_location`, `client_role`, `factual_chronology` (≥3 sentences), `chronology_events` (≥1 sourced row), `strengths_facts` (≥1 sourced row OR explicit "no clear sourced strengths identified"), `weaknesses_facts` (≥1 sourced row OR explicit "no clear sourced weaknesses identified")          |

The Hermes runtime emits one `SUBAGENT_STOPPED` audit row per child via the overlay's `hermes-smd-audit` plugin (`subagent_stop` hook). The parent waits for all three to return before proceeding.

### Phase 3 — Parent assembly with schema contract

1. **Validate each subagent's return against its required-keys list.** Strict: missing key OR empty required value triggers refusal.
2. **On any contract failure:** emit one `audit_action="SUBAGENT_INCOMPLETE"` row with metadata (`subagent_role`, `missing_key`, `matter_ref` hashed, `expected_min`). Write a refusal note to `~/.hermes/customer_notes/{customer_slug}/pi-settlement-prep-incomplete-YYYY-MM-DD-<matter-id>.md`. **Do NOT call `Email.create_draft`.** Surface the failure via the same escalation channel as `comparable_verdict_corpus_missing`.
3. **On contract pass:**
   - **Parent-level memory-rule lookup: comparable-verdict table.** Match the assembled damages + liability profile (matter_type, injury severity inferred from medical-record classifications, liability profile inferred from the strengths/weaknesses balance, jurisdiction from `case_court` custom_field) against the firm's comparable-verdict memory rule. Surface verbatim rows that match all partner-authored criterion fields. Stale or withdrawn rows do not surface. If no rows match, the table renders the corpus-absent prose; the skill never invents verdicts, extrapolates from partial matches, or generalizes from one row to a range.
   - Insert TBD markers for the five partner-authored sections per the `client_facing_fields` frontmatter: `settlement_bracket_recommendation`, `recommended_posture`, `strengths_legal_argument_prose`, `weaknesses_legal_argument_prose`, `case_strategy_language`.
   - Voice-gate check against the Layer 2 partner internal-memo corpus (per `voice-gate-fallback.md`). Failing voice score → emit the structured-table-only variant; partner authors the lead-ins.
   - Call `Email.create_draft` per ADR 0005 (`reviewer_account_id` = supervising partner; `to` = supervising partner's direct_email — internal recipient by design; `subject` = `Settlement Conference Prep: <case caption>, <case number>, <conference date>`; `body_text` + `body_html` from `references/output-format.md`).
   - Write the matter-internal sourcing note enumerating which `StoredDocument.id` populated each damages-table row, which `custom_field` populated each named field, which memory-rule rows populated the comparable-verdict and prior-pattern tables, and which fields rendered as TBD with the source-absence reason.
   - Emit telemetry (matter id hashed, conference-date relative offset, strength-fact count, weakness-fact count, comparable-verdict row count, opposing-counsel-pattern row count, carrier-pattern row count, TBD-marker count, voice-gate score, memo size, adapter calls, per-subagent `duration_ms`).

The full per-subagent contract, per-row source policy, parent-level memory-rule lookup rules, and assembly-rule detail (including why three subagents and not the original 17 sequential steps) live in `references/algorithm.md`.

### Trust Ceiling

`draft_for_review`. The ceiling is **locked at v1 and cannot be promoted to `autonomous`** per PRD §11.2 ("anything touching trust accounting, court filing, settlement authority, judgment-bearing work: `draft_for_review` permanently"). A settlement-conference prep memo informs settlement-authority decisions by definition. Promotion is architecturally blocked.

The agent MAY:

- Read the matter via `PracticeManagement.get_matter` (read-only).
- Read matter documents via `DocumentStorage.list_folder` and `DocumentStorage.download_document` (read-only).
- Read the firm's comparable-verdict, opposing-counsel prior-pattern, and carrier prior-pattern memory rules.
- Write the memo via `Email.create_draft` into the supervising partner's drafts folder (no send path; the memo is internal so the partner is the recipient, but `Email.create_draft` remains the only outbound surface).
- Write the matter-internal sourcing note inside `~/.hermes/customer_notes/{customer_slug}/`.

The agent MUST NOT, without explicit partner instruction in a different invocation:

- Modify or create any PracticeManagement record (matter, contact, time entry, document).
- Upload, modify, or delete any document via DocumentStorage. Reads only.
- Send any email. The Email interface has no send method by design (ADR 0005).
- Author a settlement bracket recommendation, a dollar range, a midpoint, or any other numeric anchor not present in the firm's comparable-verdict memory rule.
- Author a recommended posture, an open-low / open-high suggestion, an anchor strategy, or a walk-away trigger.
- Author legal-argument framing of strengths or weaknesses. The fact lists are the skill's authoring; the legal characterization is partner work.
- Invent a comparable verdict not present in the firm's memory-rule corpus.
- Extrapolate from a partially-matching memory-rule row to a "near-comparable" row.
- Average or otherwise aggregate the verdict amounts in the memory rule to produce a derived figure.
- Author qualitative inferences about opposing counsel or carrier behavior beyond what the partner already authored in the prior-pattern memory rules.
- Quote, restate, or augment any case law, statute, court rule, or treatise reference. Citations inside the verbatim comparable-verdict rows are partner authoring and exempt under the verbatim-quote carve-out; the skill never paraphrases or extends them.

If the skill cannot find a piece of source data the partner expects (e.g., the carrier name is missing on the matter), the memo's corresponding section renders as a TBD marker and the sourcing note lists the missing item. The partner sees the TBD on review and fills it in. The skill does not guess.

### Voice Rules (Layer 2 - partner internal-memo corpus match)

The factual prose sections (matter-facts summary, chronology lead-in, damages-table captions, strengths and weaknesses list lead-ins) must read as if the supervising partner wrote them. The internal-memo envelope differs from the external-correspondence envelope. Internal memos are dense, plain, partner-to-self prose. Voice samples for this skill should be drawn from the partner's prior internal prep memos, case-strategy memoranda, and partner-to-self note files; the firm's external-correspondence voice samples (demand-letter prose, opposing-counsel correspondence) are weaker anchors for this register.

See `references/voice.md` for the long form. Hard rules:

- **No em dashes anywhere.** Commas, periods, short sentences. The dash character is banned in section headers, table delimiters, captions, and prose alike. Markdown tables use ASCII hyphens in the separator row.
- **No "I hope this email finds you well." No "Just wanted to touch base." No "Reach out."** No "Please don't hesitate." No "Per our records." No "At this time."
- **No corporate filler vocabulary:** circle back, leverage, level-set, deep dive, double-click, table this, ping me, action item, bandwidth.
- **No legal conclusions in any section the skill authors.** Never "the comparative-negligence defense is plainly meritless," "the policy limits are obviously inadequate," "causation is settled." The fact lists are facts; the characterization is the partner-authored TBD section.
- **No commitment language.** Never "we will open at," "we will not accept below," "our floor is." All such language is the partner-authored sections.
- **No tentative hedges that fake certainty:** "I believe," "it appears," "in our view." If the chronology event is sourced, the event is stated. If it is not, the event is TBD.
- **Active voice.** "Dr. Chen documented the disc herniation on the May 12 MRI" not "the disc herniation was documented by Dr. Chen on the May 12 MRI."
- **Short sentences.** One idea per sentence usually. Long sentences are reserved for nuanced chronology, not for sounding lawyerly.
- **No emojis. No exclamation points anywhere.**
- **Dollar figures render as `$<digits>` with commas (e.g., `$24,500`).** They appear only in the damages tabulation (sourced from billing statements) and in the comparable-verdict table (verbatim from the memory-rule rows). They never appear in skill-authored prose. The bracket-recommendation section is TBD and contains no figure.

If the assembled prose cannot pass these rules, the skill omits the prose lead-ins and emits the structured tables only. The partner prefers structured rows to expand than a flawed paragraph to dismantle.

### Citation Policy (law-firm vertical, invariant #6)

The skill must never produce, repeat, or reformulate legal citations in skill-authored prose. The comparable-verdict table is the narrow carve-out: the rows surface verbatim from the firm's memory-rule corpus, which the partner authored, and the citation in the row's `source` column is the partner's authoring under the verbatim-quote carve-out.

The skill never:

- Invents a case-name citation.
- Augments or pinpoints a memory-rule row's citation.
- Adds a parallel citation the partner did not author.
- Cites a statute, court rule, or treatise anywhere.
- Restates a citation from the verdict row in the surrounding prose ("As in the Smith matter, the present matter ...").

If a matter custom_field (e.g., `case_summary`) contains citations and the skill would otherwise read it into a factual prose section, the skill triggers the readiness rubric's `PROPAGATION_RISK` value (see `references/categorization-rubric.md` axis 6) and refuses with `citation_in_source`.

If the assembled memo would otherwise contain a citation-shaped string in skill-authored prose (outside the verbatim comparable-verdict rows), the skill replaces the string with `[CITATION REMOVED - partner inserts after review]` and logs a citation-refusal event. Code-level enforcement lives in the citation-refusal substrate at `operator/safety-substrate/citation_filter.py`. See `references/citation-policy.md`.

### Fabrication Policy (platform invariant #8)

Every client-facing field is declared in the skill's frontmatter `client_facing_fields` block with one of: `matter_attribute`, `system_of_record`, `memory_rule`, `none`. Fields tagged `none` MUST render as a TBD marker; rendering plausible content into a `none`-tagged field is a `block`-severity fabrication-filter violation per the spec at `docs/specs/operator/fabrication-filter.md`.

The five legal-judgment fields the partner authors (`settlement_bracket_recommendation`, `recommended_posture`, `strengths_legal_argument_prose`, `weaknesses_legal_argument_prose`, `case_strategy_language`) are all tagged `none`. The runtime filter enforces non-rendering; the memo surfaces a TBD marker the partner fills in.

The comparable-verdict, opposing-counsel-prior-pattern, and carrier-prior-pattern tables are tagged `memory_rule` because each row sources from a partner-authored memory rule. The skill matches matter facts to memory-rule rows; the skill never invents rows; the skill never extrapolates from one row to a range. If the memory rule is empty or stale (no row matches), the field renders the corpus-absent prose, which is functionally equivalent to a TBD but with a more specific hint about where the partner extends the corpus.

The strengths and weaknesses fact lists are tagged `system_of_record` because each fact sources to a specific `StoredDocument.id` or `matter.custom_fields.<field>`. The skill never surfaces an unsourced fact. The skill never characterizes a sourced fact as a legal strength or weakness; the characterization is partner work in the TBD argument-framing sections.

See `references/fabrication-policy.md` for the per-section sourcing contract.

### Refusal Cases

The skill emits a refusal (writes no memo, returns a structured error) under any of:

- `out_of_scope`: the customer's `practice_areas` does not include `personal-injury`.
- `matter_not_found`: `PracticeManagement.get_matter(id)` returns null.
- `matter_wrong_type`: `matter.matter_type` is not a PI variant.
- `matter_closed`: `matter.status` is `closed`. Prep memos are not generated for closed matters; the partner re-opens the matter or assembles the memo by hand.
- `conference_date_missing`: neither `matter.custom_fields.settlement_conference_date` nor `--conference-date` is present.
- `comparable_verdict_corpus_missing`: `customer.yaml.memory_rules.comparable_verdicts` is null or empty AND the partner has not opted into the "proceed without bracket anchor" flag. By default the skill refuses rather than ship a memo with no quantitative anchor; the partner may explicitly invoke with `--no-comparable-verdicts` (logged in the sourcing note) and the memo proceeds with the comparable-verdict table rendered as the corpus-absent TBD.
- `voice_samples_missing`: `customer.yaml` Layer 2 voice samples count is below the PRD §9.6 Gate 1 minimum (30 samples). The skill refuses rather than ship a memo against an uncalibrated voice envelope. The internal-memo voice envelope additionally requires that at least five Layer 2 samples be tagged `internal_prep_memo` or `case_strategy_memo`; if the tagged count is below five, the skill emits a "voice envelope thin" warning in the sourcing note but proceeds (the internal-memo register is lower risk than the external-correspondence register because the audience is the partner).
- `citation_in_source`: a citation-shaped string appears in a matter custom_field that the skill would otherwise carry through into a non-quoted section.

When the skill can author a partial memo (some sections sourced, some TBD), it proceeds. When it cannot meet a refusal criterion, it writes no memo and logs the refusal.

## Pitfalls

See `### Refusal Cases` in Procedure. Common failure modes include authoring a settlement bracket recommendation or recommended posture (both `none`-tagged), inventing or extrapolating from comparable-verdict rows, aggregating verdict amounts to produce a derived figure, and rendering dollar amounts in skill-authored prose outside the damages tabulation and verbatim comparable-verdict rows.

## Verification

A successful run satisfies all of:

1. The memo lands in the supervising partner's drafts folder, confirmed by the adapter's `DraftRef.folder` field matching the partner's drafts path.
2. The matter-facts summary lists every field sourced from `matter.custom_fields` or rendered as a sourced TBD. No invented client names, opposing counsel names, or carrier names.
3. The chronology lists every event from sourced documents. No invented events. No invented dates.
4. The damages tables list every row from sourced billing or lost-wages documents. Totals compute only when every row sources; partial-source totals render as TBD.
5. The strengths and weaknesses lists contain only sourced facts. Each fact lists the `StoredDocument.id` or `custom_field` that sources it. No characterizations.
6. The comparable-verdict table contains only rows that surface from the firm's memory-rule corpus, with the criterion match recorded in the sourcing note. No invented verdicts. No extrapolated ranges. No aggregated figures derived from multiple rows.
7. The opposing-counsel and carrier prior-pattern tables contain only rows from the firm's memory-rule corpus, or the corpus-absent prose when no row matches. No invented observations.
8. The five legal-judgment sections (`settlement_bracket_recommendation`, `recommended_posture`, `strengths_legal_argument_prose`, `weaknesses_legal_argument_prose`, `case_strategy_language`) all render as TBD markers. None contain plausible-but-inferred prose.
9. No citation-shaped string appears anywhere in skill-authored sections. Citation strings inside the verbatim comparable-verdict rows and inside partner-authored TBD sections are not the skill's authoring and are out of scope for the substrate's authoring check.
10. The fabrication filter returns `clean` (no `none`-tagged field rendered non-empty; every `matter_attribute`/`system_of_record` field has a present source_id; every `memory_rule` field has a present rule_id or the documented corpus-absent prose).
11. The voice-gate score against the Layer 2 internal-memo corpus is above the configured threshold.
12. The memo is scannable by the partner in under fifteen minutes: matter-facts summary, chronology, damages tables, strengths list, weaknesses list, comparable-verdict table, opposing-counsel pattern table, carrier pattern table, TBD sections, partner signoff. Every TBD marker is one line, in brackets, with a hint to what the partner authors.

## References

- `references/algorithm.md` - detailed parent preflight rules, per-subagent contracts (required return keys + per-row source policy), parent-level memory-rule lookup logic (comparable-verdict table), and parent assembly logic. The source of truth for what "good settlement-prep memo assembly" looks like (ADR 0021 Stream C - extracted from the prior 17-step `## Procedure` after the `delegate_task` migration).
- `references/voice.md` - partner internal-memo voice rules; banned patterns; sentence-length envelope; Layer 2 match criterion specific to the internal-memo register.
- `references/output-format.md` - exact section order and section templates for the memo, with one example per fixture profile (soft-tissue settled vs. fracture-with-surgery contested-liability).
- `references/categorization-rubric.md` - rules for classifying a matter as ready / not-ready for prep-memo assembly; the memory-rule corpus readiness gate; the conference-date gate.
- `references/citation-policy.md` - the absolute prohibition on legal citations in skill-authored prose and the verbatim-quote carve-out for comparable-verdict rows.
- `references/fabrication-policy.md` - the per-section sourcing contract; the mapping between `client_facing_fields` frontmatter and rendered sections; TBD-marker language by section.
- `references/test-cases.md` - which fixtures exercise which behaviors and what the skill must produce for each.

## Related PRD and ADR references

- ADR 0005 (reviewer-as-sender) - `Email.create_draft` only, no send method. The memo is internal so the recipient is the partner, but the architectural rule is unchanged.
- ADR 0006 (capability-adapter pattern) - the skill calls `PracticeManagement`, `DocumentStorage`, and `Email` interfaces, never vendor SDKs.
- ADR 0008 (customer-owned memory artifact) - the comparable-verdict, opposing-counsel, and carrier prior-pattern memory rules are customer-owned per ADR 0008; the skill reads them but never modifies them.
- Platform PRD §7.5 invariant #6 - citation-refusal (vertical: law-firm). Verbatim-quote carve-out for memory-rule rows the partner authored.
- Platform PRD §7.5 invariant #8 - fabrication discipline; this skill is one of the load-bearing test cases because settlement-value is the highest fabrication-risk surface in the vertical.
- Platform PRD §8.4 - skill anatomy. Voice rules front-loaded in description per Phase A.6.
- Platform PRD §9 - persona and voice model; Layer 2 anchor corpus minimum.
- Platform PRD §11.2 - default trust ceiling `draft_for_review`, locked for judgment-bearing work.
- Law-firm PRD §5 - third-rail map. Settlement-value analysis is named as third-rail; this skill produces no value the partner has not already authored into the comparable-verdict memory rule.
- Law-firm PRD §6.2 - pillar map; this skill operationalizes the prep work that sits at the seam of Pillar 7 (Settlement + resolution) without crossing into the judgment-bearing core.
- Law-firm PRD §11.2 - demo scenario list; the settlement-conference-prep scenario is the partner's "I have a conference Friday morning and the matter file is twenty inches of paper" use case this skill addresses.

## Scope alignment with law-firm-prd §5 and §6.2

The law-firm PRD §5 third-rail map names "settlement-value analysis" and "settlement authority / negotiation positions" as work the agent must never do. The PRD §6.2 places settlement and resolution work in Pillar 7 (Settlement + resolution) and characterizes the mechanical operations there (statement prep, lien tracking, 1099 prep, closing letters) as agent-suitable, while the value-bearing work (settlement-value analysis, demand authorship with case-law / valuation, lien-strategy advice) is third-rail.

This skill operationalizes a pre-conference prep memo that lives at the seam: the partner needs the matter file, the chronology, the damages tabulation, the strengths-and-weaknesses summary, the comparable verdicts, and any prior-pattern data the firm has on the opposing counsel or carrier, all assembled in one document the partner can scan in fifteen minutes before walking into the conference. The skill provides that assembly. The skill does NOT provide:

- A settlement bracket recommendation. Bracket recommendations require valuation judgment; valuation judgment is partner work. Bracket-recommendation section renders as TBD.
- A recommended posture (open low / open high, anchor strategy, walk-away point). Posture is negotiation strategy; strategy is partner work. Posture section renders as TBD.
- A characterization of strengths as legal arguments ("the comparative-negligence defense is weak"). The skill lists sourced facts that bear on the strength; the partner authors the argument framing.
- A characterization of weaknesses as legal exposures ("the prior-back-injury history undermines causation"). Same split.
- Any case-strategy language.

The comparable-verdict table is the architecturally interesting middle case. The firm authors a verdict corpus into a memory rule: each row records the case name, verdict amount, jurisdiction, key facts that match the comparison criterion, and the source the firm cites (a published opinion, a jury verdict reporter, a partner's prior matter file, a verbatim partner note). The skill matches the matter's facts against the corpus and surfaces the rows the partner has already authored as comparable. The skill does NOT invent verdicts. The skill does NOT extrapolate from the corpus. If the corpus is missing or stale, the comparable-verdict table renders as TBD and the skill marks the bracket-recommendation section as architecturally non-derivable, noting that without a populated corpus the prep memo has no quantitative anchor.

The opposing-counsel and carrier prior-pattern tables are also memory-rule sourced. The firm authors a pattern corpus per opposing counsel and per carrier: prior settlement timing, prior offer patterns (first-offer ratio to demand, days from demand to first offer, days to settle), prior conference behavior (early settlement at mediation vs. trial-eve settlements), and any partner-authored note about that opposing counsel's posture. If the corpus is missing for the named opposing counsel or the named carrier, the pattern table renders the corpus-absent prose ("no prior-pattern data on this opposing counsel in firm memory") rather than inventing observations.

The skill name `settlement-prep` is operational shorthand for this internal-memo variant. If Captain decides the bracket-recommendation TBD section creates room for the skill to drift into valuation authoring, the fix is configuration: rename the TBD marker to omit the word "bracket" entirely, or strip the section from the template so the partner authors that thinking in a separate document. The current spec includes the section as a TBD marker because the partner needs the placeholder during the scan; the architectural enforcement is that the section is `none`-tagged and the fabrication filter blocks any non-empty render.
