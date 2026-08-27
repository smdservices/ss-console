---
name: medchron
description: Runs an A&P medical chronology end to end. Drives the production pipeline from matter resolution through Smokeball delivery, tracking clock and spend, and delivering every decision to the Captain as prose in chat rather than as a file to inspect.
version: 1.0.0
scope: venture:ss
owner: captain
status: stable
depends_on:
  mcp_tools:
    - crane_skill_invoked
    - crane_verify
---

# /medchron - Run a medical chronology

> **Invocation:** As your first action, call `crane_skill_invoked(skill_name: "medchron")`. Non-blocking; if it fails, log and continue.

## Usage

```
/medchron <matter number or client name>
```

A matter number and a client surname are both valid entry points. The skill
resolves the matter itself; never accept a matter UUID from the Captain, from
memory, or from a prior run.

Client names, matter numbers, and document contents are confidential and stay
out of this repo, which is public. They belong in the chat, in
`~/smd-medchron-data/`, and in the private engagements repo. Nothing you learn
during a run gets written back here.

## What this is, and what it is not

Two different things in this venture are called "medical chronology". Do not
confuse them.

|                             | Where it lives                                                                                                                                         | What it is                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The seat skill**          | `operator/skills/medical-chronology-maintainer/SKILL.md`, wired to routine "Medical chronology" in `operator/customers/ashton-price/routine-grid.yaml` | An Operator seat routine. Extractive, internal memo only, never sends. This is what service-agreement routine 11 refers to. **This skill does not touch it.**         |
| **The production pipeline** | `<engagements>/operator/customers/ashton-price/tools/medchron/` (private repo)                                                                         | About 40 Python scripts run from the Captain's laptop by an agent. Produces the deliverable chronology that goes into Smokeball. **This is what `/medchron` drives.** |

The pipeline is A&P-specific. It is not a general product.

## Where this skill lives

This file is the canonical copy, tracked at `docs/skills/medchron/SKILL.md` in
ss-console. `.agents/skills/medchron/SKILL.md` and `.claude/commands/medchron.md`
are **symlinks to it**, created by `scripts/install-captain-skills.sh`; both of
those directories are gitignored, so a symlink is what keeps one authored file
from becoming three drifting ones.

If `/medchron` is missing on a machine, run the installer. If you are editing the
skill, edit this file; the other two paths follow automatically.

This is not an enterprise skill. It is not synced from crane-console, and the
launcher's venture skill sync never deletes files it does not own, so the
symlinks survive `crane ss`.

## The one rule that governs every step

**The Captain cannot see any artifact this run produces.** Not a JSON file, not a
PDF, not a directory listing, not a log. Only the text of your messages reaches
them.

Therefore: **never write a step that asks the Captain to look at something.** No
"eyeball the selection", no "review the explained list", no "check the grouping",
no "confirm the output looks right". Those are instructions to nobody, and the
gate they pretend to be does not exist.

You do the reading. Then you present, in prose:

1. what is in scope,
2. what is excluded and why,
3. the counts, sizes, and money that bear on the decision,
4. your recommendation,
5. a specific question with named options.

A decision point is a gate only if the Captain can answer it from the message in
front of them. See `feedback_captain_cannot_see_artifacts_gates_must_be_prose.md`.

There are exactly **three** gates in this run: **selection** (before the pull),
**spend** (before the first paid stage), and **exceptions** (before delivery).
Everything else you decide and report.

---

## Step 0 - Orient

```bash
ENG="${SS_ENGAGEMENTS_DIR:-$HOME/dev/engagements}"
MC="$ENG/operator/customers/ashton-price/tools/medchron"
ls "$MC/RUNBOOK.md" || echo "engagements repo missing - STOP"
git -C "$ENG" fetch -q origin
git -C "$ENG" status -sb | head -1
```

If the engagements checkout is absent, **stop and say so.** The Law 2 guard fails
closed for a reason; do not improvise the pipeline from memory.

