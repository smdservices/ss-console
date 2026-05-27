---
name: demand-letter-draft
description: 'Drafts factual PI demand-letter chronology for partner.'
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: []
  commands: []
metadata:
  hermes:
    tags: [Law, PI, Demand, Draft]
  smd:
    vertical: law-firm-pi
    trust_ceiling: draft_for_review
    trust_ceiling_locked: true
    capabilities: [PracticeManagement, DocumentStorage, Email]
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
---

# Law PI Demand-Letter Draft (Factual Assembly)

Reads one active personal-injury matter and writes a factual demand-letter draft into the supervising partner's drafts folder. The skill writes only what the matter record and document store contain. The partner authors the demand amount, the liability characterization, the settlement bracket, and any case-strategy language. The skill never sends. The skill never quotes case law, statutes, or court rules. The partner reviews, fills in the TBD sections, edits, and clicks send from their own mail client.

The skill is configured per-customer through `~/.hermes/customers/{customer_slug}/customer.yaml`, which supplies the firm name, the partner's first name and signature block, the partner's reviewer email account ID for `Email.create_draft`, the firm's voice samples for Layer 2 voice match, and the practice-area filter.

## When to Use

Use when a supervising partner needs a factual demand-letter draft assembled from one active PI matter's medical, billing, and employment records. The skill writes the chronology, billing tabulation, lost-wages tabulation, exhibit list, and factual case-history prose; the partner authors the demand amount, settlement bracket, liability characterization, and case-strategy language as TBD sections.

## Prerequisites

PracticeManagement, DocumentStorage, and Email capability adapters; per-customer config at `~/.hermes/customers/{customer_slug}/customer.yaml` including Layer 2 voice samples meeting Gate 1 minimum. See frontmatter.

## How to Run

Draft from a matter ID:

```
hermes run demand-letter-draft --matter-id <id>
```

Draft from a Hermes-side matter slug (when the matter is known by its internal slug rather than the PM-system ID):

```
hermes run demand-letter-draft --matter-slug <slug>
```

Dry-run (writes the draft to `~/.hermes/customer_notes/{customer_slug}/` and returns the path; does not call `Email.create_draft`):

```
hermes run demand-letter-draft --matter-id <id> --dry-run
```

## Procedure

The skill runs in three phases. Customer-config gating runs in the parent. Three parallel subagents do the research. The parent validates an assembly-time schema contract before assembling the draft (ADR 0021 Stream C); on any incomplete return, the parent emits `SUBAGENT_INCOMPLETE` and refuses — a reviewer-as-sender never sees a quietly incomplete draft.

The detailed per-step rules, per-subagent required-key lists, and parent assembly logic live in `references/algorithm.md`. This section is the dispatch shape; that is the depth.

### Phase 1 — Parent preflight

1. **Load customer config** from `~/.hermes/customers/{customer_slug}/customer.yaml`. Refuse with `out_of_scope` if `practice_areas` does not include `personal-injury`.
2. **Load the matter** via `practice_management.get_matter(matter_id)`. Refuse with `matter_not_found` or `matter_wrong_type` per the refusal cases below.
3. **Refusal preflight.** Check `voice_samples_missing`, `insufficient_source_data` (quick document-store count), `out_of_scope`, `matter_closed` — short-circuit before any delegation.

### Phase 2 — Delegate three subagents in parallel

Use Hermes' `delegate_task` to spawn three isolated subagents concurrently. Each gets a restricted toolset (default Hermes delegation policy blocks `delegation`, `memory`, `code_execution`, `send_message`, and write capabilities for leaf subagents).

| Sub-role            | Goal                                                                              | Required return keys                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `medicals_summary`  | Assemble medical chronology + per-provider billing from medical/billing documents | `medical_chronology` (≥1 sourced row), `per_provider_billing` (≥1 row), `medical_specials_total` (numeric or explicit-TBD) |
| `damages_summary`   | Assemble lost-wages tabulation from employment-verification documents             | `lost_wages_total` (numeric or explicit-TBD), `employer_documentation` (list, may be empty)                                |
| `liability_summary` | Assemble factual case-history paragraph from custom_fields + incident docs        | `date_of_incident`, `incident_location`, `client_role`, `factual_chronology` (≥3 sentences)                                |

