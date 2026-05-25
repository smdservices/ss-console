# Law-PI Demand-Letter Draft — Detailed Algorithm

Detailed procedural rules preserved for graders. The SKILL.md `## Procedure`
section dispatches three parallel subagents via `delegate_task` (ADR 0021
Stream C) and validates their returns against an assembly-time schema
contract; this file is the source of truth for what each subagent must
produce and how the parent assembles the final draft.

## Customer-config gating (parent — runs before delegation)

1. **Load customer config.** Read `~/.hermes/customers/{customer_slug}/customer.yaml` for firm name, supervising partner's reviewer account ID, partner's signature block, voice samples (Layer 2), and practice-area filter. If `practice_areas` does not include `personal-injury`, refuse with `out_of_scope` and write no draft.
2. **Load the matter via PracticeManagement.** Call `practice_management.get_matter(matter_id)`. If the matter is null or its `matter_type` does not indicate PI, refuse with `matter_not_found` or `matter_wrong_type`. The skill never creates or modifies a matter.
3. **Read the matter's custom_fields.** PI-adapter populated fields the skill expects: `client_name`, `date_of_incident`, `incident_location`, `claim_number`, `opposing_carrier`, `opposing_adjuster_name`, `opposing_adjuster_email`, `employer_name`. Each field that is missing is recorded as a TBD source; the corresponding draft section renders the TBD marker rather than inferring a plausible value.
4. **Refusal preflight.** Before dispatching subagents, check the refusal criteria in `## Refusal Cases` of SKILL.md. `voice_samples_missing`, `insufficient_source_data` (computed from a quick document-store count), and `out_of_scope` short-circuit before any delegation.

## Subagent contracts (each delegated in parallel)

### `medicals_summary` subagent

**Goal:** assemble the medical chronology and the per-provider billing tabulation from the matter's `medical-records` and `billing-statement` documents.

**Restricted toolset:** read-only `PracticeManagement` + `DocumentStorage`. The delegation system blocks `delegation`, `memory`, `code_execution`, `send_message`, and any write capability per Hermes' default subagent restrictions.

**Required return keys (assembly-time schema contract):**

- `medical_chronology`: list of rows. Each row carries `{date, provider, treatment_summary, source_document_id}`. **MUST have ≥1 row.** Rows without a sourced date or provider are dropped from the chronology and added to the bottom of the matter-internal triage note (sourced from `source_document_id == null` entries). The chronology never invents a date or a provider.
- `per_provider_billing`: list of rows. Each row carries `{provider, billed_amount_usd, source_document_id}`. **MUST have ≥1 row** (or an explicit empty list IF the matter explicitly has no billing — represented as `medical_specials_total: "[TBD: ...]"`).
- `medical_specials_total`: numeric USD value (sum of `per_provider_billing[].billed_amount_usd`) OR the explicit-TBD marker string `"[TBD: medical specials total — partner verifies after sourcing missing billing statements]"` when any per-provider line is itself TBD.

**Per-row source policy:** every numeric value MUST trace to a `source_document_id`. Where a billing statement is missing or its total cannot be extracted, the per-provider line renders as `[TBD: source billing statement at <document path>]` and is excluded from the specials total. The skill never estimates.

### `damages_summary` subagent

**Goal:** assemble the lost-wages tabulation from the matter's `employment-verification` documents (W-2, pay stubs, employer letter).

**Restricted toolset:** read-only `DocumentStorage` + `PracticeManagement` (for `custom_fields.employer_name`). Same blocked-toolset list as `medicals_summary`.

**Required return keys (assembly-time schema contract):**

- `lost_wages_total`: numeric USD value summed from employment-verification documents, OR the explicit-TBD marker `"[TBD: lost wages — partner supplies after employer verification received]"` when employer-verification is absent. The skill never imputes wages from the client's stated occupation.
- `employer_documentation`: list of `{document_id, document_type, modified_at}` entries. **MAY be empty** (when no employer-verification documents exist — the `lost_wages_total` then carries the explicit-TBD marker).

### `liability_summary` subagent

**Goal:** assemble the factual case-history paragraph from `custom_fields` + the incident documents.

**Restricted toolset:** read-only `PracticeManagement` + `DocumentStorage`.

**Required return keys (assembly-time schema contract):**

