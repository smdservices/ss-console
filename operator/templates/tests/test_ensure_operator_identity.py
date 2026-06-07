from __future__ import annotations

import subprocess
import sys
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "ensure-operator-identity.py"


def write_customer_yaml(path: Path) -> None:
    path.write_text(
        """
customer_name: SMDurgan, LLC
google_auth:
  mode: dwd
  subject: crane@smd.services
personas:
  - slug: crane
    status: active
connectors:
  Email:
    adapter: google-gmail
  Calendar:
    adapter: google-calendar
  DocumentStorage:
    adapter: google-drive
""".lstrip(),
        encoding="utf-8",
    )


def seed_soul(home: Path) -> Path:
    profile = home / "profiles" / "crane"
    profile.mkdir(parents=True)
    soul = profile / "SOUL.md"
    soul.write_text(
        "# Crane\n\nYou are Crane, Chief of Staff at SMDurgan, LLC.\n",
        encoding="utf-8",
    )
    return soul


def run_script(customer_yaml: Path, home: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(customer_yaml), str(home)],
        check=False,
        text=True,
        capture_output=True,
    )


def test_writes_google_workspace_identity_block(tmp_path: Path) -> None:
    customer_yaml = tmp_path / "customer.yaml"
    write_customer_yaml(customer_yaml)
    soul = seed_soul(tmp_path / "hermes")

    result = run_script(customer_yaml, tmp_path / "hermes")

    assert result.returncode == 0, result.stderr
    text = soul.read_text(encoding="utf-8")
    assert "Your customer-owned Google Workspace email address is crane@smd.services." in text
    assert "Email is configured through the google-gmail BUILD connector." in text
    assert "Calendar is configured through the google-calendar BUILD connector." in text
    assert "Drive, Docs, and Sheets are configured through the google-drive BUILD connector." in text
    assert "Do not infer mail is unconfigured from absent local mail clients" in text


def test_managed_block_is_idempotent(tmp_path: Path) -> None:
    customer_yaml = tmp_path / "customer.yaml"
    write_customer_yaml(customer_yaml)
    soul = seed_soul(tmp_path / "hermes")

    first = run_script(customer_yaml, tmp_path / "hermes")
    second = run_script(customer_yaml, tmp_path / "hermes")

    assert first.returncode == 0
    assert second.returncode == 0
    assert soul.read_text(encoding="utf-8").count("smd-operator-identity:start") == 1
