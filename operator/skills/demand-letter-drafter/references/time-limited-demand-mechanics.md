# Demand Letter Drafter: Time-Limited Demand Mechanics

> **Statute grounding, fetched and verified 2026-07-28.** Sources:
> [CCP 999 (leginfo)](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CCP&sectionNum=999),
> [CCP 999.1 (leginfo)](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CCP&sectionNum=999.1),
> [CCP 999.3 (leginfo)](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CCP&sectionNum=999.3),
> [CCP 999.5 (leginfo)](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CCP&sectionNum=999.5).
> Section 999.1 cross-checked against
> [FindLaw](https://codes.findlaw.com/ca/code-of-civil-procedure/ccp-sect-999-1/).
> Chapter 3.2 (sections 999 through 999.5) was added by Stats. 2022, ch. 719, effective
> January 1, 2023.
>
> **Not independently verified in this pass: sections 999.2 and 999.4.** Treat their
> contents as **to verify at connect**; the skill does not rely on them and does not
> state their contents. Re-verify the whole chapter at connect and on any amendment.

**Why this file exists.** Everything below is an **attorney decision point**. This is
not a compliance engine and it does not certify a demand. The skill surfaces these
mechanics with the record bearing on each, and the attorney decides. Nothing here is
computed as final, and the acceptance deadline in particular is never stated as a date
(the pack's `deadline-input-never-final` floor).

---

## 1. Scope: is this even a section 999 demand?

**Decision point, reserved to the attorney.**

Section 999 defines a time-limited demand as an offer **prior to the filing of the
complaint or demand for arbitration**, made by or on behalf of a claimant to a
tortfeasor with a liability insurance policy, to settle within the insurer's limit of
liability, which by its terms must be accepted within a specified period.

Section 999.5 limits the chapter to **automobile, motor vehicle, homeowner, or
commercial premises liability** policies, for **property damage, personal or bodily
injury, and wrongful death** claims, and applies to demands transmitted on or after
January 1, 2023.

Two facts the skill reads from the record and surfaces without resolving:

- **Suit posture.** Has a complaint been filed, or a demand for arbitration made? The
  chapter's own definition is pre-suit. If the record shows suit is on file, the
  section 999 labeling and timing mechanics do not fit, and the skill **reserves the
  question rather than adapting the skeleton to a posture it was not written for**. In
  the 2026-07-28 prove-out both demand arms caught this mismatch unprompted and
  reserved it. That is the behavior to preserve.
- **Policy type.** What the declarations page or claim correspondence shows. If the
  record does not establish the policy type, that is a marker, not an assumption.

A demand can of course be made outside the chapter. Whether to make one, and whether to
label it under section 999, is the attorney's call.

## 2. Required elements (999.1)

The skill runs these as an **itemized completeness pass** over the draft, naming the
supporting record for each or marking it absent. It reports item by item. It never
writes that the demand satisfies the statute (gate 3, self-certification ban).

| Element                                                                                                           | Where it lives in the draft                  | Record source                       |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------- |
| In writing, labeled as a time-limited demand or referencing the section                                           | RE line                                      | the skeleton                        |
| A clear and unequivocal offer to settle all claims within policy limits, including satisfaction of all liens      | section VII                                  | limits disclosure + the lien ledger |
| An offer of a complete release of the insurer's insureds from all present and future liability for the occurrence | section VII                                  | the skeleton's release language     |
| Date and location of the loss                                                                                     | header table                                 | collision report                    |
| Claim number, if known                                                                                            | header table                                 | claim correspondence                |
| A description of the injuries                                                                                     | section III                                  | medical records                     |
| Reasonable proof sufficient to support the claim (records, bills, or both)                                        | section VIII, and the attachments themselves | the documents actually enclosed     |
| An acceptance period of at least the statutory minimum for the transmission method                                | section I and section VII                    | reserved, see below                 |

Two elements deserve attention because they interact with other lanes:

- **"Including satisfaction of all liens."** The offer has to account for every lien.
  The lien ledger (`lien-ledger-tracker`) owns lienholders, asserted amounts, and
  status. The skill reads them, states each with its asserted amount as of a stated
  date, and marks an unresolved amount with the lienholder named. It never computes a
  reduction and never nets anything out.
- **"Reasonable proof."** The enclosure list must match what is physically attached.
  The skill itemizes what it found in the record; whether that constitutes reasonable
  proof is a judgment the attorney makes.

## 3. The acceptance period (999.1): the floor, not the date

**Statutory minimums, by transmission method:**

| Transmission method                 | Minimum acceptance period                                |
| ----------------------------------- | -------------------------------------------------------- |
| Email, facsimile, or certified mail | not fewer than **30 days** from the date of transmission |
| Ordinary mail                       | not fewer than **33 days**                               |

**Why the skill cannot state the deadline.** The period runs from **transmission**, and
at drafting time transmission has not happened. The attorney sends the letter, on a
date the attorney picks, by a method the attorney picks. A date written into the draft
would be a guess about a future act, and a miscomputed acceptance period is a defective
demand.

So the skill:

- states the minimum for each method, as above;
- shows the **earliest compliant date** for the method the record contemplates, marked
  **proposed, confirm at transmission**, with its inputs visible (assumed transmission
  date, method, minimum applied);
- leaves the letter's own deadline as a marker the attorney fills at transmission;
- never selects the period. The statute sets a floor. Whether to give 30 days, 45, or
  60 is the attorney's decision, and a longer period is not a defect.

If the record does not establish the intended transmission method, the skill shows both
minimums and marks the method as unresolved rather than assuming one.

## 4. What happens after transmission (999.3): read, never asserted

Surfaced so the attorney knows what the letter sets in motion. The skill drafts none of
it into the letter.

- **Acceptance** is by written acceptance of the material terms (999.3(a)).
- **A request for clarification or additional information is not, by itself, a
  counteroffer or a rejection** (999.3(b)). This one matters in practice: an adjuster's
  question arriving mid-window is not a rejection, and nobody should treat it as one on
  the Operator's say-so. If such a message lands, it is surfaced to the attorney as a
  message received, characterized as nothing.
- **If the insurer does not accept**, it is to notify the claimant in writing of its
  decision and the basis for it before expiration (999.3(c)).

**What the firm does on expiration is settlement authority and firm posture, and the
skill never writes it.** No sentence that the offer will be withdrawn, that suit will
follow, that the demand will not be renewed, or that anything will be sought
afterward. If the firm's own skeleton carries such language as authored boilerplate, it
stays as the firm authored it; the skill does not compose it, extend it, or tune it to
the facts.

## 5. What is never in this file, on purpose

No discussion of bad faith, of the consequences of a rejected policy-limits demand, of
extracontractual exposure, or of the case law that frames those arguments. Section 999
defines "extracontractual damages," and the skill still does not characterize them. That
is the exposure line in SKILL.md: the skill does not argue what the carrier risks, does
not warn, and does not frame the demand as an opportunity to protect the insured. The
attorney owns that argument entirely.
