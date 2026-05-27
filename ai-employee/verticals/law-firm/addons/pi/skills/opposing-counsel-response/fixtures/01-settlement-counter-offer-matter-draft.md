---

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

---

This file is the reference output draft for fixture 01. A correctly-implemented runtime replaying the skill against `01-settlement-counter-offer-matter.yaml` produces this draft body (modulo the date in the header block, which renders as the date of the test run). The body is what `Email.create_draft` receives as `body_text` and is what the supervising partner sees in their drafts folder.

The `Email.create_draft` envelope:

- `reviewer_account_id`: `sarah.holcomb@holcomb-reyes.invalid`
- `to`: `["twhitfield@whitfield-reardon.invalid"]`
- `cc`: `[]`
- `bcc`: `[]`
- `subject`: `Re: Settlement counter-offer, Holloway v. Kerr`
- `thread_id`: `thread_settlement_42`
- `matter_ref`: `matter_synthetic_opp_01`
- `drafted_by_skill`: `opposing-counsel-response`

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
Response Due: `[TBD: response due date - partner confirms; the inbound offer window closes May 26, 2026]`

---

Plaintiff Janet Holloway, by and through undersigned counsel, responds to opposing counsel's settlement counter-offer of May 12, 2026 regarding Holloway v. Kerr. The factual claims in the inbound message are quoted in the section below; the response posture is set out under separate cover.

## Inbound factual claims (verbatim quotes from opposing counsel's letter of May 12, 2026)

Inbound, paragraph 1: "Defendant offers the sum of $72,500 in full and final settlement of all claims arising from the subject incident, payable within thirty days of execution of a standard mutual release."

Inbound, paragraph 1: "This counter-offer is made without prejudice and supersedes the offer of April 25, 2026."

Inbound, paragraph 2: "The counter-offer is conditioned on a confidentiality clause limited to non-disparagement and on dismissal with prejudice of any companion claim."

Inbound, paragraph 2: "The counter-offer is open for fourteen days from the date of this correspondence."

## Tone classification

Inbound tone classification (memory-rule sourced): `contested`

## Prior correspondence on this thread

Sourced from settlement thread thread_settlement_42.

| Date       | Direction | Sender             | Subject                                                       | Synopsis                                                                                                                                          |
| ---------- | --------- | ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-18 | Outbound  | Sarah Holcomb      | Demand for settlement, Holloway v. Kerr, claim SM-2026-049182 | Firm demand package transmitted with medical chronology and billing tabulation.                                                                   |
| 2026-04-25 | Inbound   | Theodora Whitfield | Re: Demand for settlement, Holloway v. Kerr                   | Opposing initial offer of $35,000, payable within thirty days, mutual release condition.                                                          |
| 2026-05-05 | Outbound  | Sarah Holcomb      | Re: Demand for settlement, Holloway v. Kerr                   | Firm follow-up; renewed demand; cited inadequacy of initial offer relative to documented specials.                                                |
| 2026-05-12 | Inbound   | Theodora Whitfield | Settlement counter-offer, Holloway v. Kerr                    | Opposing counter-offer of $72,500, payable within thirty days, mutual release with confidentiality clause and dismissal-with-prejudice condition. |

## Substantive response

`[TBD: substantive settlement-counter response - partner authors. The skill emits no number, no acceptance, no rejection, no counter-counter, and no negotiation framing. Settlement authority is partner work per the firm's authority matrix. The inbound's offer amount is quoted verbatim above; the prior settlement-history table above provides the chronological context; the partner authors the response posture.]`

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
