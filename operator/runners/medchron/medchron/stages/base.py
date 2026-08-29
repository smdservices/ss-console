"""What an in-process stage receives, and the two ways it can end early.

A stage is `def run(sr: StageRun) -> int`. Its exit code goes through the
same `exit_map` a subprocess stage's would, so porting a stage in-process
changes nothing about how the driver reads it. Writes are the same artifacts
the frozen scripts wrote, in the same shapes, because every later stage
(ported or not) reads them.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from .. import config as config_mod, job as job_mod
from ..seat import Seat


class StageRefusal(RuntimeError):
    """The stage refuses to continue for a reason a person must act on. The
    driver maps it to the `refused` outcome with this message."""


@dataclass
class StageRun:
    job: job_mod.Job
    cfg: config_mod.FirmConfig
    unit: job_mod.Unit
    slug_dir: Path
    decided: dict[str, Any]
    log: Callable[[str], None]
    seat_factory: Callable[[], Seat]
    _seat: Seat | None = field(default=None, repr=False)

    @property
    def seat(self) -> Seat:
        if self._seat is None:
            self._seat = self.seat_factory()
        return self._seat

    @property
    def slug(self) -> str:
        return self.job.slug

    # ---- the matter's manifest and folder tree, as the stages read them -----
    def manifest(self) -> list[dict[str, Any]]:
        man = read_json(self.slug_dir / "manifest.json", {})
        return man["documents"] if isinstance(man, dict) else man

    def folder_paths(self) -> dict[str, str]:
        return {f["id"]: f["path"] for f in read_json(self.slug_dir / "folders.json", [])}


def read_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row) + "\n")
        fh.flush()