If that checkout is behind `origin/main`, **read the RUNBOOK and the scripts from
`origin/main`, not from the working tree** (`git -C "$ENG" show origin/main:<path>`).
Do not try to pull it: an ss-console session's auto-mode classifier blocks git
writes against other repos, and on 2026-08-27 the local engagements tree was 17
commits behind with the whole `tools/medchron/` directory sitting untracked, so a
working-tree read would have run the pre-fix pipeline. A sibling checkout is a
stale branch until you prove otherwise.

Then, in order:

1. **Read `$MC/RUNBOOK.md` in full.** It is the authority for stage order and
   exact invocation. If this skill and the RUNBOOK disagree about a command, the
   RUNBOOK wins and you say so in your next message.
2. **Read the A&P dossier** at `<engagements>/operator/customers/ashton-price/dossier.md`
   (Law 2: load before touch).
3. Confirm the venv: `~/smd-medchron-data/.venv/bin/python -c "import anthropic, pypdf, fitz, docx"`.
   Confirm `pdftoppm` (poppler) is on PATH.
4. **Record the wall-clock start time.** The Captain asks for clock and spend on
   every run. Stamp it now; you cannot reconstruct it later.

Client documents live at `~/smd-medchron-data/` and **never enter any repo.**
ss-console is public.

---

## Step 1 - Resolve the matter

Never trust a stored matter UUID. A retired script with a hardcoded MID nearly
wrote a deliverable into the wrong legal matter.

```bash
cd "$MC"
./run_seat.sh seat_find_matter.py "<number>"
./run_seat.sh seat_find_matter.py "<client name>"
```

The **intersection** of the two result sets must be exactly one matter. Zero, or
two or more: stop and put the candidates in front of the Captain as prose. Heed
any `OFFSET CAP HIT` warning; a capped scan proves nothing by absence.

Record the resolved MID with `crane_verify` (`method: live_state`, the probe
command, the probe output). Use it for this run only. Read `SMD_INCIDENT_DATE`
off the matter's own record; never guess it, never infer it from a filename.

Note whether the matter is single-client or **joint**. A joint matter runs one
unit per client (`units/<unit>.json`); on a single-client matter `SMD_UNIT`
equals `SMD_SLUG`.

The seat is 1 vCPU / 1 GB. **Serialize seat calls. Never parallelize them.**

---

## Step 2 - Inventory, then GATE 1 (selection)

```bash
./run_seat.sh seat_folders.py <MID>          > folders-raw.json
./run_seat.sh seat_list_mint.py list <MID>   > manifest-raw.json
# strip the @@SEAT@@ prefix into $SMD_MC_DATA/<slug>/folders.json and manifest.json
```

Now **you** read the tree and the manifest and roll them up. Then post a message
shaped like this:

> **Selection for `<Client>` `<matter #>`.** The matter holds N documents across
> M folders, X GB total.
>
> | Folder          | Docs |   Size | In?                                          |
> | --------------- | ---: | -----: | -------------------------------------------- |
> | /MEDICAL        |   96 | 180 MB | yes                                          |
> | /INVOICES       |   41 |  52 MB | yes                                          |
> | (root)          |   12 |   8 MB | yes                                          |
> | /PLEADINGS      |   58 | 900 MB | no - litigation filings, no clinical content |
> | /CORRESPONDENCE |   24 |  14 MB | no - letters between counsel                 |
>
> That selects **149 documents, 240 MB**. Excluded by name inside the included
> folders: letters of representation, records requests, HIPAA authorizations
> (12 files) - vendor paperwork, not records.
>
> Rough cost at this size: **$40-80** and **4-8 hours**. I will come back with a
> tight number after extraction, which is free.
>
> **The risk here is omission, not spend** - a folder left out is a record that
> never reaches the chronology, and nothing downstream can detect it.
>
> Proceed with this selection, add `/PLEADINGS`, or pull everything?

Rules for that message:

- **Every folder in the matter appears in the table.** A folder you silently
  dropped is the omission class this gate exists to catch.
- Each exclusion carries its reason in plain words.
- Never write "see folders.json" or any variant.
- If a folder's contents are ambiguous from its name, **open a few files and say
  what is actually in them.** Do not infer from filenames; a run this year read
  "physician orders" off a filename and found a patient checklist and blank
  forms.

**Wait for the answer.** This is one of the three real gates.

