# CA Served-Discovery Capture Spec

**What this is:** the taxonomy of what the Operator READS off a served California
discovery document — the discovery **type** and the **service method + date** — so it
can surface the right input for the court-rules engine (or, only where the firm
confirms deadlines are done by hand, present a computed date for attorney confirm).

**What this is NOT:** a deadline calculator. Per the pack's bright line
(`discovery-deadline-input-capture-only`), the certified court-rules engine
(LawToolBox / Smokeball-InfoTrack) owns the computation. The Operator captures the
inputs and reads/chases the engine's dates. The base arithmetic below is reference
for the present-for-confirm case only, and a computed date is **never** treated as
final without attorney confirmation.

> **Statute grounding — fetched and verified 2026-07-01.** Sources:
> [CCP §1013 (FindLaw)](https://codes.findlaw.com/ca/code-of-civil-procedure/ccp-sect-1013/),
> [CCP §1010.6 (FindLaw)](https://codes.findlaw.com/ca/code-of-civil-procedure/ccp-sect-1010-6/),
> [CCP §2030.260 (FindLaw)](https://codes.findlaw.com/ca/code-of-civil-procedure/ccp-sect-2030-260/),
> §2031.260, §2033.250. Re-verify at connect and on any statute amendment; California
> discovery timing is amendment-prone. County/department local rules can add
> requirements and are **out of scope until A&P's actual venues are known**.

## 1. Discovery type taxonomy (what to identify)

| Type                                                  | Recognize by                                             | Response requires party verification?                                                     |
| ----------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Interrogatories** (Form — DISC-001/003, or Special) | caption "Interrogatories"; numbered questions            | Yes (unless objections-only) — §2030.250                                                  |
| **Requests for Production** (Inspection Demand)       | "Demand for … Production / Inspection"; numbered demands | Yes (unless objections-only) — §2031.250                                                  |
| **Requests for Admission**                            | "Requests for Admission"; numbered matters to admit/deny | Yes (unless objections-only) — §2033.240; **unsigned/late → deemed admitted (§2033.280)** |
| **Deposition notice**                                 | "Notice of Deposition"; date/time/place or remote        | No party verification; drives calendar + prep, not a response-verification                |

The capture surfaces the type; it does not judge sufficiency or draft a response.

## 2. Service method + date (read off the PROOF OF SERVICE)

The proof of service (POS) at the end of the document states the **method** and
**date** of service. These are the inputs the deadline turns on. Read them; do not
infer them from the email/postmark alone (the POS is the authoritative statement).

| Method (as stated on the POS)        | Extension added to the base window | Statute          |
| ------------------------------------ | ---------------------------------- | ---------------- |
| Personal service                     | +0                                 | —                |
| Mail, place of address in California | **+5 calendar days**               | §1013(a)         |
| Mail, address elsewhere in the U.S.  | +10 calendar days                  | §1013(a)         |
| Mail, address outside the U.S.       | +20 calendar days                  | §1013(a)         |
| Overnight / express delivery         | **+2 court days**                  | §1013(c)         |
| Electronic service                   | **+2 court days**                  | §1010.6(a)(3)(B) |

**Base response window:** **30 days** from service for interrogatories (§2030.260),
requests for production (§2031.260), and requests for admission (§2033.250). (The
30-day base is the general rule; shortened/extended variants exist by statute or
stipulation — the engine handles them; the capture only records the served type,
date, and method.)

**Court-day counting** (for the +2-court-day methods): weekends and court holidays
are excluded. The Operator does not implement the calendar; the rules engine does.
Where the firm computes by hand and the Operator presents a date for confirm, it
shows the base date, the method-extension applied, and the statute — always for
attorney confirmation, never final on its own.

## 3. What the capture emits (the surfaced input)

For each served document, the Operator surfaces, for attorney confirmation:

- the matter it matched to (by case name + number),
- the discovery **type**,
- the **service date** and **method** as read off the POS (with the POS quoted/located),
- the derived response deadline **if** the firm computes by hand (base 30 days +
  method extension, with the statute cited) — flagged "proposed, confirm",
- OR, where the rules engine is active, a note that the engine's date should be read
  and confirmed.

## 4. Fail-closed rules (anti-fiction)

- If the POS is missing, ambiguous, or the method/date cannot be read with
  confidence → **surface and ask**; never guess the method or date.
- If the discovery type is unclear → surface for confirmation; never default.
- A computed date is a **proposal for attorney confirm**, never calendared silently.
- Local/department rules that shorten or add to the timeline are **not** applied
  until A&P's venues are configured — where a local rule might govern, surface it as
  a flag, do not compute around it.
