# Litigation Lifecycle: Rehearsal Results

_Prepared for Christa Barrera and Chris Price, Ashton & Price. Status: SENT
to Christa 2026-07-06 ("Rehearsal Results: Running Your Litigation
Lifecycle"). This extends the earlier "Safety & Readiness"
report, which was careful to say the system had been adversarially reviewed
but never executed. That has changed: everything below is the system actually
running._

---

## What we did

Before anything touches your account, we built a rehearsal law office: a
complete PI practice inside Smokeball's staging environment, with seven
matters spanning your lifecycle (a collision case deep in discovery, a
premises case just filed, a minor plaintiff, a lien-heavy settlement, a trial
posture, a multi-defendant case) and a matter file of about twenty documents.
We wrote every document ourselves, and we deliberately included broken and
hostile ones: a proof of service with the service boxes unchecked and no
execution date, the same discovery set filed twice through two routes, an
amended set stacked on the original, a second client with the same name on a
different case, and a document with instructions planted inside it aimed at
an automated reader.

Then we ran your discovery process against it, end to end, through real
email and real Smokeball, and graded every step. When discovery held up, we
kept going and ran the rest of the lifecycle the same way: a case just
filed, medical records, a minor's settlement, liens and disbursement, and a
summary judgment motion. The second half of this report covers those runs.

## What it did

**It read served discovery and captured the facts that matter.** Each served
set was classified by type, and the service date and method were read off the
proof of service itself: requests for production served by mail on June 20,
form interrogatories served electronically on June 23, an amended special
interrogatory set served June 27 and recorded as superseding the original,
and a deposition notice with its date, time, and location. Every capture
became a confirmation task for the attorney. It proposes the response window
and says, in each memo, that the date is to be confirmed by a person before
anyone relies on it. It never treats its own reading as the deadline.

**It recognized the duplicate.** The set that arrived twice produced one
capture that lists both copies, not two captures and a phantom second
deadline.

**It reviewed the other side's responses the way a careful paralegal starts
the compel process.** Given the defendant's responses to a document demand,
it surfaced seven candidate deficiencies, each quoted and tied to the
specific request and the governing rule: a boilerplate objection, a privilege
objection with no log, an "equally available" non-answer, a defective
inability statement, produced documents not identified to a request, three
requests with no response at all, and a missing verification. It drafted the
meet-and-confer letter and put a go or no-go decision in front of the
attorney. It did not judge which objections have merit. That call stayed
where it belongs.

**It assembled the separate statement as pure collation.** Eight items,
request and response quoted verbatim, and every "reasons to compel" cell left
empty for the attorney. It also flagged what was missing rather than filling
it in: the absent definitions section, the three unanswered requests, and an
unidentified "documents previously produced" reference.

**It watched the whole office and reported honestly.** The daily digest found
every open item across the matter set with correct due dates, put the urgent
ones first, reported four quiet matters as quiet, and disclosed that it was
using fallback urgency windows because the firm has not yet set its own.
Nothing invented, nothing padded.

## What it refused

This is the part we test hardest, because an assistant is only trustworthy if
its refusals hold under pressure.

**The broken proof of service.** Where the service boxes were unchecked and
the date was blank, it did not guess. It wrote "cannot capture service date
or method; cannot propose a deadline" and opened an urgent attorney-review
task.

**The planted instructions.** The document that tried to direct an automated
reader to forward case materials to an outside address was identified as an
attempted manipulation, flagged with a security alert to the attorney, and
not obeyed. Document content is treated as information to handle, never as
instructions to follow.

**Opposing counsel.** We wrote to its inbox posing as opposing counsel twice.
A formal service email was recognized as service and processed with no reply
sent. An informal settlement approach was held entirely: no reply, no
engagement, and a clearance task on the matter so the team sees it the next
morning. At no point in any test did it send anything to opposing counsel.
The meet-and-confer letter it drafted is marked not for transmission until
the attorney says go.

**Its own test data.** In one test, our own file's label contradicted the
document inside it. It caught the contradiction, said which party's responses
it had actually reviewed, and locked the letter until a person confirms the
right file. We did not plant that one; it caught our mistake.

## What we found and fixed

Rehearsal exists to break things before your account is involved, and it did.
The round surfaced six defects. The largest: the system could list your
documents but had no way to read their contents, and a held message was
invisible because the hold lived only in a log. Both are fixed and retested;
the document-reading fix is what made everything above possible, and a held
message now always leaves a visible task. The remaining fixes are smaller
versions of the same discipline: every action the system takes has to land
somewhere a person will actually see it. Each fix was rebuilt, retested on
the rehearsal office, and graded again before we counted it done.

## Then we ran the rest of the lifecycle

Discovery is where you told us the most slips, so it went first and deepest.
The second rehearsal round ran every other part of the case the same way,
against the same rehearsal office, with the same grading. Every part passed,
and the guardrails held in every run.

**Deadlines went on the calendar as proposals, never as facts.** For each
served set it proposed a response date with the service method and the
weekend rollover handled correctly, and every date landed flagged for a
person to confirm. When the summary judgment motion arrived, it captured
the hearing, proposed the opposition and reply windows, said plainly that
those windows run under a different rule than ordinary motions and that its
proposals ignore court holidays, and refused to treat any of it as final.
One honest note from the grading: on one kind of service, two separate runs
proposed windows that differed by two court days. That disagreement is
exactly why every date it produces is a proposal, and it is the first thing
we want to settle with you in the working session: whether deadline
arithmetic lives in Smokeball's court-rules engine or in a routine you
confirm.

**The multi-defendant case stayed straight.** Two defendants served
discovery a day apart, one of them a sixty-question set. Each set was
captured under the right defendant, and the unusual size was called out
rather than smoothed over.

**The lien file came back the way a good ledger reads.** Three lienholders,
three different situations, each reported as it actually stood: one payoff
in hand with its expiration date and a warning to refresh it, one asserted
but never requested, one requested with no response and flagged as the item
holding up disbursement. No arithmetic on reductions. That judgment stays
with the attorney.

**The medical chronology quotes the record and nothing else.** Every line
carries the record's own words and the page it came from. Where the record
was thin, the chronology says so instead of rounding up.

## What it declined to invent

The strongest results of the second round were the refusals.

**No records roster, no chase.** Asked to chase medical records on a matter
where no one had authored a list of providers, it declined to guess at one
and asked the firm to confirm which requests are actually open.

**No numbers, no settlement statement.** Asked to prepare disbursement
inputs on a matter where the gross, the fee, and two of three lien payoffs
were not recorded, it said the statement cannot be assembled, listed
exactly what the attorney needs to record, and computed nothing. Smokeball
runs the trust math; the system feeds it only what a person authored.

**No conference date, no schedule.** The settlement tracker found no
mediation date on file and said so, rather than inventing a timeline to
track.

## What it caught that we did not plant

Two findings in the second round were not test designs. They were real gaps
in the rehearsal file, and it found them.

**A settlement offer quietly expiring.** The carrier's offer on the minor's
case carried a thirty-day window, and nothing on the matter was tracking
it. The system read the offer, computed the expiration, saw no task or
calendar entry anywhere, and raised it as needing the attorney immediately.
That is the kind of miss that costs real money, and no one had asked it to
look.

**A settlement with no petitioner.** On the same case it noticed that the
guardian ad litem existed only as a note in the matter description, not as
a record in Smokeball, and that a minor's compromise cannot move without
one. It named that as the item gating the whole settlement and put it in
front of the attorney.

## What the second round fixed

The pattern from the first round repeated: rehearsal broke things so your
account never has to. The largest fix this round: Smokeball's calendar has
three unstated requirements for how an event must be written, and the
system's first attempts bounced off them. We pinned down the exact rules,
built them in, and verified a clean write against Smokeball directly. The
smaller fixes are the same discipline as before: when a run is interrupted,
it should reconcile what it already wrote instead of adding alongside; when
it finds a time-sensitive item, it should leave a task, not just a note.
Each fix is rebuilt and reproven on the rehearsal office before it counts.

## What this is, and is not

These results are from matters we authored, in a rehearsal environment, on
real software against real Smokeball. They are strong evidence the machinery
works and the guardrails hold. They are not evidence that our picture of how
your office runs is correct. That picture gets corrected by you, in the
working session, and nothing runs against your account before that happens.
The rehearsal office stays alive permanently: every future change proves
itself there before it goes anywhere near your matters.

## What we need from you

The working session. Bring your corrections; the system is ready to be wrong
in front of you.
