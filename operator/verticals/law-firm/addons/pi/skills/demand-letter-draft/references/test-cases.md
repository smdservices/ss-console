# Test Cases

The three fixtures in `fixtures/` exercise the three behavior classes the skill must handle: a clean matter that produces a full draft, a partial matter that produces a draft with TBD markers in expected places, and a high-risk matter that the readiness rubric refuses.

Every fixture is synthetic. Every name is fictional. Every email address uses the `.invalid` TLD. Every fixture is watermarked `[SYNTHETIC FIXTURE — NOT A REAL MATTER]` in both the input matter file and the reference output draft.

## Fixture 01 — Clean matter, full draft

**Input:** `fixtures/01-clean-matter.yaml`

Profile: auto-accident matter with ample sourced documents.

- 5 medical records (ED admission, MRI report, 3 follow-up notes)
- 3 billing statements (hospital, imaging, orthopedics)
- 2 employment-verification documents (employer letter, pay stubs)
- 4 photo exhibits
- All matter custom_fields populated: client_name, date_of_incident, incident_location, claim_number, opposing_carrier, opposing_adjuster_name, opposing_adjuster_email, employer_name
- Voice samples count: 35 (above the §9.6 Gate 1 threshold of 30)

**Expected behavior:**

- Readiness rubric: matter scope IN_SCOPE, status ACTIVE, source-data density READY, voice envelope READY, citation risk CLEAN.
- Skill proceeds with full draft. Case-history paragraph attempted; voice gate is expected to pass.
- Email.create_draft called once. DraftRef.folder confirms partner's drafts folder.
- Sourcing note records sourcing for every section. No "could not source" entries.
- Fabrication filter result: `clean`. Four `none`-tagged sections render as TBD markers (liability, settlement bracket, demand amount, closing). All `matter_attribute` and `system_of_record` fields render with the sourced value.

**Reference output:** `fixtures/01-clean-matter-draft.md`. The draft contains the full case-history paragraph, complete chronology table (5 rows), complete medical-specials tabulation with total, complete lost-wages tabulation with total, the four TBD markers in the four expected sections, the complete exhibit list (9 exhibits), and the partner sign-off block.

## Fixture 02 — Missing employment verification

**Input:** `fixtures/02-missing-wages-matter.yaml`

Profile: auto-accident matter with ample medical and billing data but no employment-verification documents.

- 4 medical records
- 2 billing statements
- 0 employment-verification documents
- 2 photo exhibits
- Matter custom_fields populated for opposing-side data, but `employer_name` is null
- Voice samples count: 32

**Expected behavior:**

- Readiness rubric: matter scope IN_SCOPE, status ACTIVE, source-data density PARTIAL, voice envelope READY, citation risk CLEAN.
- Skill proceeds with draft. The lost-wages section renders as `[TBD: lost wages — partner supplies after employer verification received]`. The opening recital's lost-wages clause renders as a TBD marker rather than dropping the clause. The exhibit list does not include employer-letter or pay-stub exhibits.
- Email.create_draft called once.
- Sourcing note's "could not source" section: lost wages (no employer letter), pre-incident wage history (no pay stubs).
- Fabrication filter result: `clean`. The TBD render for `lost_wages_total` is the correct outcome; the filter does not flag a properly-rendered TBD.

**Reference output:** `fixtures/02-missing-wages-matter-draft.md`. The draft contains the case-history paragraph, complete medical chronology, complete medical-specials tabulation, the lost-wages TBD marker, the four legal-judgment TBD markers, a 6-exhibit list (no employment exhibits), and the partner sign-off block.

## Fixture 03 — Citation in source data, refusal

**Input:** `fixtures/03-citation-in-source-matter.yaml`

Profile: auto-accident matter with ample documents and well-populated custom_fields, but the partner's `case_summary` narrative field contains a citation the skill would otherwise propagate into its factual prose.

- 4 medical records
- 3 billing statements
- 2 employment-verification documents
- 3 photo exhibits
- All matter custom_fields populated
- `matter.custom_fields.case_summary` contains: "Liability is clear under the rule in `Smith v. Jones, 123 F.3d 456 (3d Cir. 2010)`."
- Voice samples count: 38

**Expected behavior:**

- Readiness rubric: matter scope IN_SCOPE, status ACTIVE, source-data density READY, voice envelope READY, citation risk PROPAGATION_RISK.
- Skill refuses with `citation_in_source`. No draft is created. Email.create_draft is NOT called.
- Sourcing note records the refusal: offending field `case_summary`, matched pattern `case_name_citation`, partner-facing remediation note (edit the field to remove or quote-isolate the citation, then re-invoke).
- Fabrication filter is not exercised (no draft to filter).

**Reference output:** `fixtures/03-citation-in-source-refusal.md`. The output is the matter-internal sourcing note showing the refusal, NOT a draft letter. (The fixture demonstrates that refusal IS a first-class output of the skill; the partner sees the refusal note in the same dashboard surface they would see a successful draft notification.)

## What the fixture corpus does NOT cover

Out of scope for the initial three fixtures, deferred to expanded coverage post-v1:

- A matter with `INSUFFICIENT` source-data density (fewer than three medical records). The refusal path is the same shape as fixture 03 with a different error code; not worth a dedicated fixture at v1.
- A matter with voice-samples count below the threshold. Same refusal shape as fixture 03 with different error code.
- A matter with a future-dated chronology row. The fabrication filter's `future_date` marker flags rather than blocks; the partner verifies. Worth a fixture eventually but not v1.
- A matter where the voice gate fails. The skill omits the case-history paragraph and ships the structured-only draft. Worth a fixture eventually.
- A medmal matter. Different document patterns and chronology shape; deferred to post-launch when the customer's actual document corpus informs the fixture.

The three fixtures together exercise the path that matters most for the safety-architecture claim: that the skill cannot fabricate medical specials totals, lost-wages figures, dates, named persons, or settlement-bracket dollar amounts. Every fixture's reference output is what the runtime must produce; deviations are skill regressions.

## How the fixtures are used

The fixtures are inputs to three downstream test suites (not implemented by this skill PR; implemented by the workstreams that own them):

1. **Voice-gate harness** (`operator/voice-gate/`, gated through #855). Replays the skill against each fixture and scores the produced draft against the Layer 2 corpus. Pass threshold per skill; this skill's threshold is set conservatively.
2. **Adapter conformance suite** (`src/lib/operator/capabilities/conformance.ts`). Replays the skill against each fixture using mock adapters for PracticeManagement, DocumentStorage, and Email. Asserts: Email.create_draft called the expected number of times (1, 1, 0 across the three fixtures); DraftRef.folder is the partner's drafts folder; PracticeManagement.get_matter is called read-only (no update_matter calls); DocumentStorage.list_folder is called read-only (no upload_document calls).
3. **Fabrication-filter regression corpus** (`operator/fixtures/fabrication/`, per `docs/specs/operator/fabrication-filter.md`). The expected outputs from these fixtures are added to the regression corpus; a future PR that introduces a `liability_characterization` rendered with non-empty content must `block` against fixture 01's reference output.

The fixtures live at `operator/verticals/law-firm/addons/pi/skills/demand-letter-draft/fixtures/` (with this skill); the downstream test suites import them. Moving the fixtures elsewhere is a coordinated change across all three suites.