After the answer, author `$SMD_MC_DATA/<slug>/include.json`:
`{"include_prefixes": [...], "exclude_substrings": [...], "root_pdfs": true}`.

One-time per install: seed `$SMD_MC_DATA/controls/` (control pages plus a
`controls.json` naming an ORDER page and an INDEX page) from an existing set.

---

## Step 3 - Pull and extract (free)

```bash
export SMD_MC_DATA=~/smd-medchron-data
export SMD_SLUG=<slug>
export SMD_UNIT=<unit>
export SMD_INCIDENT_DATE=YYYY-MM-DD

python3 download.py <slug> <MID>   # sha256 and size verified, byte-dedupes
python3 extract.py  <slug>         # text layer; builds scan_queue.json
```

`extract.py` routes a file to vision when its text layer is a glyph index
(`/0/1/2/3`) or fails an English-stopword ratio, and deletes the stale text file
so vision's resume check cannot be satisfied by junk.

### Then open the email containers, or the corpus is short

```bash
python3 index_msg.py <slug> <MID>          # after download.py, never before
```

`download.py` pulls only `DOC_EXTS`, which has no `.msg`, so **every Outlook
container on the matter is skipped and the records attached to those emails are
invisible.** `coverage_gate.py` cannot catch it: the gate's denominator is
`raw_manifest.jsonl`, the pulled set, so a file never pulled can never surface
as uncited. It reports full coverage of a corpus that was already short. Two
delivered chronologies went out that way before this was found.

`index_msg.py` pulls the containers, extracts attachments, dedupes on sha256 of
the attachment bytes, and compares each against everything already pulled.
**Order is not optional** - run it before `download.py` and the comparison set
is empty, so every attachment reports NEW by construction and the run looks
like a discovery. The script now refuses, but do not put it in that position.

Then read the NEW list and decide per attachment, which is the third prose gate
in practice:

```bash
python3 index_msg.py <slug> <MID> --fold=<sha12>,<sha12>   # allowlist, never a class
python3 extract.py <slug>                                   # again, for the folded rows
```

Folding is an allowlist because a folded image becomes a vision call and a
folded email banner becomes a junk source in composition. Bare `--fold`
refuses.

**Byte-distinct is not substantively new.** A rescan of a filed record hashes
differently and reports NEW. Across four swept matters, nearly every "new"
attachment turned out to be a rescan, a prior vendor's exhibit bundle, or
litigation paperwork. Open them before believing the count. Rendering a scanned
page with `pdftoppm -png` and reading it yourself costs nothing; the paid vision
stage is for transcribing a corpus, not for adjudicating ten pages.

**One hole nothing closes:** `.rpmsg` attachments are Microsoft RMS-encrypted
and need the recipient's Azure credentials. They are reported as their own
named bucket. Say so plainly rather than letting it sit inside "we open
emails now".

Measure the extracted text volume; it is the cost basis for Gate 2:

```bash
wc -c $SMD_MC_DATA/<slug>/text/*.txt | tail -1
```

---

## Step 4 - GATE 2 (spend)

Now you know the real size. Project from these two measured runs:

| Run                           | Pulled            | Extracted text | Actual cost | Wall clock |
| ----------------------------- | ----------------- | -------------- | ----------- | ---------- |
| Small calibration, 2026-08-26 | 53 docs / 56 MB   | 1.13 M chars   | **~$14.60** | 1h23m      |
| Large calibration, 2026-08-27 | 147 docs / 237 MB | 3.21 M chars   | **$81.11**  | 8h31m      |

The large run's ledger is complete and reconciles. **The small run's ledger
captured only $3.68 of its ~$14.60**, because a stage ran without the full env
block exported and the rest of the calls were attributed nowhere. That is why
Step 5 exports every variable for every stage.

About a third of the large run's cost and clock went to hunting eight pipeline
defects, all now fixed. A clean run of that size is inferred at **$50-55 and
4-5 hours**. That is an inference, not a measurement, and must be stated as one.

**Planning basis: $13-25 per million extracted characters, midpoint about $17;
roughly 1.2-1.6 hours per million characters.** Quote a range, name the basis,
and say which anchor this matter sits closer to and why.

Post:

