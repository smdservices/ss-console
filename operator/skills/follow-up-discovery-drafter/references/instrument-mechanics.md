# Instrument mechanics: California written discovery form and limits

> **Statute grounding: fetched and verified 2026-07-28.** Sources:
> [CCP §2030.030 (FindLaw)](https://codes.findlaw.com/ca/code-of-civil-procedure/ccp-sect-2030-030/)
> (35 specially prepared interrogatories),
> [CCP §2030.040 (FindLaw)](https://codes.findlaw.com/ca/code-of-civil-procedure/ccp-sect-2030-040/)
> (declaration for additional discovery; §2030.050 states what the declaration must
> contain, **to verify at connect**),
> [CCP §2030.060 (FindLaw)](https://codes.findlaw.com/ca/code-of-civil-procedure/ccp-sect-2030-060/)
> (interrogatory form: full and complete in itself, defined terms capitalized, no
> subparts, no continuing interrogatory),
> [CCP §2031.030 (FindLaw)](https://codes.findlaw.com/ca/code-of-civil-procedure/ccp-sect-2031-030/)
> (inspection demand form: consecutive set numbering, reasonable particularity, time,
> place, manner),
> [CCP §2033.030 (FindLaw)](https://codes.findlaw.com/ca/code-of-civil-procedure/ccp-sect-2033-030/)
> (35 non-genuineness requests for admission; genuineness requests unlimited),
> [CCP §2033.060 (FindLaw)](https://codes.findlaw.com/ca/code-of-civil-procedure/ccp-sect-2033-060/)
> (admission-request form, and the attachment requirement for genuineness requests).
> §2033.040 and §2033.050 (the admissions-side declaration) follow the interrogatory
> pattern and are **to verify at connect**. Re-verify all of these at connect and on
> any amendment; California discovery provisions are amendment-prone, and a form rule
> the firm's sets are built on is not something to carry from memory.

This file is loaded into the drafting context on every run. It governs the **form** of
the instruments. It does not govern strategy, and nothing in it authorizes the skill to
make a call the statute leaves to the propounding party.

---

## Special interrogatories

### Form: §2030.060

- **(d) Full and complete in and of itself.** "Each interrogatory shall be full and
  complete in and of itself. No preface or instruction shall be included" with a set
  unless approved under the Chapter 17 procedure. In practice: an interrogatory that
  only makes sense by reading the one above it is defective, and a set that opens with
  a block of instructions and definitions imported from a form is carrying a preface
  the statute does not allow.
- **(e) Defined terms in capitals.** "Any term specially defined in a set of
  interrogatories shall be typed with all letters capitalized whenever the term
  appears." So `YOU`, `YOUR VEHICLE`, `THE INCIDENT` are typed in capitals every time
  once defined. This is a mechanical requirement and the checker can see it.
- **(f) No subparts, no compound question.** "No specially prepared interrogatory shall
  contain subparts, or a compound, conjunctive, or disjunctive question." **This is
  gate 8.** See below.
- **(g) No continuing interrogatory.** An interrogatory may not be made continuing so as
  to impose a duty to supplement. Language like "and supplement this response as
  further information becomes known" makes the interrogatory objectionable.

### Gate 8: one fact per interrogatory, and why it fails in practice

The rule is easy to state and empirically hard to follow. In the 2026-07-28 prove-out,
**17 of 23** special interrogatories in the canonical set violated §2030.060(f), and
the same failure appeared in both models graded (findings ledger D26). The artifact was
otherwise graded usable on the first pass. This is not a comprehension failure; it is a
pattern-transfer failure, and knowing the mechanism is most of the defense:

> The compound structure is borrowed from **Form Interrogatory 15.1**, which chains
> subparts naturally (state the facts, identify the persons, identify the documents).
> Form interrogatories carry that structure because they are approved under the Chapter
> 17 procedure and are **exempt** from §2030.060(f). Specially prepared interrogatories
> are not exempt. Copying the shape of a form interrogatory into a special
> interrogatory imports a form the statute forbids.

Drafting rules that follow:

1. **One fact, one interrogatory.** If the answer would naturally be a list of
   different kinds of thing (facts, then people, then documents), that is three
   interrogatories, numbered separately.
2. **No lettered or numbered subparts inside an interrogatory.** No "(a) ... (b) ...",
   no "including but not limited to the following: 1) ... 2) ...".
3. **Watch the conjunctions.** "and" or "or" joining two distinct inquiries makes the
   interrogatory compound. "and" inside a single defined phrase ("date and time of
   the incident" as one fact) is a judgment call; where it is genuinely arguable, keep
   the construction and mark it `{{ATTORNEY: decision reserved}}` with §2030.060(f)
   named. Do not resolve it in silence, which is what the prove-out artifact did.
4. **No cross-reference.** "For each person identified in Interrogatory No. 4, state
   ..." is not full and complete in itself. Restate the identifying frame.
5. **The lint runs mechanically** (`--sprog-lint`), on the drafted set, every time. It
   flags subparts, enumerated clauses, compound conjunctions, and cross-references. A
   failing set is rebuilt, not surfaced with a caveat.

### Limit: §2030.030, and the declaration under §2030.040 / §2030.050

A party may propound, as a matter of right, **35 specially prepared interrogatories**
relevant to the subject matter, plus the official form interrogatories (which do not
count against the 35). To exceed 35, the propounding party attaches a **declaration for
additional discovery** under §2030.040, supported by grounds the statute enumerates:
the complexity or quantity of the existing and potential issues, the expense of
obtaining the information by deposition, or the efficiency of written interrogatories
for an investigation or a records search. If the responding party objects on the ground
that the limit was exceeded, the **burden of justification is on the propounding
party**.

**What the skill does with this.** It counts and reserves. It reports the specially
prepared interrogatories already propounded on the matter where the record shows them,
plus the count in the drafted set, and it names the limit and the statute. If the
drafted set would carry the matter past 35, that is a decision point marked
`{{ATTORNEY: decision reserved}}`. The skill does **not** decide to exceed the limit,
does **not** draft the declaration (it is signed under penalty of perjury by counsel
and states grounds counsel must defend), and does **not** trim the set on its own to
slip under the limit, because the trim is a strategic choice about which facts to
pursue. Where the prior counts cannot be read from the record, say so; never report a
count the record does not support.

---

## Requests for production: §2031.030

Form requirements the drafted set must satisfy:

- **Sets numbered consecutively.** The demanding party numbers each set of demands
  consecutively across the matter.
- **Identification block.** In the first paragraph immediately below the case title:
  the identity of the demanding party, the set number, and the identity of the
  responding party.
- **Reasonable particularity.** Each demand designates the documents, tangible things,
  land or other property, or electronically stored information sought, "either by
  specifically describing each individual item or by reasonably particularizing each
  category of item." A category so broad that the responding party cannot tell what
  falls inside it is the defect this requirement exists to prevent.
- **Time.** A reasonable time for the inspection, at least **30 days after service of
  the demand** (5 days in unlawful detainer).
- **Place.** A reasonable place for the inspection and any related activity.
- **Manner, and any alteration.** The activity demanded, the manner in which it will be
  performed, and whether it will permanently alter or destroy the item.

**What the skill fills and what it does not.** It drafts the demands themselves and the
identification block from the matter record. The **time, place, and manner** are the
firm's logistics and are left as `{{FILL: inspection date, place, manner | firm}}`, not
invented. A destructive-testing demand is never drafted on the skill's own initiative;
where the attorney names one, the alteration disclosure the statute requires is drafted
and the scope is marked `{{ATTORNEY: decision reserved}}`.

---

## Requests for admission

### Form: §2033.060

- **(d) Full and complete in and of itself.** No preface or instruction with the set
  unless approved under Chapter 17.
- **(e) Defined terms capitalized** whenever the term appears.
- **(f) No subparts, no compound, conjunctive, or disjunctive request** unless approved
  under Chapter 17. **The one-fact rule applies to admissions exactly as it applies to
  special interrogatories,** and the lint covers both. A request that asks the other
  side to admit two facts at once invites a partial denial that admits nothing.
- **(g) Genuineness requests carry their documents.** A party requesting an admission of
  the genuineness of a document "shall attach copies of those documents to the
  requests, and shall make the original of those documents available for inspection on
  demand." The skill drafts the request and **flags the attachment requirement** with
  the document identified by its record location and Bates range where one exists. The
  skill does not assemble or transmit the attachment set; that is part of service, and
  service is the firm's.

### Limit: §2033.030, and the declaration under §2033.040 / §2033.050

No party may request, as a matter of right, that another party admit **more than 35
matters that do not relate to the genuineness of documents**. Requests for admission of
the **genuineness of documents are not numerically limited**, except as justice
requires to protect the responding party from unwarranted annoyance, embarrassment,
oppression, or undue burden and expense. Exceeding the 35 requires a supporting
declaration on the same pattern as the interrogatory side.

**What the skill does with this.** The same as on the interrogatory side: it keeps the
two counts separate (non-genuineness against the 35, genuineness reported but not
counted against it), names the limit and the statute, and reserves the decision to
exceed. It never drafts the declaration.

---

## The two counts, reported every run

The itemized report carries this table, filled from the record and the drafted set. An
unreadable prior count is reported as unreadable, never as zero.

|                                         | Propounded to date | This set | Limit                   | Statute               |
| --------------------------------------- | ------------------ | -------- | ----------------------- | --------------------- |
| Specially prepared interrogatories      |                    |          | 35                      | §2030.030             |
| Requests for admission, non-genuineness |                    |          | 35                      | §2033.030             |
| Requests for admission, genuineness     |                    |          | not limited             | §2033.030             |
| Requests for production                 |                    |          | not numerically limited | §2031.030 (form only) |

Where a row crosses its limit, the report carries
`{{ATTORNEY: decision reserved}}`: exceed with a declaration for additional discovery,
or reduce the set. Both are the attorney's call, and the skill takes neither.
