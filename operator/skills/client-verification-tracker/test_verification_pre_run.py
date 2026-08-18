"""Tests for client-verification-tracker/pre_run.py (WP-B, #1889).

Exercises the bespoke cadence/ceiling gate that graduated this skill off the
shared empty-seat template: cadence suppression, ceiling wake-once + handed_off
terminal, unauthored-config single surface, ledger-unreadable fire-open, the
nudge numerator, and the per-skill settings config read. Fake source + fake
executor; no network, no OAuth, no D1.

Mirrors `deadline-miss-escalator/test_escalator_pre_run.py` — same harness,
adapted for chase cadence instead of deadline proximity.

Run from repo root:

    cd operator && python -m pytest \\
        skills/client-verification-tracker/test_verification_pre_run.py -v
"""

from __future__ import annotations

import asyncio
import importlib.util
import io
import json
import sys
from contextlib import redirect_stdout
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# operator/ on sys.path (for adapter.*). Load this skill's pre_run.py under a
# unique module name — every Stream B skill names the file pre_run.py, so a bare
# import would collide across skills.
_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))

from adapter.audit_log import AuditLogWriter, SuppressedWakeWriter  # noqa: E402

_PRE_RUN_PATH = _HERE.parent / "pre_run.py"
_spec = importlib.util.spec_from_file_location("cvt_pre_run", _PRE_RUN_PATH)
assert _spec is not None and _spec.loader is not None
_pre_run = importlib.util.module_from_spec(_spec)
sys.modules["cvt_pre_run"] = _pre_run
_spec.loader.exec_module(_pre_run)

ChaseConfig = _pre_run.ChaseConfig
VerificationItem = _pre_run.VerificationItem
decide = _pre_run.decide
run_once = _pre_run.run_once
load_chase_config = _pre_run.load_chase_config
parse_pull = _pre_run.parse_pull
ACTION_CHASE = _pre_run.ACTION_CHASE
ACTION_HANDOFF = _pre_run.ACTION_HANDOFF
ACTION_SURFACE_CONFIG = _pre_run.ACTION_SURFACE_CONFIG
ACTION_SURFACE_HOLD = _pre_run.ACTION_SURFACE_HOLD
hold_source_id = _pre_run.hold_source_id

# The vendored ledger module the skill loads at runtime — used here to mint real
# events so the tests exercise the true item_key/state join.
_LEDGER_PATH = _HERE.parent / "escalation_ledger.py"
_lspec = importlib.util.spec_from_file_location("cvt_ledger_test", _LEDGER_PATH)
_ledger = importlib.util.module_from_spec(_lspec)
sys.modules["cvt_ledger_test"] = _ledger
_lspec.loader.exec_module(_ledger)


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeSource:
    def __init__(self, items):
        self._items = items

    def pull_open_verifications(self):
        return self._items


class FakeExecutor:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[tuple[str, list]] = []

    async def execute(self, sql: str, params: list) -> None:
        self.calls.append((sql, params))
        if self.fail:
            raise RuntimeError("D1 unreachable")


TODAY = date(2026, 7, 14)
NOW = datetime(2026, 7, 14, 8, 0, tzinfo=timezone.utc)
_CFG = ChaseConfig(chase_cadence_days=5, escalate_after_attempts=3)
_REFIRE = 3


def _item(
    *,
    matter_id: str = "m-1",
    task_id: str | None = "task-1",
    authored_date: date | None = None,  # mirrors production: identity is task_id, not a moving date
    next_chase_due: date | None = None,
    label: str = "client-verification",
) -> VerificationItem:
    return VerificationItem(
        matter_id=matter_id,
        task_id=task_id,
        authored_date=authored_date,
        next_chase_due=next_chase_due or TODAY,
        label=label,
    )


