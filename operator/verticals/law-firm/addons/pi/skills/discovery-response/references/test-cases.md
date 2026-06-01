# Test Cases

The three fixtures in `fixtures/` exercise the three request kinds the skill must handle: standard interrogatories, requests for production of documents, and requests for admission. Each fixture demonstrates a specific TBD-marker pattern, a specific responsive-document mapping, and (for the RFP fixture) the privilege-log skeleton shape.

Every fixture is synthetic. Every name is fictional. Every email address uses the `.invalid` TLD. Every fixture is watermarked `[SYNTHETIC FIXTURE - NOT A REAL MATTER]` in both the input matter file and the reference output draft.

## Fixture 01 - Standard interrogatories

**Input:** `fixtures/01-interrogatories-matter.yaml`

Profile: auto-accident matter with a served First Set of Interrogatories from opposing counsel containing 15 numbered interrogatories. The interrogatories cover a mix of routine identification requests (interrogatory 1: identify persons with discoverable information), routine matter-facts requests (interrogatory 4: state the dates of medical treatment), and probing requests that match multiple objection categories (interrogatory 8: describe in detail every prior personal-injury claim filed by the plaintiff; interrogatory 12: identify all healthcare providers who have treated the plaintiff in the past ten years).

- Matter custom_fields fully populated: client_name, date_of_incident, incident_location, claim_number, case_caption, case_number, opposing_counsel_name, opposing_counsel_firm, opposing_counsel_email
- Served discovery-request document: doc_99 (served 2026-05-12; response due 2026-06-11 per Arizona Rules of Civil Procedure 33 default 30-day window from customer.yaml jurisdiction rule)
- Matter folder contains 8 documents (5 medical, 2 billing, 1 employment), 2 of which are work-product / client-communication candidates for the privilege log
- Objection vocabulary memory rule present with 9 categories
- Voice samples count: 35 (above the §9.6 Gate 1 threshold of 30)

**Expected behavior:**

- Readiness rubric: matter scope IN_SCOPE, status ACTIVE, request parseability PARSED, objection vocabulary READY, voice envelope READY, citation risk CLEAN.
- Skill proceeds with full draft. Per-request response table has 15 rows. Each row has the verbatim interrogatory text, the matched objection-category labels (or "(no categories matched)"), and a TBD marker for the substantive answer.
- Email.create_draft called once. DraftRef.folder confirms partner's drafts folder.
- Privilege log section renders the "no flagged documents" prose because interrogatories do not produce documents; the privilege-log shape applies to RFPs and is omitted for interrogatories. (The skill emits the privilege-log section header followed by a one-sentence note that the section applies to RFPs.)
- Sourcing note records sourcing for every row, every cell. No "could not source" entries.
- Fabrication filter result: `clean`. The 15 substantive-answer TBDs are the only `none`-tagged renders; the closing case-strategy TBD is the sixteenth.

**Reference output:** `fixtures/01-interrogatories-matter-draft.md`. The draft contains the header block, the recitation lead-in, the 15-row interrogatory response table, the privilege-log section with the "applies to RFPs" note, the closing TBD marker, and the partner sign-off block. No exhibit list (interrogatories produce no exhibits absent stipulation).

## Fixture 02 - Requests for production

**Input:** `fixtures/02-requests-for-production-matter.yaml`

Profile: same auto-accident matter at a later point in the case lifecycle, now with a served First Request for Production of Documents containing 10 numbered requests. The RFPs cover: medical records (RFP 1), prior medical records 10 years back (RFP 3, matches `overbroad` and `not proportional`), communications with prior counsel (RFP 5, matches `attorney-client privilege`), expert communications (RFP 7, matches `work-product`), and a request for all documents touching the incident (RFP 9, broad scope).

- Matter custom_fields fully populated as in fixture 01
- Served discovery-request document: doc_100 (served 2026-06-15; response due 2026-07-15)
- Matter folder contains 14 documents total: 5 medical records, 2 billing statements, 2 employment-verification, 2 photo exhibits, 1 client-intake-notes file (potential privilege), 1 internal-strategy memo (potential privilege), 1 expert-communication file (potential privilege)
- Objection vocabulary memory rule present
- Voice samples count: 35

**Expected behavior:**

- Readiness rubric: matter scope IN_SCOPE, status ACTIVE, request parseability PARSED, objection vocabulary READY, voice envelope READY, citation risk CLEAN.
- Skill proceeds with full draft. Per-request response table has 10 rows. Each row has the verbatim request text, the matched objection-category labels, the responsive-document column populated with comma-separated `StoredDocument.id` values for matching documents (or `(no responsive non-privileged documents in matter file)` for requests fully blocked by privilege; or a TBD marker for requests with no document matches and no objections), and a TBD marker for the production posture.
- Privilege log skeleton populated with 3 rows (the client-intake notes, the internal-strategy memo, and the expert-communication file). Each row has document metadata sourced from `StoredDocument`; each privilege-claim cell is a TBD marker.
- Exhibit list appended (Exhibits A through E for the 5 medical records, plus appropriate other categories).
- Email.create_draft called once.
- Sourcing note records 10 rows of request mapping, the per-request responsive-document scan results, and the 3 privilege-log rows.
- Fabrication filter result: `clean`. The 10 production-posture TBDs, the 3 privilege-claim TBDs, and the closing case-strategy TBD are the only `none`-tagged renders. The responsive-document column for RFP 9 (broad scope) renders as a TBD marker on the partner-confirms-scope rule rather than producing an arbitrarily-scoped list; the sourcing note records the absence.

