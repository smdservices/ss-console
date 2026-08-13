"""Tests for rehearse-card.py.

The guards are the point. This harness sends real mail to a real seat as a real
admin, so the ways it can be WRONG are: speaking as someone the seat does not
trust (which measures the refusal path and reads as a product defect), speaking
a command the card gates on a real-world event, or recording silence as an
answer. Each has a test.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
import yaml

_BIN = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("rehearse_card", _BIN / "rehearse-card.py")
rc = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
sys.modules["rehearse_card"] = rc
_spec.loader.exec_module(rc)


def test_locked_stages_are_skipped() -> None:
    """A locked stage names a real-world unlock (the principal's own drafting
    test). Rehearsing it would assert a readiness the firm has not granted."""
    card = {
        "stages": [
            {"id": "setup", "commands": [{"say": "a"}, {"say": "b"}]},
            {"id": "work", "locked": "unlocked by the firm's own-file test", "commands": [{"say": "c"}]},
        ]
    }
    out = rc.unlocked_commands(card)
    assert [c["say"] for c in out] == ["a", "b"]


def test_unlocked_work_stage_is_included() -> None:
    """The pilot deliberately leaves `work` unlocked — it is where drafting is
    proven before the client's test unlocks it there. A harness that always
    skipped `work` would silently never rehearse the drafting pass."""
    card = {"stages": [{"id": "work", "commands": [{"say": "draft it"}]}]}
    assert [c["say"] for c in rc.unlocked_commands(card)] == ["draft it"]


def test_real_cards_differ_exactly_as_authored() -> None:
    """pilot 18 / ashton-price 17 is a deliberate per-seat divergence, recorded
    in the pilot card's own header. If these ever match, one of them changed."""
    pilot = yaml.safe_load((rc.CUSTOMERS / "pilot-smokeball" / "initiation-card.yaml").read_text())
    ap = yaml.safe_load((rc.CUSTOMERS / "ashton-price" / "initiation-card.yaml").read_text())
    assert len(rc.unlocked_commands(pilot)) == 18
    assert len(rc.unlocked_commands(ap)) == 17


def test_seat_inbox_from_the_authored_connector() -> None:
    cfg = {
        "connectors": {
            "Email": {
                "enabled": True,
                "adapter": "agentmail",
                "webhook_url": "https://hermes-pilot-smokeball.fly.dev/webhooks/agentmail",
            }
        }
    }
    assert rc.seat_inbox(cfg) == "pilot-smokeball@agentmail.to"


def test_seat_with_no_channel_is_refused() -> None:
    """ashton-price today: no Email connector at all. 'Nothing to rehearse' must
    be a loud exit, not an empty transcript that reads like a clean run."""
    with pytest.raises(SystemExit) as e:
        rc.seat_inbox({"connectors": {}})
    assert e.value.code == 2


def test_disabled_connector_is_refused() -> None:
    with pytest.raises(SystemExit):
        rc.seat_inbox({"connectors": {"Email": {"enabled": False, "adapter": "agentmail"}}})


def test_quote_trail_is_stripped() -> None:
    """The transcript must hold the Operator's own words; a quoted trail would
    put the command back in the record as if the seat had said it."""
    body = "Here is my answer.\n\nOn Thu, Aug 13, 2026 at 12:25 AM UTC someone wrote:\n> the original"
    assert rc.strip_quote_trail(body) == "Here is my answer."


def test_quote_trail_stripper_leaves_clean_bodies_alone() -> None:
    assert rc.strip_quote_trail("just an answer") == "just an answer"


@pytest.mark.parametrize("slug", ["pilot-smokeball", "ashton-price"])
def test_real_cards_carry_expected_and_falsifier(slug: str) -> None:
    """The transcript pairs each reply with these two fields so a second reader
    can judge without re-deriving them. A command missing either would produce a
    transcript entry nobody can grade."""
    card = yaml.safe_load((rc.CUSTOMERS / slug / "initiation-card.yaml").read_text())
    for cmd in rc.unlocked_commands(card):
        assert str(cmd.get("expected", "")).strip(), f"{slug}: {cmd.get('say')!r} has no expected"
        assert str(cmd.get("falsifier", "")).strip(), f"{slug}: {cmd.get('say')!r} has no falsifier"


def test_harness_does_not_grade() -> None:
    """Deliberate absence. The first hand rehearsal was scored by the agent that
    wrote the messages and was wrong at least once; an automated grader here
    would industrialise that error. If a `grade`/`verdict` helper ever appears,
    this test should be the argument against it."""
    assert not [n for n in dir(rc) if n.lower() in {"grade", "judge", "verdict", "score"}]