def _chased_event(item, *, ts, attempt):
    key = _ledger.item_key(item.matter_id, item.task_id, item.label, item.authored_date)
    return _ledger.make_event(
        skill="client-verification-tracker",
        matter_id=item.matter_id,
        item_key=key,
        event="chased",
        attempt=attempt,
        token=_ledger.token_for(key),
        ts=ts,
    )


def _handed_off_event(item, *, ts, attempt):
    key = _ledger.item_key(item.matter_id, item.task_id, item.label, item.authored_date)
    return _ledger.make_event(
        skill="client-verification-tracker",
        matter_id=item.matter_id,
        item_key=key,
        event="handed_off",
        attempt=attempt,
        ts=ts,
    )


def _resolved_event(item, *, ts):
    key = _ledger.item_key(item.matter_id, item.task_id, item.label, item.authored_date)
    return _ledger.make_event(
        skill="client-verification-tracker",
        matter_id=item.matter_id,
        item_key=key,
        event="resolved",
        attempt=0,
        ts=ts,
    )


def _decide(items, events, *, config=_CFG, today=TODAY):
    return decide(
        items,
        config,
        _ledger,
        events,
        raw_inputs_for_digest=b"x",
        today=today,
        refire_days=_REFIRE,
    )


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _capture_stdout(coro) -> tuple[int, str]:
    buf = io.StringIO()
    with redirect_stdout(buf):
        code = _run(coro)
    return code, buf.getvalue().strip()


# ---------------------------------------------------------------------------
# decide() — cadence (condition a)
# ---------------------------------------------------------------------------


def test_new_item_first_chase_due_when_task_date_arrived():
    # No prior chase; the tracking task's authored due date is today → chase due.
    d = _decide([_item(next_chase_due=TODAY)], [])
    assert d.wake is True
    assert d.plans[0].action == ACTION_CHASE
    assert d.plans[0].attempt == 1  # first nudge


def test_new_item_first_chase_not_due_before_task_date():
    d = _decide([_item(next_chase_due=TODAY + timedelta(days=2))], [])
    assert d.wake is False
    assert d.decision_basis == "no_verification_action_due"


def test_chase_suppressed_within_cadence_window():
    # Chased 2 days ago, cadence 5 → not due yet.
    item = _item()
    events = [_chased_event(item, ts="2026-07-12T09:00:00.000Z", attempt=1)]
    d = _decide([item], events)
    assert d.wake is False


def test_chase_refires_after_cadence_window():
    # Chased 5 days ago, cadence 5 → due again.
    item = _item()
    events = [_chased_event(item, ts="2026-07-09T09:00:00.000Z", attempt=1)]
    d = _decide([item], events)
    assert d.wake is True
    assert d.plans[0].action == ACTION_CHASE
    assert d.plans[0].attempt == 2  # nudge 2 of 3


def test_nudge_numerator_counts_prior_chases():
    # Two prior chases, last one 6 days ago → the next chase is nudge 3 of 3.
    item = _item()
    events = [
        _chased_event(item, ts="2026-07-02T09:00:00.000Z", attempt=1),
        _chased_event(item, ts="2026-07-08T09:00:00.000Z", attempt=2),
    ]
    d = _decide([item], events)
    assert d.wake is True
    assert d.plans[0].attempt == 3
    assert d.extra_metadata["items"][0]["ceiling"] == 3


# ---------------------------------------------------------------------------
# decide() — attempt ceiling (condition b)
# ---------------------------------------------------------------------------


def test_ceiling_reached_wakes_once_to_hand_off():
    # Three chases (= ceiling) unanswered → stop chasing, hand off.
    item = _item()
    events = [
        _chased_event(item, ts="2026-07-02T09:00:00.000Z", attempt=1),
        _chased_event(item, ts="2026-07-07T09:00:00.000Z", attempt=2),
        _chased_event(item, ts="2026-07-12T09:00:00.000Z", attempt=3),
    ]
    d = _decide([item], events)
    assert d.wake is True
    assert d.plans[0].action == ACTION_HANDOFF
    assert d.extra_metadata["handoff_due"] == 1
    assert d.extra_metadata["chase_due"] == 0


