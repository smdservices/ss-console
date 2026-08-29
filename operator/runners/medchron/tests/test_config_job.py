from __future__ import annotations

import copy
from pathlib import Path

import pytest
import yaml

from medchron import config as config_mod, job as job_mod
from tests.conftest import FIRM_CONFIG, job_yaml


def test_valid_config_loads(firm_config_path: Path) -> None:
    cfg = config_mod.load(str(firm_config_path))
    assert cfg.slug == "example-firm"
    assert cfg.per_job_cap_usd == 150.0
    assert cfg.compiled("providers", "aliases")[0][1] == "Example Clinic"


def test_unknown_key_is_refused(tmp_path: Path) -> None:
    data = copy.deepcopy(FIRM_CONFIG)
    data["budget"]["per_matter_cap"] = 400  # not a key; a typo must not silently vanish
    p = tmp_path / "f.yaml"
    p.write_text(yaml.safe_dump(data), encoding="utf-8")
    with pytest.raises(config_mod.ConfigError, match="budget.per_matter_cap: unknown key"):
        config_mod.load(str(p))


def test_unknown_section_is_refused(tmp_path: Path) -> None:
    data = copy.deepcopy(FIRM_CONFIG)
    data["extras"] = {"x": 1}
    p = tmp_path / "f.yaml"
    p.write_text(yaml.safe_dump(data), encoding="utf-8")
    with pytest.raises(config_mod.ConfigError, match="extras: unknown section"):
        config_mod.load(str(p))


def test_audit_is_never_batchable(tmp_path: Path) -> None:
    data = copy.deepcopy(FIRM_CONFIG)
    data["levers"]["batch_stages"] = ["vision", "audit"]
    p = tmp_path / "f.yaml"
    p.write_text(yaml.safe_dump(data), encoding="utf-8")
    with pytest.raises(config_mod.ConfigError, match="audit"):
        config_mod.load(str(p))


def test_missing_file_is_a_refusal_not_a_default(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(config_mod.ENV_PATH, raising=False)
    with pytest.raises(config_mod.ConfigError, match="no built-in firm"):
        config_mod.load(str(tmp_path / "absent.yaml"))


def test_bad_regex_is_named(tmp_path: Path) -> None:
    data = copy.deepcopy(FIRM_CONFIG)
    data["coverage"]["exclusions"].append({"match": "(", "reason": "x"})
    problems = config_mod.validate(data)
    assert any("coverage.exclusions[2].match: invalid regex" in p for p in problems)


def test_job_loads(job_dir: Path) -> None:
    j = job_mod.load(job_dir)
    assert j.slug == "example-matter"
    assert j.incident_date == "2026-01-15"
    assert not j.joint
    assert j.cap_usd is None


def test_job_joint_requires_folder_prefix(tmp_path: Path, data_root: Path) -> None:
    body = yaml.safe_load(job_yaml(data_root, joint=True))
    del body["units"][1]["folder_prefix"]
    with pytest.raises(job_mod.JobError, match="folder_prefix"):
        job_mod.parse(body, path=tmp_path / "job.yaml")


@pytest.mark.parametrize(
    "mutate, msg",
    [
        (lambda b: b["incident"].__setitem__("date", "01/15/2026"), "YYYY-MM-DD"),
        (lambda b: b["incident"].__setitem__("source", "guessed"), "incident.source"),
        (lambda b: b["units"][0].__setitem__("dob", "1970-01-01"), "MM/DD/YYYY"),
        (lambda b: b.__setitem__("cap_usd", 0), "cap_usd"),
        (lambda b: b.pop("data_root"), "data_root"),
    ],
)
def test_job_refuses_the_shapes_it_must_not_guess(tmp_path: Path, data_root: Path, mutate, msg: str) -> None:
    body = yaml.safe_load(job_yaml(data_root))
    mutate(body)
    with pytest.raises(job_mod.JobError, match=msg):
        job_mod.parse(body, path=tmp_path / "job.yaml")
