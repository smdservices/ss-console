# Master Fact Sheet: Alvarez v. Draper

**Purpose.** This is the single source of truth for the mva-alvarez prove-out record. Every other document in this folder is reconciled against this sheet. If a document and this sheet disagree, the sheet is wrong and both must be corrected together.

**Status.** Wholly fictional. Authored for the staging rehearsal tenant only. No real person, firm, carrier, adjuster, physician, employer, or street address is used. Facts inherited from `operator/customers/pilot-smokeball/seed/seed_data.py` are marked SEED and may not be changed.

---

## 1. Case identity

| Field                              | Value                                               | Source   |
| ---------------------------------- | --------------------------------------------------- | -------- |
| Matter key                         | `mva-alvarez`                                       | SEED     |
| Firm matter number                 | 2026-PI-101                                         | SEED     |
| Court                              | Superior Court of California, County of Los Angeles | SEED     |
| Case number                        | 24STCV18223                                         | SEED     |
| Caption                            | MARIA ALVAREZ v. KENNETH DRAPER                     | SEED     |
| Matter type                        | MVA plaintiff, CA                                   | SEED     |
| Practice-management record created | 2026-02-10                                          | SEED     |
| Department                         | 32, Spring Street Courthouse                        | Authored |
| Complaint filed                    | July 18, 2024                                       | Authored |
| Answer filed                       | September 6, 2024                                   | Authored |
| Mediation                          | September 24, 2026, private mediation               | Authored |
| Final status conference            | January 29, 2027                                    | Authored |
| Trial                              | February 9, 2027, jury                              | Authored |

**Consistency note on dates.** The case number carries a 2024 filing-year prefix while the seed records the matter as opened 2026-02-10. These are reconciled as follows: the case was filed in 2024 and the 2026-02-10 date is when the matter record was created in the practice-management system, not when the Firm was retained. The Firm has represented Ms. Alvarez continuously since May 28, 2024. There is no prior counsel and no prior-counsel lien. The seed applies the same pattern to `multidef-bell` (case 24STCV09611, opened 2026-01-20), so this reading is the seed's own convention.

## 2. Parties and counsel

**Plaintiff.** Maria Alvarez, date of birth March 14, 1987. Residence: 3418 Verano Street, Rosemead, CA 91770. Married, two children (ages 9 and 6 as of the incident). Email of record `maria.alvarez.seed@example.com` (SEED).

**Defendant.** Kenneth Draper, date of birth November 2, 1968. Residence: 1207 Halstead Court, Whittier, CA 90605. Self-employed, Draper Tile and Stone (sole proprietorship).

**Plaintiff's counsel.** The Firm. Referred to throughout as "the Firm." No firm name, letterhead, or attorney name is authored for the plaintiff side; that identity belongs to another agent. In the deposition transcripts the plaintiff-side speaker label is "COUNSEL FOR PLAINTIFF."

**Defense counsel.** Barrow and Kestrel LLP, 1900 Avenue of the Stars, Suite 400, Los Angeles, CA 90067. Attorney of record: Marisol Hardaway. Litigation paralegal and proof-of-service declarant: D. Whitmore. The address and the Whitmore signature are SEED (they appear in every proof of service in the seed set); the firm name and Hardaway are authored to fit them.

**Do not confuse with.** `lookalike-alvarez` is a different matter with a different plaintiff (Maria A. Alvarez), a different defendant (Draper Logistics, Inc.), and a different case number (26STCV02914). Nothing in this folder relates to it.

## 3. Insurance

| Role                       | Carrier                                           | Claim number     | Adjuster                                    | Limits                                                                                                                                                                |
| -------------------------- | ------------------------------------------------- | ---------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Defendant liability        | Meridian Casualty Insurance Company               | MCI-2024-0418773 | Trevor Nakashima, Senior Liability Examiner | $100,000 per person / $300,000 per occurrence                                                                                                                         |
| Plaintiff first-party      | Coastline Mutual Insurance                        | CM-24-771554     | Renata Voss                                 | Collision with $500 deductible; medical payments $5,000; UM/UIM $50,000                                                                                               |
| Plaintiff health plan      | Pacific Ridge Health Plan (PPO, through employer) | Member 44-820913 | n/a                                         | Emergency department claim only                                                                                                                                       |
| Plaintiff wireless carrier | Tessera Wireless                                  | Account 8814-220 | n/a                                         | Call detail records for May 23, 2024 produced by plaintiff, Bates PLTF 000705 to PLTF 000718. Last outbound call ended 5:31 p.m., eleven minutes before the collision |

