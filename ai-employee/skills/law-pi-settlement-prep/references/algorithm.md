# Law-PI Settlement Prep — Detailed Algorithm

Detailed procedural rules preserved for graders. The SKILL.md `## Procedure`
section dispatches three parallel subagents via `delegate_task` (ADR 0021
Stream C) and validates their returns against an assembly-time schema
contract; this file is the source of truth for what each subagent must
produce, how the parent assembles the final memo, the parent-level
memory-rule lookups (comparable-verdict table), and the cross-subagent
consistency rules.

## Parent preflight (runs before delegation)

1. **Load customer config.** Read `~/.hermes/customers/{customer_slug}/customer.yaml`
   for firm name, supervising partner's reviewer account ID, partner's
   signature block, voice samples (Layer 2 — including
   `internal_prep_memo` / `case_strategy_memo` tagged samples), the
   firm's comparable-verdict memory rule, the firm's opposing-counsel
   prior-pattern memory rule, the firm's carrier prior-pattern memory
   rule, and the practice-area filter. Refuse with `out_of_scope` if
   `practice_areas` does not include `personal-injury`. Refuse with
   `voice_samples_missing` if Layer 2 samples are below the PRD §9.6
   Gate 1 minimum. The internal-memo envelope additionally surfaces a
   "voice envelope thin" warning if fewer than five samples are tagged
   `internal_prep_memo` or `case_strategy_memo` — the skill proceeds
   (the internal register is lower risk than external correspondence
   because the audience is the partner).
2. **Load the matter via PracticeManagement.** Call
   `practice_management.get_matter(matter_id)`. If the matter is null
   or its `matter_type` does not indicate PI, refuse with
   `matter_not_found` or `matter_wrong_type`. If `matter.status` is
   `closed`, refuse with `matter_closed`. The skill never creates or
   modifies a matter.
3. **Verify the conference date.** Read
   `matter.custom_fields.settlement_conference_date` or the
   `--conference-date` override. Refuse with `conference_date_missing`
   if neither is present. If the date is in the past, proceed but flag
   in the sourcing note (the partner may be retrospectively assembling
   a prep memo).
4. **Refusal preflight (short-circuit before delegation).** Check
   `comparable_verdict_corpus_missing` (and honor the partner's
   `--no-comparable-verdicts` opt-in flag — when passed, the skill
   proceeds with the comparable-verdict table rendered as the
   corpus-absent TBD), and `citation_in_source` (citation-shaped string
   in a partner-authored narrative field that would otherwise be read
   into skill prose).

## Subagent contracts (each delegated in parallel)

### `opposing_counsel_history` subagent

**Goal:** pull all prior correspondence threads with opposing counsel
via EmailThread, extract prior offers, and match opposing-counsel +
carrier names against firm memory-rule patterns.

**Restricted toolset:** read-only `EmailThread` + `PracticeManagement`
(for `custom_fields.opposing_counsel_name`,
`custom_fields.opposing_carrier_name`, etc.).

**Required return keys (assembly-time schema contract):**

- `thread_summary`: list of `{thread_id, subject, last_message_date,
  message_count, source_thread_ref}` entries summarizing prior
  correspondence. **MUST have ≥1 sourced thread row** OR the explicit
  marker `"[TBD: no prior correspondence threads with opposing
  counsel; partner verifies matter has reached the correspondence
  phase before settlement prep]"`. If the matter genuinely has no
  prior opposing-counsel correspondence, the upstream
  `insufficient_source_data` refusal already triggers — settlement
  prep without any prior contact is premature.
- `prior_offers`: list of `{offer_amount, offer_date, source_doc_id}`.
  **MAY be empty** — many matters reach conference prep before a first
  offer. Every entry traces to a specific `StoredDocument.id` (typically
  a partner-authored note recording the offer) — the subagent NEVER
  invents an offer amount.
- `opposing_counsel_pattern`: memory-rule row if `opposing_counsel_name`
  matches a partner-authored row in the firm's opposing-counsel
  prior-pattern memory rule, OR the explicit corpus-absent marker
  `"[opposing counsel not in firm's prior-pattern corpus]"`. Rows
  surface verbatim. The subagent NEVER interpolates between rows or
  generalizes from one row.
- `carrier_pattern`: memory-rule row if `opposing_carrier_name` matches
  a partner-authored row in the firm's carrier prior-pattern memory
  rule, OR the explicit corpus-absent marker
  `"[carrier not in firm's prior-pattern corpus]"`. Same render rules
  as opposing_counsel_pattern.

