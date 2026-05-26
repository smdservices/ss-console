# Law-PI Discovery Response — Detailed Algorithm

Detailed procedural rules preserved for graders. The SKILL.md `## Procedure`
section dispatches three parallel subagents via `delegate_task` (ADR 0021
Stream C) and validates their returns against an assembly-time schema
contract; this file is the source of truth for what each subagent must
produce, how the parent assembles the final draft, and the cross-subagent
consistency rules.

## Parent preflight (runs before delegation)

1. **Load customer config.** Read `~/.hermes/customers/{customer_slug}/customer.yaml`
   for firm name, supervising partner's reviewer account ID, partner's
   signature block, voice samples (Layer 2), the firm's objection-category
   vocabulary memory rule, and the practice-area filter. If `practice_areas`
   does not include `personal-injury`, refuse with `out_of_scope` and write
   no draft.
2. **Load the matter via PracticeManagement.** Call
   `practice_management.get_matter(matter_id)`. If the matter is null or its
   `matter_type` does not indicate PI, refuse with `matter_not_found` or
   `matter_wrong_type`. If `matter.status` is `closed`, refuse with
   `matter_closed` — discovery responses are not issued on closed matters.
   The skill never creates or modifies a matter.
3. **Load the discovery request document.** Call
   `document_storage.download_document(request_document_id)` for the
   `--request-document-id` path, or load the file at `--request-file` and
   stage it via `document_storage.upload_document` only when `--stage-request`
   is explicitly passed. Otherwise the file is read in-process and never
   written back to the matter folder.
4. **Refusal preflight (short-circuit before delegation).** Check the
   refusal cases in `## Refusal Cases` of SKILL.md:
   - `voice_samples_missing` — Layer 2 voice samples below the PRD §9.6
     Gate 1 minimum.
   - `objection_vocabulary_missing` — `customer.yaml.memory_rules.objection_categories`
     is missing or empty. The firm authors the vocabulary; the skill refuses
     rather than ship a draft with no category labels.
   - `citation_in_source` — a citation-shaped string appears in a partner-
     authored narrative field (e.g., a `case_summary` custom_field) that
     the skill would otherwise carry through into a non-quoted section.
     The substrate-level citation filter blocks; the skill refuses and
     escalates.
   - `request_unparseable` — a quick preflight parse fails to identify any
     numbered items in the request body. This catches a degraded-OCR or
     malformed request before delegation rather than letting
     `interrogatory_map` return an empty `numbered_requests` and trip the
     schema contract.

## Subagent contracts (each delegated in parallel)

### `interrogatory_map` subagent

**Goal:** parse the numbered structure of the incoming discovery request,
detect the request kind, identify the response due date, and map each
numbered item to the firm's categorical objection vocabulary.

**Restricted toolset:** read-only `PracticeManagement` + `DocumentStorage`.
The delegation system blocks `delegation`, `memory`, `code_execution`,
`send_message`, and any write capability per Hermes' default subagent
restrictions.

**Required return keys (assembly-time schema contract):**

- `numbered_requests`: list of rows. Each row carries `{request_number,
  verbatim_text, sub_parts}`. The `verbatim_text` is the request text
  carried through unchanged — no rewording, no paraphrasing. **MUST have
  ≥1 row.** A request body with zero parseable numbered items is the
  upstream `request_unparseable` refusal, not a contract failure here.
- `request_kind`: one of `interrogatories` | `requests_for_production` |
  `requests_for_admission` | `combined`. The `combined` variant captures
  a filing that mixes kinds; the parent renders it as a consolidated
  draft with per-kind sections.
- `response_due_date`: ISO 8601 date string OR the explicit-TBD marker
  `"[TBD: response due date - partner confirms]"`. The subagent reads
  the served-date metadata (from a `served_at` field if present) or the
  partner-authored cover-letter date, and computes via the firm's
  per-jurisdiction rule in `customer.yaml`. The subagent NEVER invents
  a deadline; absent data → TBD.
- `per_request_objections`: list of one entry per numbered request. Each
  entry is `{request_number, category_labels: [...]}` where
  `category_labels` is sourced from the firm's `objection_categories`
  memory rule. The category labels are partner-authored vocabulary
  pointers, NOT legal conclusions. Per-entry `category_labels` MAY be
  empty (no category matched). The wrapper MUST contain one entry per
  numbered request — count mismatch with `numbered_requests` is a
  cross-subagent consistency failure (see below).