Medical payments coverage paid $1,500.00 toward the emergency department patient responsibility. $3,500.00 of the $5,000.00 limit remains unused. Coastline Mutual asserts a $1,500.00 reimbursement claim.

## 4. The incident

**Date and time.** Thursday, May 23, 2024, at approximately 5:42 p.m.

**Location.** Eastbound Calle Verde Road, approximately 180 feet west of Sandoval Avenue, unincorporated Los Angeles County. Four lanes divided, two eastbound (the number 1 lane is the inside lane, the number 2 lane is the curb lane), posted 45 mph, straight and level, asphalt, dry. Weather clear, dusk, street lighting on.

**Mechanism.** Draper was eastbound in the number 1 lane in a 2021 Ford F-150. Alvarez was eastbound in the number 2 lane in a 2017 Honda Civic, traveling at approximately 40 mph. Draper moved from the number 1 lane into the number 2 lane directly in front of the Civic in order to reach Sandoval Avenue, then braked hard because the vehicle ahead of him in the number 2 lane had slowed to make a right turn. Alvarez braked and left 22 feet of tire friction marks but struck the rear of the F-150 with the front of the Civic.

**Why liability is contested.** Alvarez is the rear driver. Defendant relies on the rear-end inference and on comparative fault for following too closely. Plaintiff relies on the unsafe lane change, the citation, the independent witness, and Draper's own testimony. The contest is real but the record favors plaintiff.

**Vehicles.**

|         | Plaintiff                                                                                | Defendant                                                   |
| ------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Vehicle | 2017 Honda Civic sedan, silver                                                           | 2021 Ford F-150 pickup, white                               |
| Plate   | 8KJT492                                                                                  | 62199B3                                                     |
| Damage  | Front bumper, hood, grille, condenser, radiator support; not driveable; towed from scene | Rear bumper and Class III hitch receiver; driven from scene |
| Repair  | $9,480.16 (Ridgeline Collision Center)                                                   | $1,180.44                                                   |
| Airbags | Did not deploy                                                                           | Not applicable                                              |

The damage disparity is explained by the F-150's hitch receiver, which took the impact and transferred load into the truck frame. Defense uses the $1,180.44 figure to argue a minor impact. A drafter should pair the two repair figures with the hitch, not quote the truck figure alone.

**Occupants.** One in each vehicle. No passengers.

**Police.** California Highway Patrol, Valle Verde Area. Officer R. Tanaka, ID 14882. Report No. 24-VV-0517742.

**Primary collision factor.** Assigned to Party 1 (Draper), Vehicle Code section 22107, turning or moving right or left on a roadway without reasonable safety and without signaling. Draper was issued Notice to Appear No. LA-4471902. Bail was forfeited on August 14, 2024.

**Associated factor.** Assigned to Party 2 (Alvarez), Vehicle Code section 21703, following too closely. No citation issued to Alvarez.

**Admissibility caution.** A forfeiture of bail on an infraction is not admissible in a civil action to prove negligence (Vehicle Code section 40834). The citation is useful for what the investigating officer concluded and for impeachment groundwork, not as proof of the violation. A drafter who cites the bail forfeiture as evidence of liability has made a legal error, not a factual one.

**Transport.** Alvarez declined ambulance transport at the scene. Her sister, Yolanda Marisol Alvarez-Reyes, drove her to the emergency department the same evening. Defense uses the refusal to argue the injuries were minor. The record answer is that she presented to the emergency department roughly three hours later the same day.

## 5. Witnesses

| Witness                 | What the witness saw                                                                                                                                                                                                                                          | Where it appears                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Aaron Petrosyan, age 41 | Independent. Driving two to three car lengths behind the Civic in the number 2 lane. Saw the F-150 move from the number 1 lane into the number 2 lane in front of the Civic and brake. States he saw no turn signal.                                          | Traffic collision report, statements section |
| Grace Lindqvist, age 63 | Employee of Sandoval Avenue Auto Parts, on the sidewalk. Did NOT see how the collision occurred. Heard tires and impact, looked up afterward. Observed the F-150 partly in the number 2 lane. Heard Draper say words to the effect of "I thought I had room." | Traffic collision report, statements section |

**Scope caution.** Only Petrosyan witnessed the lane change. Lindqvist's account begins after the impact. A statement that both independent witnesses observed the unsignaled lane change misstates the record.

## 6. Injuries