def test_handed_off_is_terminal_and_suppresses():
    # Ceiling reached AND already handed off → quiet (a person owns it now).
    item = _item()
    events = [
        _chased_event(item, ts="2026-07-02T09:00:00.000Z", attempt=1),
        _chased_event(item, ts="2026-07-07T09:00:00.000Z", attempt=2),
        _chased_event(item, ts="2026-07-12T09:00:00.000Z", attempt=3),
        _handed_off_event(item, ts="2026-07-12T09:05:00.000Z", attempt=3),
    ]
    d = _decide([item], events)
    assert d.wake is False


def test_resolved_is_terminal_and_suppresses():
    item = _item()
    events = [
        _chased_event(item, ts="2026-07-09T09:00:00.000Z", attempt=1),
        _resolved_event(item, ts="2026-07-11T09:00:00.000Z"),
    ]
    d = _decide([item], events)
    assert d.wake is False


# ---------------------------------------------------------------------------
# decide() — unauthored config (condition c): surface, hold, re-fire until
# authored (#1899). Never daily, never once-ever.
# ---------------------------------------------------------------------------


def _config_sentinel_fired(*, ts="2026-07-10T09:00:00.000Z", attempt=1):
    key = _ledger.item_key("", "__chase_config__", "chase-config-missing", "")
    return _ledger.make_event(
        skill="client-verification-tracker",
        matter_id=None,
        item_key=key,
        event="fired",
        attempt=attempt,
        ts=ts,
    )


def test_unauthored_config_surfaces():
    # Cadence missing → surface, no chase of the open item.
    d = _decide([_item(next_chase_due=TODAY)], [], config=ChaseConfig(escalate_after_attempts=3))
    assert d.wake is True
    assert d.plans[0].action == ACTION_SURFACE_CONFIG
    assert d.plans[0].attempt == 1  # first surface
    assert "chase_cadence_days" in d.extra_metadata["missing"]


def test_unauthored_config_quiet_within_refire_window():
    # Surfaced 2 days ago, refire window 3 → hold quiet, do not re-surface yet.
    d = _decide(
        [_item(next_chase_due=TODAY)],
        [_config_sentinel_fired(ts="2026-07-12T09:00:00.000Z")],
        config=ChaseConfig(chase_cadence_days=5),  # ceiling missing
    )
    assert d.wake is False
    assert d.decision_basis == "chase_config_unauthored_within_refire_window"


def test_unauthored_config_resurfaces_after_refire_window():
    # Surfaced 4 days ago, refire window 3, dials still unauthored → re-surface
    # (#1899: a held chase must not go permanently dark on one missed notice).
    d = _decide(
        [_item(next_chase_due=TODAY)],
        [_config_sentinel_fired(ts="2026-07-10T09:00:00.000Z")],
        config=ChaseConfig(chase_cadence_days=5),  # ceiling missing
    )
    assert d.wake is True
    assert d.plans[0].action == ACTION_SURFACE_CONFIG
    assert d.plans[0].attempt == 2  # second surface, numbered from the ledger


def test_unauthored_config_ack_snoozes_the_surface():
    # Staff acked the config notice yesterday → snoozed (ack window = refire
    # window), not re-fired, and still no chase.
    key = _ledger.item_key("", "__chase_config__", "chase-config-missing", "")
    events = [
        _config_sentinel_fired(ts="2026-07-10T09:00:00.000Z"),
        _ledger.make_event(
            skill="client-verification-tracker",
            matter_id=None,
            item_key=key,
            event="acked",
            attempt=1,
            ts="2026-07-13T09:00:00.000Z",
        ),
    ]
    d = _decide([_item(next_chase_due=TODAY)], events, config=ChaseConfig())
    assert d.wake is False
    assert d.decision_basis == "chase_config_unauthored_within_refire_window"