**Per-row source policy:** every `category_labels` entry traces to the
firm's `objection_categories` memory rule by `rule_id`. The subagent
DOES NOT author the objection sentence — that's a partner-authored TBD
in the final draft. The subagent's job is to match request text against
the firm's existing vocabulary, not to invent new categorization.

### `privilege_log_findings` subagent

**Goal:** scan the matter's documents folder for material that may be
withheld under privilege, and build the privilege-log skeleton.

**Restricted toolset:** read-only `DocumentStorage` + `PracticeManagement`
(for `custom_fields.opposing_counsel_name` and similar).

**Required return keys (assembly-time schema contract):**

- `privilege_candidates`: list of `{document_id, classification,
  reason_for_flag}` entries. **MAY be empty** — some matters have no
  responsive documents requiring privilege review. The subagent flags
  documents whose `StoredDocument.classification` is one of
  `attorney_work_product`, `client_communication`,
  `expert_communication`, or `internal_memo`. Other classifications are
  not flagged.
- `privilege_log_rows`: list of `{document_id, filename, date, author,
  recipient}` entries. Length MUST equal `privilege_candidates` length.
  Each row records the metadata the partner needs to author the
  privilege-claim characterization. **`privilege_claim_type` is NOT
  returned by this subagent** — that field is a partner-authored TBD
  per the fabrication-discipline contract. The subagent records what
  the partner needs to decide; the partner decides.

**Per-row source policy:** every row traces to a specific
`StoredDocument.id`. No invented filenames. No invented authors. Where
metadata is missing (e.g., a scanned PDF with no author field), the
field renders as `[TBD: author - partner confirms]` rather than
inferring from filename or content.

### `supporting_docs` subagent

**Goal:** map each numbered request to a responsive-document list from
the matter folder.

**Restricted toolset:** read-only `DocumentStorage` + `PracticeManagement`.

**Required return keys (assembly-time schema contract):**

- `per_request_responsive_docs`: list of one entry per numbered request.
  Each entry is `{request_number, responsive_docs: [{document_id,
  filename, date, classification, one_line_description}]}` where
  `responsive_docs` MAY be empty per-request (some requests have no
  responsive material in the matter folder). The wrapper MUST contain
  one entry per numbered request — count mismatch with
  `interrogatory_map.numbered_requests` is a cross-subagent consistency
  failure.

**Per-row source policy:** every responsive document row traces to a
specific `StoredDocument.id`. Search uses keyword matching against
`StoredDocument.filename`, `StoredDocument.classification`, and (where
the adapter supports it) document body text. The subagent NEVER invents
a responsive document; if no documents match a request, the entry
renders as `responsive_docs: []` and the final draft surfaces it as
`[TBD: responsive documents - partner confirms whether matter file
contains responsive material for this request]`. The subagent NEVER
characterizes whether a document is privileged in this list — that's
the `privilege_log_findings` subagent's domain.

## Parent — assembly contract and refusal

After all three subagents return, the parent validates each return
against its required-keys list. The validator is strict: missing key,
empty required value, OR cross-subagent count mismatch triggers refusal.

### Cross-subagent consistency rules

These are validated in addition to the per-subagent required-keys:

1. **Numbered-request count match.** `interrogatory_map.numbered_requests`
   count MUST equal `interrogatory_map.per_request_objections` count
   (each numbered request has an objection entry, possibly with empty
   category list) AND MUST equal `supporting_docs.per_request_responsive_docs`
   count.
2. **Privilege-log row count match.** `privilege_log_findings.privilege_candidates`
   count MUST equal `privilege_log_findings.privilege_log_rows` count.
3. **Request-number alphabet consistency.** Every `request_number` in
   `per_request_objections` and `per_request_responsive_docs` MUST
   appear in `numbered_requests`. No subagent invents a request number
   the parser did not produce.

A mismatch on any of these is a `SUBAGENT_INCOMPLETE` refusal — the
parent does NOT paper over the inconsistency by assembling a draft with
mismatched rows. A discovery response with a misaligned table is worse
than no draft.

### On any contract failure

1. The parent emits one `audit_action="SUBAGENT_INCOMPLETE"` row with
   metadata:
   - `subagent_role`: `"interrogatory_map"` | `"privilege_log_findings"` |
     `"supporting_docs"` | `"cross_subagent_consistency"`
   - `missing_key`: name of the key that failed validation (or
     `"numbered_request_count_mismatch"` / similar for cross-subagent)
   - `matter_ref`: the matter id (hashed before audit emission)
   - `expected_min`: the minimum threshold that failed (e.g., `>= 1 row`,
     `count_match_required`)