### `damages_summary` subagent

**Goal:** tabulate medical specials (per-provider, per-date) and lost
wages (per-pay-period) from documents in the matter folder.

**Restricted toolset:** read-only `DocumentStorage` +
`PracticeManagement` (for `custom_fields.employer_name`).

**Required return keys (assembly-time schema contract):**

- `medical_specials_total`: numeric USD value summed from
  `per_provider_billing[].billed_amount_usd` OR the explicit-TBD
  marker `"[TBD: medical specials total - partner verifies after
  sourcing missing billing statements]"` when any per-provider line
  is itself TBD.
- `per_provider_billing`: list of rows. Each row carries
  `{provider, date, billed_amount_usd, adjusted_amount_usd,
  source_document_id}`. **MUST have ≥1 row** (or the wrapper-level
  `medical_specials_total` TBD marker). Where billed and adjusted
  amounts differ on the source billing statement, both render; the
  total uses billed_amount_usd. The subagent NEVER estimates.
- `lost_wages_total`: numeric USD value summed from employment-
  verification documents OR the explicit-TBD marker `"[TBD: lost
  wages - partner supplies after employer verification received]"`
  when employer-verification is absent. The subagent never imputes
  wages from the client's stated occupation or generalizes from
  industry averages.
- `other_damages`: list of `{kind, amount_usd, source_doc_id}`
  entries for damages outside medical specials and lost wages
  (property damage, transportation costs, etc.). **MAY be empty**.
  Every entry traces to a source document.

**Per-row source policy:** every numeric value traces to a
`source_document_id`. Where a billing statement is missing or its
total cannot be extracted, the per-provider line renders as
`[TBD: source billing statement at <document path>]` and is excluded
from the specials total. The skill never estimates.

### `liability_summary` subagent

**Goal:** assemble matter-facts summary, chronology, and sourced
strengths + weaknesses fact lists from custom_fields + incident
documents.

**Restricted toolset:** read-only `PracticeManagement` +
`DocumentStorage`.

**Required return keys (assembly-time schema contract):**

- `date_of_incident`: ISO 8601 date string OR the TBD marker. Sourced
  from `matter.custom_fields.date_of_incident` or, where absent, from
  a partner-authored incident report.
- `incident_location`: string OR the TBD marker. Sourced from
  `matter.custom_fields.incident_location`.
- `client_role`: one of `driver | passenger | pedestrian | cyclist |
  occupant | other` OR the TBD marker. Sourced from
  `matter.custom_fields.client_role`.
- `factual_chronology`: 3-5 sentences of factual case-history prose
  identifying the client, the incident date and location, the
  documented client role, the opposing party name, opposing counsel
  and firm, and the carrier. **MUST contain at least 3 sentences.** No
  characterization of fault. No characterization of severity beyond
  what the medical record states. No quoted client testimony unless it
  appears verbatim in a partner-authored matter note.
- `chronology_events`: list of `{event_kind, event_date,
  source_document_id, one_line_description}` rows. Event kinds the
  subagent surfaces: `incident_date`, `first_medical_contact`,
  `subsequent_medical_visit`, `employment_verification_filed`,
  `billing_statement_filed`, `demand_letter_served`,
  `opposing_counsel_response`, `mediation_referral`,
  `conference_scheduled`. **MUST have ≥1 sourced row.** Every event
  traces to a `StoredDocument.id` or a `matter.custom_fields.<field>`
  reference. No event renders without a source.
- `strengths_facts`: list of `{fact_one_liner, source_id, source_kind}`
  rows. Examples of strengths the subagent surfaces when the matter
  file supports them: independent medical evidence (MRI confirms
  diagnosis), corroborating photos at scene, employer's lost-wages
  verification, contemporaneous medical contact within hours of
  incident, clean prior medical history in the relevant body region,
  unambiguous incident report attributing fault. **MUST have ≥1
  sourced row** OR the explicit marker `"[no clear sourced strengths
  identified in this matter; partner may identify strengths from
  external context]"`. The subagent NEVER characterizes a fact's
  legal weight ("strong causation case") — that's the partner-
  authored TBD argument-framing section.