The Hermes runtime emits one `SUBAGENT_STOPPED` audit row per child via the overlay's `hermes-smd-audit` plugin (`subagent_stop` hook). The parent waits for all three to return before proceeding.

### Phase 3 — Parent assembly with schema contract

1. **Validate each subagent's return against its required-keys list.** Strict: missing key OR empty required value triggers refusal.
2. **On any contract failure:** emit one `audit_action="SUBAGENT_INCOMPLETE"` row with metadata (`subagent_role`, `missing_key`, `matter_ref` hashed, `expected_min`). Write a refusal note to `~/.hermes/customer_notes/{customer_slug}/pi-demand-incomplete-YYYY-MM-DD-<matter-id>.md`. **Do NOT call `Email.create_draft`.** Surface the failure via the same escalation channel as `insufficient_source_data`.
3. **On contract pass:**
   - Insert TBD markers for the four partner-authored sections (`demand_amount`, `settlement_bracket_prose`, `liability_characterization`, `case_strategy_language`) per the `client_facing_fields` frontmatter.
   - Voice-gate check against the Layer 2 partner corpus.
   - Call `Email.create_draft` per ADR 0005 (`reviewer_account_id` = supervising partner; `to` = opposing adjuster's email or empty; `subject` from matter attributes; `body_text` + `body_html` from `references/output-format.md`).
   - Write the matter-internal sourcing note enumerating which `StoredDocument.id` populated each row and which custom_field populated each named field.
   - Emit telemetry (matter id hashed, TBD-marker count, voice-gate score, draft size, adapter calls, per-subagent `duration_ms`).

The full per-subagent contract, per-row source policy, and assembly-rule detail (including why three subagents and not the original 14 sequential steps) live in `references/algorithm.md`.

### Trust Ceiling

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

### Voice Rules (Layer 2 — partner corpus match)

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

### Citation Policy (law-firm vertical, invariant #6)

The skill must never produce, repeat, or reformulate legal citations. Case-name-shaped strings with reporter cites (e.g., `Smith v. Jones, 123 F.3d 456 (3d Cir. 2010)`), statute references (e.g., `42 U.S.C. § 1983`), court rule references (e.g., `Fed. R. Civ. P. 26(b)(1)`), and treatise pinpoint cites are all in scope. If the matter record contains citations in partner-authored narrative notes, the skill carries them through verbatim as quoted text inside the partner-authored TBD section markers only; it does not validate, restate, or augment them. If the assembled draft would otherwise contain a citation-shaped string, the skill replaces the string with `[CITATION REMOVED — partner inserts after review]` and logs a citation-refusal event. Code-level enforcement lives in the citation-refusal substrate at `ai-employee/safety-substrate/citation_filter.py`; the skill's prompt-level discipline is defense in depth. See `references/citation-policy.md`.

### Fabrication Policy (platform invariant #8)

Every client-facing field is declared in the skill's frontmatter `client_facing_fields` block with one of: `matter_attribute`, `system_of_record`, `memory_rule`, `none`. Fields tagged `none` MUST render as a TBD marker; rendering plausible content into a `none`-tagged field is a `block`-severity fabrication-filter violation per the spec at `docs/specs/ai-employee/fabrication-filter.md`. The four legal-judgment fields the partner authors (`liability_characterization`, `settlement_bracket_prose`, `demand_amount`, `case_strategy_language`) are all tagged `none` for exactly this reason: the skill cannot author them, the runtime filter enforces non-rendering, and the draft surfaces a TBD marker the partner fills in. See `references/fabrication-policy.md` for the per-section sourcing contract.

### Refusal Cases

The skill emits a refusal (writes no draft, returns a structured error) under any of:

- `out_of_scope`: the customer's `practice_areas` does not include `personal-injury`.
- `matter_not_found`: `PracticeManagement.get_matter(id)` returns null.
- `matter_wrong_type`: `matter.matter_type` is not a PI variant.
- `matter_closed`: `matter.status` is `closed`. Demand letters are not issued on closed matters.
- `insufficient_source_data`: the matter has fewer than three sourced rows across the medical, billing, and employment categories combined. A draft built on fewer than three sourced rows is closer to fabrication than to assembly; the partner is escalated to either populate the matter record or author the letter from scratch.
- `voice_samples_missing`: `customer.yaml` Layer 2 voice samples count is below the PRD §9.6 Gate 1 minimum (30 samples). The skill refuses rather than ship an externally-bound draft against an uncalibrated voice envelope.
- `citation_in_source`: a citation-shaped string appears in a matter custom_field that the skill would otherwise carry through into a non-quoted section. The substrate-level citation filter blocks; the skill refuses and escalates to the partner.

When the skill can author a partial draft (some sections sourced, some TBD), it proceeds. When it cannot meet a refusal criterion, it writes no draft and logs the refusal.

## Pitfalls

See `### Refusal Cases` in Procedure. Common failure modes also include emitting a citation-shaped string in skill-authored prose, rendering plausible content into a `none`-tagged field, or proceeding without Layer 2 voice samples at Gate 1 minimum.

## Verification

A successful run satisfies all of:

1. The draft lands in the supervising partner's drafts folder (not the agent's AgentMail identity), confirmed by the adapter's `DraftRef.folder` field matching the partner's drafts path.
2. Every authored figure (medical specials total, per-provider billing, lost-wages total, treatment dates, provider names, dates of incident) is sourced from a `StoredDocument.id` or a `matter.custom_fields.<key>`, recorded in the sourcing note.
3. The four legal-judgment sections (`liability_characterization`, `settlement_bracket_prose`, `demand_amount`, `case_strategy_language`) all render as TBD markers. None contain plausible-but-inferred prose.
4. No citation-shaped string appears anywhere in the draft (citation-refusal substrate verifies post-emit).
5. The fabrication filter returns `clean` (no `none`-tagged field rendered non-empty; every `matter_attribute`/`system_of_record` field has a present source_id).
6. The voice-gate score against the Layer 2 partner corpus is above the configured threshold (per `voice-gate-fallback.md` spec).
7. The draft is scannable by the partner in under five minutes: header, recipient, recitals (factual), chronology, tabulations, exhibit list, TBD sections, sign-off block. Every TBD marker is one line, in brackets, with a hint to what the partner authors.

