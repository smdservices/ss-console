# Discovery Response Drafter: response-format statutes (California)

The Civil Discovery Act sections that dictate the **form** a response must take. They are
what makes a response set mechanically correct: which dispositions are permitted, what a
statement of inability has to contain, how an objection has to be stated, who signs.

They are not a license to advise. The skill drafts to the form these sections require and
cites them inside matter-internal artifacts only. Whether an objection is proper, whether
a disposition is the right one, and whether the set is ready to serve are the attorney's
calls. Statute citations never go in email (see the delivery-channel rule in `SKILL.md`).

> **Statute grounding, fetched and verified 2026-07-28** via
> [FindLaw, California Code of Civil Procedure](https://codes.findlaw.com/ca/code-of-civil-procedure/),
> for the ten sections marked VERIFIED below. Sections marked TO VERIFY AT CONNECT were
> not fetched in this pass and must be confirmed against
> [California Legislative Information (leginfo)](https://leginfo.legislature.ca.gov/faces/codesTOCSelected.xhtml?tocCode=CCP)
> before any of them is relied on in a draft. California discovery provisions are
> amendment-prone; re-verify the whole set at connect and on any amendment.

## Interrogatories (CCP 2030.x)

- **2030.210, permitted forms of response. VERIFIED 2026-07-28.** Subdivision (a): the
  party responds with an answer containing the information sought, an exercise of the
  party's option to produce writings, or an objection to the particular interrogatory.
  Subdivision (b): the first paragraph, immediately below the title of the case, carries
  the identity of the responding party, the set number, and the identity of the
  propounding party. Subdivision (c): each answer, exercise of option, or objection bears
  the same identifying number or letter and is in the same sequence as the corresponding
  interrogatory. That numbering rule is what the coverage diff checks against.
- **2030.220, completeness. VERIFIED 2026-07-28.** (a) Each answer is as complete and
  straightforward as the information reasonably available to the responding party
  permits. (b) An interrogatory that cannot be answered completely is answered to the
  extent possible. (c) Where the responding party lacks personal knowledge sufficient to
  respond fully, the response says so, and states that a reasonable and good faith effort
  to obtain the information by inquiry to other natural persons or organizations was
  made, except where the information is equally available to the propounding party. That
  statement is not a formality: a response that simply omits what is not known, without
  it, is incomplete on its face.
- **2030.230, option to produce writings. TO VERIFY AT CONNECT.** Available only where the
  answer would require compiling or summarizing documents and the burden is substantially
  the same for both parties, and it requires specifying the writings in sufficient detail
  for the propounding party to locate and identify them. Never a way around a question
  that can be answered.
- **2030.240, objections. VERIFIED 2026-07-28.** (a) If only part of an interrogatory is
  objectionable, the remainder is answered. (b) The specific ground for the objection is
  set forth clearly in the response; where the objection rests on privilege, the
  particular privilege is clearly stated, and a work-product claim is expressly asserted.
- **2030.250, signature and verification. VERIFIED 2026-07-28.** The party to whom the
  interrogatories are directed signs the response under oath **unless the response
  contains only objections**. For an entity, an officer or agent signs under oath on its
  behalf. The attorney for the responding party signs any response that contains an
  objection. So a mixed answers-and-objections set carries both signatures, and the
  attorney signature is not a substitute for the party verification.
- **2030.260, response deadline. TO VERIFY AT CONNECT.** The 30-day base period. Captured
  as a trigger fact, never computed as final by this skill.
- **2030.290, untimely response. TO VERIFY AT CONNECT.** Failure to serve a timely
  response waives objections, including privilege and work product, with relief available
  only on motion. This is why a near deadline is an escalation and not a note.
- **2030.300, motion to compel further. Grounded 2026-07-01** in
  `meet-and-confer-drafter/SKILL.md` (the 45-day rule). Out of scope here: this skill
  responds to a served set, it does not move against one.

## Requests for production (CCP 2031.x)

- **2031.210, permitted forms of response. VERIFIED 2026-07-28.** Subdivision (a) gives
  three, and only three, dispositions per item: a statement that the party will comply, a
  representation that the party lacks the ability to comply, or an objection. Subdivision
  (b) is the same identity-and-set-number header rule as interrogatories; subdivision (c)
  the same number-and-sequence rule. Subdivision (d): an objection to electronically
  stored information based on inaccessibility identifies the types or categories of
  sources asserted not reasonably accessible.
- **2031.220, statement of compliance. TO VERIFY AT CONNECT.** A statement of compliance
  states that the production will be allowed in whole or in part and that all documents in
  the responding party's possession, custody, or control to which no objection is made
  will be included. It must not be drafted before someone has confirmed the documents
  exist and can be produced.
- **2031.230, inability to comply. VERIFIED 2026-07-28.** The representation affirms that
  a diligent search and a reasonable inquiry have been made; specifies whether the
  inability is because the item never existed, has been destroyed, has been lost,
  misplaced, or stolen, or has never been or is no longer in the responding party's
  possession, custody, or control; and sets forth the name and address of any natural
  person or organization known or believed to have possession, custody, or control of the
  item. All three parts are required. This is not a place for a general disclaimer.
- **2031.240, partial compliance and objections. VERIFIED 2026-07-28.** (a) Where only
  part of an item or category is objectionable, the response contains a statement of
  compliance or a representation of inability as to the remainder. (b)(1) The response
  identifies with particularity the document, tangible thing, land, or electronically
  stored information to which an objection is made. (b)(2) It sets forth clearly the
  extent of, and the specific ground for, the objection, and where the objection rests on
  privilege, the particular privilege invoked is stated. (c)(1) Where the objection rests
  on privilege or work product, the response provides sufficient factual information for
  other parties to evaluate the merits of the claim, **including, if necessary, a
  privilege log**. That subdivision codifies the California case law on privilege logs.
- **2031.250, signature and verification. TO VERIFY AT CONNECT.** The production-response
  analogue of 2030.250.
- **2031.260, response deadline. TO VERIFY AT CONNECT.** The 30-day base period.
- **2031.280(a), identifying produced documents. VERIFIED 2026-07-28.** Documents or
  categories produced in response to a demand are identified with **the specific request
  number to which the documents respond**. The production index and the response numbers
  have to match, which is a second reason the coverage diff is numbered against the served
  set.
- **2031.300, untimely response. TO VERIFY AT CONNECT.** Objection waiver on untimeliness,
  the production analogue of 2030.290.
- **2031.310 / 2031.320, motions to compel further and to compel compliance.** Out of
  scope for this skill; 2031.310 is grounded 2026-07-01 in `meet-and-confer-drafter`.

## Requests for admission (CCP 2033.x)

- **2033.210, permitted forms of response. VERIFIED 2026-07-28.** Each response answers
  the substance of the requested admission or sets forth an objection to the particular
  request. Same identity-and-set-number header rule, and the same number-and-sequence
  rule as the other two devices.
- **2033.220, answering. VERIFIED 2026-07-28.** (a) Each answer is as complete and
  straightforward as the information reasonably available permits. (b) Each answer admits
  so much of the matter as is true, either as expressed in the request or as reasonably
  and clearly qualified; denies so much as is untrue; and specifies so much as to the
  truth of which the responding party lacks sufficient information or knowledge. (c) That
  last response requires a statement that **a reasonable inquiry concerning the matter in
  the particular request has been made**, and that the information known or readily
  obtainable is insufficient to enable the party to admit the matter.
- **2033.230, partial admission. TO VERIFY AT CONNECT.** Where only part of a request is
  objectionable, the remainder is answered.
- **2033.240, signature and verification. TO VERIFY AT CONNECT.** The admissions analogue
  of 2030.250.
- **2033.250, response deadline. TO VERIFY AT CONNECT.** The 30-day base period.
- **2033.280, untimely response. TO VERIFY AT CONNECT.** Objection waiver on untimeliness,
  and the propounding party's route to deemed admissions. The most consequential
  untimeliness in the three devices, which is why the deadline trigger facts are captured
  and escalated rather than quietly tabled.
- **2033.290, motion to compel further.** Out of scope; grounded 2026-07-01 in
  `meet-and-confer-drafter`.

## Adjacent sections the drafting touches

- **2023.010(e) and (f).** An objection made without substantial justification, and an
  evasive response, are misuses of the discovery process. This is the exposure behind the
  candidate-objections-only rule and behind cutting a boilerplate general-objections block
  back to what this record supports. TO VERIFY AT CONNECT.
- **2030.060(f) and (d), subparts and compound interrogatories.** Ground for a candidate
  objection on an incoming special interrogatory that is not full and complete in itself
  or that carries impermissible subparts. Note the direction: on **incoming** sets this is
  a candidate objection the attorney weighs. The one-fact-per-interrogatory lint (gate 8)
  runs on sets the firm **propounds**, which is `follow-up-discovery-drafter`, not this
  skill. TO VERIFY AT CONNECT.
- **2015.5, declaration form.** The verification declaration requires the date and the
  place of execution. Both are left blank for the client to complete at signing, always.
  TO VERIFY AT CONNECT.
- **1013 and 1010.6(a)(3)(B), service-method extensions.** Captured as deadline trigger
  facts only. The certified rules engine owns the computation
  (`deadline-input-never-final`). Grounded 2026-07-01 in `meet-and-confer-drafter`.
- **Evidence Code 954 (attorney-client privilege) and CCP 2018.030 (work product).** The
  grounds a privilege candidate is flagged under. The skill flags and holds out; it never
  asserts or clears either. TO VERIFY AT CONNECT.
