# Synthetic PI matter corpus: demo fixtures

`[SYNTHETIC FIXTURE — NOT A REAL MATTER]`

Eight synthetic personal-injury matters spanning pre-suit, active discovery, and pre-trial phases. Purpose: pre-seed a demo Hermes Machine for the customer meeting so the partner sees believable case data during catalog drilldown (Platform PRD §16, Law-firm PRD §11, §12.5).

These are distinct from the JSON grading fixtures at `ai-employee/fixtures/law-firm/pi/` (PR #812). Those serve the grading harness. These serve the demo flow as readable markdown that mirrors what a partner would see inside the dashboard's Matters tab.

## Coverage

| Slug                                        | Phase                              | Injury type                    | Settlement range | Complexity |
| ------------------------------------------- | ---------------------------------- | ------------------------------ | ---------------- | ---------- |
| `pi-auto-rear-end-cervical-fusion`          | Pre-suit (demand drafting)         | Auto, soft-tissue → fusion     | $250k–$500k      | Medium     |
| `pi-slip-commercial-shoulder-tear`          | Pre-suit (demand drafting)         | Commercial slip-and-fall       | $75k–$150k       | Low        |
| `pi-dog-bite-pediatric-scarring`            | Pre-suit (intake just closed)      | Dog bite, minor plaintiff      | $100k–$300k      | Medium     |
| `pi-auto-highway-tbi`                       | Active discovery                   | Auto, traumatic brain injury   | $750k–$2M        | High       |
| `pi-premises-negligent-security`            | Active discovery                   | Premises liability, assault    | $400k–$1M        | High       |
| `pi-medical-complications-knee-replacement` | Active discovery                   | Medical, retained foreign body | $300k–$750k      | High       |
| `pi-auto-intersection-multi-vehicle`        | Pre-trial (mediation prep)         | Auto, multi-defendant          | $500k–$1.2M      | High       |
| `pi-slip-residential-snow-ice`              | Pre-trial (settlement negotiation) | Slip-and-fall, premises        | $50k–$120k       | Low-medium |

## Conventions

- **Client names** use the placeholder format `John Doe-N` or `Jane Roe-N` (N is a sequence number per matter). Clearly fictional, not realistic.
- **Case numbers** use the placeholder format `CASE-2026-FICTIONAL-NNN`. Not tied to any real court system or filing convention.
- **Defendant names** are obvious fictions (`Brookline Holdings LLC`, `Saguaro Property Group`, etc.) with no real-world counterpart intended.
- **Carrier names** are fictional (`Mountain West Mutual`, `Coastline Indemnity`).
- **Dollar amounts** in damages tabulation are realistic-shaped but synthetic. They are not market valuations; they exist to populate the demo fixture.
- **Dates** are anchored relative to the demo window (2026-06-02 → 2026-06-09). Incident dates fall within the two years prior; future deadlines fall within the six months following.

## Fabrication discipline

Per Platform PRD §7.5 invariant #8: each matter file is the system-of-record for its own facts. Demo agents drawing on this corpus reference fields that appear here; they do not infer or fill in plausible-but-uncited content. Where a real engagement would have a field that this fixture leaves blank (e.g., signed retainer date for a pre-suit matter still in intake), the fixture renders the field as `TBD` rather than inventing a value.

## Style

Plain English, no legalese unless the legalese is the substantive content (e.g., a citation to a statute of limitations). No em dashes. No invented medical jargon; clinical descriptions are plausible but generic.

## Watermark

Every matter file carries the `[SYNTHETIC FIXTURE — NOT A REAL MATTER]` watermark in its first line. The watermark is checked by the demo harness before any matter is rendered into the Hermes dashboard.
