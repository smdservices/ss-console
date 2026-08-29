"""The fixed stage order and each stage's contract.

Every ordering rule here was learned from a delivered defect (the RUNBOOK's
invariants): billing_extract before build_units; build_units after vision;
repair_truncated always before assemble, never gated on map output; filter
before exhibits; condense before summarize; strip as falsify, dry run, apply;
the audit last, and reopened by any later edit to the document. The driver
executes this list; it does not decide order at run time.

A stage is a subprocess of the frozen pipeline in PR 1. Its `argv` builder
reproduces the script's positional contract exactly, so a later PR can flip
`runner` to an in-process function without touching the order. `exit_map`
turns a script's exit codes into the outcome vocabulary; anything unmapped and
non-zero is `failed`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from .job import Job, Unit

# Outcome vocabulary shared with state.py. HOLD and REFUSE never write to the
# matter; they end the run with a reason a person can act on.
DONE, REFUSED, HELD, FAILED = "done", "refused", "held", "failed"

ArgvFn = Callable[["Ctx"], list[str]]


@dataclass(frozen=True)
class Ctx:
    job: Job
    unit: Unit
    date_stamp: str  # MM-DD-YY for the deliverable names

    @property
    def slug(self) -> str:
        return self.job.slug


@dataclass(frozen=True)
class Stage:
    name: str
    script: str                     # file in the pipeline dir; "" for decision stages
    argv: ArgvFn
    paid: bool = False              # True -> the budget check runs first
    scope: str = "unit"             # "slug" runs once per job, "unit" once per client
    requires: tuple[str, ...] = ()
    invalidates: tuple[str, ...] = ()   # stages reopened when this one re-runs
    exit_map: dict[int, tuple[str, str]] = field(default_factory=dict)
    decision: str | None = None     # decisions.py hook name for authoring stages
    once_per_machine: bool = False  # e.g. ICD table fetch


def _slug(ctx: Ctx) -> list[str]:
    return [ctx.slug]


def _slug_unit(ctx: Ctx) -> list[str]:
    return [ctx.slug, ctx.unit.unit]


def _slug_unit_date(ctx: Ctx) -> list[str]:
    return [ctx.slug, ctx.unit.unit, ctx.job.incident_date]


STAGES: tuple[Stage, ...] = (
    # ---- $0: selection, pull, extract ------------------------------------
    Stage("decide_selection", "", _slug, scope="slug", decision="selection"),
    Stage("download", "download.py", lambda c: [c.slug, c.job.matter_id], scope="slug",
          requires=("decide_selection",),
          exit_map={1: (FAILED, "download reported a pull failure")}),
    Stage("extract", "extract.py", _slug, scope="slug", requires=("download",)),
    Stage("index_msg", "index_msg.py", lambda c: [c.slug, c.job.matter_id], scope="slug",
          requires=("extract",)),
    Stage("decide_fold", "", _slug, scope="slug", requires=("index_msg",), decision="fold"),
    Stage("fold_msg", "index_msg.py", lambda c: [c.slug, c.job.matter_id, "--fold=@decided"],
          scope="slug", requires=("decide_fold",)),
    Stage("extract_after_fold", "extract.py", _slug, scope="slug", requires=("fold_msg",)),
    # ---- paid: transcription, units, billing -----------------------------
    Stage("vision", "vision_scan.py", _slug, paid=True, scope="slug", requires=("extract_after_fold",)),
    Stage("decide_billing_docs", "", _slug, scope="slug", requires=("vision",), decision="billing_docs"),
    Stage("billing_extract", "billing_extract.py", _slug, paid=True, scope="slug",
          requires=("decide_billing_docs",),
          exit_map={1: (FAILED, "billing pages could not be transcribed")}),
    Stage("decide_units", "", _slug, scope="slug", requires=("billing_extract",), decision="units"),
    Stage("build_units", "build_units.py", _slug, scope="slug", requires=("decide_units",),
          exit_map={2: (REFUSED, "build_units refused: a scanned file is untranscribed or billing_extract is missing")}),
    Stage("identity", "check_unit_identity.py", _slug, scope="slug", requires=("build_units",),
          exit_map={1: (FAILED, "units.json missing")}),
    # ---- paid: composition ------------------------------------------------
    Stage("map", "map_run.py", lambda c: [c.slug, c.unit.unit, f"units/{c.unit.unit}.json"],
          paid=True, requires=("identity",),
          exit_map={1: (FAILED, "map incomplete or empty after split")}),
    Stage("repair_truncated", "repair_truncated.py", _slug_unit, paid=True, requires=("map",)),
    Stage("assemble", "assemble.py", _slug_unit, requires=("repair_truncated",),
          exit_map={1: (REFUSED, "assemble refused: truncated or model-refused chunks")}),
    Stage("merge", "merge_code.py", _slug_unit, paid=True, requires=("assemble",),
          exit_map={3: (REFUSED, "merge falsifier: a citation was lost"),
                    4: (REFUSED, "merge falsifier: a paragraph was lost"),
                    5: (REFUSED, "merge falsifier: an entry was lost"),
                    6: (REFUSED, "merge: routed clusters left unmerged")}),
    Stage("group", "group_providers.py", _slug_unit, requires=("merge",)),
    Stage("filter", "filter_preincident.py", lambda c: [*_slug_unit_date(c), c.job.injuries],
          paid=True, requires=("group",),
          exit_map={1: (REFUSED, "filter refused: merged clusters missing")}),
    Stage("exhibits", "build_exhibits.py", _slug_unit, requires=("filter",),
          exit_map={1: (REFUSED, "exhibits: a citation could not be remapped")}),
    Stage("condense", "condense_entries.py", _slug_unit, paid=True, requires=("exhibits",)),
    Stage("summarize", "summarize_preincident.py", _slug_unit_date, paid=True, requires=("condense",),
          exit_map={1: (REFUSED, "summary reached beyond the source record")}),
    # ---- document, classification, strip, gates ---------------------------
    Stage("icd_tables", "fetch_icd.sh", lambda c: [], scope="slug", once_per_machine=True,
          requires=("summarize",)),
    Stage("build_doc", "build_doc.py",
          lambda c: [c.slug, c.unit.unit, c.unit.client_name, c.job.incident_date],
          requires=("icd_tables",), invalidates=("audit", "coverage_gate", "strip_apply")),
    Stage("classify_nonrecord", "classify_nonrecord.py", _slug_unit, requires=("build_doc",)),
    Stage("decide_control", "", _slug_unit, requires=("classify_nonrecord",), decision="control"),
    Stage("classify_scanned", "classify_scanned.py", lambda c: [*_slug_unit(c), "--apply"],
          paid=True, requires=("decide_control",)),
    Stage("strip_falsify", "strip_nonrecord.py", lambda c: [*_slug_unit(c), "--falsify"],
          requires=("classify_scanned",),
          exit_map={1: (REFUSED, "strip falsifier failed: a citation would lose its page")}),
    Stage("strip_dry", "strip_nonrecord.py", _slug_unit, requires=("strip_falsify",),
          exit_map={1: (REFUSED, "strip dry run refused")}),
    Stage("strip_apply", "strip_nonrecord.py", lambda c: [*_slug_unit(c), "--apply"],
          requires=("strip_dry",),
          exit_map={1: (REFUSED, "strip apply refused (a prior strip exists, or citations moved)")}),
    Stage("decide_orphans", "", _slug_unit, requires=("strip_apply",), decision="orphans"),
    Stage("coverage_gate", "coverage_gate.py", _slug_unit, requires=("decide_orphans",),
          exit_map={1: (HELD, "coverage gate: files pulled and never explained")}),
    Stage("billing_chart", "billing_chart.py",
          lambda c: [c.slug, c.unit.unit, "--patient", c.unit.client_name],
          requires=("coverage_gate",)),
    Stage("billing_docx", "billing_docx.py",
          lambda c: [c.slug, c.unit.client_name,
                     f"out/{c.unit.unit}/{c.unit.client_name} - Medical Billing Worksheet {c.date_stamp}.docx",
                     c.unit.unit],
          requires=("billing_chart",),
          exit_map={1: (REFUSED, "billing worksheet refused (a suspect amount or missing unit)")}),
    # ---- audit last; render only after it passes ---------------------------
    Stage("audit", "audit_repair_loop.py", lambda c: ["3"], paid=True, requires=("billing_docx",),
          exit_map={1: (HELD, "audit coverage: a live claim is not finally SUPPORTED")}),
    Stage("render", "md_to_docx_v4.py",
          lambda c: [f"runs/{c.unit.unit}/final-chronology.md",
                     f"out/{c.unit.unit}/{c.unit.client_name} - Medical Chronology {c.date_stamp}.docx"],
          requires=("audit",)),
    Stage("manifest", "make_manifest.py",
          lambda c: [c.slug, c.unit.unit, c.unit.client_name, c.date_stamp],
          requires=("render",)),
)

BY_NAME = {s.name: s for s in STAGES}
ORDER = [s.name for s in STAGES]


def validate_dag() -> list[str]:
    """Every `requires` and `invalidates` names a real stage that comes,
    respectively, before and after it."""
    problems: list[str] = []
    pos = {n: i for i, n in enumerate(ORDER)}
    for s in STAGES:
        for r in s.requires:
            if r not in pos:
                problems.append(f"{s.name}: requires unknown stage {r!r}")
            elif pos[r] >= pos[s.name]:
                problems.append(f"{s.name}: requires {r!r} which comes later")
        for inv in s.invalidates:
            if inv not in pos:
                problems.append(f"{s.name}: invalidates unknown stage {inv!r}")
            elif pos[inv] <= pos[s.name]:
                problems.append(f"{s.name}: invalidates {inv!r} which comes earlier")
    if len(set(ORDER)) != len(ORDER):
        problems.append("duplicate stage names")
    return problems


def stages_from(start: str | None) -> list[Stage]:
    if start is None:
        return list(STAGES)
    if start not in BY_NAME:
        raise KeyError(f"unknown stage {start!r}; known: {ORDER}")
    return list(STAGES[ORDER.index(start):])
