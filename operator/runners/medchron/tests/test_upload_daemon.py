"""The upload stage (idempotent through the recorded folder id) and the
on-Machine daemon (queue, one at a time, quarantine, pause-once, resume,
wipe, heartbeat)."""
from __future__ import annotations

import json
import os
import stat
import sqlite3
from pathlib import Path

import pytest

from medchron import config as config_mod, job as job_mod
from medchron.daemon import BrokerError, Daemon, memory_cap_mode, sticky_level
from medchron.stages import upload
from medchron.stages.base import StageRun
from medchron_testkit import FakeSeat


# ---- upload ------------------------------------------------------------------

def _upload_sr(job_dir: Path, firm: Path, data_root: Path, seat: FakeSeat, log: list[str]) -> StageRun:
    job = job_mod.load(job_dir)
    cfg = config_mod.load(str(firm))
    sd = data_root / "example-matter"
    out = sd / "out" / "alpha"
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for name, body in (("Alpha Example - Medical Chronology 08-29-26.docx", b"docx-bytes"),
                       ("Exhibit 1 - Example Clinic - 01-20-2026 (Medical Records).pdf", b"%PDF-1")):
        (out / name).write_bytes(body)
        import hashlib

        rows.append({"name": name, "folder": "MEDICAL CHRONOLOGY - Alpha Example 08-29-26", "local_path": str(out / name),
                     "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)})
    (out / "upload_manifest.json").write_text(json.dumps(rows))
    (sd / "runs" / "alpha").mkdir(parents=True, exist_ok=True)
    return StageRun(job=job, cfg=cfg, unit=job.units[0], slug_dir=sd, decided={}, log=log.append,
                    seat_factory=lambda: seat, date_stamp="08-29-26")


def test_upload_creates_the_folder_records_it_first_and_reads_back(job_dir, firm_config_path, data_root):
    seat = FakeSeat([], [], {})
    seat.lag = 2                                            # the vendor's index lag: two lists before it shows
    log: list[str] = []
    sr = _upload_sr(job_dir, firm_config_path, data_root, seat, log)
    assert upload.run(sr, pause=0, tries=5) == 0
    assert [c["name"] for c in seat.created] == ["MEDICAL CHRONOLOGY - Alpha Example 08-29-26"]
    assert [s["name"][:9] for s in seat.sent] == ["Alpha Exa", "Exhibit 1"]
    d = json.loads((sr.slug_dir / "runs" / "alpha" / "delivery.json").read_text())
    assert d["folder_id"] == "folder-1" and all(f["confirmed"] for f in d["files"]) and len(d["files"]) == 2
    assert any("read-back complete" in line for line in log)


def test_upload_refuses_a_folder_it_did_not_create(job_dir, firm_config_path, data_root):
    seat = FakeSeat([], [{"id": "theirs", "name": "MEDICAL CHRONOLOGY - Alpha Example 08-29-26", "parentId": None,
                          "path": "x"}], {})
    log: list[str] = []
    sr = _upload_sr(job_dir, firm_config_path, data_root, seat, log)
    assert upload.run(sr, pause=0, tries=2) == 1
    assert not seat.created and not seat.sent and any("did not create it" in line for line in log)


def test_upload_resumes_after_a_crash_between_create_and_add(job_dir, firm_config_path, data_root):
    seat = FakeSeat([], [], {})
    seat.crash_after = 1                                    # the second add_file dies
    log: list[str] = []
    sr = _upload_sr(job_dir, firm_config_path, data_root, seat, log)
    with pytest.raises(RuntimeError):
        upload.run(sr, pause=0, tries=2)
    d = json.loads((sr.slug_dir / "runs" / "alpha" / "delivery.json").read_text())
    assert d["folder_id"] == "folder-1"                     # recorded before the first add_file
    seat.crash_after = None
    assert upload.run(sr, pause=0, tries=3) == 0
    assert len(seat.created) == 1 and [s["name"][:9] for s in seat.sent] == ["Alpha Exa", "Exhibit 1"]
    assert any("already present" in line and "1 file(s) sent" in line for line in log)


def test_upload_holds_when_the_read_back_stays_short(job_dir, firm_config_path, data_root):
    seat = FakeSeat([], [], {})
    seat.lag = 50
    log: list[str] = []
    sr = _upload_sr(job_dir, firm_config_path, data_root, seat, log)
    assert upload.run(sr, pause=0, tries=3) == 2
    d = json.loads((sr.slug_dir / "runs" / "alpha" / "delivery.json").read_text())
    assert not any(f["confirmed"] for f in d["files"])


def test_upload_refuses_when_local_bytes_changed_since_the_manifest(job_dir, firm_config_path, data_root):
    seat = FakeSeat([], [], {})
    log: list[str] = []
    sr = _upload_sr(job_dir, firm_config_path, data_root, seat, log)
    (sr.slug_dir / "out" / "alpha" / "Alpha Example - Medical Chronology 08-29-26.docx").write_bytes(b"tampered")
    assert upload.run(sr, pause=0, tries=1) == 1 and not seat.sent


# ---- daemon -------------------------------------------------------------------

class FakeBroker:
    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}
        self.records: list[tuple[str, str, dict]] = []
        self.down = False

    def status(self, job_id):
        if self.down:
            raise BrokerError("down")
        return self.rows.get(job_id)

    def record(self, job_id, state, fields):
        if self.down:
            raise BrokerError("down")
        self.records.append((job_id, state, fields))
        self.rows.setdefault(job_id, {})["state"] = state
        return {"ok": True}


def _fake_runner(tmp_path: Path, script: str) -> list[str]:
    p = tmp_path / "fake-medchron.py"
    p.write_text(script)
    return [os.environ.get("PYTHON", "python3"), str(p)]


OK_RUNNER = """
import json, sys, pathlib
jd = pathlib.Path(sys.argv[1])
assert jd.joinpath('job.yaml').is_file()
marker = jd / 'ran'
n = int(marker.read_text()) + 1 if marker.exists() else 1
marker.write_text(str(n))
if n == 1 and (jd / 'crash-once').exists():
    sys.exit(137)
print(json.dumps([{"unit": "alpha", "outcome": "delivered", "reason": None, "stage": None, "dollars": 12.34,
                   "pages": 300, "documents": 40, "folder_id": "folder-9",
                   "files": [{"name": "A.docx", "sha256": "ab", "bytes": 10, "confirmed": True}]}]))
"""


def _envelope(job_id: str) -> dict:
    return {"job_id": job_id, "matter": {"id": "m-1", "number": "2026-PI-102", "title": ""},
            "units": [{"unit": "alpha", "client_name": "Alpha Example", "name_token": "Example", "surname": "Example",
                       "dob": "01/02/1980"}],
            "incident": {"date": "2026-01-15", "source": "administrator_request"},
            "allowance_remaining_documents": 100, "cap_usd": 25}


def _daemon(tmp_path: Path, script: str = OK_RUNNER, **kw) -> tuple[Daemon, FakeBroker]:
    run_dir = tmp_path / "run"
    (run_dir / "queue").mkdir(parents=True, exist_ok=True)
    broker = FakeBroker()
    now = {"t": 1_000_000.0}
    d = Daemon(run_dir=run_dir, broker=broker, runner_cmd=_fake_runner(tmp_path, script), customer_slug="example",
               sticky_db=str(tmp_path / "sticky.db"), cgroup_root=tmp_path / "cgroup", child_uid=None,
               clock=lambda: now["t"], **kw)
    d._now = now  # type: ignore[attr-defined]
    return d, broker


def _submit(d: Daemon, broker: FakeBroker, job_id: str) -> None:
    broker.rows[job_id] = {"state": "submitted"}
    (d.queue / f"{job_id}.json").write_text(json.dumps(_envelope(job_id)))


def test_daemon_runs_the_oldest_job_reports_transitions_and_ticks(tmp_path):
    d, broker = _daemon(tmp_path)
    _submit(d, broker, "01B")
    _submit(d, broker, "01A")
    assert d.tick() == "delivered"
    assert [(j, s) for j, s, _ in broker.records] == [("01A", "running"), ("01A", "delivered")]
    fields = broker.records[-1][2]
    assert (fields["documents"], fields["pages"], fields["cents"], fields["folder_id"]) == (40, 300, 1234, "folder-9")
    assert fields["delivery"]["files"][0]["name"] == "A.docx"
    job_yaml = (d.jobs / "01A" / "job.yaml").read_text()
    assert "slug: example" in job_yaml and "allowance_remaining_documents: 100" in job_yaml and "data_root:" in job_yaml
    hb = json.loads((d.run_dir / "heartbeat.json").read_text())
    assert hb["memory_cap"] == "none" and hb["queued"] == 1 and (d.run_dir / "tick").exists()
    assert not (d.run_dir / "child.pid").exists()
    assert d.tick() == "delivered" and broker.records[-1][0] == "01B"
    assert d.tick() is None


def test_daemon_quarantines_an_envelope_without_a_ledger_row(tmp_path):
    d, broker = _daemon(tmp_path)
    (d.queue / "01Z.json").write_text(json.dumps(_envelope("01Z")))
    assert d.tick() is None
    assert (d.queue / "quarantine" / "01Z.json").exists() and not broker.records


def test_daemon_holds_once_at_hard_stop_and_releases(tmp_path):
    d, broker = _daemon(tmp_path)
    conn = sqlite3.connect(d.sticky_db)
    conn.execute("CREATE TABLE sticky_stop_state (customer TEXT, persona TEXT, level TEXT, updated_at TEXT)")
    conn.execute("INSERT INTO sticky_stop_state VALUES ('example', '_machine', 'HARD_STOP', 'now')")
    conn.commit()
    _submit(d, broker, "01A")
    assert d.tick() == "paused" and d.tick() == "paused"
    assert [(j, s) for j, s, _ in broker.records] == [("01A", "held")]     # once
    conn.execute("UPDATE sticky_stop_state SET level='OK'")
    conn.commit()
    conn.close()
    assert d.tick() == "delivered"
    assert [s for _, s, _ in broker.records] == ["held", "running", "delivered"]


def test_sticky_level_reads_the_worst_row_and_fails_toward_unknown(tmp_path):
    assert sticky_level(str(tmp_path / "none.db")) is None
    p = tmp_path / "s.db"
    conn = sqlite3.connect(p)
    conn.execute("CREATE TABLE sticky_stop_state (customer TEXT, persona TEXT, level TEXT)")
    conn.executemany("INSERT INTO sticky_stop_state VALUES (?,?,?)", [("x", "a", "OK"), ("x", "b", "SOFT_STOP")])
    conn.commit()
    conn.close()
    assert sticky_level(str(p)) == "SOFT_STOP"
    p.write_bytes(b"not a database")
    assert sticky_level(str(p)) == "unknown"


def test_daemon_resumes_a_job_after_a_crash(tmp_path):
    d, broker = _daemon(tmp_path)
    _submit(d, broker, "01A")
    jd = d.jobs / "01A"
    jd.mkdir(parents=True)
    (jd / "crash-once").write_text("")
    assert d.tick() == "failed"                              # exit 137, no verdict
    assert broker.records[-1][1] == "failed" and "exited 137" in broker.records[-1][2]["reason"]
    # A kill mid-run leaves no terminal record at all: the daemon restarts and finds the claimed job.
    d2, broker2 = _daemon(tmp_path)
    broker2.rows["01A"] = {"state": "running"}
    d2._write_state("01A", claimed=True, state="running", attempts=1)
    assert d2.tick() == "delivered"
    assert d2._daemon_state("01A")["attempts"] == 2


def test_daemon_wipes_terminal_jobs_after_the_hold_and_never_live_ones(tmp_path):
    d, broker = _daemon(tmp_path, wipe_hours=72)
    _submit(d, broker, "01A")
    d.tick()
    assert (d.jobs / "01A").exists()
    d._now["t"] += 71 * 3600
    assert d.wipe_expired() == [] and (d.jobs / "01A").exists()
    d._now["t"] += 2 * 3600
    assert d.wipe_expired() == ["01A"] and not (d.jobs / "01A").exists()
    _submit(d, broker, "01B")
    d.claim_next()
    d._now["t"] += 1000 * 3600
    assert d.wipe_expired() == [] and (d.jobs / "01B").exists()


def test_daemon_defers_when_the_broker_is_down_and_child_env_is_allow_listed(tmp_path, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "never")
    script = """
import json, os, sys
assert os.environ.get("ANTHROPIC_API_KEY") == "sk-test"
assert "R2_SECRET_ACCESS_KEY" not in os.environ
print(json.dumps([{"unit": "alpha", "outcome": "refused", "reason": "cap", "dollars": 0.0, "pages": 5,
                   "documents": 3}]))
"""
    d, broker = _daemon(tmp_path, script)
    _submit(d, broker, "01A")
    broker.down = True
    assert d.tick() is None and not broker.records                       # cannot even claim
    broker.down = False
    assert d.tick() == "held"
    assert broker.records[-1][1] == "held" and broker.records[-1][2]["reason"] == "refused: cap"


def test_memory_cap_mode_detects_v2_v1_and_none(tmp_path):
    assert memory_cap_mode(tmp_path) == "none"
    # The Fly hybrid layout: no root cgroup.controllers, memory on the v1 mount.
    (tmp_path / "memory").mkdir()
    (tmp_path / "memory" / "cgroup.procs").write_text("")
    assert memory_cap_mode(tmp_path) == "cgroup1"
    (tmp_path / "cgroup.controllers").write_text("cpuset cpu io memory pids\n")
    assert memory_cap_mode(tmp_path) == "cgroup2"


def test_cgroup1_preexec_writes_the_v1_limit(tmp_path):
    d, broker = _daemon(tmp_path)
    (d.cgroup_root / "memory").mkdir(parents=True)
    (d.cgroup_root / "memory" / "cgroup.procs").write_text("")
    assert d._cgroup_preexec() is not None
    assert (d.cgroup_root / "memory" / "medchron" / "memory.limit_in_bytes").read_text() == str(d.memory_max)
    _submit(d, broker, "01A")
    d.tick()
    assert json.loads((d.run_dir / "heartbeat.json").read_text())["memory_cap"] == "cgroup1"


def test_daemon_heartbeat_is_world_readable(tmp_path):
    d, _ = _daemon(tmp_path)
    d.heartbeat(running=None)
    assert stat.S_IMODE((d.run_dir / "heartbeat.json").stat().st_mode) == 0o644
