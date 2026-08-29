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
    """One MEDICAL folder with a dense seven-page record and a one-page
    engagement document (excluded from composition by the firm's name rule and
    explained to the coverage gate by its exclusion reason); the map cites the
    record, so every stage after composition has real artifacts to work on."""
    f1, f9 = make_pdf([f"{PROSE} Page {i} of the record." for i in range(1, 8)]), make_pdf([PROSE])
    docs = [doc_row("f1", "f1.pdf", "fold-med", len(f1)), doc_row("f9", "Retainer signed.pdf", "fold-med", len(f9))]
    return FakeSeat(docs, [{"id": "fold-med", "name": "MEDICAL", "parentId": None, "path": "/MEDICAL"}],
                    {"f1": f1, "f9": f9})


REAL_MAP = ("## ENTRIES\n01/20/2026\nExample Clinic | Patient Complaints & Limitations\n\n"
            "The patient reports neck pain after the collision rated 6 of 10. (FILE: f1.pdf, p. 2)\n\n"
            "Medical Diagnoses\n\nCervical strain. (FILE: f1.pdf, p. 3)\n\n"
            "## INDEX\n2026-01-20 | Example Clinic | S13.4XXA | f1.pdf\n\n## BILLING-DATES\nnone in this chunk\n\n"
            "## CONFLICTS / REFERENCED-BUT-ABSENT\nnone observed\n\n## FILES-SEEN\n"
            "=== FILE: f1.pdf (fileId f1) === entries: 1\n")
SUPPORTED = {"verdict": "SUPPORTED", "unsupported_assertions": [], "contradictions": [], "note": "on the page"}
UNSUPPORTED = {"verdict": "UNSUPPORTED", "unsupported_assertions": ["x"], "contradictions": [], "note": "not this page"}


class _Usage:
    input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens = 10, 5, 0, 0


def _text_msg(text: str):
    return type("M", (), {"content": [type("B", (), {"type": "text", "text": text})()], "stop_reason": "end_turn",
                          "usage": _Usage()})()


def _tool_msg(payload: dict):
    return type("M", (), {"content": [type("B", (), {"type": "tool_use", "input": payload})()], "stop_reason": "tool_use",
                          "usage": _Usage()})()


class _Stream:
    def __init__(self, msg):
        self.msg = msg

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get_final_message(self):
        return self.msg


class _NoNetwork:
    """Answers each paid shape the run makes from a script; anything else
    reaching the SDK fails loudly. Streams are the compose; a forced tool is
    an audit verdict (a control, cited to the other exhibit, is refused);
    the classifier's system prompt gets labels; nothing else is expected."""

    def __init__(self) -> None:
        self.messages = self
        self.calls: list[dict] = []

    def _system(self, kw) -> str:
        sysm = kw.get("system")
        if isinstance(sysm, list):
            return sysm[0].get("text", "")
        return sysm or ""

    def create(self, **kw):
        self.calls.append(kw)
        if kw.get("tool_choice"):
            tail = kw["messages"][0]["content"][-1]["text"]
            return _tool_msg(UNSUPPORTED if "cited to Exhibit 2 p.1)" in tail else SUPPORTED)
        if "classify single pages" in self._system(kw):
            labels = [b["text"].split()[1].rstrip(":") for b in kw["messages"][0]["content"] if b["type"] == "text"]
            answer = {"CTL0": "ORDER", "CTL1": "INDEX"}
            return _text_msg("\n".join(f"{lb} = {answer.get(lb, 'RECORD')}" for lb in labels))
        raise AssertionError("a driver test reached the SDK client with an unexpected shape")

    def stream(self, **kw):
        self.calls.append(kw)
        return _Stream(_text_msg(REAL_MAP))


def _controls(data_root: Path) -> None:
    """The scanned-page classifier's falsifier pages and the ICD tables, as a
    seat carries them under controls/."""
    ctl = data_root / "controls"
    ctl.mkdir(parents=True, exist_ok=True)
    (ctl / "control-order.pdf").write_bytes(make_pdf(["Order #: 1\nRequested Date Range: 2026\nvendor@example-retrieval.com"]))
    (ctl / "control-index.pdf").write_bytes(make_pdf(["This list is computer generated\nabdomen 4\n"]))
    (ctl / "controls.json").write_text(json.dumps([{"pdf": "controls/control-order.pdf", "page": 1, "label": "ORDER"},
                                                   {"pdf": "controls/control-index.pdf", "page": 1, "label": "INDEX"}]))
    icd = ctl / "icd"
    icd.mkdir(exist_ok=True)
    (icd / "icd10cm_order.txt").write_text("{:<5} {:<7} {} {:<60} {}\n".format("00001", "S134XXA", "1", "Sprain of lig", "Sprain of ligaments of cervical spine, initial encounter"))
    (icd / "CMS32_DESC_LONG_DX.txt").write_text("7242 Lumbago\n")
    (icd / "VERSION.json").write_text("{}")