def test_unauthored_config_never_chases():
    # Even with an item long overdue for a chase, unauthored config holds.
    item = _item(next_chase_due=TODAY - timedelta(days=30))
    d = _decide([item], [], config=ChaseConfig())
    assert d.plans[0].action == ACTION_SURFACE_CONFIG  # never ACTION_CHASE


# ---------------------------------------------------------------------------
# decide() — per-item hold (condition d, ss #2402): an open hold blocks chase
# AND hand-off; it re-surfaces on the re-fire window; only a resolved hold
# releases the chase. Founding case: signer unresolved (2026-08-11 the turn
# surfaced the hold in an email only, and the 2026-08-14 wake planned a chase
# to the unconfirmed signer).
# ---------------------------------------------------------------------------


def _hold_event(item, *, event="fired", ts, attempt=1):
    key = _ledger.item_key(
        item.matter_id, hold_source_id(item.task_id), "chase-hold", None
    )
    return _ledger.make_event(
        skill="client-verification-tracker",
        matter_id=item.matter_id,
        item_key=key,
        event=event,
        attempt=attempt,
        ts=ts,
    )


def test_hold_blocks_a_due_chase_and_resurfaces():
    # Chase long overdue, but a hold fired 4 days ago (refire window 3) →
    # the plan is a re-surface of the hold, never a chase.
    item = _item(next_chase_due=TODAY - timedelta(days=30))
    events = [_hold_event(item, ts="2026-07-10T09:00:00.000Z")]
    d = _decide([item], events)
    assert d.wake is True
    assert [p.action for p in d.plans] == [ACTION_SURFACE_HOLD]
    assert d.plans[0].attempt == 2  # second surface, numbered from the ledger
    assert d.extra_metadata["hold_surface_due"] == 1


def test_hold_quiet_within_refire_window_still_blocks_chase():
    # Hold surfaced yesterday → nothing re-fires, and the due chase stays blocked.
    item = _item(next_chase_due=TODAY - timedelta(days=30))
    events = [_hold_event(item, ts="2026-07-13T09:00:00.000Z")]
    d = _decide([item], events)
    assert d.wake is False
    assert d.decision_basis == "no_verification_action_due"


def test_acked_hold_snoozes_the_surface_but_still_blocks():
    # Ack means "a person saw it", not "the signer is confirmed" → no chase.
    item = _item(next_chase_due=TODAY - timedelta(days=30))
    events = [
        _hold_event(item, ts="2026-07-08T09:00:00.000Z"),
        _hold_event(item, event="acked", ts="2026-07-13T09:00:00.000Z"),
    ]
    d = _decide([item], events)
    assert d.wake is False


def test_resolved_hold_releases_the_chase():
    # The falsifier (Law 12): same item, hold resolved → the chase plans again.
    item = _item(next_chase_due=TODAY - timedelta(days=30))
    events = [
        _hold_event(item, ts="2026-07-08T09:00:00.000Z"),
        _hold_event(item, event="resolved", ts="2026-07-12T09:00:00.000Z"),
    ]
    d = _decide([item], events)
    assert d.wake is True
    assert [p.action for p in d.plans] == [ACTION_CHASE]


def test_handed_off_hold_blocks_and_goes_quiet():
    # A hold handed to a person: no chase, and no autonomous re-surface either.
    item = _item(next_chase_due=TODAY - timedelta(days=30))
    events = [
        _hold_event(item, ts="2026-07-01T09:00:00.000Z"),
        _hold_event(item, event="handed_off", ts="2026-07-02T09:00:00.000Z"),
    ]
    d = _decide([item], events)
    assert d.wake is False


