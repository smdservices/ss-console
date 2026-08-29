from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from medchron import budget as budget_mod, config as config_mod, decisions, driver as driver_mod, job as job_mod
from medchron.state import RunState, state_path
from medchron_testkit import FakeSeat, calls, doc_row, job_yaml, make_pdf, seed_folders, seed_raw_manifest, write_ledger

PROSE = ("Patient seen in clinic today for follow up of neck pain after the collision. "
         "The patient reports that the pain is improving with therapy and has no new complaints. ") * 6


def _cfg(firm_config_path: Path) -> config_mod.FirmConfig:
    return config_mod.load(str(firm_config_path))


# ---- decisions ---------------------------------------------------------------
def test_selection_is_subtraction_with_disclosure(job_dir: Path, data_root: Path, firm_config_path: Path) -> None:
    seed_folders(data_root, ["MEDICAL", "INVOICES", "VENDOR CHRON", "CLIENT CORRESPONDENCE", "PHOTOS", "LIENS"])
    d = decisions.selection(job_mod.load(job_dir), _cfg(firm_config_path), data_root / "example-matter", dry_run=False)
    assert not d.held
    assert d.payload["include_prefixes"] == ["/INVOICES", "/LIENS", "/MEDICAL"]
    assert d.payload["_decided"]["excluded_top_level"] == ["CLIENT CORRESPONDENCE", "PHOTOS", "VENDOR CHRON"]
    assert (data_root / "example-matter" / "include.json").is_file()


def test_selection_joint_matter_uses_unit_folders_and_shared(tmp_path: Path, data_root: Path, firm_config_path: Path) -> None:
    jd = tmp_path / "job"
    jd.mkdir()
    (jd / "job.yaml").write_text(job_yaml(data_root, joint=True))
    seed_folders(data_root, ["Alpha_Example", "Beta_Example", "EMAILS ALL", "PHOTOS", "MISC"])
    d = decisions.selection(job_mod.load(jd), _cfg(firm_config_path), data_root / "example-matter", dry_run=True)
    assert d.payload["include_prefixes"] == ["/Alpha_Example", "/Beta_Example", "/EMAILS ALL"]
    assert any("MISC" in n for n in d.notes)
    assert not (data_root / "example-matter" / "include.json").exists()  # dry run writes nothing


def test_selection_holds_when_a_unit_folder_is_missing(tmp_path: Path, data_root: Path, firm_config_path: Path) -> None:
    jd = tmp_path / "job"
    jd.mkdir()
    (jd / "job.yaml").write_text(job_yaml(data_root, joint=True))
    seed_folders(data_root, ["Alpha_Example", "EMAILS"])
    d = decisions.selection(job_mod.load(jd), _cfg(firm_config_path), data_root / "example-matter", dry_run=False)
    assert d.held and "Beta_Example" in d.holds[0]


def test_fold_keeps_everything_but_skip_types_and_discloses_encrypted(job_dir: Path, data_root: Path, firm_config_path: Path) -> None:
    # The shape stages/msg.py writes: kept attachments only, with the pull's
    # name when the bytes are already in the corpus; encrypted ones by name.
    (data_root / "example-matter" / "msg_attachments.json").write_text(json.dumps({
        "comparable": True,
        "attachments": [
            {"sha256": "a" * 64, "local": "aaaaaaaaaaaa.pdf", "kind": "pdf", "already_pulled_as": None},
            {"sha256": "c" * 64, "local": "cccccccccccc.png", "kind": "image", "already_pulled_as": None},
            {"sha256": "e" * 64, "local": "eeeeeeeeeeee.pdf", "kind": "pdf", "already_pulled_as": "filed copy.pdf"},
        ],
        "encrypted": [{"email": "RE: records", "attachment": "secure.rpmsg", "bytes": 30000}],
    }))
    d = decisions.fold(job_mod.load(job_dir), _cfg(firm_config_path), data_root / "example-matter", dry_run=False)
    assert d.payload["fold"] == ["a" * 12, "c" * 12]
    assert d.payload["_disclosed_encrypted"] == ["secure.rpmsg"]
    assert any("1 encrypted attachment" in n for n in d.notes)


def test_orphans_explains_by_config_reason_and_holds_on_residue(job_dir: Path, data_root: Path, firm_config_path: Path) -> None:
    sd = data_root / "example-matter"
    (sd / "units").mkdir()
    (sd / "units" / "alpha.json").write_text(json.dumps([{"id": "f1", "name": "clinic note", "pages": 3}]))
    seed_raw_manifest(data_root, [
        {"id": "f1", "name": "clinic note.pdf", "ok": True},
        {"id": "f2", "name": "Retainer signed.pdf", "ok": True},
        {"id": "f3", "name": "unknown scan.pdf", "ok": True},
    ])
    job = job_mod.load(job_dir)
    d = decisions.orphans(job, _cfg(firm_config_path), sd, job.units[0], dry_run=False)
    assert d.held and "unknown scan.pdf" in d.holds[0]
    assert not (sd / "orphans.json").exists()
    seed_raw_manifest(data_root, [
        {"id": "f1", "name": "clinic note.pdf", "ok": True},
        {"id": "f2", "name": "Retainer signed.pdf", "ok": True},
        {"id": "f3", "name": "image001", "ext": ".png", "size_got": 1168, "ok": True},
    ])
    d = decisions.orphans(job, _cfg(firm_config_path), sd, job.units[0], dry_run=False)
    assert not d.held
    reasons = [o["reason"] for o in json.loads((sd / "orphans.json").read_text())["orphans"]]
    assert reasons[0].startswith("engagement document")
    assert reasons[1].startswith("email signature or spacer graphic (1168 bytes .png)")


