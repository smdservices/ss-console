from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "ensure-disabled-skills.py"


def write_customer_yaml(path: Path) -> None:
    path.write_text(
        """
personas:
  - slug: crane
    skills_disabled:
      - himalaya
      - google-workspace
""".lstrip(),
        encoding="utf-8",
    )


def seed_profile(home: Path) -> Path:
    profile = home / "profiles" / "crane"
    skills = profile / "skills"
    (skills / "email" / "himalaya").mkdir(parents=True)
    (skills / "productivity" / "google-workspace").mkdir(parents=True)
    (skills / "productivity" / "notion").mkdir(parents=True)
    (skills / "email" / "himalaya" / "SKILL.md").write_text("himalaya", encoding="utf-8")
    (skills / "productivity" / "google-workspace" / "SKILL.md").write_text(
        "google", encoding="utf-8"
    )
    (skills / "productivity" / "notion" / "SKILL.md").write_text("notion", encoding="utf-8")
    (skills / ".bundled_manifest").write_text(
        "himalaya:abc\n"
        "google-workspace:def\n"
        "notion:ghi\n",
        encoding="utf-8",
    )
    (profile / ".skills_prompt_snapshot.json").write_text(
        json.dumps(
            {
                "version": 1,
                "manifest": {
                    "email/himalaya/SKILL.md": [1, 2],
                    "productivity/google-workspace/SKILL.md": [1, 2],
                    "productivity/notion/SKILL.md": [1, 2],
                },
                "skills": [
                    {"skill_name": "himalaya", "category": "email"},
                    {"skill_name": "google-workspace", "category": "productivity"},
                    {"skill_name": "notion", "category": "productivity"},
                ],
            }
        ),
        encoding="utf-8",
    )
    return profile


def run_script(customer_yaml: Path, home: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args, str(customer_yaml), str(home)],
        check=False,
        text=True,
        capture_output=True,
    )


def test_check_fails_when_disabled_skills_are_exposed(tmp_path: Path) -> None:
    customer_yaml = tmp_path / "customer.yaml"
    write_customer_yaml(customer_yaml)
    seed_profile(tmp_path / "hermes")

    result = run_script(customer_yaml, tmp_path / "hermes", "--check")

    assert result.returncode == 1
    assert "CHECK FAILED" in result.stderr


def test_enforce_removes_disabled_skill_artifacts(tmp_path: Path) -> None:
    customer_yaml = tmp_path / "customer.yaml"
    write_customer_yaml(customer_yaml)
    profile = seed_profile(tmp_path / "hermes")

    result = run_script(customer_yaml, tmp_path / "hermes")

    assert result.returncode == 0, result.stderr
    assert not (profile / "skills" / "email" / "himalaya").exists()
    assert not (profile / "skills" / "productivity" / "google-workspace").exists()
    assert (profile / "skills" / "productivity" / "notion").is_dir()
    assert (profile / "skills" / ".bundled_manifest").read_text(encoding="utf-8") == "notion:ghi\n"

    snapshot = json.loads((profile / ".skills_prompt_snapshot.json").read_text(encoding="utf-8"))
    assert snapshot["manifest"] == {"productivity/notion/SKILL.md": [1, 2]}
    assert snapshot["skills"] == [{"skill_name": "notion", "category": "productivity"}]

    check = run_script(customer_yaml, tmp_path / "hermes", "--check")
    assert check.returncode == 0, check.stderr
