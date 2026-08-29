"""`medchron run <job_dir>`: the orchestrator that used to be a Claude session
reading a runbook.

For each unit, in DAG order: skip stages the state file says are done, run the
decision hook or the pipeline script, enforce the cap before every paid stage,
record the outcome, and stop at the first HOLD, REFUSE, or failure. A kill
mid-stage resumes at that stage on the next run. Every subprocess gets the full
env block, so no spend ever lands in the orphan ledger.

HOLD and REFUSE write nothing to the matter. The run's outcome is one word plus
one reason, printed as JSON and as a sentence, because the person reading it
cannot see any artifact.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import __version__, budget as budget_mod, config as config_mod, dag, decisions, job as job_mod
from .state import RunState, state_path

PIPELINE_ENV = "MEDCHRON_PIPELINE_DIR"


class DriverError(RuntimeError):
    pass


@dataclass
class Outcome:
    unit: str
    outcome: str            # delivered | held | refused | failed | dry_run
    reason: str | None
    stage: str | None
    dollars: float
    pages: int
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()

    def sentence(self) -> str:
        head = f"{self.unit}: {self.outcome}"
        if self.stage:
            head += f" at {self.stage}"
        if self.reason:
            head += f": {self.reason}"
        return f"{head} ({self.dollars:.2f} USD, {self.pages} pages read)"


def _pipeline_dir() -> Path:
    raw = os.environ.get(PIPELINE_ENV)
    if not raw:
        raise DriverError(f"{PIPELINE_ENV} is not set (the frozen pipeline directory)")
    p = Path(raw).expanduser()
    if not p.is_dir():
        raise DriverError(f"{PIPELINE_ENV}={p} is not a directory")
    return p


def _pipeline_sha(pipeline: Path) -> str:
    """The git sha of the pipeline checkout when available, else a content sha
    over its scripts, so the state file names the code the run was made with."""
    try:
        out = subprocess.run(["git", "-C", str(pipeline), "rev-parse", "HEAD"],
                             capture_output=True, text=True, timeout=10, check=False)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    h = hashlib.sha256()
    for f in sorted(pipeline.glob("*.py")):
        h.update(f.name.encode())
        h.update(f.read_bytes())
    return "content:" + h.hexdigest()[:16]


def _env_block(job: job_mod.Job, cfg: config_mod.FirmConfig, unit: job_mod.Unit) -> dict[str, str]:
    env = dict(os.environ)
    env.update({
        "SMD_MC_DATA": str(job.data_root),
        "SMD_SLUG": job.slug,
        "SMD_UNIT": unit.unit,
        "SMD_INCIDENT_DATE": job.incident_date,
        "SMD_BATCH_STAGES": ",".join(cfg.batch_stages),
        "SMD_CACHE": "1" if cfg.get("levers", "cache", True) else "0",
        "SMD_AUDIT_MODE": str(cfg.get("levers", "audit_mode", "image")),
        "SMD_COMPOSE_MAX_TOKENS": str(cfg.get("levers", "compose_max_tokens", 128000)),
    })
    for tier, model in (cfg.get("models", "tiers") or {}).items():
        env[f"SMD_MODEL_{tier.upper()}"] = str(model)
    for key in list(env):
        if key.startswith("SMD_EFFORT_"):
            del env[key]  # effort levers are never set by the driver
    return env


def _resolve_argv(stage: dag.Stage, ctx: dag.Ctx, slug_dir: Path, decided: dict[str, Any]) -> list[str]:
    args = []
    for a in stage.argv(ctx):
        if a == "--fold=@decided":
            shas = decided.get("fold") or []
            a = "--fold=" + ",".join(shas)
        elif a.startswith(("runs/", "out/", "units/")):
            a = str(slug_dir / a)
        args.append(a)
    return args


def _stage_input_sha(slug_dir: Path, stage: dag.Stage) -> str | None:
    """A cheap fingerprint of the artifacts a stage reads, so a state file can
    say whether a done stage is still current. PR 1 fingerprints the authored
    inputs; per-stage input lists arrive with each in-process port."""
    names = ["include.json", "units.json", "billing_docs.json", "msg_fold.json", "orphans.json"]
    h = hashlib.sha256()
    for n in names:
        p = slug_dir / n
        if p.is_file():
            h.update(n.encode())
            h.update(p.read_bytes())
    return h.hexdigest()[:16]


class Driver:
    def __init__(self, job_dir: Path, *, firm_config: str | None = None, pricing: str | None = None,
                 dry_run: bool = False, start: str | None = None, log=print) -> None:
        self.job = job_mod.load(job_dir)
        self.cfg = config_mod.load(firm_config)
        self.dry_run = dry_run
        self.start = start
        self.log = log
        self.pipeline = None if dry_run else _pipeline_dir()
        pricing_path = Path(pricing or os.environ.get(budget_mod.PRICING_ENV) or budget_mod.PRICING_DEFAULT)
        self.pricing = budget_mod.Pricing.load(pricing_path)
        cap = self.job.cap_usd if self.job.cap_usd is not None else self.cfg.per_job_cap_usd
        self.slug_dir = self.job.data_root / self.job.slug
        ledgers = [self.slug_dir / "runs" / u.unit / "usage-ledger.jsonl" for u in self.job.units]
        ledgers.append(self.job.data_root / "usage-ledger-orphan.jsonl")
        self.budget = budget_mod.Budget(self.pricing, cap, ledgers, float(self.cfg.get("budget", "usd_per_million_chars")))
        self.date_stamp = time.strftime("%m-%d-%y")
        self.decided: dict[str, Any] = {}
        problems = dag.validate_dag()
        if problems:
            raise DriverError("DAG invalid: " + "; ".join(problems))

    # ---- one unit ---------------------------------------------------------
    def run_unit(self, unit: job_mod.Unit, slug_done: set[str]) -> Outcome:
        st = RunState.load_or_new(state_path(self.job.data_root, self.job.slug, unit.unit),
                                  slug=self.job.slug, unit=unit.unit)
        st.runner_version = __version__
        st.pipeline_sha = _pipeline_sha(self.pipeline) if self.pipeline else "dry-run"
        ctx = dag.Ctx(job=self.job, unit=unit, date_stamp=self.date_stamp)
        notes: list[str] = []
        extracted = self.slug_dir / "extracted.jsonl"
        for stage in dag.stages_from(self.start):
            if stage.scope == "slug" and stage.name in slug_done:
                continue
            if st.is_done(stage.name) and self.start is None:
                continue
            if stage.decision:
                out = self._decide(stage, unit, st, notes)
            else:
                out = self._execute(stage, ctx, st, extracted, notes)
            if stage.scope == "slug" and out is None:
                slug_done.add(stage.name)
            if out is not None:
                return out
        pages = budget_mod.pages_read(extracted)
        if self.dry_run:
            st_outcome = "dry_run"
        else:
            st.end("delivered", "every stage done; package staged under out/")
            st_outcome = "delivered"
        return Outcome(unit.unit, st_outcome, None, None, self.budget.refresh(), pages, notes)

    def _decide(self, stage: dag.Stage, unit: job_mod.Unit, st: RunState, notes: list[str]) -> Outcome | None:
        hook_name = stage.decision or ""
        if hook_name in decisions.HOOKS:
            d = decisions.HOOKS[hook_name](self.job, self.cfg, self.slug_dir, dry_run=self.dry_run)
        else:
            d = decisions.UNIT_HOOKS[hook_name](self.job, self.cfg, self.slug_dir, unit, dry_run=self.dry_run)
        notes.extend(f"{d.hook}: {n}" for n in d.notes)
        if d.hook == "fold":
            self.decided["fold"] = (d.payload or {}).get("fold", [])
        if d.held:
            reason = "; ".join(d.holds)
            if self.dry_run:
                # A dry run keeps going so every hook's hold is measured, which
                # is how a rule's hold rate is read off delivered matters.
                notes.append(f"WOULD HOLD at {stage.name}: {reason}")
                return None
            st.finish(stage.name, status="held", exit_code=None, dollars=self.budget.refresh(),
                      pages=None, note=reason)
            st.end("held", reason)
            return Outcome(unit.unit, "held", reason, stage.name, self.budget.refresh(),
                           budget_mod.pages_read(self.slug_dir / "extracted.jsonl"), notes)
        if not self.dry_run:
            st.finish(stage.name, status="done", exit_code=0, dollars=self.budget.refresh(), pages=None)
        self.log(f"[decide] {stage.name}: ok" + (f" ({'; '.join(d.notes)})" if d.notes else ""))
        return None

    def _execute(self, stage: dag.Stage, ctx: dag.Ctx, st: RunState, extracted: Path,
                 notes: list[str]) -> Outcome | None:
        unit = ctx.unit
        if self.dry_run:
            self.log(f"[dry-run] would run {stage.name}: {stage.script} {' '.join(stage.argv(ctx))}")
            return None
        if stage.once_per_machine and (self.job.data_root / "controls" / "icd" / "VERSION.json").is_file():
            st.finish(stage.name, status="skipped", exit_code=0, dollars=None, pages=None, note="present")
            return None
        if stage.paid:
            try:
                self.budget.check(stage=stage.name, extracted_chars=budget_mod.extracted_chars(extracted)
                                  if stage.name == "vision" else None)
            except budget_mod.BudgetError as exc:
                st.finish(stage.name, status="refused", exit_code=None, dollars=self.budget.spent(),
                          pages=budget_mod.pages_read(extracted), note=str(exc))
                st.end("refused", str(exc))
                return Outcome(unit.unit, "refused", str(exc), stage.name, self.budget.spent(),
                               budget_mod.pages_read(extracted), notes)
        script = self.pipeline / stage.script
        if not script.is_file():
            st.finish(stage.name, status="failed", exit_code=None, dollars=None, pages=None,
                      note=f"script missing: {script}")
            st.end("failed", f"pipeline script missing: {stage.script}")
            return Outcome(unit.unit, "failed", f"pipeline script missing: {stage.script}", stage.name,
                           self.budget.spent(), budget_mod.pages_read(extracted), notes)
        argv = _resolve_argv(stage, ctx, self.slug_dir, self.decided)
        cmd = (["bash", str(script)] if script.suffix == ".sh"
               else [str(self.cfg.get("pipeline", "python") or sys.executable), str(script), *argv])
        st.start(stage.name, input_sha=_stage_input_sha(self.slug_dir, stage))
        self.log(f"[run] {stage.name}: {' '.join(cmd[1:])}")
        proc = subprocess.run(cmd, cwd=self.slug_dir, env=_env_block(self.job, self.cfg, unit),
                              capture_output=True, text=True, check=False)
        tail = (proc.stdout + proc.stderr)[-2000:]
        (self.slug_dir / "runs" / unit.unit).mkdir(parents=True, exist_ok=True)
        (self.slug_dir / "runs" / unit.unit / f"log-{stage.name}.txt").write_text(proc.stdout + proc.stderr, encoding="utf-8")
        dollars = self.budget.refresh()
        pages = budget_mod.pages_read(extracted)
        if proc.returncode == 0:
            st.finish(stage.name, status="done", exit_code=0, dollars=dollars, pages=pages)
            if stage.invalidates:
                st.invalidate(list(stage.invalidates))
            return None
        outcome, reason = stage.exit_map.get(proc.returncode, ("failed", f"exit {proc.returncode}"))
        reason = f"{reason}; last output: {tail.strip()[-400:]}"
        st.finish(stage.name, status=outcome, exit_code=proc.returncode, dollars=dollars, pages=pages, note=reason)
        st.end(outcome, reason)
        return Outcome(unit.unit, outcome, reason, stage.name, dollars, pages, notes)

    # ---- the job ----------------------------------------------------------
    def run(self) -> list[Outcome]:
        outcomes: list[Outcome] = []
        slug_done: set[str] = set()
        for unit in self.job.units:
            outcomes.append(self.run_unit(unit, slug_done))
        return outcomes


def report(outcomes: list[Outcome]) -> str:
    lines = [o.sentence() for o in outcomes]
    for o in outcomes:
        lines.extend(f"  note: {n}" for n in o.notes)
    return "\n".join(lines)


def to_json(outcomes: list[Outcome]) -> str:
    return json.dumps([o.to_dict() for o in outcomes], indent=1)