> **Extraction done, free.** N documents yielded **T million characters** of
> text, K of them scanned and queued for vision transcription.
>
> That puts this run at **$A-$B** and **H-J hours** against the two calibration
> points. It sits closer to the <small / large> anchor because <reason>.
>
> Authorize the spend?

**Wait.** Spend is the Captain's call, always.

---

## Step 5 - Paid stages

**Export the full variable block before every stage invocation** - `SMD_MC_DATA`,
`SMD_SLUG`, `SMD_UNIT`, `SMD_INCIDENT_DATE`. The ledger attributes by those
variables. A stage run without them lands its rows nowhere and the cost
disappears from the close-out, which is how the small calibration run lost three
quarters of its attribution.

Take the stage list and the exact commands **from the RUNBOOK**, not from this
file. The ordering constraints are repeated here because they are invariants
rather than commands, and each one was learned from a delivered defect:

- **`build_units` runs after `vision_scan`,** never before. Selecting on
  `text_path` before vision writes it silently dropped every scanned document
  from composition, and a chronology shipped that way before the defect was
  found. `build_units` now refuses (exit 2) while any queued file is
  untranscribed.
- **`filter_preincident` runs before `build_exhibits`.** `build_exhibits` refuses
  otherwise; before that refusal existed, 47 merged entries were silently absent
  from a delivered document.
- **`summarize_preincident` runs after `condense_entries`,** because it consumes
  the condensed file; the reverse order computes the condensation and discards
  it.
- **`strip_nonrecord` runs `--falsify`, then dry-run, then `--apply`.**

Long stages (`map_run`, `repair_truncated`, the audit loop) run for hours. Launch
them with `run_in_background` and watch with `Monitor`; do not block a foreground
call on them. Filter the monitor for progress **and** failure signatures, not
progress alone. A silent monitor and a crashed job look identical.

**Report as you go, without asking for anything.** After each major stage, one
line: what completed, the headline number, spend so far. That is a status line,
not a gate.

Decisions you make yourself and report, never hand over:

- **Provider grouping.** Read `groups/<unit>.json`, add facility rules for
  providers the existing rules do not cover, and say how many lanes you ended
  with and which ones you wrote rules for.
- **Billing document selection** for `billing_docs.json`. CMS-1500 claim forms
  count; they carry charges. Page counts can arrive null from the seat and must
  be filled locally before `billing_extract` will run.
- **Truncated chunks.** `repair_truncated` re-splits them. A part whose output
  falls under 2% of its source bytes is treated as unclean and re-split again.
- **A refused chunk.** Three refusals in a row is almost never a safety refusal.
  Both causes seen so far were text-layer corruption: a glyph index and a
  cipher-shifted layer. Read the text before concluding anything about the model.

---

## Step 6 - Audit and repair

```bash
python3 audit_repair_loop.py     # audit -> repair rounds, cap 3
```

Sonnet audits; a flagged claim gets a one-page-widened second chance
(`SUPPORTED_WIDENED` means a citation defect, and the span is rewritten and
re-audited under its new key); opus repairs by removal or weakening only.
Residual failing claims after the cap are **dropped** and logged.

The loop ends at `audit_coverage.py`: every live claim finally audited and plain
`SUPPORTED`, or no docx. The audit never re-audits a key, so the RESULT line
counts historical keys, live and superseded; **the gate's arithmetic is the
verdict, not that line.**

Never hand-edit the chronology after this gate. Any edit reopens the loop, and
rerunning it is cheap because only changed keys reach the API.

---

## Step 7 - GATE 3 (exceptions)

```bash
python3 coverage_gate.py <slug> <unit>
```

The gate reports which pulled files reached composition, then which are cited in
the document, then which are neither cited nor explained by the drop policy.

**You read every unexplained file yourself.** Not the filenames - the files. Then
categorize them and give a verdict per category:

> **Coverage gate: PASS, 827/827 claims supported.** Of 149 pulled documents,
> 60 are cited in the chronology and 51 are explained by the drop policy. That
> leaves **21 uncited**. I read all 21:
>
> - **14 duplicates** of documents already cited, byte-identical or a rescan
> - **4 vendor paperwork** - records-request letters and a HIPAA authorization
> - **2 blank intake forms**, no fields filled
> - **1 patient checklist** filed under a clinical name, no clinical content
>
> None of them carries a record that belongs in the chronology. My verdict is
> that the document is complete.
>
> Ready to deliver, or is there a category you want put back in?

