# Engagement Dossier: Ashton & Price LLP

> **Context, never quotable.** Nothing in this file may appear in client-facing output. The dossier primes judgment, not copy. Sentinels from this file are gated out of correspondence by `tests/forbidden-strings.test.ts`.

**What this file is.** The single place an agent loads before touching this engagement. The read gate (`.claude/hooks/engagement-guard.mjs`, Law 2 of `docs/doctrine/agent-operating-doctrine.md`) blocks engagement writes until this file has been read this session.

**Maintenance contract.** New correspondence, a new decision, or a new fact stated by the Captain updates this file in the same session.

## Relationship map

| Person          | Role                                                                                                                            | How the Captain knows them                                                     | Posture notes                                                                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chris Price     | Principal, litigator, the decision-maker; signs the check                                                                       | Family to the Captain (recorded 2026-06-14; degree and detail: TBD, interview) | AI-savvy: runs a Claude Project per case, uses AI to review and highlight, never to draft his litigation work product. Honor that posture in every design and every letter. "Exclusive man, likes being on top": assume the ambition, never pitch him a hedge.                   |
| Christa Barrera | Office manager; the firm's financial and operational spine (bookkeeping, trust/IOLTA, disbursement, payroll, vendors, file org) | Direct contact since 2026-06-24                                                | The inside champion: super smart, into AI, excited to see what the Operator can do. She feels every pipeline slip as a cash or compliance problem; multi-user confidentiality is her instinctive worry. Her diligence list (letter 09) is sharp; write to her at full precision. |

**Engagement posture** (the Captain, 2026-06-14): this deal is ours to lose. Chris is already sold; the risk is a slip or an oversight, not persuasion. So the work is demonstrating mastery of their business, systems, and pain, plus a foolproof, frictionless, drama-free path. One mistake costs more than ten missing features. Do not sell; do not defend the price to someone who is not attacking it; do not fumble details in front of the sharpest reader in the firm (Christa).

**What this engagement opens for the venture:** first Operator pilot, first legal-vertical seat, the reference and case study the vertical strategy builds on. [What Chris himself opens beyond the pilot (referrals into the PI bar, advocacy, other): TBD, interview.]

## Commercial rationale

| Term            | Value                                                                                                                                       | Why (source, dated)                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monthly         | $5,000/mo flat retainer                                                                                                                     | ADR 0063 (2026-07-04): priced at the coordinator-salary anchor per ADR 0037 tenet 1; internal, never published                                     |
| Stand-up        | $4,000, waived for this firm                                                                                                                | Waiver stated in letter 10-DRAFT (Captain-approved 2026-07-24). Rationale: TBD, interview; not recorded anywhere in the repo (verified 2026-07-26) |
| Billing start   | when implementation testing wraps; no charge until then                                                                                     | Letter 10-DRAFT (Captain-approved 2026-07-24)                                                                                                      |
| Termination     | month to month, 30 days written notice; data return per letter 10 item 5 (14-day export, 30-day destruction window, attestation on request) | Letter 10-DRAFT                                                                                                                                    |
| Pilot invoicing | $0 during pilot while `services.recurring_price` carries list for the COGS/MRR gate                                                         | ADR 0063 consequences                                                                                                                              |

**Pricing-presentation posture:** TBD, interview (pending per the Captain as of 2026-07-23). Do not add salary-anchor framing, waiver justifications, or value defense to client copy without the Captain's direction; the 2026-07-26 incident was exactly that.

**Claude access:** the firm has its own Claude Enterprise account; the Claude-to-Operator connector rides it (the Captain, 2026-07-26). Claude was already in their stack in letter 04, and they dropped CoCounsel in letter 06 in favor of BriefPoint plus Claude as the drafting tools. Do not describe Claude seats as an SMD cost or an SMD deliverable.

## Firm research

- Plaintiff personal-injury firm, roughly 11 to 15 people, 6 attorneys; Fair Oaks (Sacramento) main office at 8243 Greenback Ln, plus SF. Phone (916) 786-7787.
- Systems: Smokeball on Prosper+ (confirmed; do not re-ask), M365 ("Office 365 as they say", confirmed 2026-06-24), BriefPoint (written-discovery responses), InfoTrack (serve/e-file, ships a production MCP), YoCierge (medical records), Adobe, Dropbox, Claude. CoCounsel evaluated and dropped (letter 06). Salem Surround managed human chat feeds marketing; those leads are human-keyed into Smokeball.
- Deadline engine: Smokeball court-rules/InfoTrack; the Operator verifies and chases, never computes deadlines.
- Seat inputs resolved 2026-06-24: chris@ashtonandprice.com, christa@ashtonandprice.com, `fly_region: sjc`.

## Canonical documents

Read the correspondence ledger first: `correspondence/README.md` (canonical-vs-stale table, verified timeline, message-ids).

- `CLIENT-PROPOSAL.md`: the document the build is measured against; every capability it names is a commitment.
- Letters `04` and `06`: the scope-defining inbound (stack + scope expansion; section-by-section markup).
- Letter `07`: the reconciliation target; the routine grid and permanent caps it commits are compiled into `routine-grid.yaml` + `commitments.json` and gated by `tests/customer-commitments.test.ts` (ADR 0075).
- Letter `09`: canonical inbound; the two settings, grid acceptance, per-matter alert routing requirement, nine diligence questions.
- Letter `10-DRAFT`: the Captain-approved answers, planned send 2026-07-27; the commitments header on it is binding.
- `IMPLEMENTATION-PLAN.md`: active sequencing (supersedes BUILD-PLAN.md for sequencing).

## Recorded absences

- No data-handling questionnaire from Christa exists in writing (verified in the correspondence README; do not treat one as existing).
- The stand-up waiver rationale is not recorded anywhere in the repo (verified 2026-07-26).
- No BAA is legally required to attach (plaintiff-side, patient-authorization chain); we offer a DPA with CCPA terms and obtain upstream BAAs anyway. Do not sign a BAA as if we were a business associate. (Research record, 2026-07.)

## Captain-only facts

- 2026-06-14: "Chris is family, already sold, unlikely to cancel; the risk is a slip, not persuasion. One mistake = the plank." (Meeting-prep session.)
- 2026-07-26: the firm holds its own Claude Enterprise account for the Claude-to-Operator connection. (This session.)
- TBD, interview: waiver rationale; what Chris opens for the venture beyond the pilot; pricing-presentation posture.