def test_hold_blocks_the_ceiling_handoff_too():
    # Attempts at ceiling AND a hold → the ambiguity precedes the count: no
    # hand-off plan while the hold is open, only the hold surface.
    item = _item(next_chase_due=TODAY - timedelta(days=30))
    events = [
        _chased_event(item, ts="2026-06-20T09:00:00.000Z", attempt=1),
        _chased_event(item, ts="2026-06-25T09:00:00.000Z", attempt=2),
        _chased_event(item, ts="2026-06-30T09:00:00.000Z", attempt=3),
        _hold_event(item, ts="2026-07-10T09:00:00.000Z"),
    ]
    d = _decide([item], events)
    assert d.wake is True
    assert [p.action for p in d.plans] == [ACTION_SURFACE_HOLD]


def test_hold_on_one_item_does_not_block_another():
    held = _item(matter_id="m-1", task_id="task-1", next_chase_due=TODAY - timedelta(days=30))
    free = _item(matter_id="m-2", task_id="task-2", next_chase_due=TODAY)
    events = [_hold_event(held, ts="2026-07-13T09:00:00.000Z")]
    d = _decide([held, free], events)
    assert d.wake is True
    assert {(p.matter_id, p.action) for p in d.plans} == {("m-2", ACTION_CHASE)}


# ---------------------------------------------------------------------------
# run_once() — integration + fail-open
# ---------------------------------------------------------------------------


def _factory(executor):
    def factory():
        return SuppressedWakeWriter(AuditLogWriter(executor))

    return factory


def test_run_once_wakes_on_chase_due():
    item = _item(next_chase_due=TODAY)
    executor = FakeExecutor()
    code, out = _capture_stdout(
        run_once(
            [FakeSource([item])],
            _factory(executor),
            today=TODAY,
            now=NOW,
            config=_CFG,
            refire_days=_REFIRE,
            ledger_module=_ledger,
            ledger_events=[],
        )
    )
    assert code == 0
    # The wake line carries the gate's plans — the woken turn's work list
    # (#2226): a bare wakeAgent flag left the agent to re-derive targeting it
    # structurally cannot (a NEW item has no ledger state to scan from).
    parsed = json.loads(out)
    assert parsed["wakeAgent"] is True
    assert parsed["decision_basis"] == "verification_action_due"
    key = _ledger.item_key(item.matter_id, item.task_id, item.label, item.authored_date)
    assert parsed["plans"] == [
        {
            "matter_id": "m-1",
            "task_id": "task-1",
            "item_key": key,
            "action": "chase",
            "attempt": 1,
        }
    ]
    # The wake leaves a row too (#2253). Before this, the gate logged why it did
    # NOT act and logged nothing when it did, so the one tick that mattered was
    # the one tick the ledger could not show.
    assert len(executor.calls) == 1
    _, params = executor.calls[0]
    assert params[2] == "EMITTED_WAKE"
    assert params[5] == "client-verification-tracker"
    metadata = json.loads(params[11])
    assert metadata["decision_basis"] == "verification_action_due"
    assert metadata["plans_total"] == 1
    # This gate serializes the whole plan list (no cap), so it does NOT claim an
    # emitted/truncated split — a constant dressed as a measurement is a check
    # that cannot fail.
    assert "plans_emitted" not in metadata
    assert "plans_truncated" not in metadata


def test_run_once_wake_is_unchanged_when_the_emitted_wake_write_fails():
    """The inverted contract: a failed audit write must not touch the wake.

    On the suppress path an audit failure escalates to a wake, because a silent
    suppress is indistinguishable from a broken gate. Here the wake is already
    the decision, so the row is observability and never a gate.
    """
    item = _item()
    executor = FakeExecutor(fail=True)
    code, out = _capture_stdout(
        run_once(
            [FakeSource([item])],
            _factory(executor),
            today=TODAY,
            now=NOW,
            config=_CFG,
            refire_days=_REFIRE,
            ledger_module=_ledger,
            ledger_events=[],
        )
    )
    assert code == 0
    parsed = json.loads(out)
    assert parsed["wakeAgent"] is True
    assert parsed["decision_basis"] == "verification_action_due"
    key = _ledger.item_key(item.matter_id, item.task_id, item.label, item.authored_date)
    assert parsed["plans"] == [
        {
            "matter_id": "m-1",
            "task_id": "task-1",
            "item_key": key,
            "action": "chase",
            "attempt": 1,
        }
    ]
    assert len(executor.calls) == 1  # attempted, failed, swallowed


