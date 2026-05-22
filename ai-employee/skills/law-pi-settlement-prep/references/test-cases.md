# Test Cases

The two fixtures in `fixtures/` exercise the two profiles that anchor this skill's behavior: a low-severity matter with clear liability where the comparable-verdict corpus surfaces multiple matching rows, and a higher-severity matter with contested liability where the corpus surfaces fewer rows and one of the weaknesses fact-list entries is non-empty.

Every fixture is synthetic. Every name is fictional. Every email address uses the `.invalid` TLD. Every fixture is watermarked `[SYNTHETIC FIXTURE - NOT A REAL MATTER]` in both the input matter file and the reference output memo.

## Fixture 01 - Soft-tissue matter with clear liability

**Input:** `fixtures/01-soft-tissue-clear-liability-matter.yaml`

Profile: auto-accident matter. Client rear-ended at a stoplight, police report attributes fault to the opposing party operator, soft-tissue injuries documented across six weeks of treatment, no prior injury history in the relevant body region, employer-verified lost wages, demand letter served, settlement conference scheduled. Carrier and opposing counsel are both in the firm's prior-pattern corpus.

- Matter custom_fields fully populated: client_name, date_of_incident, incident_location, claim_number, case_caption, case_number, opposing_counsel_name, opposing_counsel_firm, opposing_carrier_name, settlement_conference_date, demand_served_date, conference_location, mediator_name, attendees_recorded
- Matter folder contains: 4 medical records, 2 billing statements, 1 employment verification, 1 lost-wages statement, 1 police report, 2 incident photos, 1 demand letter copy
- Comparable-verdict memory rule contains 12 rows; 3 rows match the matter profile (auto-accident, soft-tissue, Maricopa County, clear liability)
- Opposing-counsel prior-pattern memory rule contains a row for the named opposing counsel
- Carrier prior-pattern memory rule contains a row for the named carrier
- Voice samples count: 38 (above the §9.6 Gate 1 threshold of 30); 7 samples tagged internal_prep_memo

**Expected behavior:**

- Readiness rubric: matter scope IN_SCOPE, status ACTIVE, conference date SCHEDULED, document corpus READY, comparable-verdict corpus READY, voice envelope READY, citation risk CLEAN.
- Skill proceeds with full memo. Matter-facts summary one paragraph. Conference logistics block populated. Chronology lists ten events. Damages tables compute totals (medical specials $14,500; lost wages $2,340). Strengths fact list has 4 entries (sourced). Weaknesses fact list has 0 entries; the section emits the "no documented weaknesses" prose. Comparable-verdict table surfaces 3 rows verbatim from the corpus. Opposing-counsel pattern table surfaces 1 row. Carrier pattern table surfaces 1 row. Five TBD sections render as TBD markers. Exhibit list has 11 entries.
- Email.create_draft called once. DraftRef.folder confirms partner's drafts folder. Recipient is the partner's own direct_email (internal memo).
- Sourcing note records sourcing for every row, every cell.
- Fabrication filter result: `clean`.

**Reference output:** `fixtures/01-soft-tissue-clear-liability-matter-memo.md`.

## Fixture 02 - Disc-herniation matter with contested liability

**Input:** `fixtures/02-disc-herniation-contested-liability-matter.yaml`