def test_control_picks_the_page_with_most_native_text(job_dir: Path, data_root: Path, firm_config_path: Path) -> None:
    sd = data_root / "example-matter"
    (sd / "out" / "alpha").mkdir(parents=True)
    (sd / "out" / "alpha" / "page_map.json").write_text(json.dumps([
        {"exhibit": 1, "files": [{"file": "sparse scan.pdf", "start_page": 1, "pages": 10}]},
        {"exhibit": 2, "files": [{"file": "dense notes.pdf", "start_page": 1, "pages": 5}]},
    ]))
    (sd / "extracted.jsonl").write_text(
        json.dumps({"name": "sparse scan", "pages": 10, "chars": 400}) + "\n"
        + json.dumps({"name": "dense notes", "pages": 5, "chars": 12000}) + "\n"
    )
    job = job_mod.load(job_dir)
    d = decisions.control(job, _cfg(firm_config_path), sd, job.units[0], dry_run=False)
    assert d.payload["exhibit"] == 2 and d.payload["page"] == 2
    assert (sd / "record_control.json").is_file()


# ---- driver ------------------------------------------------------------------
def _seat() -> FakeSeat:
    """One MEDICAL folder with a dense seven-page record and a one-page second
    file, both native text; enough for the ported stages to run for real under
    the driver without a scan queue or a billing document."""
    f1, f9 = make_pdf([PROSE] * 7), make_pdf([PROSE])
    docs = [doc_row("f1", "f1.pdf", "fold-med", len(f1)), doc_row("f9", "mystery.pdf", "fold-med", len(f9))]
    return FakeSeat(docs, [{"id": "fold-med", "name": "MEDICAL", "parentId": None, "path": "/MEDICAL"}],
                    {"f1": f1, "f9": f9})


class _NoNetwork:
    """A client that fails loudly: nothing in these runs may reach the API."""

    def __init__(self) -> None:
        self.messages = self

    def create(self, **kw):
        raise AssertionError("a driver test reached the SDK client")

    def stream(self, **kw):
        raise AssertionError("a driver test reached the SDK client")


def _driver(job_dir: Path, firm_config_path: Path, pricing_path: Path, **kw) -> driver_mod.Driver:
    kw.setdefault("seat_factory", _seat)
    kw.setdefault("client", _NoNetwork())
    return driver_mod.Driver(job_dir, firm_config=str(firm_config_path), pricing=str(pricing_path), log=lambda *_: None, **kw)


def test_dry_run_authors_nothing_and_runs_nothing(job_dir: Path, data_root: Path, firm_config_path: Path, pricing_path: Path) -> None:
    seed_folders(data_root, ["MEDICAL"])
    outs = _driver(job_dir, firm_config_path, pricing_path, dry_run=True).run()
    assert outs[0].outcome == "dry_run"
    # Every hook still reports; a would-hold is a note, so the hold rate of a
    # rule can be read off delivered matters without a run.
    assert any(n.startswith("WOULD HOLD at decide_control") for n in outs[0].notes)
    assert not (data_root / "example-matter" / "include.json").exists()
    assert calls(data_root) == []