def test_run_once_wake_survives_a_writer_without_the_emitted_wake_method():
    """A writer object too old to have `write_emitted_wake` must not break a
    wake. The failure mode this closes is a half-deployed image, where the
    gate's own observability would otherwise take the tick down with it."""

    class _LegacyWriter:
        async def write_suppressed_wake(self, **_kwargs) -> str:
            return "x"

    code, out = _capture_stdout(
        run_once(
            [FakeSource([_item()])],
            lambda: _LegacyWriter(),
            today=TODAY,
            now=NOW,
            config=_CFG,
            refire_days=_REFIRE,
            ledger_module=_ledger,
            ledger_events=[],
        )
    )
    assert code == 0
    parsed = json.loads(out)
    assert parsed["wakeAgent"] is True
    assert parsed["decision_basis"] == "verification_action_due"
    assert len(parsed["plans"]) == 1


def test_run_once_suppresses_within_cadence_and_writes_heartbeat():
    item = _item()
    events = [_chased_event(item, ts="2026-07-12T09:00:00.000Z", attempt=1)]
    executor = FakeExecutor()
    code, out = _capture_stdout(
        run_once(
            [FakeSource([item])],
            _factory(executor),
            today=TODAY,
            now=NOW,
            config=_CFG,
            refire_days=_REFIRE,
            ledger_module=_ledger,
            ledger_events=events,
        )
    )
    assert code == 0
    assert json.loads(out) == {"wakeAgent": False}
    assert len(executor.calls) == 1  # the SUPPRESSED_WAKE heartbeat row
    sql, params = executor.calls[0]
    assert sql.startswith("INSERT INTO audit_log")
    assert params[2] == "SUPPRESSED_WAKE"
    assert params[5] == "client-verification-tracker"
    metadata = json.loads(params[11])
    assert metadata["decision_basis"] == "no_verification_action_due"


def test_run_once_fires_open_when_ledger_unavailable(monkeypatch):
    """Fail-open: a chase watcher that goes silent is the dangerous failure, so a
    ledger that cannot be loaded wakes rather than suppresses.

    ``ledger_module=None`` alone does NOT simulate the failure — it makes
    ``run_once`` call ``_load_ledger_module()``, which succeeds against the
    sibling ledger file in this repo. The pre-#2226 bare-flag stdout made the
    two paths indistinguishable, so this test passed while exercising the
    normal wake path. The loader itself must fail.
    """
    monkeypatch.setattr(_pre_run, "_load_ledger_module", lambda: None)
    item = _item()
    executor = FakeExecutor()
    code, out = _capture_stdout(
        run_once(
            [FakeSource([item])],
            _factory(executor),
            today=TODAY,
            now=NOW,
            config=_CFG,
            refire_days=_REFIRE,
            ledger_module=None,  # forces the (patched) loader
            ledger_events=None,
        )
    )
    assert code == 0
    # Fail-open wakes carry a basis but NO plans: the agent is told it woke
    # blind so SKILL.md's full-enumeration fallback applies.
    assert json.loads(out) == {
        "wakeAgent": True,
        "decision_basis": "ledger_unavailable_fail_open",
    }
    assert executor.calls == []  # never reached the suppress/heartbeat path