- `date_of_incident`: ISO 8601 date string OR the TBD marker.
- `incident_location`: string OR the TBD marker.
- `client_role`: one of `driver | passenger | pedestrian | cyclist | other` OR the TBD marker. Sourced from the matter's `custom_fields.client_role` field or, where absent, inferred from a partner-authored matter note (NOT inferred from anywhere else).
- `factual_chronology`: 3-5 sentences of factual case-history prose. **MUST contain at least 3 sentences.** No characterization of fault. No characterization of severity beyond what the medical record states. No quoted client testimony unless it appears verbatim in a matter note authored by the partner.

## Parent — assembly contract and refusal

After all three subagents return, the parent validates each return against its required-keys list. The validator is strict: missing key or empty required value triggers refusal.

**On any contract failure:**

1. The parent emits one `audit_action="SUBAGENT_INCOMPLETE"` row with metadata:
   - `subagent_role`: `"medicals_summary"` | `"damages_summary"` | `"liability_summary"`
   - `missing_key`: name of the key that failed validation
   - `matter_ref`: the matter id (hashed before audit emission)
   - `expected_min`: the minimum threshold that failed (e.g., `>= 1 row`, `>= 3 sentences`)
2. The parent writes a refusal note to `~/.hermes/customer_notes/{customer_slug}/pi-demand-incomplete-YYYY-MM-DD-<matter-id>.md` enumerating which subagent returned what and which keys were missing.
3. The parent does NOT call `Email.create_draft`. **A reviewer-as-sender never sees an incomplete draft.**
4. The parent surfaces the failure via the same escalation channel as `insufficient_source_data` so the partner knows to investigate the matter's source documents.

**On assembly-contract pass:**

1. The parent inserts TBD markers for the four partner-authored sections (`demand_amount`, `settlement_bracket_prose`, `liability_characterization`, `case_strategy_language`) — these are NEVER returned by any subagent because they are tagged `none` in the frontmatter `client_facing_fields` block.
2. Voice-gate check against the Layer 2 partner corpus (per `voice-gate-fallback.md`). Failing voice score → conservative variant → if still failing, omit the factual case-history paragraph (partner authors it instead).
3. Call `Email.create_draft` per ADR 0005 with `DraftInput` populated from the assembled summaries.
4. Write the matter-internal sourcing note enumerating which `StoredDocument.id` populated each row and which custom_field populated each named field.
5. Emit telemetry: matter id (hashed), TBD-marker count by section, voice-gate score, draft size in bytes, adapter calls made, plus per-subagent duration_ms.

## Why three subagents and not the original 14 sequential steps

The original 14-step procedure (preserved in git history before this rewrite) executed every step in the parent agent's conversation context: every PracticeManagement call, every DocumentStorage read, every per-provider billing parse landed as a separate tool-result block. For a matter with 30 documents the context bloat was ~30k tokens of inbound material before the parent could write the first sentence.

`delegate_task` collapses each research stream into a single isolated subagent. The parent receives only the structured summaries (`medical_chronology[]`, `lost_wages_total`, `factual_chronology`), not the per-document parse. Three concurrent subagents reduce wall-clock time from sequential-N to roughly max(t_medicals, t_damages, t_liability). The Devil's Advocate critique correctly noted that wall-clock latency alone is the wrong success metric — the schema contract is what prevents an incomplete subagent return from quietly producing an incomplete draft.

## What this algorithm is NOT

- **Not autonomous.** Trust ceiling stays `draft_for_review (locked)`. Promotion to `autonomous` is architecturally blocked.
- **Not partner-authoring.** The four legal-judgment sections (`liability_characterization`, `settlement_bracket_prose`, `demand_amount`, `case_strategy_language`) render as TBD markers; the partner fills them in.
- **Not citation-producing.** Per `references/citation-policy.md` and the substrate filter at `ai-employee/safety-substrate/citation_filter.py`, no subagent and no parent step produces, repeats, or reformulates a legal citation.
- **Not fabricated.** Per `references/fabrication-policy.md` and the frontmatter `client_facing_fields` block, every numeric or factual value either traces to a source or renders as a TBD marker. The assembly-time schema contract is the structural enforcement of this — incomplete subagent returns refuse, they do not silently fill.
