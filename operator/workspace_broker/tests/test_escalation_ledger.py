"""Unit tests for the shared escalation_ledger module (WP-A / WP-B).

Covers item identity + token derivation, corrupt-line handling, state
derivation, the fire policy (fire-once / re-fire window / ack-snooze /
terminal), and validate_append's acked-needs-prior-raise rule.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from workspace_broker import escalation_ledger as el


# ---------------------------------------------------------------------------
# item_key + token
# ---------------------------------------------------------------------------


def test_item_key_stable_and_source_id_disambiguates() -> None:
    a = el.item_key("m-1", "task-1", "filing-deadline", date(2026, 7, 20))
    b = el.item_key("m-1", "task-1", "filing-deadline", "2026-07-20")
    assert a == b  # date and iso-string agree
    # Two same-day tasks on ONE matter differ only by source id — the
    # anti-collision guarantee the plan calls out.
    c = el.item_key("m-1", "task-2", "filing-deadline", date(2026, 7, 20))
    assert a != c


def test_item_key_ignores_label() -> None:
    """ss #2151 guard. ``label`` is model-composed free text and MUST NOT reach
    the hash. Putting it back re-breaks the ledger join."""
    base = el.item_key("m-1", "task-1", "task-deadline", date(2026, 7, 20))
    assert base == el.item_key("m-1", "task-1", "settlement-offer-lapsed", date(2026, 7, 20))
    assert base == el.item_key("m-1", "task-1", "", date(2026, 7, 20))
    assert base == el.item_key("m-1", "task-1", None, date(2026, 7, 20))


def test_pre_run_and_agent_labels_agree_on_one_task() -> None:
    """The live defect, reproduced. ``pre_run`` assigns a closed-set label; the
    agent's turn invents a descriptor. Before ss #2151 these hashed the SAME
    Smokeball task to different keys, so nothing ever joined: on the pilot, 160
    events produced 128 item states and none matched an open task. Fire-once and
    the seven-day ack snooze were both inert."""
    pre_run_side = el.item_key("m-7", "task-42", "task-deadline", date(2026, 8, 11))
    agent_side = el.item_key("m-7", "task-42", "rfa-confirm-service-date", date(2026, 8, 11))
    assert pre_run_side == agent_side
    assert el.token_for(pre_run_side) == el.token_for(agent_side)


def test_item_key_still_discriminates_on_stable_fields() -> None:
    """Dropping label must not collapse genuinely distinct items."""
    base = el.item_key("m-1", "task-1", "task-deadline", date(2026, 7, 20))
    assert base != el.item_key("m-2", "task-1", "task-deadline", date(2026, 7, 20))
    assert base != el.item_key("m-1", "task-2", "task-deadline", date(2026, 7, 20))
    assert base != el.item_key("m-1", "task-1", "task-deadline", date(2026, 7, 21))


def test_has_stable_identity() -> None:
    assert el.has_stable_identity("task-9") is True
    assert el.has_stable_identity("") is False
    assert el.has_stable_identity(None) is False
    assert el.has_stable_identity("unknown-matter") is False


def test_token_is_deterministic_and_typable() -> None:
    key = el.item_key("m-1", "task-1", "filing-deadline", date(2026, 7, 20))
    t1 = el.token_for(key)
    t2 = el.token_for(key)
    assert t1 == t2
    assert t1.startswith("ACK-") and len(t1) == 10
    body = t1[4:]
    assert all(ch in el._CROCKFORD for ch in body)  # no ambiguous I/L/O/U


# ---------------------------------------------------------------------------
# read_ledger — corrupt lines skipped (fail-noisy)
# ---------------------------------------------------------------------------


def test_read_ledger_missing_file_is_empty(tmp_path: Path) -> None:
    assert el.read_ledger(str(tmp_path / "nope.jsonl")) == []


def test_read_ledger_skips_corrupt_and_blank_lines(tmp_path: Path) -> None:
    path = tmp_path / "ledger.jsonl"
    good = el.serialize_event(
        el.make_event(
            skill="deadline-miss-escalator",
            matter_id="m-1",
            item_key="k1",
            event="fired",
            attempt=1,
            token="ACK-000001",
            ts="2026-07-14T07:00:00.000Z",
        )
    )
    path.write_text(
        good + "\n"
        + "\n"  # blank
        + "{not json\n"  # corrupt
        + '{"v":1,"ts":"x","skill":"s"}\n'  # missing item_key/event -> skipped
        + good + "\n",
        encoding="utf-8",
    )
    events = el.read_ledger(str(path))
    assert len(events) == 2  # two good, three dropped
    assert all(e["event"] == "fired" for e in events)


# ---------------------------------------------------------------------------
# derive_state + should_fire
# ---------------------------------------------------------------------------


def _ev(event, *, key="k1", ts, attempt=1, token="ACK-000001", matter_id="m-1"):
    return el.make_event(
        skill="deadline-miss-escalator",
        matter_id=matter_id,
        item_key=key,
        event=event,
        attempt=attempt,
        token=token,
        ts=ts,
    )


def test_never_raised_fires() -> None:
    assert el.should_fire(None, date(2026, 7, 14), refire_days=3, ack_snooze_days=7) is True
    assert el.next_attempt(None) == 1


def test_fired_within_window_suppresses_then_refires() -> None:
    events = [_ev("fired", ts="2026-07-12T07:00:00.000Z")]
    state = el.derive_state(events)["k1"]
    assert state.attempts == 1
    # 1 day later, refire_days=3 -> still within window -> suppress
    assert el.should_fire(state, date(2026, 7, 13), refire_days=3, ack_snooze_days=7) is False
    # 3 days later -> window elapsed -> re-fire
    assert el.should_fire(state, date(2026, 7, 15), refire_days=3, ack_snooze_days=7) is True
    assert el.next_attempt(state) == 2


def test_acked_snoozes_then_resurfaces() -> None:
    events = [
        _ev("fired", ts="2026-07-10T07:00:00.000Z"),
        _ev("acked", ts="2026-07-10T09:00:00.000Z"),
    ]
    state = el.derive_state(events)["k1"]
    assert state.acked is True
    # within the snooze window -> suppressed
    assert el.should_fire(state, date(2026, 7, 15), refire_days=3, ack_snooze_days=7) is False
    # after ack_snooze_days -> re-surface (ack is a snooze, not a tombstone)
    assert el.should_fire(state, date(2026, 7, 17), refire_days=3, ack_snooze_days=7) is True


def test_refire_after_ack_clears_the_ack() -> None:
    events = [
        _ev("fired", ts="2026-07-10T07:00:00.000Z"),
        _ev("acked", ts="2026-07-10T09:00:00.000Z"),
        _ev("fired", ts="2026-07-17T07:00:00.000Z", attempt=2),
    ]
    state = el.derive_state(events)["k1"]
    assert state.acked is False  # the later raise supersedes the ack
    assert state.attempts == 2


def test_resolved_and_handed_off_are_terminal() -> None:
    resolved = el.derive_state(
        [_ev("fired", ts="2026-07-10T07:00:00.000Z"), _ev("resolved", ts="2026-07-11T07:00:00.000Z")]
    )["k1"]
    assert el.should_fire(resolved, date(2026, 8, 1), refire_days=3, ack_snooze_days=7) is False
    handed = el.derive_state(
        [_ev("fired", ts="2026-07-10T07:00:00.000Z"), _ev("handed_off", ts="2026-07-11T07:00:00.000Z")]
    )["k1"]
    assert el.should_fire(handed, date(2026, 8, 1), refire_days=3, ack_snooze_days=7) is False


def test_derive_state_orders_by_ts_regardless_of_input_order() -> None:
    # ack appears before fire in the list; ts ordering must still put fire first.
    events = [
        _ev("acked", ts="2026-07-10T09:00:00.000Z"),
        _ev("fired", ts="2026-07-10T07:00:00.000Z"),
    ]
    state = el.derive_state(events)["k1"]
    assert state.acked is True  # ack is the latest event
    assert state.attempts == 1


# ---------------------------------------------------------------------------
# validate_append
# ---------------------------------------------------------------------------


def test_validate_append_accepts_fired() -> None:
    el.validate_append([], _ev("fired", ts="2026-07-14T07:00:00.000Z"))


def test_validate_append_rejects_acked_without_raise() -> None:
    with pytest.raises(ValueError):
        el.validate_append([], _ev("acked", ts="2026-07-14T07:00:00.000Z"))


def test_validate_append_matches_ack_by_token() -> None:
    existing = [_ev("fired", ts="2026-07-14T07:00:00.000Z", token="ACK-ABCDEF", key="k9")]
    # same token, different item_key spelling still matches on token
    el.validate_append(existing, _ev("acked", ts="2026-07-14T08:00:00.000Z", token="ACK-ABCDEF", key="k9"))


def test_validate_append_rejects_unknown_event() -> None:
    with pytest.raises(ValueError):
        el.validate_append([], {"event": "boom", "item_key": "k1", "skill": "s", "ts": "x"})


def test_validate_append_requires_item_key_and_skill() -> None:
    with pytest.raises(ValueError):
        el.validate_append([], {"event": "fired", "item_key": "", "skill": "s", "ts": "x"})
    with pytest.raises(ValueError):
        el.validate_append([], {"event": "fired", "item_key": "k1", "skill": "", "ts": "x"})


# ---------------------------------------------------------------------------
# Identity epoch (ss #2151) — a pre-epoch code must not read as acknowledged
# ---------------------------------------------------------------------------


def test_ack_against_pre_epoch_raise_is_refused_by_name() -> None:
    """A human replying with an ACK code from an old alert must be told the code
    is superseded, not quietly told the item was acked. The pre-epoch key names
    nothing live, so accepting it would report a silenced alarm that never rang —
    the same false-report class the identity fix exists to end."""
    stale = _ev("fired", ts="2026-08-11T14:05:18.711Z", token="ACK-8SQ6CJ", key="d6718838f50dfa54")
    stale["v"] = 1
    with pytest.raises(ValueError, match="ss #2151"):
        el.validate_append(
            [stale], _ev("acked", ts="2026-08-12T09:00:00.000Z", token="ACK-8SQ6CJ", key="d6718838f50dfa54")
        )


def test_ack_still_accepted_when_a_current_raise_exists() -> None:
    """The epoch guard must not block a legitimate ack. A pre-epoch row alongside
    a current raise for the same token resolves against the current one."""
    stale = _ev("fired", ts="2026-08-11T14:05:18.711Z", token="ACK-8SQ6CJ", key="k-live")
    stale["v"] = 1
    current = _ev("fired", ts="2026-08-12T14:00:00.000Z", token="ACK-8SQ6CJ", key="k-live")
    el.validate_append([stale, current], _ev("acked", ts="2026-08-12T15:00:00.000Z", token="ACK-8SQ6CJ", key="k-live"))


def test_raise_with_missing_version_is_treated_as_pre_epoch() -> None:
    """Unknown provenance is not evidence of a current key."""
    stale = _ev("fired", ts="2026-08-11T14:05:18.711Z", token="ACK-ZZZZZZ", key="k-unknown")
    stale.pop("v", None)
    with pytest.raises(ValueError, match="ss #2151"):
        el.validate_append(
            [stale], _ev("acked", ts="2026-08-12T09:00:00.000Z", token="ACK-ZZZZZZ", key="k-unknown")
        )


def test_schema_version_is_at_the_identity_epoch() -> None:
    """New events must be written at (or above) the epoch, or every ack they
    later receive would be refused as superseded."""
    assert el.SCHEMA_VERSION >= el.IDENTITY_EPOCH