## References

- `references/algorithm.md` — detailed parent preflight rules, per-subagent contracts (required return keys + per-row source policy), and parent assembly logic. The source of truth for what "good demand-letter assembly" looks like (ADR 0021 Stream C — extracted from the prior 14-step `## Procedure` after the `delegate_task` migration).
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
- Law-firm PRD §6.2 / §12.1 — scope-alignment note explains the relationship between this skill and the deferred `pi-demand-letter-text-only` skill.

## Scope alignment with law-firm-prd §6.2

The law-firm PRD §6.2 defers a generic "demand letter text" skill (`pi-demand-letter-text-only`) to Phase 3+ on the grounds that factual demand-letter prose still carries implicit legal-judgment characterization (impact framing, liability framing, settlement-value framing). This skill implements the **factually-narrow** subset that is safe in v1:

- Chronology, tabulation, exhibit assembly, and factual case-history prose are authored by the skill.
- Demand amount, settlement bracket, liability characterization, and case-strategy language are NOT authored by the skill. They render as TBD markers for the partner to fill in.

The skill name `demand-letter-draft` is operational shorthand for this factually-narrow variant. It is functionally adjacent to the `pi-demand-letter-evidence-packet` capability described in law-firm-prd §6.2 and §12.1, with one addition: the factual sections are assembled as prose in the partner's voice envelope rather than as standalone spreadsheets, so the partner edits a draft letter rather than re-typing from a packet.

If Captain decides this scope creeps too close to the deferred `pi-demand-letter-text-only` skill, the fix is one of: (1) narrow the factual prose to bulleted assembly only and remove the "case history" paragraph, or (2) hold the skill for Phase 3 per the PRD's stated deferral. Both fixes are configuration, not architecture.
