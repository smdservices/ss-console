---

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

---

This file is the reference output draft for fixture 02. A correctly-implemented runtime replaying the skill against `02-motion-correspondence-matter.yaml` produces this draft body (modulo the date in the header block, which renders as the date of the test run).

The `Email.create_draft` envelope:

- `reviewer_account_id`: `sarah.holcomb@holcomb-reyes.invalid`
- `to`: `["twhitfield@whitfield-reardon.invalid"]`
- `cc`: `[]`
- `bcc`: `[]`
- `subject`: `Re: Meet and confer regarding motion for summary judgment, Holloway v. Kerr`
- `thread_id`: `thread_motion_18`
- `matter_ref`: `matter_synthetic_opp_02`
- `drafted_by_skill`: `law-pi-opposing-counsel-response`

Note: the inbound recital includes verbatim court-rule citations (Ariz. R. Civ. P. 16 and Ariz. R. Civ. P. 56) that appear inside the verbatim-quote envelope. The citation-refusal substrate's `verbatim_quote_exempt` flag respects the carve-out per `references/citation-policy.md`; the substrate does not block on these strings. The skill-authored prose around the recital is fully citation-free.

The draft body (everything below the next horizontal rule):

---

Holcomb & Reyes, LLP
1810 N Central Avenue, Suite 800
Phoenix, AZ 85004

`<today's date in "Month D, YYYY" format>`

Theodora Whitfield
Whitfield Reardon, PLLC
4477 N Central Avenue, Suite 1500
Phoenix, AZ 85012

Re: Holloway v. Kerr
Case Number: CV2026-006491
Our Client: Janet Holloway
Response Due: August 5, 2026

---

Plaintiff Janet Holloway, by and through undersigned counsel, responds to opposing counsel's meet-and-confer letter of July 22, 2026 regarding a planned motion for summary judgment. The factual claims in the inbound message are quoted in the section below; the response posture is set out under separate cover.

## Inbound factual claims (verbatim quotes from opposing counsel's letter of July 22, 2026)

Inbound, paragraph 1: "Pursuant to the meet-and-confer obligations under Ariz. R. Civ. P. 16, defendant writes to advise that defendant intends to file a motion for summary judgment under Ariz. R. Civ. P. 56 on the issue of causation."

Inbound, paragraph 1: "The proposed order is attached for your review."

Inbound, paragraph 2: "The relief sought is dismissal of plaintiff's claims for damages arising from the disc herniation diagnosed on the MRI dated May 12, 2026."

Inbound, paragraph 2: "Defendant's position is that plaintiff has failed to produce expert opinion supporting causation, and discovery in this matter closes on July 31, 2026."

Inbound, paragraph 3: "Defendant proposes a hearing on the motion on August 26, 2026 at 9:00 AM in Maricopa County Superior Court, Courtroom 401."

Inbound, paragraph 4: "Defendant requests a response from plaintiff within fourteen days of the date of this correspondence."

## Tone classification

Inbound tone classification (memory-rule sourced): `procedural`

## Prior correspondence on this thread

Sourced from motion-correspondence thread thread_motion_18.

| Date       | Direction | Sender             | Subject                                                       | Synopsis                                                          |
| ---------- | --------- | ------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| 2026-06-30 | Outbound  | Sarah Holcomb      | Discovery posture and pretrial schedule, Holloway v. Kerr     | Firm letter regarding discovery posture and pretrial schedule.    |
| 2026-07-10 | Inbound   | Theodora Whitfield | Re: Discovery posture and pretrial schedule, Holloway v. Kerr | Opposing letter contesting the firm's discovery characterization. |

## Substantive response

`[TBD: substantive motion response - partner authors. The skill emits no concession, no opposition framing, no procedural posture, and no characterization of the motion's merits. Legal-argument authoring is partner work. The inbound's motion title, relief sought, and procedural-posture claims are quoted verbatim above; the prior motion-correspondence table above provides the chronological context; the partner authors the response.]`

## Closing

`[TBD: closing paragraph - partner authors per firm template. The skill emits no language about settlement posture, motion-to-compel risk, sanctions exposure, meet-and-confer obligations, or any forward-looking case-strategy language.]`

---

Sarah Holcomb
Managing Partner
Holcomb & Reyes, LLP
1810 N Central Avenue, Suite 800
Phoenix, AZ 85004
(602) 555-0142
sarah.holcomb@holcomb-reyes.invalid
