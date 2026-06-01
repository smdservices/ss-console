# Firm dossier: [LEGAL NAME]

> **Status:** template. Copy this file to `operator/customers/{firm-slug}/dossier.md`, then fill in every bracketed field. Bracketed fields that remain after the runbook completes are pre-meeting blockers. Required by Platform PRD §16.2 + `docs/runbooks/pi-firm-demo-prep.md`.

> **Confidentiality:** every field below is sourced from public record (PACER, court dockets, firm website, LinkedIn long-form posts, state bar listings). Do not paste private email, settlement amounts under seal, or anything covered by a protective order.

> **Slug rules:** `^[a-z0-9][a-z0-9-]{0,31}$`, matches `operator/customers/{firm-slug}/` and `customer.yaml` `customer_id`. The reserved `_template` directory is never a real customer slug.

---

## 1. Firm identity

- **Legal name:** [LEGAL NAME]
- **Also known as:** [DBA / SHORT NAME / "the firm" referent used in their own copy]
- **Primary office address:** [STREET, CITY, STATE, ZIP]
- **Additional offices:** [LIST or "none"]
- **State bar jurisdictions:** [STATE BAR JURISDICTIONS]
- **Firm website:** [https://...]
- **Year founded:** [YYYY]
- **Headcount (best estimate):** [PARTNERS / ASSOCIATES / SUPPORT]

## 2. Partners and decision-makers

| Role             | Name          | Notes                                             |
| ---------------- | ------------- | ------------------------------------------------- |
| Managing partner | [NAME]        | [bio link, bar number, years practicing]          |
| Named partners   | [NAMES]       | [comma-separated]                                 |
| Lead PI partner  | [NAME]        | [if different from managing]                      |
| Operations lead  | [NAME, TITLE] | [office manager / firm administrator / paralegal] |

## 3. Practice areas

- **Primary practice area:** [e.g., Plaintiff Personal Injury]
- **Secondary practice areas:** [e.g., Wrongful Death, Mass Tort, Premises Liability]
- **Volume estimate:** [matters/year, sourced from court filings or firm statements]
- **Geographic reach:** [STATE / METRO / NATIONAL]
- **Defense vs plaintiff split (if applicable):** [PERCENT or "100% plaintiff"]

## 4. Recent matters and settlements (public record)

> Cite the public record. Include the case caption, docket number, court, and date. Do not paraphrase from press releases without verifying the underlying filing.

| Case caption | Court / docket | Outcome (public)                           | Citation            |
| ------------ | -------------- | ------------------------------------------ | ------------------- |
| [CAPTION]    | [COURT, NO.]   | [verdict / settlement amount if disclosed] | [URL or PACER cite] |
| [CAPTION]    | [COURT, NO.]   | [verdict / settlement amount if disclosed] | [URL or PACER cite] |
| [CAPTION]    | [COURT, NO.]   | [verdict / settlement amount if disclosed] | [URL or PACER cite] |

## 5. Voice signature

> See `docs/specs/operator/voice-ingestion.md` for what gets stored. The pipeline persists structural-diffs only, never raw text. Minimum bar before demo: **10 samples** sourced from public writing.

- **Sample count ingested:** [N] (minimum 10)
- **Sources:**
  - Firm blog posts: [COUNT]
  - Court filings (motions, briefs, demand letters in the public record): [COUNT]
  - LinkedIn long-form posts (named partners only): [COUNT]
  - Published articles / op-eds: [COUNT]
- **Tone notes (3-5 adjectives):** [e.g., "plainspoken, declarative, declarative, jury-facing, no Latin"]
- **Sentence-length distribution observed:** [short / medium / long mix]
- **Greeting style observed:** [e.g., "Dear Counsel" / "To whom it may concern" / first-name informal]
- **Sign-off style observed:** [e.g., "Sincerely" / "Respectfully submitted" / "Best"]
- **R2 storage path:** `r2://vaults/{firm-slug}/voice/samples/`
- **Last ingestion timestamp:** [ISO-8601]

## 6. Hypothesized practice-management stack

| Component           | Vendor                     | Confidence       | Evidence                                                    |
| ------------------- | -------------------------- | ---------------- | ----------------------------------------------------------- |
| Practice management | [VENDOR or "none"]         | low / med / high | [job posting, court filing footer, LinkedIn JD, RFP record] |
| Email               | [gmail / ms-graph / other] | low / med / high | [MX record, email domain provider]                          |
| Calendar            | [gmail / ms-graph / other] | low / med / high | [same as email, usually]                                    |
| Document storage    | [vendor]                   | low / med / high | [evidence]                                                  |
| eSignature          | [vendor]                   | low / med / high | [evidence]                                                  |
| Court access        | [PACER / state-specific]   | low / med / high | [public docket activity]                                    |

## 7. Decision-makers and influencers

- **Signs the check (economic buyer):** [NAME, ROLE]
- **Uses the product daily (operational champion):** [NAME, ROLE]
- **Influencers (paralegals, IT vendor, fractional COO):** [NAMES, ROLES]
- **Prior outreach history:** [CHANNEL, DATE, OUTCOME or "none"]
- **Referral source (if any):** [Vistage / EO / accountant / direct]

## 8. Demo angle

> One skill, one fixture, one walk-through. The fixture seeds a synthetic-but-believable PI matter the firm will recognize as their own shape. The skill matches their highest-frequency operational pain. Both must be reviewed by Captain before the meeting.

- **PI skill to lead with:** [demand-letter-draft / discovery-response / settlement-prep / opposing-counsel-response]
  - Rationale: [WHY THIS SKILL FOR THIS FIRM]
- **Fixture to use:** [path under `operator/skills/{skill}/fixtures/` or `operator/fixtures/law-firm/`]
  - Synthetic matter shape: [PRACTICE AREA, INJURY TYPE, DEFENDANT TYPE]
- **Backup angle if primary falls flat:** [SECOND SKILL]

## 9. Pre-meeting checklist

Tied to `docs/runbooks/pi-firm-demo-prep.md`. Every box must be checked before Captain confirms the demo slot. Re-run the prepare-demo-firm tool until exit code 0 before the final box can be checked.

- [ ] Section 1 complete: firm identified and confirmed with Captain
- [ ] Sections 1-4 of this dossier filled in (identity, partners, practice areas, recent matters)
- [ ] Section 5 voice samples sourced (≥10) and ingested per voice schema
- [ ] Section 6 PM stack hypothesis recorded with confidence rating
- [ ] Section 7 decision-makers identified
- [ ] Section 8 demo angle selected and fixture confirmed
- [ ] `operator/customers/{firm-slug}/customer.yaml` authored and validates against `docs/specs/operator/customer-yaml-schema.md`
- [ ] `operator/bin/provision-customer.sh {firm-slug}` completes successfully
- [ ] `operator/bin/prepare-demo-firm.sh --firm-slug {firm-slug}` exits 0
- [ ] Pre-meeting walk-through with Captain completed ≥24hr before the demo

## 10. Notes

> Free-form. Anything that did not fit in the structured sections above. Use this for: how Captain found the firm, prior interactions, geographic context, anything an agent would need to remember mid-conversation.

[NOTES]
