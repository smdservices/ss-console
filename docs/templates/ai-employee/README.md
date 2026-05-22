# AI Employee Beta-1 Contract Templates

This directory holds the three template documents used to paper a beta-1 AI Employee engagement: the Service Contract, the Data Processing Addendum (DPA), and the BAA-equivalent Confidentiality Addendum. The DocuSign workflow that turns these templates into countersigned customer documents is documented separately in [`signing-flow.md`](./signing-flow.md).

## What these templates are (and are not)

These are **internal drafting templates**. They are the starting point that Captain (and, before customer-zero countersignature, external counsel licensed in the customer's jurisdiction) uses to produce the final form documents that go through DocuSign. They are not authoritative legal documents. They have not been reviewed by counsel. Every clause is subject to revision before any customer signs.

No file in this directory may be sent to a customer as-is. The DocuSign workflow expects a Captain-reviewed, counsel-reviewed final form, with all bracketed fields replaced by customer-specific values.

## The three templates

| File                                                                       | Purpose                                                                                                                              | When used                                                                                                                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`service-contract.md`](./service-contract.md)                             | Master agreement for the AI Employee service. Covers scope, monthly fee, term, termination, SLA, liability, dispute resolution.      | Every paying AI Employee customer signs this.                                                                                                                                 |
| [`data-processing-addendum.md`](./data-processing-addendum.md)             | Article 28 / GDPR-shaped DPA. Names sub-processors, retention windows, incident response, data subject rights, customer ownership.   | Every paying AI Employee customer signs this alongside the Service Contract.                                                                                                  |
| [`baa-equivalent-confidentiality.md`](./baa-equivalent-confidentiality.md) | Confidentiality and privileged-information addendum scoped to law firms. Covers attorney work product, conflicts, subpoena handling. | Required when the customer is a law firm. Equivalent confidentiality terms applied to other professional-services customers (healthcare, accounting) on a case-by-case basis. |

Read [`signing-flow.md`](./signing-flow.md) for the DocuSign workflow that ties them together.

## Bracketed fields

Every template uses `[FIELD NAME]` syntax for values that must be replaced before the document is sent. The standard field set is:

- `[CUSTOMER LEGAL NAME]`
- `[CUSTOMER STATE OF INCORPORATION]`
- `[CUSTOMER ADDRESS]`
- `[EFFECTIVE DATE]`
- `[MONTHLY FEE]`
- `[INITIAL TERM MONTHS]`
- `[TERMINATION NOTICE DAYS]`
- `[GOVERNING LAW STATE]`
- `[LIABILITY CAP AMOUNT]`
- `[ADDITIONAL TERMS]`

Each template also defines its own narrower fields (for example, the DPA defines `[RETENTION WINDOW DAYS]`, `[OFFBOARDING WINDOW DAYS]`, and per-region storage location placeholders). Those are documented in each template's own field table.

## Architecture references

The data-handling commitments in the DPA and the BAA-equivalent are not aspirational. They reflect the actual platform architecture as documented in the AI Employee PRDs and ADRs. Every commitment in these templates is sourced to one of:

- [Platform PRD](../../pm/ai-employee/platform-prd.md) §13 (Compliance & Privacy Posture)
- [ADR 0005 Reviewer-as-sender](../../adr/0005-reviewer-as-sender.md)
- [ADR 0007 Per-customer Machine isolation](../../adr/0007-per-customer-machine-isolation.md)
- [ADR 0008 Customer-owned memory artifact](../../adr/0008-customer-owned-memory-artifact.md)
- [ADR 0009 Cross-Machine query prohibition](../../adr/0009-cross-machine-query-prohibition.md)
- [Decommission spec](../../specs/ai-employee/decommission-customer.md)
- [Compliance evidence packet spec](../../specs/ai-employee/compliance-evidence-packet.md)

Any change to the platform that alters one of those source documents may require a corresponding revision here. The pre-customer-zero counsel review is the moment to verify alignment.

## Footer required on every shipped document

Each template ends with this footer, which must remain visible on every draft that leaves this directory and must be removed only at the moment Captain prepares the final form for DocuSign upload:

> This is a TEMPLATE. Before customer countersignature, this document must be (1) reviewed by Captain and (2) reviewed by external counsel licensed in the customer's jurisdiction.

## Source of truth

This directory is the canonical drafting source. The signed DocuSign envelopes are the legally operative documents; copies of countersigned envelopes are archived per the procedure in [`signing-flow.md`](./signing-flow.md) and surfaced in the customer's compliance evidence packet ([artifact 10-dpa.pdf and 11-baa.pdf per PRD §13.6](../../pm/ai-employee/platform-prd.md#136-compliance-evidence-packet-structure)).

Issue tracking: this template set was authored against [#827](https://github.com/venturecrane/ss-console/issues/827).