- `weaknesses_facts`: list of `{fact_one_liner, source_id,
  source_kind}` rows. Examples of weaknesses the subagent surfaces
  when the matter file supports them: recorded prior injury or prior
  claim in the relevant body region, treatment gap between incident
  and first medical contact, treatment-compliance issue documented in
  a medical record, recorded inconsistency between client's incident
  description and the police report, documented employment gap, etc.
  **MUST have ≥1 sourced row** OR the explicit marker `"[no clear
  sourced weaknesses identified in this matter]"`. The subagent
  NEVER characterizes legal exposure ("comparative negligence
  defense") — that's the partner-authored TBD argument-framing
  section.

## Parent — assembly contract and refusal

After all three subagents return, the parent validates each return
against its required-keys list. The validator is strict: missing key
or empty required value triggers refusal.

### On any contract failure

1. The parent emits one `audit_action="SUBAGENT_INCOMPLETE"` row with
   metadata:
   - `subagent_role`: `"opposing_counsel_history"` | `"damages_summary"`
     | `"liability_summary"`
   - `missing_key`: name of the key that failed validation
   - `matter_ref`: the matter id (hashed before audit emission)
   - `expected_min`: the minimum threshold that failed (e.g.,
     `>= 1 sourced row`, `>= 3 sentences`)
2. The parent writes a refusal note to
   `~/.hermes/customer_notes/{customer_slug}/pi-settlement-prep-incomplete-YYYY-MM-DD-<matter-id>.md`
   enumerating which subagent returned what and which keys were
   missing.
3. The parent does NOT call `Email.create_draft`. **A reviewer-as-sender
   never sees an incomplete prep memo.**
4. The parent surfaces the failure via the same escalation channel as
   `comparable_verdict_corpus_missing` so the partner knows to
   investigate the source data or the matter's document folder.

### On assembly-contract pass

1. **Parent-level memory-rule lookup: comparable-verdict table.** The
   parent (NOT a subagent) matches the assembled damages + liability
   profile against the firm's comparable-verdict memory rule. Match
   criteria the rule supports:
   - `matter_type` (auto-accident, premises, etc.)
   - injury severity (soft-tissue, fracture, disc-herniation-with-
     surgery, traumatic-brain-injury, etc.) — inferred from the
     `damages_summary.per_provider_billing[]` medical record
     classifications
   - liability profile (clear / contested / comparative) — inferred
     from the strengths/weaknesses balance returned by
     `liability_summary`
   - jurisdiction (matched against `matter.custom_fields.case_court`)

   Rows that match all the criterion fields the partner authored on
   each row surface verbatim. Stale or withdrawn rows do not surface.
   Each surfaced row renders with the columns the memory rule defines.
   If no rows match, the table renders as `"[TBD: no comparable
   verdicts in the firm's memory rule match this matter's profile.
   The partner authors the bracket recommendation from external
   research, or the firm extends the corpus before the conference.]"`.
   The parent NEVER invents verdicts, NEVER extrapolates from rows
   that partially match, NEVER generalizes from one row to a range,
   NEVER averages verdict amounts to produce a derived figure. This
   is a parent-level lookup (not a subagent task) because the matching
   keys are computed FROM the subagent returns; a subagent would not
   have the cross-subagent visibility.

2. **Insert TBD markers for the five partner-authored sections** per
   the `client_facing_fields` frontmatter:
   - `settlement_bracket_recommendation`: `[TBD: settlement bracket
     recommendation - partner authors. The comparable-verdict table
     above and the damages tabulation are provided as input. The
     skill produces no bracket because settlement-value analysis is
     third-rail per law-firm PRD §5.]`
   - `recommended_posture`: `[TBD: recommended posture (open low /
     open high / anchor / walk-away) - partner authors. The
     opposing-counsel and carrier prior-pattern tables are provided
     as input.]`
   - `strengths_legal_argument_prose`: `[TBD: legal-argument framing
     of strengths - partner authors. The strengths fact list above is
     provided as input.]`
   - `weaknesses_legal_argument_prose`: `[TBD: legal-argument framing
     of weaknesses - partner authors.]`
   - `case_strategy_language`: `[TBD: closing recommendation - partner
     authors. The skill emits no language about negotiation posture,
     settlement authority, walk-away triggers, or any forward-looking
     case-strategy framing.]`

3. **Voice-gate check** against the Layer 2 partner internal-memo
   corpus (per `voice-gate-fallback.md`). The internal-memo envelope
   differs from the external-correspondence envelope: the partner's
   prior internal prep memos and case-strategy memoranda are the
   primary samples. Failing voice score → emit the structured-table-
   only variant; partner authors the lead-ins.

4. **Call `Email.create_draft` per ADR 0005:**
   - `reviewer_account_id`: supervising partner's account ID.
   - `to`: supervising partner's `direct_email` — internal recipient
     by design (the memo is internal so the partner is both reviewer
     and recipient).
   - `subject`: `Settlement Conference Prep: <case caption>, <case number>, <conference date>`
     — every field sourced or rendered as TBD.
   - `thread_id`: null.
   - `body_text` and `body_html`: per `references/output-format.md`.
   - `matter_ref`, `drafted_by_skill`: as documented in SKILL.md.

5. **Write the matter-internal sourcing note** enumerating which
   `StoredDocument.id` populated each damages-table row, which
   `custom_field` populated each named field, which memory-rule rows
   populated the comparable-verdict and prior-pattern tables, and
   which fields rendered as TBD with the source-absence reason.

6. **Emit telemetry:** matter id (hashed), conference-date relative
   offset (not the date itself), strength-fact count, weakness-fact
   count, comparable-verdict row count, opposing-counsel-pattern row
   count, carrier-pattern row count, TBD-marker count, voice-gate
   score, memo size in bytes, adapter calls made, plus per-subagent
   `duration_ms`.

## Why three subagents and not the original 17 sequential steps

The original 17-step procedure (preserved in git history before this
rewrite) executed every step in the parent agent's conversation
context: every PracticeManagement call, every DocumentStorage read,
every memory-rule lookup, every per-document classification parse, every
per-provider billing extraction landed as a separate tool-result block.
For a matter with 60 documents and three populated memory rules the
context bloat was ~50k tokens of inbound material before the parent
could write the first sentence of the memo.

`delegate_task` collapses each research stream into a single isolated
subagent. The parent receives only the structured summaries
(`thread_summary[]`, `medical_specials_total`, `factual_chronology`,
`strengths_facts[]`, etc.), not the per-document parse. Three
concurrent subagents reduce wall-clock time from sequential-N to
roughly max(t_opposing, t_damages, t_liability). The Devil's Advocate
critique correctly noted that wall-clock latency alone is the wrong
success metric — the schema contract is what prevents an incomplete
subagent return from quietly producing an incomplete memo.

The comparable-verdict table is intentionally a **parent-level lookup**,
not a subagent task. Its matching keys (injury severity, liability
profile) are computed FROM the subagent returns; a fourth subagent
would either need synchronous access to the other three's outputs
(breaking Hermes' isolated-subagent contract) or duplicate their work.
The parent computes the matching profile once the three subagents
return, then walks the memory-rule corpus. This is also where the
fabrication-discipline enforcement is tightest: the comparable-verdict
table can produce dollar figures the partner cites, so the parent's
"surface verbatim or render corpus-absent TBD" enforcement is
load-bearing.

## What this algorithm is NOT

- **Not autonomous.** Trust ceiling stays `draft_for_review (locked)`.
  Settlement-conference prep memos inform settlement-authority
  decisions by definition. Promotion to `autonomous` is
  architecturally blocked per PRD §11.2.
- **Not bracket-authoring.** The skill produces no dollar range, no
  midpoint, no anchor, no walk-away figure. The settlement bracket
  recommendation is a partner-authored TBD section.
- **Not posture-authoring.** The skill produces no open-low / open-
  high suggestion, no anchor strategy. The recommended posture is a
  partner-authored TBD section.
- **Not citation-producing.** Per `references/citation-policy.md` and
  the substrate filter at `ai-employee/safety-substrate/citation_filter.py`,
  no subagent and no parent step produces, repeats, or reformulates
  a legal citation. The comparable-verdict rows are the verbatim-quote
  carve-out (the partner authored the row including its citation);
  the skill never paraphrases or extends them.
- **Not fabricated.** Per `references/fabrication-policy.md` and the
  frontmatter `client_facing_fields` block, every numeric or factual
  value either traces to a source or renders as a TBD marker. The
  assembly-time schema contract is the structural enforcement of
  this — incomplete subagent returns refuse, they do not silently
  fill.
- **Not aggregating verdicts.** The parent NEVER averages, computes
  medians, or otherwise derives a figure from the comparable-verdict
  corpus. Each row surfaces verbatim or not at all.