def _driver(job_dir: Path, firm_config_path: Path, pricing_path: Path, **kw) -> driver_mod.Driver:
    kw.setdefault("seat_factory", _seat)
    kw.setdefault("client", _NoNetwork())
    _controls(job_mod.load(job_dir).data_root)
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
    outs = _driver(job_dir, firm_config_path, pricing_path).run()
    o = outs[0]
    # Every stage ran: the ported ones for real (the map cites the record, so
    # an exhibit is built, classified, stripped of nothing, covered, charted
    # and audited), the frozen ones (identity, render, manifest) as fakes.
    assert o.outcome == "delivered" and o.stage is None, o
    assert (sd / "orphans.json").is_file()
    page_map = json.loads((sd / "out" / "alpha" / "page_map.json").read_text())
    assert len(page_map) == 1 and page_map[0]["total_pages"] == 7 and page_map[0]["provider"] == "Example Clinic"
    doc = (sd / "runs" / "alpha" / "final-chronology.md").read_text()
    assert "(Exhibit 1 - p. 2)" in doc and "| S13.4XXA | Sprain of ligaments" in doc
    assert json.loads((sd / "nonrecord.json").read_text())["1"]["drop_pages"] == []
    assert json.loads((sd / "scanned_labels.json").read_text())["controls_ok"] is True
    audit_rows = [json.loads(line) for line in (sd / "out" / "alpha" / "audit-results.jsonl").read_text().splitlines()]
    assert [r["verdict"] for r in audit_rows if r["kind"] == "real"] == ["SUPPORTED"]   # "Cervical strain." is under the 30-char floor
    assert "GATE PASS" in (sd / "runs" / "alpha" / "log-audit.txt").read_text()
    assert json.loads((sd / "billing_chart.json").read_text())["rows"][0]["basis"] == "no bill located"
    # The ported $0 stages ran for real: listing, pull, extract, the email index.
    assert json.loads((sd / "manifest.json").read_text())["count"] == 2
    pulled = {r["id"] for r in map(json.loads, (sd / "raw_manifest.jsonl").read_text().splitlines()) if r["ok"]}
    assert pulled == {"f1", "f9"}
    extracted = {r["name"]: r for r in map(json.loads, (sd / "extracted.jsonl").read_text().splitlines())}
    assert extracted["f1"]["pages"] == 7 and extracted["f1"]["chars"] > 5600
    assert json.loads((sd / "msg_attachments.json").read_text())["comparable"] is True
    assert (sd / "runs" / "alpha" / "log-download.txt").read_text().startswith("example-matter: 2 targets")
    # The paid $0-in-this-run stages ran in-process too: no scans, no billing docs, one unit.
    assert [r["id"] for r in json.loads((sd / "units" / "alpha.json").read_text())] == ["f1"]
    assert json.loads((sd / "orphans.json").read_text())["orphans"][0]["reason"].startswith("engagement document")
    # The frozen stages still run as subprocesses with the full env block.
    ran = [c["script"] for c in calls(data_root)]
    assert ran == ["check_unit_identity.py", "md_to_docx_v4.py", "make_manifest.py"]   # what is still frozen
    first = calls(data_root)[0]
    assert first["env"]["SMD_SLUG"] == "example-matter"
    assert first["env"]["SMD_UNIT"] == "alpha"
    assert first["env"]["SMD_INCIDENT_DATE"] == "2026-01-15"
    assert first["env"]["SMD_MODEL_AUDIT"] == "claude-sonnet-5"
    assert first["cwd"] == str(data_root / "example-matter")
    st = RunState.load_or_new(state_path(data_root, "example-matter", "alpha"), slug="x", unit="y")
    assert st.outcome == "delivered"
    for name in ("list_matter", "download", "extract_after_fold", "vision", "billing_extract", "build_units",
                 "map", "repair_truncated", "assemble", "merge", "group", "filter", "exhibits", "condense",
                 "summarize", "build_doc", "classify_nonrecord", "strip_apply", "coverage_gate", "billing_chart",
                 "billing_docx", "audit", "manifest"):
        assert st.is_done(name), name
    assert doc.startswith("Alpha Example - Medical Chronology") and "## Records Reviewed and Limitations" in doc
    assert "This chronology was prepared from 2 documents" in doc
    assert (sd / "runs" / "alpha" / "entries_condensed.md").is_file()
    assert (sd / "runs" / "alpha" / "map-01.md").read_text() == REAL_MAP
    assert (sd / "runs" / "alpha" / "merged.md").read_text() == ""
    assert o.dollars > 0    # the compose, classify and audit calls were ledgered and priced
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
    (fake_pipeline / "exit_md_to_docx_v4.py").write_text("1")
    outs = _driver(job_dir, firm_config_path, pricing_path).run()
    assert outs[0].outcome == "failed" and outs[0].stage == "render"


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
