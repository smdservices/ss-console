# Test Cases

The three fixtures in `fixtures/` exercise the three correspondence kinds the skill must handle: a settlement counter-offer, a motion-related letter with proposed order, and a scheduling-negotiation letter. Each fixture demonstrates a specific TBD-marker pattern, a specific prior-correspondence mapping from the EmailThread system of record, and (for the settlement fixture) the dollar-amount verbatim-quote envelope.

Every fixture is synthetic. Every name is fictional. Every email address uses the `.invalid` TLD. Every fixture is watermarked `[SYNTHETIC FIXTURE - NOT A REAL MATTER]` in both the input matter file and the reference output draft.

## Fixture 01: Settlement counter-offer

**Input:** `fixtures/01-settlement-counter-offer-matter.yaml`

Profile: auto-accident matter with a served settlement counter-offer from opposing counsel. The firm sent a demand on April 18, 2026; opposing counsel responded on April 25 with a low initial offer; the firm sent a follow-up on May 5; opposing counsel served the inbound counter-offer on May 12. The inbound proposes a settlement amount, a 30-day payment timing, and a mutual-release condition.

- Matter custom_fields fully populated: client_name, date_of_incident, incident_location, claim_number, case_caption, case_number, opposing_counsel_name, opposing_counsel_firm, opposing_counsel_email
- Inbound message: `msg_inbound_05_12_2026_counter_offer` (received 2026-05-12; settlement-thread metadata present)
- Prior settlement-thread messages: 4 prior messages (April 18 firm demand, April 25 opposing initial offer, May 5 firm follow-up, May 12 opposing counter-offer)
- No motion-correspondence thread, no scheduling thread
- Tone vocabulary memory rule present with 5 categories
- Voice samples count: 35 (above the §9.6 Gate 1 threshold of 30)
- The inbound's tone matches the `contested` keyword set (uses "inadequate" in characterizing the firm's prior demand)

**Expected behavior:**

- Readiness rubric: matter scope IN_SCOPE, status ACTIVE, inbound kind RESOLVED (confidence 0.95 for settlement_counter_offer), tone vocabulary READY, voice envelope READY, citation risk CLEAN, dollar-amount risk QUOTED_OK (dollar amounts in inbound recital and verbatim prior-correspondence synopses only).
- Skill proceeds with full draft. Inbound-claim recital quotes the offer amount, the payment timing, and the release condition verbatim. Prior-correspondence table has 4 rows in chronological order (April 18 outbound, April 25 inbound, May 5 outbound, May 12 inbound). Tone-classification label reads `contested`.
- Email.create_draft called once. DraftRef.folder confirms partner's drafts folder.
- Substantive-response section renders the settlement-counter TBD marker with the no-number, no-acceptance, no-rejection language.
- Closing case-strategy section renders the TBD marker.
- Sourcing note records sourcing for every claim (EmailThread message ID per claim), every prior-correspondence row, and the tone-rule match.
- Fabrication filter result: `clean`. The settlement-counter substantive TBD and the closing case-strategy TBD are the only `none`-tagged renders. Dollar amounts in the inbound recital and verbatim prior-correspondence synopses are exempt under the verbatim-quote carve-out.

**Reference output:** `fixtures/01-settlement-counter-offer-matter-draft.md`. The draft contains the header block, the recitation lead-in, the verbatim inbound-claim recital (4 claims quoted), the tone-classification label, the 4-row prior-correspondence table, the substantive-response TBD marker, the closing TBD, and the partner sign-off block.

## Fixture 02: Motion correspondence

**Input:** `fixtures/02-motion-correspondence-matter.yaml`

Profile: same auto-accident matter at a later point in the case lifecycle. The matter is now in active litigation; opposing counsel has served a meet-and-confer letter regarding a planned motion for summary judgment, with a proposed order attached. The inbound proposes a hearing date, recites the factual basis for the motion, and demands a response within 14 days.

- Matter custom_fields fully populated as in fixture 01
- Inbound message: `msg_inbound_07_22_2026_motion` (received 2026-07-22; motion-correspondence-thread metadata present; PDF attachment `proposed_order_msj_2026-07-22.pdf` flagged on the message)
- Prior motion-correspondence-thread messages: 2 prior messages (June 30 firm letter re: discovery posture, July 10 opposing letter re: discovery dispute)
- Settlement thread continues to exist but is not the inbound's thread
- Tone vocabulary memory rule present
- Voice samples count: 35
- The inbound's tone matches the `procedural` keyword set (uses "meet and confer" prominently)

**Expected behavior:**

- Readiness rubric: matter scope IN_SCOPE, status ACTIVE, inbound kind RESOLVED (confidence 0.92 for motion_correspondence), tone vocabulary READY, voice envelope READY, citation risk QUOTED_OK (the inbound contains a citation to a court rule, but the citation is inside the verbatim-quoted inbound recital), dollar-amount risk CLEAN (no dollar amounts in this fixture).
- Skill proceeds with full draft. Inbound-claim recital quotes the motion title, the relief sought, the proposed hearing date, the response deadline, and the verbatim citation-bearing factual statement from the inbound. Prior-correspondence table has 2 rows. Tone-classification label reads `procedural`.
- Email.create_draft called once.
- Substantive-response section renders the motion-substantive-response TBD marker with the no-concession, no-opposition-framing language.
- Closing case-strategy section renders the TBD marker.
- Sourcing note records sourcing for every claim, including the citation appearing inside the verbatim-quoted inbound section (the sourcing note tags this as `verbatim_quote_exempt`).
- Fabrication filter result: `clean`. The motion-substantive TBD and the closing case-strategy TBD are the only `none`-tagged renders.

