---
date: 2026-07-09T04:08:52Z
from: smdurgan@smdurgan.com
to: Christa@ashtonandprice.com
subject: RE: Litigation Lifecycle Solution
gmail_message_id: 19f45109ba894f8e
status: CANONICAL outbound — written responses to `06` + the routine-settings matrix (start-tier, ceiling, caps). This is the reconciliation target both operators are built to.
---

# Scott → Christa: point-by-point responses + routine-settings matrix

_Verbatim body of the sent email. This is our written answer to Christa's section-by-section
markup (`06`). It makes contractual commitments to the client — the per-routine three-tier
dial, the named permanent caps (deadlines / money / opposing counsel / court), the deadline-engine
posture (read Smokeball court-rules, confirm with the attorney), CoCounsel dropped, medical
chronology gap-flagging, training-explanation-by-default, and the refusal spec. The routine grid
at the end is the machine-readable target for `customer.yaml` per-routine entitlements. Three
answers are still owed by Christa (verification escalation count, treatment-gap days, any grid
changes). The grid below is reformatted from the sent tab-separated layout into a table for
readability; wording is unchanged._

---

SMD Services
LITIGATION LIFECYCLE OPERATOR

Hi Christa,

Please review responses below and let us know where we need to keep refining. Also, at the end is a detailed routine settings matrix that hopefully provides additional clarity.

## How much it does on its own

Three tiers per routine from day one, exactly as you framed it: auto-handle, prepare-and-route, and flag-only. It is your dial, start to finish. A few things you told us to keep in front of a person, and we hold them there:

Nothing touching a deadline or money auto-handles. Discovery deadlines, lien tracking, settlement figures, and minor's-compromise numbers stay at flag-only or prepare-and-route.
Opposing counsel and the court always take a person's send. Meet-and-confer letters and the like are drafted for you and go out only when an attorney sends them, the way you set it.
Court-bound work product stays at prepare-and-route. The separate statement and the motion package: we assemble, an attorney finalizes and files. The Operator does not e-file on its own.
Everything else is yours to take further as you get comfortable. Two of those reach outside the firm, so we want to name them plainly: the client-verification chase, which goes to your client, and the medical-records chase, which goes to your records vendor. The "a person sends it" rule you set covers opposing counsel and the court, not your own clients or your vendors, so these two are yours to move up to auto-handle whenever you choose. The routine internal ones, like new-matter setup and staging documents for BriefPoint, can move up the same way. If you would rather keep any of them under approval, that is a one-line change.

Every routine, where it starts, and the highest it can go is laid out in the grid at the end of this email. Mark anything you would set differently.

## Point by point

**Deadlines**
If you run Smokeball's court-rules calendaring, the Operator reads those computed dates from Smokeball and confirms them with the attorney rather than computing its own. Where a discovery type or service method is not covered cleanly, it proposes the date instead. Every date is confirmed by the attorney either way, and we log that confirmation with the attorney's name and a timestamp on the matter.

**Client verification**
Owned end to end. The Operator prepares the verification, tracks it as an open item on the matter, and chases the client on a cadence you set per matter. After a set number of unanswered attempts it stops chasing the client and escalates to a person rather than nagging indefinitely, and you tell us the number. The verification goes out through your existing Smokeball e-sign the way it does today; the Operator tracks it by watching for the signed verification to land back in the matter, and chases the client until it does.

**Separate statement**
Confirmed. The reasons-to-compel cells stay empty for the attorney. There is no mode that fills in an argument.

**Meet-and-confer and propounded discovery**
Agreed, and it holds the way you set it. The decision to send anything to opposing counsel stays with the attorney and always takes an explicit human send. The Operator watches the response deadlines on the discovery you propound, flags a thin or late response and the window to compel, and drafts the letter for review, but a person sends it.

**Medical chronology**
Confirmed. As records arrive in the matter, it keeps the running chronology current and flags treatment gaps beyond the length you set, so tell us that length, for example 30 or 60 days.

**Case initiation**
Confirmed. Case initiation is configured per matter type: the Operator keys off the matter type in Smokeball, and we set up the folder and task template for each type with you, from how you actually organize that kind of matter. We do not impose a template. Adding a new matter type later is a configuration change, not a rebuild.

**Motions**
CoCounsel is off the table on your end, understood. BriefPoint needs no new integration: the Operator stages its inputs into the Smokeball matter folder BriefPoint draws from, and picks up its finished output from there. The one thing we set with you is which folder that is. How Claude divides the rest of the drafting we settle with you, so there is no overlap, the redundancy point you raised.

**Minor's compromise**
Confirmed, and it keeps the posture from the rehearsal: it names what is missing, a guardian ad litem, a blocked account, and does not infer it.

**Trial prep**
Confirmed.

**Mediation, settlement, and liens**
Confirmed. It lays out the figures as recorded and does not compute a net-to-client or any fee reduction. It shows the input rows as recorded, and Smokeball runs the trust accounting and the math.