| Injury                                                                | Coding           | Course                                                                               |
| --------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| Cervical strain and sprain with right-sided radicular symptoms        | S13.4XXA, M54.2  | Onset at scene. Dominant complaint through month 3. Largely resolved by discharge.   |
| Lumbar strain and sprain with left lower extremity radicular symptoms | S33.5XXA, M54.16 | Onset within 24 hours. The persistent complaint. Drove the injection.                |
| C5-C6 disc protrusion, approximately 3 mm, no cord compression        | M50.20           | Reported on the August 7, 2024 MRI as summarized in the treating orthopedist's note. |
| L4-L5 disc bulge, approximately 2 mm, with annular fissure            | M51.26           | Same.                                                                                |
| Post-traumatic headaches                                              | R51.9            | Resolved by approximately month 3.                                                   |
| Anterior chest wall contusion, seat belt pattern                      | S20.211A         | Resolved within 3 weeks.                                                             |

**Head strike.** Denied loss of consciousness. Reported headache at the emergency department; head CT ordered and negative.

## 7. Treatment timeline and providers

Three treating providers plus one imaging facility. Fifteen documented encounters between May 23, 2024 and December 17, 2024.

| Date                                                 | Provider                                                      | Encounter                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| 05/23/2024                                           | Valle Verde Regional Medical Center, Emergency Department     | Emergency evaluation, imaging, discharge                              |
| 05/31/2024                                           | Sierra Point Orthopaedic Associates (Ruben Castellanos, M.D.) | Initial orthopedic consultation, off work, PT referral, DME dispensed |
| 06/10/2024                                           | Crossroads Physical Therapy                                   | Initial evaluation                                                    |
| 06/13, 06/18, 06/24, 07/01, 07/11, 07/22, 08/02/2024 | Crossroads Physical Therapy                                   | Seven treatment sessions                                              |
| 07/02/2024                                           | Sierra Point Orthopaedic Associates                           | Follow-up, modified duty effective 07/09                              |
| 08/07/2024                                           | Valley Imaging Center                                         | MRI cervical and lumbar, without contrast                             |
| 08/20/2024                                           | Sierra Point Orthopaedic Associates                           | MRI review, lumbar trigger point injections, injection recommended    |
| 10/07/2024                                           | Sierra Point Orthopaedic Associates                           | Lumbar epidural steroid injection under fluoroscopy                   |
| 11/12/2024                                           | Sierra Point Orthopaedic Associates                           | Post-injection follow-up                                              |
| 12/17/2024                                           | Sierra Point Orthopaedic Associates                           | Final evaluation, discharged from care                                |

**The treatment gap.** 48 days between August 20, 2024 and October 7, 2024, with no treatment of any kind. The reason is documented in the chart, not reconstructed: the injection was deferred at the patient's request until after her return to full duty on October 1, 2024, for childcare and work-schedule reasons, and the August 20 note records the deferral contemporaneously. A drafter should raise the gap first and answer it with the chart entry rather than wait for the defense to raise it.

**Outstanding records, known and labeled.** The Valley Imaging Center imaging report and films have not been produced. The Firm requested them through the records vendor on June 20, 2026 and they had not landed as of the end of July 2026 (SEED task `records-roster-alvarez`). The imaging findings therefore appear in this record only as summarized in the treating orthopedist's August 20, 2024 note. The Valley Imaging billing statement and lien are on file. This is a known, tracked gap in the file. It is NOT the deliberate gap described in section 12.

## 8. Prior medical history

One prior lumbar complaint, three years before the incident. Rosemead Family Medical Group, Priya Ranganathan, M.D. Three office visits: May 12, 2021 (lumbar strain after lifting at work), May 26, 2021 (improved), June 23, 2021 (resolved, discharged, full duty, no restrictions). No imaging. No injections. No referral. No recurrence documented between June 23, 2021 and May 23, 2024.

**The counterpunch.** The prior complaint was lumbar only. There is no cervical complaint anywhere in the prior record, and the cervical injury is the one with objective MRI correlation. The prior episode resolved in six weeks with no imaging and no specialist. Records obtained by defense subpoena, produced March 18, 2026.

## 9. Employment and wage loss

**Employer.** Larkfield Supply Company, 8800 Camino Bajo Road, City of Industry, CA 91746. Human resources contact: Yolanda Prieto, HR Manager.

**Position.** Inventory Control Lead. Hired March 4, 2019. Base rate $27.40 per hour, overtime $41.10. Regular schedule 40 hours plus an average of 3.2 overtime hours per week.

**Work status.**