Profile: auto-accident matter. Client struck while making a left turn at an intersection where right-of-way is contested (the police report records both operators' statements without attribution of fault). MRI documents L4-L5 disc herniation. Prior medical history records a 2021 lumbar strain at the same level (a documented weakness). Treatment included orthopedic consults and physical therapy across eleven weeks. Employer-verified lost wages. Demand letter served. Settlement conference scheduled. Opposing counsel is in the firm's prior-pattern corpus; the carrier is NOT in the corpus.

- Matter custom_fields populated: client_name, date_of_incident, incident_location, claim_number, case_caption, case_number, opposing_counsel_name, opposing_counsel_firm, opposing_carrier_name (unfamiliar to firm), settlement_conference_date, demand_served_date, prior_back_injury_history (documented), conference_location
- Matter folder contains: 6 medical records (including MRI), 3 billing statements, 1 employment verification, 1 lost-wages statement, 1 police report (no fault attribution), 3 incident photos, 1 demand letter copy
- Comparable-verdict memory rule contains 12 rows; 2 rows match the matter profile (auto-accident, disc herniation, Maricopa County, contested liability)
- Opposing-counsel prior-pattern memory rule contains a row for the named opposing counsel
- Carrier prior-pattern memory rule does NOT contain a row for the named carrier
- Voice samples count: 38; 7 samples tagged internal_prep_memo

**Expected behavior:**

- Readiness rubric: matter scope IN_SCOPE, status ACTIVE, conference date SCHEDULED, document corpus READY, comparable-verdict corpus READY (2 rows match), voice envelope READY, citation risk CLEAN.
- Skill proceeds with full memo. Matter-facts summary names the contested-liability profile. Conference logistics block populated. Chronology lists fifteen events. Damages tables compute totals (medical specials $32,800; lost wages $5,460). Strengths fact list has 3 entries (MRI confirms disc herniation, first medical contact within four days, employer continuity documented). Weaknesses fact list has 2 entries (prior 2021 lumbar strain at the same level documented in matter custom_field, police report attributes no fault). Comparable-verdict table surfaces 2 rows verbatim. Opposing-counsel pattern table surfaces 1 row. Carrier pattern table renders the corpus-absent prose ("no prior-pattern data on <carrier name> in firm memory"). Five TBD sections render as TBD markers. Exhibit list has 14 entries.
- Email.create_draft called once.
- Sourcing note records the corpus-absence for the carrier pattern table.
- Fabrication filter result: `clean`.

**Reference output:** `fixtures/02-disc-herniation-contested-liability-matter-memo.md`.

## What the fixture corpus does NOT cover

Out of scope for the initial two fixtures, deferred to expanded coverage post-v1:

- A matter where the comparable-verdict corpus has no matching rows. The behavior is documented (table renders corpus-absent prose; bracket TBD notes the absence). Deferred to a third fixture once the v1 customer's memory-rule onboarding has produced enough corpus thinness to merit a fixture.
- A matter with `comparable_verdict_corpus_missing` invoked with `--no-comparable-verdicts`. The refusal-flag behavior is documented; not worth a dedicated fixture at v1.
- A matter with voice samples count below the threshold. Same refusal shape with different error code.
- A matter with voice samples count above 30 but fewer than 5 tagged internal_prep_memo. The skill proceeds with a warning; worth a fixture eventually but not v1.
- A matter where the voice gate fails on the matter-facts summary. The skill omits the prose and ships the structured-tables-only memo. Worth a fixture eventually but not v1.
- A premises or product-liability matter. Deferred to post-launch when the customer's actual matter portfolio informs the fixture.
- A medmal matter. Deferred per the same rationale.
- A citation-in-source-data refusal. Covered by the discovery-response and demand-letter skills' fixtures; the prep-memo behavior is identical and a redundant fixture is unnecessary at v1.

The two fixtures together exercise the path that matters most for the safety-architecture claim: that the skill cannot fabricate a settlement bracket, a posture recommendation, a legal-argument characterization of strengths or weaknesses, or a case-strategy commitment across two matter profiles with different liability and severity signatures.

## How the fixtures are used

The fixtures are inputs to three downstream test suites (not implemented by this skill PR; implemented by the workstreams that own them):

1. **Voice-gate harness** (`ai-employee/voice-gate/`, gated through #855). Replays the skill against each fixture and scores the produced memo against the Layer 2 internal-memo corpus. Pass threshold per skill; this skill's threshold is set conservatively.
2. **Adapter conformance suite** (`src/lib/ai-employee/capabilities/conformance.ts`). Replays the skill against each fixture using mock adapters. Asserts: Email.create_draft called once per fixture; DraftRef.folder is the partner's drafts folder; recipient is the partner's own direct_email; PracticeManagement.get_matter is called read-only; DocumentStorage.list_folder and download_document are called read-only.
3. **Fabrication-filter regression corpus** (`ai-employee/fixtures/fabrication/`, per `docs/specs/ai-employee/fabrication-filter.md`). The expected outputs from these fixtures are added to the regression corpus; a future PR that introduces a `settlement_bracket_recommendation` rendered with non-empty content must `block` against fixture 01's reference output.

The fixtures live at `ai-employee/skills/law-pi-settlement-prep/fixtures/`; the downstream test suites import them.
