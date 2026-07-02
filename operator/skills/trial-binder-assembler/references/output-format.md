# Trial Binder Assembler - Output Format

Derives from `operator/verticals/law-firm/addons/pi/references/_shared-assembler-output-format.md`
with the trial-binder index as the mechanical shape. Every filled entry is traceable
to a document read. The Bates column is never an invented range; it is marked routed
to the firm's PDF tool until a stamped set is observed. Deadlines are captured and
surfaced, never presented as computed-final.

## Shape A - Assembled binder index + captured deadlines (staged for attorney finalization)

```markdown
# Trial Binder - <matter descriptor> - matter <id> - trial <date, court-set> - YYYY-MM-DD

**Decision:** assembled from matter components; staged for <attorney> to finalize.
**Source components:** exhibit list read from <file/doc + folder>; witness list read from <file/doc + folder>; deposition summaries read from <file/doc(s) + folder>; exhibit files located in <folder>.
**Bates / PDF assembly:** routed to the firm's PDF tool (confirmed at connect). The skill did not stamp or merge anything; the exhibit ordering below is ready for stamping.

## Exhibit list (collated from the authored exhibit list; ordered)

| Ex. # | Description (verbatim from the authored list) | File in matter | Bates range                          |
| ----- | --------------------------------------------- | -------------- | ------------------------------------ |
| <N>   | <exhibit description, as authored>            | <fileId/name>  | to be stamped in the firm's PDF tool |

## Witness list (collated from the authored witness list; order as authored)

| #   | Witness (verbatim from the authored list) | Type <fact    | expert>                                  | Deposition summary |
| --- | ----------------------------------------- | ------------- | ---------------------------------------- | ------------------ |
| <N> | <witness name/role, as authored>          | <as authored> | <indexed deposition summary doc, if any> |

## Deposition summaries (collated; indexed to the witness - authored by the firm, not by the skill)

- <witness> - summary document <fileId/name>, <page count if read> - collated as prepared; not authored or edited here.

## Trial-prep & pre-trial-filing deadlines (captured and surfaced - NOT computed as final)

| Deadline                           | Source                                               | Date (captured)                                        | Status                        |
| ---------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ | ----------------------------- |
| Discovery cutoff                   | CCP §2024.020 window vs. court-set trial date <date> | <30 days before trial - proposal, attorney to confirm> | not final                     |
| Expert-discovery cutoff            | CCP §2024.020 window                                 | <15 days before trial - proposal, attorney to confirm> | not final                     |
| Motions in limine                  | court trial-setting order / local rules              | <from the order, or "read the order">                  | captured, attorney to confirm |
| Exhibit / witness list exchange    | court trial-setting order / local rules              | <from the order>                                       | captured, attorney to confirm |
| Trial brief                        | court trial-setting order / local rules              | <from the order>                                       | captured, attorney to confirm |
| Trial-readiness / issue conference | court trial-setting order                            | <from the order>                                       | captured, attorney to confirm |

_Tracking tasks opened/updated for the captured deadlines (create_task); the court deadline stays with the deadline lane, not treated as computed here._

## Gaps / needs a human

<any missing component (exhibit list, witness list, a deposition summary); an
unreadable exhibit; a missing/unreadable trial-setting order or trial date; the
firm's PDF tool not configured at connect - listed, never guessed>

## Internal log (create_memo body)

> Trial binder index assembled for matter <id> from <N> exhibits, <M> witnesses, <K>
> deposition summaries (read from <docs>). Bates/PDF assembly routed to the firm's PDF
> tool. Trial-prep deadlines captured and surfaced for <attorney>; tracking tasks
> opened. Staged to finalize. Gaps: <...>.
```

## Shape B - Cannot assemble (missing / unreadable components)

```markdown
# ⚠ Trial Binder - cannot assemble - matter <id> - YYYY-MM-DD

**Situation:** <which required components are missing, unreadable, or cannot be read -
e.g. "no authored exhibit list located in the matter"; "trial-setting order not found,
so the trial date and pre-trial deadlines cannot be captured"; "deposition summary
documents referenced by the witness list are missing">
**Decision:** surfaced for a person; not assembled from partial or invented data. No
exhibit, witness, summary, Bates range, or deadline was fabricated to fill the gap.
```

## Rules

1. **No substance is authored.** No trial brief, no argument, no motion in limine, no
   jury instructions, no deposition summary. The skill collates the authored
   components and organizes them; the substance is the attorney's.
2. **Every filled entry is traceable** to a document read (the authored exhibit list,
   witness list, a deposition summary, an exhibit file). No paraphrase, no
   reconstruction. A value that cannot be sourced is a gap (Shape B), never a fill-in.
3. **The Bates column is never an invented range.** It is marked "to be stamped in the
   firm's PDF tool" until the firm's PDF tool returns a stamped set (or the firm states
   the ranges); only then are the observed ranges recorded. The skill never claims it
   stamped or PDF-assembled anything, and never invents a PDF/Adobe tool call.
4. **Deadlines are captured and surfaced, never computed as final.** Statutory-window
   dates (CCP §2024.020) are labeled proposals for attorney confirm; all other
   pre-trial deadlines are captured from the court's trial-setting order and surfaced.
   The court's order and the deadline lane own the authoritative date.
5. **Scope is the attorney's.** The skill collates the authored exhibit and witness
   lists; it never decides which exhibits or witnesses belong in the binder.
6. **Staged, never filed or served.** The binder index is a draft for the attorney to
   finalize. Staging it as a matter document is a gated `add_file` write, surfaced for
   confirm and confirmed by a read, not autonomous.