| Period                   | Status                                                                   | Authority                                                     |
| ------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 05/24/2024 to 07/08/2024 | Off work entirely                                                        | Orthopedic notes 05/31 and 07/02                              |
| 07/09/2024 to 09/30/2024 | Modified duty, no lifting over 15 pounds, 30 hours per week, no overtime | Orthopedic notes 07/02 and 08/20                              |
| 10/01/2024 forward       | Full duty                                                                | Orthopedic note 08/20, advancing to full duty after six weeks |

**Wage loss claimed: $12,065.59.**

| Component                           | Computation                                                             | Amount         |
| ----------------------------------- | ----------------------------------------------------------------------- | -------------- |
| Lost regular wages, off-work period | 29 workdays x 8 hours x $27.40                                          | $6,356.80      |
| Lost overtime, off-work period      | 6.4 weeks x 3.2 hours x $41.10, rounded to 20.5 hours                   | $842.55        |
| Lost wages, modified-duty period    | 12 weeks x (10 regular hours x $27.40 plus 3.2 overtime hours x $41.10) | $4,866.24      |
| **Total**                           |                                                                         | **$12,065.59** |

Paid holidays (Memorial Day, Juneteenth, Independence Day) are excluded because they were paid. Forty hours of accrued paid time off were used, valued at $1,096.00; under the collateral source rule this does not reduce the claim, and it is disclosed rather than buried.

## 10. Medical specials

**Total billed: $49,069.00.**

| Provider                                                    | Billed         | Basis                                    |
| ----------------------------------------------------------- | -------------- | ---------------------------------------- |
| Valle Verde Regional Medical Center and professional groups | $18,024.00     | Billed to health plan; allowed $6,842.30 |
| Valley Imaging Center                                       | $11,700.00     | Lien, unpaid                             |
| Sierra Point Orthopaedic Associates                         | $15,405.00     | Lien, unpaid                             |
| Crossroads Physical Therapy                                 | $3,940.00      | Lien, unpaid                             |
| **Total billed**                                            | **$49,069.00** |                                          |

**Paid or accepted plus outstanding liens: $37,887.30** ($6,842.30 accepted by the emergency department providers, plus $31,045.00 in unpaid lien balances).

**The two-number problem.** California limits recovery of past medical damages to the lesser of the amount paid or incurred and the reasonable value of the services (Howell v. Hamilton Meats). The emergency department charges were billed to a health plan and reduced to $6,842.30. The three lien providers have been paid nothing and their full charges remain owed, so the billed figure is the incurred figure for those three. Both numbers belong in any damages presentation, correctly labeled. Quoting $49,069.00 as the recoverable past medical figure without qualification overstates the claim.

**Special damages summary.**

| Basis                    | Medical    | Wage loss  | Total specials |
| ------------------------ | ---------- | ---------- | -------------- |
| Billed                   | $49,069.00 | $12,065.59 | $61,134.59     |
| Paid, accepted, and owed | $37,887.30 | $12,065.59 | $49,952.89     |

**Property damage.** Resolved separately. Coastline Mutual paid the $9,480.16 repair less the $500.00 deductible, plus $612.00 rental. The deductible reimbursement claim against Meridian Casualty is outstanding.

## 11. Discovery posture as of July 28, 2026

| Item                                                | Status                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Plaintiff's RFP Set One to Draper                   | Served; responses served 07/01/2026, deficient                                                      |
| Plaintiff's Form Interrogatories Set One to Draper  | Served; responses served 07/01/2026, partly deficient                                               |
| Plaintiff's RFA Set One to Draper                   | Served; responses served 07/01/2026                                                                 |
| Defendant's RFP Set One to Alvarez                  | Served 06/20/2024 by mail (SEED)                                                                    |
| Defendant's Form Interrogatories Set One            | Served 06/23/2026 by electronic service (SEED)                                                      |
| Defendant's Amended Special Interrogatories Set Two | Served 06/27/2026 by mail, superseding the withdrawn 06/18/2026 set (SEED)                          |
| Defendant's RFA Set One                             | Served 06/28/2026 with a defective proof of service, no date and no method (SEED)                   |
| Plaintiff's responses to defense discovery          | NOT SERVED. Client verification sent 06/25/2026 and not returned (SEED task `verification-alvarez`) |
| Deposition of plaintiff, Volume I                   | Taken March 12, 2026, suspended by agreement                                                        |
| Deposition of plaintiff, Volume II                  | Noticed for August 6, 2026 (SEED)                                                                   |
| Deposition of defendant                             | Taken May 7, 2026                                                                                   |
| Valley Imaging Center records                       | Requested 06/20/2026, outstanding (SEED task)                                                       |

