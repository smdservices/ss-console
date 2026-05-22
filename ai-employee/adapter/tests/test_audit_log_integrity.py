"""Tests for ai-employee/adapter/audit_log_integrity.py (issue #892).

Exercises the D1 vs Logpush mirror integrity comparison against
fake in-memory loaders.

Run from repo root:

    cd ai-employee && python -m pytest adapter/tests/test_audit_log_integrity.py -v
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import AsyncIterator

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))  # ai-employee/ on sys.path

from adapter.audit_log_integrity import (  # noqa: E402
    AuditRow,
    FindingKind,
    IntegrityReport,
    check_audit_integrity,
)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _row(
    id: str,
    ts: str,
    *,
    action_type: str = "DRAFT_CREATED",
    actor: str = "agent",
    actor_role: str = "agent",
    skill_name: str = "inbox-triage",
    matter_ref: str = "matter-123",
    input_digest: str = "abc",
    output_digest: str = "def",
    diff_digest: str = None,
    trust_ceiling: str = "draft_for_review",
    metadata: str = '{"k":1}',
) -> AuditRow:
    return AuditRow(
        id=id,
        ts=ts,
        action_type=action_type,
        actor=actor,
        actor_role=actor_role,
        skill_name=skill_name,
        matter_ref=matter_ref,
        input_digest=input_digest,
        output_digest=output_digest,
        diff_digest=diff_digest,
        trust_ceiling=trust_ceiling,
        metadata=metadata,
    )


class _FakeLoader:
    """Test loader yielding a fixed list of rows."""

    def __init__(self, rows: list[AuditRow]) -> None:
        self._rows = rows

    def load(self, start_ts: str, end_ts: str) -> AsyncIterator[AuditRow]:  # noqa: ARG002
        rows = self._rows

        async def _gen():
            for r in rows:
                yield r

        return _gen()


class _BrokenLoader:
    """Loader whose `load()` raises on iteration."""

    def __init__(self, exc: Exception) -> None:
        self._exc = exc

    def load(self, start_ts: str, end_ts: str):  # noqa: ARG002
        exc = self._exc

        async def _gen():
            raise exc
            yield  # pragma: no cover

        return _gen()


# Fixed reference timestamp used across tests (well outside the 5-min
# mirror-lag grace window so "old" rows don't accidentally get the grace).
_NOW = datetime(2026, 5, 21, 12, 0, 0, tzinfo=timezone.utc)
_NOW_TS = "2026-05-21T12:00:00.000Z"
_OLD_TS = "2026-05-20T12:00:00.000Z"  # 24h before _NOW


# ---------------------------------------------------------------------------
# Clean path
# ---------------------------------------------------------------------------


def test_clean_when_d1_and_mirror_match():
    rows = [_row("01A", _OLD_TS), _row("01B", _OLD_TS)]
    d1 = _FakeLoader(list(rows))
    mirror = _FakeLoader(list(rows))

    report = _run(
        check_audit_integrity(
            d1, mirror, start_ts=_OLD_TS, end_ts=_NOW_TS, now=lambda: _NOW
        )
    )
    assert report.clean is True
    assert report.findings == []
    assert report.d1_rows_checked == 2
    assert report.mirror_rows_checked == 2


def test_clean_when_both_empty():
    report = _run(
        check_audit_integrity(
            _FakeLoader([]),
            _FakeLoader([]),
            start_ts=_OLD_TS,
            end_ts=_NOW_TS,
            now=lambda: _NOW,
        )
    )
    assert report.clean is True
    assert report.d1_rows_checked == 0
    assert report.mirror_rows_checked == 0


# ---------------------------------------------------------------------------
# IN_D1_NOT_IN_MIRROR
# ---------------------------------------------------------------------------


def test_in_d1_not_in_mirror_old_row_is_a_finding():
    d1 = _FakeLoader([_row("01A", _OLD_TS), _row("01B", _OLD_TS)])
    mirror = _FakeLoader([_row("01A", _OLD_TS)])

    report = _run(
        check_audit_integrity(
            d1, mirror, start_ts=_OLD_TS, end_ts=_NOW_TS, now=lambda: _NOW
        )
    )
    assert report.clean is False
    assert len(report.findings) == 1
    finding = report.findings[0]
    assert finding.kind == FindingKind.IN_D1_NOT_IN_MIRROR
    assert finding.row_id == "01B"


def test_in_d1_not_in_mirror_recent_row_within_grace_is_skipped():
    # Row's ts is "now" exactly — well within the 5 minute lag grace
    d1 = _FakeLoader([_row("01A", _NOW_TS)])
    mirror = _FakeLoader([])  # mirror hasn't caught up yet

    report = _run(
        check_audit_integrity(
            d1, mirror, start_ts=_OLD_TS, end_ts=_NOW_TS, now=lambda: _NOW
        )
    )
    # No finding — recent row gets the lag grace
    assert report.clean is True
    assert report.findings == []


def test_in_d1_not_in_mirror_just_outside_grace_is_a_finding():
    # Row is 6 minutes old; the grace window is 5 minutes
    six_min_ago = _NOW - timedelta(minutes=6)
    six_min_ago_ts = six_min_ago.strftime("%Y-%m-%dT%H:%M:%S.") + f"{six_min_ago.microsecond // 1000:03d}Z"
    d1 = _FakeLoader([_row("01A", six_min_ago_ts)])
    mirror = _FakeLoader([])

    report = _run(
        check_audit_integrity(
            d1, mirror, start_ts=_OLD_TS, end_ts=_NOW_TS, now=lambda: _NOW
        )
    )
    assert len(report.findings) == 1
    assert report.findings[0].kind == FindingKind.IN_D1_NOT_IN_MIRROR


def test_in_d1_not_in_mirror_unparseable_ts_does_not_grant_grace():
    d1 = _FakeLoader([_row("01A", "garbage timestamp")])
    mirror = _FakeLoader([])

    report = _run(
        check_audit_integrity(
            d1, mirror, start_ts=_OLD_TS, end_ts=_NOW_TS, now=lambda: _NOW
        )
    )
    # Unparseable ts → no grace → finding surfaces
    assert len(report.findings) == 1
    assert report.findings[0].kind == FindingKind.IN_D1_NOT_IN_MIRROR


# ---------------------------------------------------------------------------
# IN_MIRROR_NOT_IN_D1
# ---------------------------------------------------------------------------


def test_in_mirror_not_in_d1_always_a_finding():
    # The substrate's load-bearing case: D1 row disappeared but the
    # mirror has it. Either an immutability violation OR a Captain
    # legal-hold redaction. The check surfaces it either way.
    d1 = _FakeLoader([])
    mirror = _FakeLoader([_row("01A", _OLD_TS)])

    report = _run(
        check_audit_integrity(
            d1, mirror, start_ts=_OLD_TS, end_ts=_NOW_TS, now=lambda: _NOW
        )
    )
    assert len(report.findings) == 1
    assert report.findings[0].kind == FindingKind.IN_MIRROR_NOT_IN_D1
    assert report.findings[0].row_id == "01A"


# ---------------------------------------------------------------------------
# DIGEST_MISMATCH
# ---------------------------------------------------------------------------


def test_digest_mismatch_when_load_bearing_column_differs():
    d1_row = _row("01A", _OLD_TS, input_digest="aaa")
    mirror_row = _row("01A", _OLD_TS, input_digest="bbb")  # different!
    d1 = _FakeLoader([d1_row])
    mirror = _FakeLoader([mirror_row])

    report = _run(
        check_audit_integrity(
            d1, mirror, start_ts=_OLD_TS, end_ts=_NOW_TS, now=lambda: _NOW
        )
    )
    assert len(report.findings) == 1
    assert report.findings[0].kind == FindingKind.DIGEST_MISMATCH
    assert report.findings[0].row_id == "01A"


def test_metadata_alone_does_not_drive_a_mismatch():
    # Metadata is excluded from compare_key on purpose (see module
    # docstring). Drift in metadata alone is NOT a finding.
    d1_row = _row("01A", _OLD_TS, metadata='{"k":1}')
    mirror_row = _row("01A", _OLD_TS, metadata='{"k":2}')
    d1 = _FakeLoader([d1_row])
    mirror = _FakeLoader([mirror_row])

    report = _run(
        check_audit_integrity(
            d1, mirror, start_ts=_OLD_TS, end_ts=_NOW_TS, now=lambda: _NOW
        )
    )
    assert report.findings == []
    assert report.clean is True


# ---------------------------------------------------------------------------
# Multi-finding
# ---------------------------------------------------------------------------


def test_report_collects_multiple_finding_kinds():
    d1 = _FakeLoader(
        [
            _row("01A", _OLD_TS),  # match
            _row("01B", _OLD_TS),  # only-in-d1
            _row("01C", _OLD_TS, input_digest="aaa"),  # mismatch
        ]
    )
    mirror = _FakeLoader(
        [
            _row("01A", _OLD_TS),
            _row("01C", _OLD_TS, input_digest="bbb"),  # mismatch
            _row("01D", _OLD_TS),  # only-in-mirror
        ]
    )

    report = _run(
        check_audit_integrity(
            d1, mirror, start_ts=_OLD_TS, end_ts=_NOW_TS, now=lambda: _NOW
        )
    )
    kinds = {f.kind for f in report.findings}
    assert kinds == {
        FindingKind.IN_D1_NOT_IN_MIRROR,
        FindingKind.IN_MIRROR_NOT_IN_D1,
        FindingKind.DIGEST_MISMATCH,
    }
    assert len(report.findings) == 3


# ---------------------------------------------------------------------------
# Loader failures surface, no exception escapes
# ---------------------------------------------------------------------------


def test_loader_failure_surfaces_via_report():
    d1 = _BrokenLoader(RuntimeError("d1 down"))
    mirror = _FakeLoader([])

    report = _run(
        check_audit_integrity(
            d1, mirror, start_ts=_OLD_TS, end_ts=_NOW_TS, now=lambda: _NOW
        )
    )
    assert report.clean is False
    assert report.findings == []
    assert "d1 down" in (report.loader_error or "")


def test_mirror_loader_failure_also_surfaces():
    d1 = _FakeLoader([_row("01A", _OLD_TS)])
    mirror = _BrokenLoader(IOError("r2 timeout"))

    report = _run(
        check_audit_integrity(
            d1, mirror, start_ts=_OLD_TS, end_ts=_NOW_TS, now=lambda: _NOW
        )
    )
    assert report.clean is False
    assert "r2 timeout" in (report.loader_error or "")


# ---------------------------------------------------------------------------
# Report shape
# ---------------------------------------------------------------------------


def test_report_initial_state_is_clean_and_empty():
    report = IntegrityReport()
    assert report.clean is True
    assert report.findings == []
    assert report.d1_rows_checked == 0
    assert report.mirror_rows_checked == 0
    assert report.loader_error is None