**Reference output:** `fixtures/02-requests-for-production-matter-draft.md`. The draft contains the header, recitation, 10-row RFP response table, privilege log with 3 rows, closing TBD, sign-off, and exhibit list.

## Fixture 03 - Requests for admission

**Input:** `fixtures/03-requests-for-admission-matter.yaml`

Profile: same auto-accident matter, now served a First Set of Requests for Admission with 8 numbered matters for admission. The RFAs cover: routine identifying facts (RFA 1: admit the plaintiff was operating the named vehicle on the date of loss), opinion-bearing matters (RFA 3: admit the defendant's vehicle did not cause the plaintiff's disc herniation - matches `seeks expert opinion`), premature-valuation matters (RFA 5: admit the medical specials exceed $25,000 - matches `premature` and `seeks expert opinion`), and partially-true matters where the admit/deny mix is partner work (RFA 6: admit the plaintiff was wearing a seatbelt at the time of impact).

- Matter custom_fields fully populated
- Served discovery-request document: doc_101 (served 2026-06-20; response due 2026-07-20)
- Matter folder unchanged from fixture 02
- Objection vocabulary memory rule present
- Voice samples count: 35

**Expected behavior:**

- Readiness rubric: matter scope IN_SCOPE, status ACTIVE, request parseability PARSED, objection vocabulary READY, voice envelope READY, citation risk CLEAN.
- Skill proceeds with full draft. Per-request response table has 8 rows. Each row has the verbatim RFA text, the matched objection-category labels, and a TBD marker for the admission-or-denial.
- Privilege log section renders the "no privileged documents flagged for RFA filing" prose because RFAs do not request documents and do not produce a privilege log; the skill emits the privilege-log section header followed by the one-sentence note that the section applies to RFPs.
- No exhibit list (RFAs produce no exhibits).
- Email.create_draft called once.
- Sourcing note records 8 rows of RFA mapping; no responsive-document scan was needed.
- Fabrication filter result: `clean`. The 8 admit-or-deny TBDs and the closing case-strategy TBD are the only `none`-tagged renders.

**Reference output:** `fixtures/03-requests-for-admission-matter-draft.md`. The draft contains the header, recitation, 8-row RFA response table, the privilege-log "applies to RFPs" note, closing TBD, and sign-off block.

## What the fixture corpus does NOT cover

Out of scope for the initial three fixtures, deferred to expanded coverage post-v1:

- A request with parseability score below 70% (degraded OCR, unparseable structure). The refusal path is the same shape as a missing-vocabulary refusal with a different error code (`request_unparseable`); not worth a dedicated fixture at v1.
- A matter with `objection_vocabulary_missing` in customer.yaml. Same refusal shape with different error code.
- A matter with voice-samples count below the threshold. Same refusal shape with different error code.
- A matter where the voice gate fails on the recitation lead-in. The skill omits the lead-in prose and ships the structured-tables-only draft. Worth a fixture eventually but not v1.
- A combined-discovery filing that mixes interrogatories and RFPs in one document. The skill handles this by emitting one draft with two response-table sections; worth a fixture eventually but not v1.
- A medmal matter with different document patterns. Deferred to post-launch when the customer's actual document corpus informs the fixture.
- A citation-in-source-data refusal (covered by the demand-letter skill's fixture 03; the discovery-response skill's behavior is identical on this path and a redundant fixture is unnecessary at v1).

The three fixtures together exercise the path that matters most for the safety-architecture claim: that the skill cannot fabricate substantive answers, privilege-claim characterizations, admissions, or case-strategy commitments across the three request kinds. Every fixture's reference output is what the runtime must produce; deviations are skill regressions.

## How the fixtures are used

The fixtures are inputs to three downstream test suites (not implemented by this skill PR; implemented by the workstreams that own them):

1. **Voice-gate harness** (`operator/voice-gate/`, gated through #855). Replays the skill against each fixture and scores the produced draft against the Layer 2 corpus. Pass threshold per skill; this skill's threshold is set conservatively.
2. **Adapter conformance suite** (`src/lib/operator/capabilities/conformance.ts`). Replays the skill against each fixture using mock adapters for PracticeManagement, DocumentStorage, and Email. Asserts: Email.create_draft called the expected number of times (1, 1, 1 across the three fixtures); DraftRef.folder is the partner's drafts folder; PracticeManagement.get_matter is called read-only (no update_matter calls); DocumentStorage.list_folder and download_document are called read-only (no upload_document calls; the optional --stage-request path is not exercised by these fixtures).
3. **Fabrication-filter regression corpus** (`operator/fixtures/fabrication/`, per `docs/specs/operator/fabrication-filter.md`). The expected outputs from these fixtures are added to the regression corpus; a future PR that introduces a `substantive_answer_per_request` rendered with non-empty content must `block` against fixture 01's reference output.

The fixtures live at `operator/verticals/law-firm/addons/pi/skills/discovery-response/fixtures/` (with this skill); the downstream test suites import them. Moving the fixtures elsewhere is a coordinated change across all three suites.