def test_run_once_falls_back_to_wake_on_audit_failure():
    """The dead-man's-switch: a heartbeat write failure forces wake."""
    item = _item()
    events = [_chased_event(item, ts="2026-07-12T09:00:00.000Z", attempt=1)]
    executor = FakeExecutor(fail=True)
    code, out = _capture_stdout(
        run_once(
            [FakeSource([item])],
            _factory(executor),
            today=TODAY,
            now=NOW,
            config=_CFG,
            refire_days=_REFIRE,
            ledger_module=_ledger,
            ledger_events=events,
        )
    )
    assert json.loads(out) == {
        "wakeAgent": True,
        "decision_basis": "suppress_heartbeat_failed_fail_open",
    }
    assert len(executor.calls) == 1  # attempt made before fallback


def test_run_once_falls_back_to_wake_when_no_writer():
    item = _item()
    events = [_chased_event(item, ts="2026-07-12T09:00:00.000Z", attempt=1)]
    code, out = _capture_stdout(
        run_once(
            [FakeSource([item])],
            lambda: None,
            today=TODAY,
            now=NOW,
            config=_CFG,
            refire_days=_REFIRE,
            ledger_module=_ledger,
            ledger_events=events,
        )
    )
    assert json.loads(out) == {
        "wakeAgent": True,
        "decision_basis": "no_audit_writer_fail_open",
    }


def test_run_once_wake_emits_handoff_and_config_plans():
    """Every plan action serializes, not just chase: the ceiling hand-off and
    the config-missing surface reach the agent the same way (#2226)."""
    item = _item()
    events = [
        _chased_event(item, ts="2026-07-01T09:00:00.000Z", attempt=n) for n in (1, 2, 3)
    ]
    executor = FakeExecutor()
    code, out = _capture_stdout(
        run_once(
            [FakeSource([item])],
            _factory(executor),
            today=TODAY,
            now=NOW,
            config=_CFG,
            refire_days=_REFIRE,
            ledger_module=_ledger,
            ledger_events=events,
        )
    )
    assert code == 0
    parsed = json.loads(out)
    assert parsed["wakeAgent"] is True
    assert parsed["decision_basis"] == "verification_action_due"
    assert [p["action"] for p in parsed["plans"]] == ["handoff"]
    assert parsed["plans"][0]["matter_id"] == "m-1"

    unauthored = ChaseConfig(chase_cadence_days=None, escalate_after_attempts=None)
    code, out = _capture_stdout(
        run_once(
            [FakeSource([item])],
            _factory(FakeExecutor()),
            today=TODAY,
            now=NOW,
            config=unauthored,
            refire_days=_REFIRE,
            ledger_module=_ledger,
            ledger_events=[],
        )
    )
    assert code == 0
    parsed = json.loads(out)
    assert parsed["decision_basis"] == "chase_config_unauthored_surface"
    assert [p["action"] for p in parsed["plans"]] == ["surface_config_missing"]


# ---------------------------------------------------------------------------
# parse_pull — the production Smokeball pull parser
# ---------------------------------------------------------------------------


def test_parse_pull_reads_nested_matter_link_object():
    # The live Smokeball /tasks payload nests the matter as a link object —
    # the flat-key miss put "unknown-matter" into every item identity and
    # forked the ledger join (WP-D probe find, ss #1915).
    raw = {
        "tasks": {
            "items": [
                {
                    "id": "t-1",
                    "matter": {"id": "m-real", "href": "https://api/matters/m-real"},
                    "subject": "Client verification outstanding",
                    "dueDate": "2026-07-20",
                }
            ]
        }
    }
    items, problem = parse_pull(raw, today=TODAY)
    assert problem is None
    assert items[0].matter_id == "m-real"


def test_parse_pull_filters_to_verification_tasks():
    raw = {
        "tasks": {
            "items": [
                {"matterId": "m-1", "id": "t-1", "subject": "Verification chase: Reyes FROG", "dueDate": "2026-07-20"},
                {"matterId": "m-1", "id": "t-2", "subject": "File the motion", "dueDate": "2026-07-18"},
            ]
        }
    }
    items, problem = parse_pull(raw, today=TODAY)
    assert problem is None
    assert [i.task_id for i in items] == ["t-1"]  # only the verification task
    assert items[0].next_chase_due == date(2026, 7, 20)