def test_the_whole_dag_runs_with_ported_stages_in_process_and_frozen_ones_as_subprocesses(
    job_dir: Path, data_root: Path, firm_config_path: Path, pricing_path: Path, fake_pipeline: Path
) -> None:
    sd = data_root / "example-matter"
    (sd / "out" / "alpha").mkdir(parents=True)
    (sd / "out" / "alpha" / "page_map.json").write_text(json.dumps([
        {"exhibit": 1, "files": [{"file": "f1.pdf", "start_page": 1, "pages": 7}]}]))
    outs = _driver(job_dir, firm_config_path, pricing_path).run()
    o = outs[0]
    # Every stage ran: the ported ones for real (both files owned by the one
    # unit, nothing to scan, no billing documents), the frozen ones as fakes.
    assert o.outcome == "delivered" and o.stage is None, o
    assert (sd / "orphans.json").is_file()
    # The ported $0 stages ran for real: listing, pull, extract, the email index.
    assert json.loads((sd / "manifest.json").read_text())["count"] == 2
    pulled = {r["id"] for r in map(json.loads, (sd / "raw_manifest.jsonl").read_text().splitlines()) if r["ok"]}
    assert pulled == {"f1", "f9"}
    extracted = {r["name"]: r for r in map(json.loads, (sd / "extracted.jsonl").read_text().splitlines())}
    assert extracted["f1.pdf"]["pages"] == 7 and extracted["f1.pdf"]["chars"] > 5600
    assert json.loads((sd / "msg_attachments.json").read_text())["comparable"] is True
    assert (sd / "runs" / "alpha" / "log-download.txt").read_text().startswith("example-matter: 2 targets")
    # The paid $0-in-this-run stages ran in-process too: no scans, no billing docs, one unit.
    assert [r["id"] for r in json.loads((sd / "units" / "alpha.json").read_text())] == ["f1", "f9"]
    # The frozen stages still run as subprocesses with the full env block.
    ran = [c["script"] for c in calls(data_root)]
    assert ran[0] == "check_unit_identity.py"
    assert "strip_nonrecord.py" in ran
    first = calls(data_root)[0]
    assert first["env"]["SMD_SLUG"] == "example-matter"
    assert first["env"]["SMD_UNIT"] == "alpha"
    assert first["env"]["SMD_INCIDENT_DATE"] == "2026-01-15"
    assert first["env"]["SMD_MODEL_AUDIT"] == "claude-sonnet-5"
    assert first["cwd"] == str(data_root / "example-matter")
    st = RunState.load_or_new(state_path(data_root, "example-matter", "alpha"), slug="x", unit="y")
    assert st.outcome == "delivered"
    for name in ("list_matter", "download", "extract_after_fold", "vision", "billing_extract", "build_units", "manifest"):
        assert st.is_done(name), name
    assert st.pipeline_sha


def test_resume_skips_done_stages_after_a_kill(job_dir: Path, data_root: Path, firm_config_path: Path, pricing_path: Path, fake_pipeline: Path) -> None:
    seed_folders(data_root, ["MEDICAL"])
    (fake_pipeline / "exit_check_unit_identity.py").write_text("9")  # a crash mid-run
    outs = _driver(job_dir, firm_config_path, pricing_path).run()
    assert outs[0].outcome == "failed" and outs[0].stage == "identity"
    before = len(calls(data_root))
    (fake_pipeline / "exit_check_unit_identity.py").unlink()
    st = RunState.load_or_new(state_path(data_root, "example-matter", "alpha"), slug="x", unit="y")
    st.outcome = None
    st.save()
    _driver(job_dir, firm_config_path, pricing_path).run()
    after = calls(data_root)[before:]
    assert after[0]["script"] == "check_unit_identity.py"
    st = RunState.load_or_new(state_path(data_root, "example-matter", "alpha"), slug="x", unit="y")
    assert st.stage("download").attempts == 1   # the pull was not repeated
    assert st.stage("build_units").attempts == 1


def test_cap_refuses_before_the_first_paid_stage(job_dir: Path, data_root: Path, firm_config_path: Path, pricing_path: Path, fake_pipeline: Path) -> None:
    seed_folders(data_root, ["MEDICAL"])
    write_ledger(data_root, "alpha", [{"stage": "compose", "model": "claude-opus-5", "in": 40_000_000, "out": 0}])  # $200 already
    outs = _driver(job_dir, firm_config_path, pricing_path).run()
    o = outs[0]
    assert o.outcome == "refused" and o.stage == "vision"
    assert "cap 150.00 USD reached" in o.reason
    assert "vision_scan.py" not in [c["script"] for c in calls(data_root)]


def test_exit_code_map_yields_the_vocabulary(job_dir: Path, data_root: Path, firm_config_path: Path, pricing_path: Path, fake_pipeline: Path) -> None:
    seed_folders(data_root, ["MEDICAL"])
    (fake_pipeline / "exit_assemble.py").write_text("1")
    outs = _driver(job_dir, firm_config_path, pricing_path).run()
    assert outs[0].outcome == "refused" and "assemble refused" in outs[0].reason


def test_unknown_model_in_ledger_refuses_the_run(job_dir: Path, data_root: Path, firm_config_path: Path, pricing_path: Path, fake_pipeline: Path) -> None:
    seed_folders(data_root, ["MEDICAL"])
    write_ledger(data_root, "alpha", [{"stage": "compose", "model": "claude-mystery-7", "in": 10, "out": 0}])
    with pytest.raises(budget_mod.BudgetError, match="refusing to price it at zero"):
        _driver(job_dir, firm_config_path, pricing_path).run()


def test_job_cap_overrides_the_firm_default(tmp_path: Path, data_root: Path, firm_config_path: Path, pricing_path: Path, fake_pipeline: Path) -> None:
    jd = tmp_path / "job"
    jd.mkdir()
    (jd / "job.yaml").write_text(job_yaml(data_root, cap=1.0))
    seed_folders(data_root, ["MEDICAL"])
    write_ledger(data_root, "alpha", [{"stage": "compose", "model": "claude-sonnet-5", "in": 1_000_000, "out": 0}])  # $2
    outs = _driver(jd, firm_config_path, pricing_path).run()
    assert outs[0].outcome == "refused" and "cap 1.00 USD" in outs[0].reason
    assert yaml.safe_load((jd / "job.yaml").read_text())["cap_usd"] == 1.0