**Reference output:** `fixtures/02-motion-correspondence-matter-draft.md`. The draft contains the header, recitation, verbatim motion-inbound recital (5 claims including the verbatim citation), tone-classification label, 2-row motion-correspondence-history table, substantive-response TBD, closing TBD, and sign-off.

## Fixture 03: Scheduling negotiation

**Input:** `fixtures/03-scheduling-negotiation-matter.yaml`

Profile: same auto-accident matter, now in discovery phase. Opposing counsel has served a scheduling letter proposing a deposition of the plaintiff on a specific date with an attached proposed stipulation. The inbound proposes the date, the venue, and a stipulation to extend the discovery-cutoff deadline as a condition.

- Matter custom_fields fully populated
- Inbound message: `msg_inbound_08_05_2026_scheduling` (received 2026-08-05; scheduling-thread metadata present; PDF attachment `proposed_stipulation_extension_2026-08-05.pdf` flagged on the message)
- Prior scheduling-thread messages: 3 prior messages (July 15 firm letter proposing initial deposition window, July 22 opposing letter requesting alternative dates, July 30 firm letter narrowing the window)
- Settlement thread and motion-correspondence thread exist but are not the inbound's thread
- Tone vocabulary memory rule present
- Voice samples count: 35
- The inbound's tone matches the `routine` keyword set (uses "confirming," "as discussed," "pursuant to")

**Expected behavior:**

- Readiness rubric: matter scope IN_SCOPE, status ACTIVE, inbound kind RESOLVED (confidence 0.94 for scheduling_correspondence), tone vocabulary READY, voice envelope READY, citation risk CLEAN, dollar-amount risk CLEAN.
- Skill proceeds with full draft. Inbound-claim recital quotes the proposed date, the proposed venue, the affected deadline, and the conditional stipulation language verbatim. Prior-correspondence table has 3 rows. Tone-classification label reads `routine`.
- Email.create_draft called once.
- Substantive-response section renders the scheduling-substantive-response TBD marker with the no-agreement, no-refusal, no-alternative-date language.
- Closing case-strategy section renders the TBD marker.
- Sourcing note records sourcing for every claim, every prior-correspondence row, and the tone-rule match.
- Fabrication filter result: `clean`. The scheduling-substantive TBD and the closing case-strategy TBD are the only `none`-tagged renders.

**Reference output:** `fixtures/03-scheduling-negotiation-matter-draft.md`. The draft contains the header, recitation, verbatim scheduling-inbound recital (4 claims), tone-classification label, 3-row scheduling-history table, substantive-response TBD, closing TBD, and sign-off.

## What the fixture corpus does NOT cover

Out of scope for the initial three fixtures, deferred to expanded coverage post-v1:

- A `kind_unresolvable` inbound (the detection rubric returns no kind above 0.50 confidence). The refusal path is the same shape as a missing-vocabulary refusal with a different error code; not worth a dedicated fixture at v1.
- A `MIXED` inbound (one letter proposing both a date and an offer). The skill emits a consolidated draft with two response sections; worth a fixture eventually but not v1.
- A matter with `tone_vocabulary_missing` in customer.yaml. Same refusal shape with different error code.
- A matter with voice-samples count below the threshold. Same refusal shape with different error code.
- A matter where the voice gate fails on the recitation lead-in. The skill omits the lead-in prose and ships the structured-tables-only draft. Worth a fixture eventually but not v1.
- A citation-in-source-data refusal (covered by the discovery-response skill's behavior contract; the opposing-counsel-response skill's behavior is identical on this path and a redundant fixture is unnecessary at v1).
- A dollar-amount-in-source-data refusal (the readiness rubric's axis 7). Worth a fixture eventually because it is unique to this skill, but the refusal-shape is identical to the citation-in-source path and v1 coverage is satisfied by the citation-policy fixture pattern.
- A hostile-tone inbound (the partner reviews tone classification but the skill renders the same draft shape regardless of tone). Worth a fixture eventually for adversarial-edge coverage.

The three fixtures together exercise the path that matters most for the safety-architecture claim: that the skill cannot fabricate substantive responses, settlement numbers, motion framings, scheduling commitments, or case-strategy language across the three correspondence kinds. Every fixture's reference output is what the runtime must produce; deviations are skill regressions.

## How the fixtures are used

The fixtures are inputs to three downstream test suites (not implemented by this skill PR; implemented by the workstreams that own them):

1. **Voice-gate harness** (`operator/voice-gate/`, gated through #855). Replays the skill against each fixture and scores the produced draft against the Layer 2 corpus. Pass threshold per skill; this skill's threshold is set conservatively.
2. **Adapter conformance suite** (`src/lib/operator/capabilities/conformance.ts`). Replays the skill against each fixture using mock adapters for PracticeManagement, EmailThread, and Email. Asserts: Email.create_draft called the expected number of times (1, 1, 1 across the three fixtures); DraftRef.folder is the partner's drafts folder; PracticeManagement.get_matter is called read-only; EmailThread.list_messages_for_matter and get_message are called read-only (no message-send calls; no message-modify calls).
3. **Fabrication-filter regression corpus** (`operator/fixtures/fabrication/`, per `docs/specs/operator/fabrication-filter.md`). The expected outputs from these fixtures are added to the regression corpus; a future PR that introduces a `settlement_counter_substantive_response` rendered with a non-empty value must `block` against fixture 01's reference output. A future PR that emits a dollar amount in any skill-authored prose section must `block` against fixture 01's reference output.

The fixtures live at `operator/verticals/law-firm/addons/pi/skills/opposing-counsel-response/fixtures/` (with this skill); the downstream test suites import them. Moving the fixtures elsewhere is a coordinated change across all three suites.
