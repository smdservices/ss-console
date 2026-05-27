---

`[SYNTHETIC FIXTURE — NOT A REAL MATTER]`

---

This file is the reference output for fixture 04. The matter has enough total source documents to pass the upstream `insufficient_source_data` check (≥3 sourced rows across categories), but ZERO medical-record-classified documents. The three delegated subagents run; the `medicals_summary` subagent returns empty `medical_chronology` and `per_provider_billing` arrays because no medical-record documents exist in the matter folder. The parent's assembly-time schema contract (ADR 0021 Stream C) rejects the medicals subagent return (the contract requires `medical_chronology` to have ≥1 sourced row). The parent emits `SUBAGENT_INCOMPLETE` and refuses to assemble. NO `Email.create_draft` call. NO draft created.

The runtime's error returned to the caller:

```
SkillRefusalError {
  skill: "demand-letter-draft",
  code: "subagent_incomplete",
  matter_ref: "matter_synthetic_04",
  subagent_role: "medicals_summary",
  missing_key: "medical_chronology",
  expected_min: ">= 1 sourced row",
  user_facing_message: "The skill cannot assemble this demand because the matter has no medical-record documents to source the chronology from. The matter folder contains employment-verification and photo documents, but no medical records. To proceed: upload the client's medical records to the matter folder (classification: medical_record), then re-invoke. The skill refuses to assemble a demand letter from a chronology that has no sourced medical treatment rows — that is not a draft a reviewer-as-sender should ship.",
}
```

The matter-internal sourcing note written at `~/.hermes/customer_notes/holcomb-reyes/pi-demand-incomplete-<date>-matter_synthetic_04.md`:

---

# PI Demand Draft Incomplete — matter_synthetic_04

**Matter:** matter_synthetic_04 (Theodora Marchetti)
**Drafted:** `<ISO-8601 timestamp of run>`
**Draft reference:** (none — schema contract refused before draft creation)
**Voice-gate score:** (not exercised)
**Fabrication-filter result:** (not exercised — refusal upstream of filter)

## Subagent execution

| Subagent            | Status     | Returned keys                                                                                                                                                                                                                                                 |
| ------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `medicals_summary`  | INCOMPLETE | `medical_chronology: []` (empty), `per_provider_billing: []` (empty), `medical_specials_total: "[TBD: no medical-record documents in matter folder]"`                                                                                                         |
| `damages_summary`   | OK         | `lost_wages_total: 2800.00`, `employer_documentation: [doc_401, doc_402]`                                                                                                                                                                                     |
| `liability_summary` | OK         | `date_of_incident: "2026-05-12"`, `incident_location: "Northbound I-17 between Bell Road and Greenway Road, Phoenix, Arizona"`, `client_role: "driver of 2019 Honda Pilot"`, `factual_chronology: <3-sentence prose, sourced from doc_403, doc_404, doc_405>` |

## Schema contract validation

| Subagent            | Required key             | Value                                                   | Validates?                                                                                               |
| ------------------- | ------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `medicals_summary`  | `medical_chronology`     | `[]` (empty)                                            | NO — contract requires ≥1 sourced row                                                                    |
| `medicals_summary`  | `per_provider_billing`   | `[]` (empty)                                            | NO — contract requires ≥1 row OR explicit-TBD `medical_specials_total` (the latter satisfies on its own) |
| `medicals_summary`  | `medical_specials_total` | `"[TBD: no medical-record documents in matter folder]"` | OK — explicit-TBD marker accepted                                                                        |
| `damages_summary`   | `lost_wages_total`       | `2800.00`                                               | OK                                                                                                       |
| `damages_summary`   | `employer_documentation` | `[doc_401, doc_402]`                                    | OK                                                                                                       |
| `liability_summary` | `date_of_incident`       | `"2026-05-12"`                                          | OK                                                                                                       |
| `liability_summary` | `incident_location`      | (string)                                                | OK                                                                                                       |
| `liability_summary` | `client_role`            | `"driver of 2019 Honda Pilot"`                          | OK                                                                                                       |
| `liability_summary` | `factual_chronology`     | (3-sentence prose)                                      | OK                                                                                                       |

The first contract failure (`medical_chronology` empty) triggers refusal. The parent does not attempt to assemble a partial draft with a missing chronology — incomplete sub-research becomes a refusal, not a quietly-incomplete draft.

## Refusal events

- **Code:** subagent_incomplete
- **Offending subagent:** medicals_summary
- **Missing key:** medical_chronology
- **Expected:** ≥1 sourced row
- **Action:** parent refused. No Email.create_draft call. Incomplete sourcing note written.

## Partner-facing remediation

The matter folder has no medical-record documents. To proceed with a demand-letter draft:

1. **Upload the client's medical records.** Place the medical-record PDFs in `/matters/matter_synthetic_04/medical/`. Ensure each document's `classification` field on the PracticeManagement side is `medical_record`. Re-invoke the skill after upload.
2. **If the client genuinely has no medical treatment records,** then a PI demand letter is premature. The matter still needs the client's medical sourcing before settlement valuation is possible.

## Adapter calls made

- PracticeManagement.get_matter("matter_synthetic_04") — 1 call (parent preflight)
- DocumentStorage.list_folder("/matters/matter_synthetic_04") — 1 call (parent preflight readiness check)
- delegate_task × 3 (medicals_summary, damages_summary, liability_summary) — three subagents spawned
- DocumentStorage calls within each subagent — covered by per-subagent audit rows
- (No Email.create_draft call. No subagent return assembled.)

## Audit events emitted

- `SUBAGENT_STOPPED` × 3 — one per subagent (medicals, damages, liability), with `child_role`, `child_status`, `duration_ms` in metadata. Emitted by the overlay's `hermes-smd-audit` plugin on the `subagent_stop` hook.
- `SUBAGENT_INCOMPLETE` — skill=demand-letter-draft, subagent_role=medicals_summary, missing_key=medical_chronology, matter_ref=matter_synthetic_04 (hashed), expected_min=">= 1 sourced row". Emitted by the parent skill BEFORE refusing to assemble.

---

## Why this refusal exists

ADR 0021 Stream C's Devil's Advocate critique flagged that a `delegate_task`-based skill must validate each subagent's return against an explicit schema contract before assembling the final draft. The failure mode the critique called out: a subagent returns `{}` (or a partially-empty payload) because its restricted toolset couldn't reach a needed resource, the parent assembles a draft missing a third of its evidence, and ships it as `draft_for_review`. Trust-ceiling routes it to draft, but the draft itself is silently incomplete — a reviewer-as-sender approving the draft approves the incompleteness.

The assembly-time schema contract is the structural enforcement of that critique: each subagent return is checked against its required-keys list before assembly. A missing or empty required value triggers `SUBAGENT_INCOMPLETE` and refusal. The reviewer-as-sender never sees a quietly-incomplete draft. PI demand letters with missing evidence are malpractice-adjacent; "three subagent_stop audit rows and faster than sequential" is necessary but not sufficient — the assembly contract is the sufficient piece.
