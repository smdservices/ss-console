"""L1 boot smoke test — pytest wrapper around bin/boot-smoke-test.sh.

Per test plan v2 §"Layer 1 — Plumbing & integration — Boot smoke E2E".
The bash script at ai-employee/bin/boot-smoke-test.sh runs 7
dependency-chain checks via `fly ssh console` against a provisioned
Machine:

  1. Machine state=started (within 60s)
  2. Postgres reachable (pg_isready)
  3. Redis reachable (redis-cli ping)
  4. Honcho health endpoint (curl /health)
  5. customer.yaml present at /opt/data/customer.yaml
  6. Hermes profiles directory materialized
  7. Overlay plugins installed (hermes plugins list)

This pytest wrapper:

  - In stub mode (no FLY_MACHINE_HOST env): SKIPs the live invocation;
    validates the script exists, is executable, and has documented
    failure modes for each step. CI runs this on every PR.
  - In live mode (FLY_MACHINE_HOST set + the customer's slug exposed
    via TEST_CUSTOMER_SLUG): invokes the script against the real
    Machine; asserts exit 0. CI runs this in the soak workflow
    against a freshly provisioned _template-derived Machine.

The E2E extension (first agent turn → audit row in D1 → mirror
conclusion) is deferred to the soak workflow's per-launch step
because each step requires real Anthropic credentials + D1 binding
+ live Honcho. This wrapper handles the boot-smoke portion only;
the E2E run is the launch-check.sh shadow-run step in L4.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
REPO_ROOT = _HERE.parents[2]
BOOT_SCRIPT = REPO_ROOT / "ai-employee" / "bin" / "boot-smoke-test.sh"


REQUIRED_STEPS = (
    "machine-state-started",
    "postgres-ready",
    "redis-ping",
    "honcho-health",
    "customer-yaml-present",
    "hermes-profiles-dir",
    "hermes-plugins-installed",
)


class TestBootSmokeScript:
    """Static checks on the existing bin/boot-smoke-test.sh."""

    def test_script_exists(self):
        assert BOOT_SCRIPT.exists(), (
            f"boot smoke script missing at {BOOT_SCRIPT}"
        )

    def test_script_is_executable(self):
        assert os.access(BOOT_SCRIPT, os.X_OK), (
            f"boot smoke script not executable: chmod +x {BOOT_SCRIPT}"
        )

    @pytest.mark.parametrize("step", REQUIRED_STEPS)
    def test_documented_step_present_in_script(self, step):
        """Each documented dependency-chain step must be referenced by name
        in the bash script. Prevents silent regressions where a step is
        removed or renamed without updating this contract.
        """
        text = BOOT_SCRIPT.read_text(encoding="utf-8")
        assert step in text, (
            f"step {step!r} not referenced in boot-smoke-test.sh — either "
            f"the step was removed or the contract here is stale"
        )

    def test_script_uses_fly_ssh_console(self):
        """The smoke test runs against a provisioned Fly Machine via fly ssh."""
        text = BOOT_SCRIPT.read_text(encoding="utf-8")
        assert "fly ssh console" in text or "fly_ssh" in text, (
            "script does not appear to invoke fly ssh console — boot smoke "
            "needs to execute inside the Machine"
        )


class TestBootSmokeLiveRun:
    """Live invocation against a real Fly Machine. Skips if no host set."""

    @pytest.fixture
    def live_args(self):
        host = os.environ.get("FLY_MACHINE_HOST")
        slug = os.environ.get("TEST_CUSTOMER_SLUG")
        if not host:
            pytest.skip(
                "FLY_MACHINE_HOST not set; boot-smoke-test live mode requires "
                "a provisioned Machine (the soak workflow sets this when "
                "the test fires per-launch)"
            )
        if not slug:
            pytest.skip(
                "TEST_CUSTOMER_SLUG not set; boot-smoke-test requires the "
                "customer slug to address the Machine"
            )
        return {"host": host, "slug": slug}

    def test_flyctl_available(self, live_args):
        """Smoke check: flyctl must be on PATH for the script to work."""
        if not shutil.which("fly"):
            pytest.fail(
                "flyctl ('fly') not on PATH; cannot run live boot-smoke "
                "test against FLY_MACHINE_HOST"
            )

    def test_boot_smoke_against_real_machine(self, live_args):
        """Run the bash script against the configured Machine; assert exit 0."""
        if not shutil.which("fly"):
            pytest.skip("flyctl not on PATH")
        result = subprocess.run(
            [str(BOOT_SCRIPT), live_args["slug"]],
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode != 0:
            pytest.fail(
                f"boot-smoke-test.sh exited {result.returncode} against "
                f"slug={live_args['slug']}\nstdout:\n{result.stdout}\n"
                f"stderr:\n{result.stderr}"
            )


class TestBootSmokeContractSurface:
    """Sanity: the contract documented here matches the script's surface."""

    def test_required_steps_match_script_steps_count(self):
        """The 7 steps documented in REQUIRED_STEPS must match the 7 in
        the boot-smoke-test.sh ---------- Step N: comments. If a step is
        added/removed, this test surfaces the contract drift."""
        text = BOOT_SCRIPT.read_text(encoding="utf-8")
        # Count "---------- Step N:" headers in the script.
        step_headers = [
            line for line in text.splitlines()
            if line.startswith("# ---------- Step ")
        ]
        assert len(step_headers) == len(REQUIRED_STEPS), (
            f"script has {len(step_headers)} steps but contract documents "
            f"{len(REQUIRED_STEPS)}; update REQUIRED_STEPS or the script"
        )