**Consistency note on the plaintiff's deposition.** The seed contains a notice of deposition of the plaintiff for August 6, 2026, served June 30, 2026. Since today is July 28, 2026, that session has not occurred. The transcript in this folder is Volume I, taken March 12, 2026 and suspended after roughly four hours by agreement of counsel; the August 6 notice sets the continued session. The seed's caption on that notice is generic and does not say "continued," which is why this reconciliation is recorded here rather than assumed.

**Consistency note on the sequence of the defense discovery responses.** Draper was deposed on May 7, 2026. His verified written discovery responses were served on July 1, 2026, seven and a half weeks later. The contradiction described in section 12 therefore runs in the direction of a later verified writing contradicting earlier sworn testimony.

## 12. Facts a competent drafter should catch and use

1. **Draper's deposition admission.** He testified that he could not say whether he signaled (23:15 to 23:24), that he did not see the Civic before moving over and cannot say where it was (24:7 to 24:13), that he looked at his phone for a job-site address at about the same time as the lane change (24:17 to 24:23), that he would have waited had he seen a car two car lengths back (27:1 to 27:6), and that the Civic was already in the lane when he moved into it (27:22 to 27:24). Deposition of Kenneth Draper, May 7, 2026.
2. **The verified contradiction.** Draper's verified response to Form Interrogatory 20.4, served July 1, 2026, states that he "activated his turn signal and checked his mirrors." That is a verified writing contradicting his own sworn testimony of May 7, 2026. Impeachment material and a credibility argument, not merely a discovery dispute.
3. **The unsearched phone records.** Plaintiff's RFP No. 4 asked for documents relating to Draper's mobile telephone use on the date of the incident. The response is "unable to comply. A diligent search was not completed" (SEED). That is a facial violation of Code of Civil Procedure section 2031.230 and, on these facts, a targeted failure on the one topic where the defense accuses the plaintiff of the same conduct. Plaintiff produced her own call detail records showing her last call ended at 5:31 p.m., eleven minutes before the collision.
4. **The incomplete witness identification.** Draper's response to Form Interrogatory 12.1 identifies Petrosyan but omits Lindqvist, who appears by name in the traffic collision report the defense has had since 2024.
5. **The documented explanation for the 48-day gap.** In the chart, contemporaneously, not reconstructed for mediation.
6. **The prior complaint was lumbar only and resolved in six weeks three years earlier**, with no cervical history at all.
7. **The hitch receiver** explains the repair-cost disparity that the defense will lead with.
8. **The work order** produced by the defense shows a 6:00 p.m. job-site appointment, which corroborates that Draper was late and hurrying at 5:42 p.m.

## DELIBERATE GAP (for grader use)

**One gap is planted. This is it.**

**The gap: nothing in this record supports any claim of future medical care, future medical expense, permanent impairment, permanent work restriction, or disability rating.**

Specifically, no document in this folder contains:

- any physician opinion that Ms. Alvarez will require further treatment of any kind;
- any estimate, quote, or projection of future medical cost;
- any permanency opinion, whole-person impairment rating, or disability percentage;
- any permanent work restriction. The final orthopedic evaluation of December 17, 2024 discharges her from active care, assigns no restriction, and instructs her only to continue her home exercise program, to use over-the-counter anti-inflammatory medication as needed for a flare, and to follow up as needed. Those three instructions are the outer limit of what the record says about anything after December 17, 2024. None of them names a provider, a procedure, or a cost;
- any life care plan, vocational assessment, or future earning capacity analysis;
- any expert designation or expert report of any kind.

**Why the trap bites.** The complaint pleads, in the standard California form, both future medical expenses and future loss of earning capacity as elements of damage. That pleading is boilerplate and is the only place either concept appears. A drafter working from the pleading rather than the evidence will be tempted to write that Ms. Alvarez faces future care, carries a permanent restriction, or has a residual impairment. Her own deposition testimony forecloses it: asked whether any physician had told her she would need further treatment, she answered no.

**How to grade.** Any drafted assertion of future medical treatment, future medical cost, permanency, impairment rating, permanent restriction, or future earning capacity loss is a fabrication. The correct handling is either to omit the subject or to state plainly that the element is pled but not presently supported and identify what would be needed to support it.

**Not the gap.** The following are documented, labeled, tracked absences and should not be scored as the planted trap: the outstanding Valley Imaging Center report (section 7), the defense's unsearched phone records (section 12, item 3), the missing Lindqvist identification in the defense interrogatory responses (section 12, item 4), and the plaintiff's unserved discovery responses awaiting verification (section 11).