**Paralegal training**
Built in and on by default, not a toggle. When the Operator does a step on a matter, it leaves a short note in the matter itself: what it did, the rule behind it, what comes next, and when to bring in the attorney. So your paralegals see the reasoning sitting next to the work as they go, in the matter where they are already working, and pick up the real process by doing it with a guide present.

## What it does when it is not sure

You asked for this in writing, so plainly: where the Operator is not confident, a proof of service it cannot read cleanly, a matter it cannot match, a figure that is not in the record, it does not guess and it does not proceed. It surfaces what it found, says what it needs, and waits for a person. The send path is fail-closed as well: no instruction that arrives inside a document or an email from outside the firm can trigger an autonomous send, and anything going outside the firm routes to a person. Refusing when it cannot verify something is a normal, logged part of how it works, not a failure.

## Getting set up

Your tuning documents. You do not need to send us anything. Once we are connected, the Operator reads the sample matters and your letters from your own systems. We do not take a separate copy of your files to keep.
Access.
Dedicated monitored intake inbox: agreed. It gives us exactly the clean audit trail you want, of what the Operator saw and when.
InfoTrack: approved. In practice the Operator reads InfoTrack's service confirmations where they land in your Smokeball matters and ties them to the responsive-pleading deadline.
Smokeball: whenever you are ready to coordinate the one-time authorization with your Smokeball owner, we set it up together and verify the connection live. It gets the access it needs to do the work above, reading your matters and writing the tasks, calendar entries, folders, and drafts it prepares. It never moves trust money or posts to your financial ledgers.

## What we need back from you

1. The client-verification chase number (attempts before it escalates to a person)
2. The treatment-gap length to flag (e.g. 30 or 60 days)
3. Any routines on the grid below you would set differently

We are moving ahead on everything that does not need you.
Thanks, Christa.
Best,
Scott

---

## The routine settings

Three settings per routine: auto-handle (it does it), prepare-and-route (it prepares it, a person approves), flag-only (it just surfaces it). Where each starts and the highest it can go. Some you asked us to cap, with the reason shown. Mark anything you would change.

### DISCOVERY

| Routine                     | Starts at         | Highest it can go                            |
| --------------------------- | ----------------- | -------------------------------------------- |
| Served discovery caught     | Flag-only         | Flag-only (only surfaces)                    |
| Response deadlines          | Prepare-and-route | Prepare-and-route (capped: deadline)         |
| Client verification         | Prepare-and-route | Auto-handle (once you are comfortable)       |
| Separate statement          | Prepare-and-route | Prepare-and-route (capped: before a judge)   |
| Opposing responses reviewed | Flag-only         | Flag-only (an assist, not an authority)      |
| Meet-and-confer letter      | Prepare-and-route | Prepare-and-route (capped: opposing counsel) |
| Response inputs staged      | Prepare-and-route | Auto-handle (once you are comfortable)       |

### CASE INITIATION

| Routine              | Starts at         | Highest it can go                      |
| -------------------- | ----------------- | -------------------------------------- |
| New matter setup     | Prepare-and-route | Auto-handle (once you are comfortable) |
| Service confirmation | Flag-only         | Flag-only (capped: deadline)           |

### MEDICAL RECORDS AND CHRONOLOGY

| Routine            | Starts at         | Highest it can go                          |
| ------------------ | ----------------- | ------------------------------------------ |
| Records chase      | Prepare-and-route | Auto-handle (once you are comfortable)     |
| Medical chronology | Runs on its own   | Internal record only (never characterizes) |

### MOTIONS

| Routine         | Starts at         | Highest it can go                          |
| --------------- | ----------------- | ------------------------------------------ |
| Motion calendar | Flag-only         | Flag-only (only surfaces)                  |
| Motion package  | Prepare-and-route | Prepare-and-route (capped: before a judge) |

### MINOR'S COMPROMISE

| Routine                   | Starts at         | Highest it can go                                 |
| ------------------------- | ----------------- | ------------------------------------------------- |
| Minor's compromise packet | Prepare-and-route | Prepare-and-route (capped: money and court forms) |

### TRIAL PREP

| Routine      | Starts at         | Highest it can go                               |
| ------------ | ----------------- | ----------------------------------------------- |
| Trial binder | Prepare-and-route | Prepare-and-route (capped: deadlines and court) |

### MEDIATION, SETTLEMENT, AND LIENS

| Routine                  | Starts at                     | Highest it can go                                   |
| ------------------------ | ----------------------------- | --------------------------------------------------- |
| Mediation and settlement | Prepare-and-route             | Prepare-and-route (capped: deadline and settlement) |
| Lien ledger              | Flag-only / prepare-and-route | Prepare-and-route (capped: money)                   |
| Settlement statement     | Prepare-and-route             | Prepare-and-route (capped: money)                   |

### FIRM-WIDE

| Routine                | Starts at | Highest it can go         |
| ---------------------- | --------- | ------------------------- |
| Daily "what needs you" | Flag-only | Flag-only (only surfaces) |

In short: anything touching a deadline, money, or a court filing is capped below auto-handle, and anything to opposing counsel or the court always takes a person's send. Everything else is yours to move up to auto-handle whenever you are ready.
