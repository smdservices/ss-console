"""Tests for bin/audit-chain-watch.py, the daily off-box chain check (ss#2500).

Everything here is driven through injected runners and uploaders. Nothing in
this file touches a seat, D1, or R2: a control's test suite that needed the
live system to run would be skipped in CI, which is how a control ends up
shipping with detection nobody has ever seen fire.

The load-bearing assertions:

  * a tail-truncated export against a real pin is a FINDING, and the same export
    with no pin is a HOLD rather than a pass;
  * a hold and a finding are distinguishable in the exit code, and a hold is
    never silently upgraded to clean by a successful archive;
  * the SQL builder cannot be escaped out of by a hostile break string, which is
    the one place seat-controlled text reaches a statement.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
_OPERATOR = _HERE.parents[2]
sys.path.insert(0, str(_OPERATOR))
sys.path.insert(0, str(_OPERATOR / "workspace_broker"))

from chain import CHAIN_COLUMNS, GENESIS, compute_row_hash  # noqa: E402

# The script has a dash in its name, so it is loaded by path rather than
# imported. Same shape the other bin/ script tests use.
_spec = importlib.util.spec_from_file_location(
    "audit_chain_watch", _OPERATOR / "bin" / "audit-chain-watch.py"
)
watch = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
# Registered BEFORE exec: @dataclass resolves its own module out of sys.modules,
# and an unregistered module makes the decorator raise at import time.
sys.modules["audit_chain_watch"] = watch
_spec.loader.exec_module(watch)


def _chain(n: int) -> list[dict]:
    rows: list[dict] = []
    prev = GENESIS
    for i in range(n):
        row = {
            "id": f"01J0000000000000000000{i:04d}",
            "ts": f"2026-08-20T00:00:{i % 60:02d}Z",
            "action_type": "TOOL_CALL_COMPLETED",
            "actor": "agent",
            "actor_role": "agent",
            "skill_name": "unit-test",
            "matter_ref": None,
            "input_digest": None,
            "output_digest": None,
            "diff_digest": None,
            "trust_ceiling": "draft",
            "metadata": None,
        }
        row["prev_hash"] = prev
        row["row_hash"] = compute_row_hash(prev, [row[c] for c in CHAIN_COLUMNS])
        prev = row["row_hash"]
        rows.append(row)
    return rows


def _pin(rows: list[dict], index: int, *, audit_rows: int | None = None) -> dict:
    return {
        "audit_head": rows[index]["row_hash"],
        "audit_rows": len(rows) if audit_rows is None else audit_rows,
        "first_seen_heartbeat_ts": "2026-08-20T00:00:00Z",
        "last_seen_heartbeat_ts": "2026-08-20T00:05:00Z",
    }


# ---------------------------------------------------------------------------
# evaluate_export
# ---------------------------------------------------------------------------


def test_truncated_tail_against_a_real_pin_is_a_finding():
    rows = _chain(30)
    pin = _pin(rows, -1)
    outcome = watch.evaluate_export("seat", rows[:-1], pin)
    assert outcome.state == watch.FINDING
    assert "truncated" in outcome.headline
    assert outcome.details["pin_verdict"] == "pin_absent"


def test_the_same_truncated_export_with_no_pin_is_a_hold_not_a_pass():
    """The negative control for the test above.

    Without a pin the export is self-consistent and there is nothing to say.
    Saying "clean" would repeat exactly the claim this issue exists to retire.
    """
    rows = _chain(30)
    outcome = watch.evaluate_export("seat", rows[:-1], None)
    assert outcome.state == watch.HOLD
    assert outcome.details["pin_verdict"] == "pin_not_supplied"


def test_a_descending_pin_is_clean():
    rows = _chain(30)
    outcome = watch.evaluate_export("seat", rows, _pin(rows, 10))
    assert outcome.state == watch.CLEAN
    assert outcome.details["pin_verdict"] == "pin_descends"


def test_a_regressed_head_is_a_finding():
    rows = _chain(30)
    outcome = watch.evaluate_export("seat", rows[:12], _pin(rows, -1))
    assert outcome.state == watch.FINDING


def test_a_shrunken_row_count_is_a_finding_even_when_the_head_still_descends():
    """The second signal, isolated.

    The pin's head is row 5 and it IS in the export, so the head check passes.
    The pin also recorded 30 rows and the export holds 10.
    """
    rows = _chain(30)
    pin = _pin(rows, 5, audit_rows=30)
    outcome = watch.evaluate_export("seat", rows[:10], pin)
    assert outcome.state == watch.FINDING
    assert "shrank" in outcome.headline


def test_a_null_row_count_does_not_manufacture_a_shrink():
    rows = _chain(30)
    pin = _pin(rows, 5, audit_rows=None)
    pin["audit_rows"] = None
    assert watch.evaluate_export("seat", rows, pin).state == watch.CLEAN


def test_a_malformed_pin_is_a_hold_not_an_accusation():
    rows = _chain(10)
    pin = _pin(rows, -1)
    pin["audit_head"] = "garbage"
    outcome = watch.evaluate_export("seat", rows, pin)
    assert outcome.state == watch.HOLD
    assert "instrument" in outcome.headline


def test_a_broken_chain_outranks_the_pin_check():
    rows = _chain(10)
    pin = _pin(rows, -1)
    rows[4]["skill_name"] = "tampered"  # breaks its own recomputation
    outcome = watch.evaluate_export("seat", rows, pin)
    assert outcome.state == watch.FINDING
    assert "does not verify" in outcome.headline


# ---------------------------------------------------------------------------
# SQL construction
# ---------------------------------------------------------------------------


def test_sql_text_cannot_be_escaped_out_of():
    hostile = "'; DROP TABLE cost_anomaly_alerts; --"
    literal = watch.sql_text(hostile)
    # No quote, no semicolon, no comment marker survives into the statement:
    # the whole value is hex between a fixed opener and a fixed closer.
    assert literal.startswith("CAST(x'") and literal.endswith("' AS TEXT)")
    body = literal[len("CAST(x'") : -len("' AS TEXT)")]
    assert all(c in "0123456789abcdef" for c in body)
    assert bytes.fromhex(body).decode("utf-8") == hostile


def test_sql_int_refuses_anything_that_is_not_an_integer():
    assert watch.sql_int(0) == "0"
    for bad in ("1", 1.0, True, None):
        with pytest.raises(TypeError):
            watch.sql_int(bad)


def test_first_result_set_raises_rather_than_returning_empty_on_a_strange_envelope():
    """"Could not read" must never be indistinguishable from "no pin recorded"."""
    assert watch.first_result_set(json.dumps([{"results": [{"a": 1}]}])) == [{"a": 1}]
    assert watch.first_result_set(json.dumps({"results": []})) == []
    with pytest.raises(RuntimeError):
        watch.first_result_set(json.dumps("nope"))
    with pytest.raises(RuntimeError):
        watch.first_result_set(json.dumps({"results": "nope"}))


def test_the_alert_row_is_written_with_the_audit_integrity_source():
    seen: list[list[str]] = []

    def runner(cmd):
        seen.append(list(cmd))
        return subprocess.CompletedProcess(cmd, 0, json.dumps([{"results": []}]), "")

    console = watch.ConsoleD1(db="test-db", runner=runner)
    console.write_alert(
        entity_id="ent-1",
        slug="seat",
        summary="seat: the ledger was truncated.",
        details={"note": "'; DROP TABLE x; --"},
    )
    sql = seen[-1][-1]
    assert "'audit_integrity'" in sql
    assert "audit_chain:" in bytes.fromhex(_first_hex(sql, 3)).decode("utf-8")
    assert "DROP TABLE x" not in sql


def _first_hex(sql: str, index: int) -> str:
    """The nth hex blob literal in a statement, for asserting on inlined values."""
    parts = sql.split("CAST(x'")
    return parts[index + 1].split("'")[0]


# ---------------------------------------------------------------------------
# Archive
# ---------------------------------------------------------------------------


def test_the_archive_key_and_digest_are_reproducible(tmp_path):
    rows = _chain(5)
    uploaded: list[tuple[Path, str]] = []

    def uploader(local: Path, destination: str) -> None:
        uploaded.append((local, destination))

    first = watch.archive_export(
        "seat", rows, bucket="b", uploader=uploader, work_dir=tmp_path / "one"
    )
    second = watch.archive_export(
        "seat", rows, bucket="b", uploader=uploader, work_dir=tmp_path / "two"
    )
    assert first.key.startswith("audit/seat/") and first.key.endswith(".json.gz")
    assert uploaded[0][1] == f"s3://b/{first.key}"
    # Same rows, same bytes, same digest -- a gzip mtime would break this and
    # make every day's digest incomparable for no reason.
    assert first.sha256 == second.sha256
    # And the digest is over the bytes on the wire, so an auditor reproduces it
    # by hashing the object they downloaded.
    assert first.sha256 == __import__("hashlib").sha256(uploaded[0][0].read_bytes()).hexdigest()


def test_an_unconfirmed_bucket_lock_is_not_treated_as_configured():
    def denied(cmd):
        return subprocess.CompletedProcess(cmd, 255, "", "An error occurred (NotImplemented)")

    ok, note = watch.probe_bucket_lock("smd-audit-archive", runner=denied)
    assert ok is False
    assert "immutability is unproven" in note


def test_a_configured_bucket_lock_is_recognized():
    def allowed(cmd):
        return subprocess.CompletedProcess(
            cmd, 0, json.dumps({"ObjectLockConfiguration": {"ObjectLockEnabled": "Enabled"}}), ""
        )

    ok, note = watch.probe_bucket_lock("smd-audit-archive", runner=allowed)
    assert ok is True
    assert "configured" in note


# ---------------------------------------------------------------------------
# Exit contract
# ---------------------------------------------------------------------------


def _outcome(state: str) -> "watch.SeatOutcome":
    return watch.SeatOutcome("seat", state, "headline", {})


def test_exit_codes_are_the_control_probes_tri_state():
    assert watch.resolve_exit([_outcome(watch.CLEAN)], [], True) == watch.EXIT_CLEAN
    assert watch.resolve_exit([_outcome(watch.HOLD)], [], True) == watch.EXIT_HOLD
    assert watch.resolve_exit([_outcome(watch.FINDING)], [], True) == watch.EXIT_FINDING
    # A finding outranks a hold: it is the louder fact and it is already on the
    # alert sink. The hold still shows in the report.
    assert (
        watch.resolve_exit([_outcome(watch.FINDING), _outcome(watch.HOLD)], [], True)
        == watch.EXIT_FINDING
    )
    # An unlocked archive prefix reddens an otherwise clean run. An off-box copy
    # anyone can delete is a backup, not a record.
    assert watch.resolve_exit([_outcome(watch.CLEAN)], [], False) == watch.EXIT_HOLD
    # So does a finding that could not be written to the sink.
    assert watch.resolve_exit([_outcome(watch.CLEAN)], ["could not write"], True) == watch.EXIT_HOLD


def test_zero_seats_is_a_hold(monkeypatch, tmp_path):
    """A run that measured nothing must never exit 0.

    This is the send-reconciler shape: the job was green for weeks while
    scanning an empty set.
    """
    monkeypatch.setattr(watch, "_REPO", tmp_path)
    assert watch.main([]) == watch.EXIT_HOLD


def test_authored_seats_skips_template_dirs(tmp_path):
    base = tmp_path / "operator" / "customers"
    for name in ("_template", "_hosted-template", "real-seat", "no-yaml"):
        (base / name).mkdir(parents=True)
    for name in ("_template", "real-seat"):
        (base / name / "customer.yaml").write_text("slug: x\n")
    assert watch.authored_seats(tmp_path) == ["real-seat"]
