"""bootstrap.sh must export HERMES_TIMEZONE from business_hours.timezone (#cron-tz).

The container clock is UTC, and Hermes' cron engine computes due-ness with
hermes_time.now(), whose highest-priority source is the HERMES_TIMEZONE env
var. Without the export, every authored cron expression silently runs in UTC
while the customer.yaml comments claim local time — caught live 2026-07-03:
the pilot's "0623 PT" morning digest actually meant 11:23 PM Pacific, and the
escalator's "0700 PT" had fired at midnight Pacific since it shipped.

These asserts pin the seam:
  * bootstrap extracts business_hours.timezone from the root customer.yaml
  * exports it as HERMES_TIMEZONE BEFORE the gateway exec (the clock consumer)
  * unauthored block exports nothing (UTC stays the prior behavior, not a
    new default — ADR 0037 tenet 3)
Plus: both A&P-arc seats actually author the block, so the export has a
producer on the seats whose cron comments promise Pacific times.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

_OPERATOR = Path(__file__).resolve().parents[2]
_BOOTSTRAP = _OPERATOR / "templates" / "bootstrap.sh"
_SEATS = (
    _OPERATOR / "customers" / "pilot-smokeball" / "customer.yaml",
    _OPERATOR / "customers" / "ashton-price" / "customer.yaml",
)


def _code_lines() -> list[str]:
    out = []
    for line in _BOOTSTRAP.read_text(encoding="utf-8").splitlines():
        out.append("" if line.lstrip().startswith("#") else line)
    return out


def _first_index(lines: list[str], pattern: str) -> int:
    rx = re.compile(pattern)
    for i, line in enumerate(lines):
        if rx.search(line):
            return i
    return -1


def test_bootstrap_exports_seat_timezone_before_gateway() -> None:
    lines = _code_lines()
    extract_idx = _first_index(lines, r"business_hours")
    export_idx = _first_index(lines, r"export HERMES_TIMEZONE=")
    gateway_idx = _first_index(lines, r"\bexec\b.*\bhermes\b.*\bgateway\s+run\b")

    assert extract_idx != -1, "bootstrap.sh must read business_hours from customer.yaml"
    assert export_idx != -1, "bootstrap.sh must export HERMES_TIMEZONE"
    assert gateway_idx != -1, "could not find the gateway exec line"
    assert extract_idx < export_idx < gateway_idx, (
        "HERMES_TIMEZONE must be extracted and exported before the gateway exec "
        f"(extract={extract_idx}, export={export_idx}, gateway={gateway_idx})"
    )


def test_bootstrap_exports_seat_timezone_before_cron_materialization() -> None:
    """ss-console#1691: the export must ALSO precede step 7 (`hermes-smd
    bootstrap`), not just the gateway exec. Cron materialization persists each
    managed job's first next_run_at computed via hermes_time.now() in the
    step-7 process, and hermes_time caches its timezone per process — so an
    export placed after step 7 stores UTC-computed first fires that the
    gateway then fires at BOTH the UTC-interpreted and seat-local times (the
    2026-07-04 escalator double-fire: midnight PT + 7:00 AM PT)."""
    lines = _code_lines()
    export_idx = _first_index(lines, r"export HERMES_TIMEZONE=")
    overlay_bootstrap_idx = _first_index(lines, r"^\s*hermes-smd bootstrap\b")

    assert export_idx != -1, "bootstrap.sh must export HERMES_TIMEZONE"
    assert overlay_bootstrap_idx != -1, "could not find the hermes-smd bootstrap (step 7) line"
    assert export_idx < overlay_bootstrap_idx, (
        "HERMES_TIMEZONE must be exported BEFORE `hermes-smd bootstrap` — cron "
        "materialization persists next_run_at with the timezone cached at that "
        f"process's start (export={export_idx}, step7={overlay_bootstrap_idx})"
    )


def test_export_is_conditional_on_authored_timezone() -> None:
    """Unauthored business_hours must NOT export an empty/placeholder value —
    the export sits inside a non-empty guard so UTC remains the fallback."""
    text = _BOOTSTRAP.read_text(encoding="utf-8")
    m = re.search(
        r'if \[ -n "\$\{SEAT_TIMEZONE\}" \]; then\s*\n\s*export HERMES_TIMEZONE=',
        text,
    )
    assert m, "export HERMES_TIMEZONE must be guarded on a non-empty SEAT_TIMEZONE"


def test_ap_arc_seats_author_pacific_timezone() -> None:
    for seat in _SEATS:
        data = yaml.safe_load(seat.read_text(encoding="utf-8"))
        hours = data.get("business_hours") or {}
        assert hours.get("timezone") == "America/Los_Angeles", (
            f"{seat.parent.name}: business_hours.timezone must be America/Los_Angeles — "
            "its cron comments promise Pacific-local times"
        )