If a file is a genuine judgment call, name it in prose, say what it contains, and
say what turns on the decision. Never present a list to be inspected.

---

## Step 8 - Deliver

```bash
python3 md_to_docx_v4.py <final-chronology.md> <out.docx>
python3 make_manifest.py <slug> <unit> "<Client Name>" <MM-DD-YY>
```

The manifest must live **on the seat** and carry `sha256` and `bytes` per file.

`fly ssh sftp put` fails on filenames containing spaces or parentheses. Hardlink
each file to a simple staging name first, and issue one unchained `put` per file.

```bash
./run_seat.sh seat_write_deliverable.py plan  <MID> "<folder>" <manifest>
./run_seat.sh seat_write_deliverable.py apply <MID> "<folder>" <manifest>
```

Read the plan before applying. Folder convention:
`MEDICAL CHRONOLOGY <MM-DD-YY> by A&P Operator Agent`.

**Re-resolve the matter by dual probe immediately before the write.** The
resolution from Step 1 is hours old by now, and a write into the wrong legal
matter is unrecoverable.

**Read the folder back after apply and count.** A readback taken seconds after
the last upload can under-report because the vendor's index lags. If the count is
short, re-read before concluding anything. Record the readback with
`crane_verify`.

Superseding an existing delivery uses `seat_supersede_one.py plan|apply` with the
same readback discipline.

---

## Step 9 - Close out

1. **Sum the ledger** for the run and reconcile against the Anthropic console
   receipts for the run window. A gap over 10% is a ledger defect, not a cost
   fact. Receipts total; ledgers attribute.
2. **Report clock and spend**: start stamp, end stamp, elapsed, dollars by stage.
3. **Report the document**: entries, exhibits, pages, ICD codes resolved,
   provider lanes, audit result, planted controls rejected, cited page references
   verified.
4. **Write a memory only if the run changed a fact** - a new defect class, a new
   calibration point, a cost that moves the routine-11 cap arithmetic. A finished
   task is not by itself a reason to write one.
5. **Commit any pipeline fix made mid-run** to the engagements repo before the
   session ends. A fix that lives only in a working tree is a fix the next run
   will not have.

---

## Failure modes this pipeline has actually produced

Recognize these. They are why the ordering constraints above exist.

| Symptom                                              | Cause                                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| "VISION DONE" but nothing transcribed                | A stale junk text file satisfied the resume check                                |
| A map chunk refuses three times                      | Glyph-index or cipher-shifted text layer, not a safety refusal                   |
| A repaired chunk far smaller than its source         | Truncation repair emitted a fragment; the yield floor catches it                 |
| Merged entries missing from the document             | `build_exhibits` ran before `filter_preincident`                                 |
| Zero ICD codes resolved                              | Codes arrive comma- and slash-joined with parentheticals                         |
| A whole class of missing files invisible to the gate | The gate counted composition input, not the pulled set                           |
| Strip refuses: "every cited page was dropped"        | The guard working correctly - a real record misclassified by an internal heading |
| A ledger that under-reports the run                  | A stage ran without the full env block exported                                  |
| `billing_extract` fails on a null page count         | The seat manifest can carry `pages: null`; fill locally first                    |

## Related

- `feedback_captain_cannot_see_artifacts_gates_must_be_prose.md` - the constraint this skill is built around
- `feedback_receipts_total_ledgers_attribute.md` - why Step 9 reconciles
- `feedback_a_shared_output_dir_is_a_matter_mixing_hazard.md` - why `SMD_SLUG` is exported everywhere
- `feedback_seat_is_1vcpu_1gb_probes_must_be_serialized.md` - why seat calls are serial
- `feedback_a_citation_is_not_coverage.md` - why Gate 3 counts the pulled set
- Law 12 (`docs/doctrine/agent-operating-doctrine.md`) - every detector in this pipeline is calibrated on the run's own numbers and proven able to fail in both directions