2. The parent writes a refusal note to
   `~/.hermes/customer_notes/{customer_slug}/pi-discovery-incomplete-YYYY-MM-DD-<matter-id>.md`
   enumerating which subagent returned what and which keys / consistency
   rules failed.
3. The parent does NOT call `Email.create_draft`. **A reviewer-as-sender
   never sees an incomplete draft.**
4. The parent surfaces the failure via the same escalation channel as
   `request_unparseable` so the partner knows to investigate the source
   request or the matter's document folder.

### On assembly-contract pass

1. Insert TBD markers for the four partner-authored sections per the
   `client_facing_fields` frontmatter:
   - `substantive_answer_per_request` — one TBD per numbered interrogatory
   - `privilege_claim_characterization` — one TBD per privilege-log row
   - `admission_or_denial_per_request` — one TBD per numbered request for
     admission
   - `case_strategy_language` — one TBD at the end of the response
   These are NEVER returned by any subagent because they are tagged
   `none` in the frontmatter `client_facing_fields` block. Rendering
   plausible content into a `none`-tagged field is a `block`-severity
   fabrication-filter violation.
2. Voice-gate check against the Layer 2 partner corpus (per
   `references/voice.md` and `voice-gate-fallback.md`). A failing voice
   score causes the skill to emit a structured-table-only variant with
   no prose lead-ins; the partner authors the lead-ins.
3. Call `Email.create_draft` per ADR 0005:
   - `reviewer_account_id`: supervising partner's account ID from
     `customer.yaml`.
   - `to`: `matter.custom_fields.opposing_counsel_email` or `[]` if absent.
   - `subject`: `Responses to <request_kind> for <case caption>, <case number>`.
   - `thread_id`: existing `discovery_correspondence_thread_id` custom_field
     or null.
   - `body_text` and `body_html`: per `references/output-format.md`.
   - `matter_ref`, `drafted_by_skill`: as documented in SKILL.md.
4. Write the matter-internal sourcing note enumerating which
   `StoredDocument.id` populated each responsive-document row, which
   `custom_field` populated each named field, which memory rule
   populated each objection category, and which fields rendered as TBD
   with the source-absence reason.
5. Emit telemetry: matter id (hashed), request kind, numbered-request
   count, TBD-marker count by section, voice-gate score, privilege-log
   row count, draft size in bytes, adapter calls made, plus per-subagent
   `duration_ms`.

## Why three subagents and not the original 14 sequential steps

The original 14-step procedure (preserved in git history before this
rewrite) executed every step in the parent agent's conversation
context: every PracticeManagement call, every DocumentStorage read,
every per-request objection match, every privilege-candidate flag
landed as a separate tool-result block. For a matter with 50 documents
and 20 numbered requests the context bloat was ~40k tokens of inbound
material before the parent could write the first sentence.

`delegate_task` collapses each research stream into a single isolated
subagent. The parent receives only the structured summaries
(`numbered_requests[]`, `privilege_log_rows[]`,
`per_request_responsive_docs[]`), not the per-document parse. Three
concurrent subagents reduce wall-clock time from sequential-N to
roughly max(t_interrogatory, t_privilege, t_supporting). The Devil's
Advocate critique correctly noted that wall-clock latency alone is the
wrong success metric — the schema contract is what prevents an
incomplete subagent return from quietly producing an incomplete draft.

## What this algorithm is NOT

- **Not autonomous.** Trust ceiling stays `draft_for_review (locked)`.
  Promotion to `autonomous` is architecturally blocked per PRD §11.2
  (discovery responses are court filings once served).
- **Not partner-authoring.** The four legal-judgment sections
  (`substantive_answer_per_request`, `privilege_claim_characterization`,
  `admission_or_denial_per_request`, `case_strategy_language`) render
  as TBD markers; the partner fills them in.
- **Not citation-producing.** Per `references/citation-policy.md` and
  the substrate filter at `ai-employee/safety-substrate/citation_filter.py`,
  no subagent and no parent step produces, repeats, or reformulates a
  legal citation. The verbatim-quoted incoming request retains any
  citations opposing counsel supplied; partner-authored TBD sections
  may contain citations; the skill's prose never does.
- **Not fabricated.** Per `references/fabrication-policy.md` and the
  frontmatter `client_facing_fields` block, every numeric or factual
  value either traces to a source or renders as a TBD marker. The
  assembly-time schema contract + cross-subagent consistency rules are
  the structural enforcement of this — incomplete or inconsistent
  subagent returns refuse, they do not silently fill.