def test_parse_pull_dateless_verification_seeds_first_chase_today():
    raw = {"tasks": {"items": [{"matterId": "m-1", "id": "t-1", "subject": "verification tracking"}]}}
    items, problem = parse_pull(raw, today=TODAY)
    assert problem is None
    assert items[0].next_chase_due == TODAY


def test_parse_pull_error_key_is_a_problem():
    raw = {"tasks": {"items": []}, "tasksError": "boom"}
    items, problem = parse_pull(raw, today=TODAY)
    assert items == [] and problem is not None


def test_parse_pull_unrecognized_envelope_is_a_problem():
    items, problem = parse_pull({"tasks": {"weird": 1}}, today=TODAY)
    assert items == [] and problem is not None


def test_parse_pull_empty_is_clean():
    items, problem = parse_pull({"tasks": {"items": []}}, today=TODAY)
    assert items == [] and problem is None


def test_parse_pull_idless_verification_has_no_task_id():
    raw = {"tasks": {"items": [{"matterId": "m-1", "subject": "verification", "dueDate": "2026-07-20"}]}}
    items, problem = parse_pull(raw, today=TODAY)
    assert problem is None
    assert items[0].task_id is None


# ---------------------------------------------------------------------------
# load_chase_config — per-skill settings block, fail-closed on absence
# ---------------------------------------------------------------------------

_YAML = """\
personas:
  - slug: operator
    skills:
      - name: matter-inbox-router
      - name: client-verification-tracker
        settings:
          chase_cadence_days: 5
          escalate_after_attempts: 3
escalation:
  refire_days: 4
"""


def test_load_chase_config_reads_per_skill_settings(tmp_path, monkeypatch):
    cfg = tmp_path / "customer.yaml"
    cfg.write_text(_YAML, encoding="utf-8")
    monkeypatch.setenv("SMD_CUSTOMER_YAML_PATH", str(cfg))
    config, refire = load_chase_config()
    assert config.chase_cadence_days == 5
    assert config.escalate_after_attempts == 3
    assert config.authored is True
    assert refire == 4


def test_load_chase_config_unauthored_when_settings_absent(tmp_path, monkeypatch):
    cfg = tmp_path / "customer.yaml"
    cfg.write_text(
        "personas:\n  - slug: operator\n    skills:\n      - name: client-verification-tracker\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("SMD_CUSTOMER_YAML_PATH", str(cfg))
    config, refire = load_chase_config()
    assert config.authored is False  # fail-closed hold, not a default
    assert refire == _pre_run._DEFAULT_REFIRE_DAYS


def test_load_chase_config_unauthored_on_missing_file(monkeypatch):
    monkeypatch.delenv("SMD_CUSTOMER_YAML_PATH", raising=False)
    config, _refire = load_chase_config()
    assert config.authored is False


def test_load_chase_config_unauthored_on_unparseable(tmp_path, monkeypatch):
    bad = tmp_path / "customer.yaml"
    bad.write_text("personas: [this is: not valid: yaml", encoding="utf-8")
    monkeypatch.setenv("SMD_CUSTOMER_YAML_PATH", str(bad))
    config, _refire = load_chase_config()
    assert config.authored is False  # never crash, never silent cadence


def test_load_chase_config_rejects_nonpositive(tmp_path, monkeypatch):
    cfg = tmp_path / "customer.yaml"
    cfg.write_text(
        "personas:\n  - slug: operator\n    skills:\n"
        "      - name: client-verification-tracker\n"
        "        settings:\n          chase_cadence_days: 0\n"
        "          escalate_after_attempts: -1\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("SMD_CUSTOMER_YAML_PATH", str(cfg))
    config, _refire = load_chase_config()
    assert config.chase_cadence_days is None
    assert config.escalate_after_attempts is None
