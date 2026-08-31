"""Tests for the body-verify phase (operator/bin/lib/send_verify.py).

Two failure modes are pinned with equal weight:

* an instrument that grades wrong (a diverged body passing, a skeleton fallback
  read as divergence, one wake laundering a run of dispatches);
* an instrument that LEAKS. Both repos are public, so a client email body must
  never appear in any output this phase produces -- report text, --json, the
  finding fingerprint, anything. The leak tests are structural (the dataclass
  cannot hold a body) AND behavioral (a sentinel body fed through the full
  render/json paths appears nowhere), and the walker that proves the behavioral
  half is itself falsified (a deliberately regressed verdict is caught), because
  a check that cannot fail measures nothing.
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import pytest

_BIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BIN / "lib"))

import send_verify as sv  # noqa: E402 -- path injected above

# The reconciler, spec-loaded the way test_reconcile_sends.py does, to drive the
# integrated render()/--json paths the leak tests must cover.
_spec = importlib.util.spec_from_file_location("reconcile_sends", _BIN / "reconcile-sends.py")
rec = importlib.util.module_from_spec(_spec)
sys.modules["reconcile_sends"] = rec
_spec.loader.exec_module(rec)

CONTRACTS = _BIN.parent / "contracts"

SENTINEL = "CLIENT-BODY-SENTINEL-9f3a"

UTC = timezone.utc


def _ts(minute: int, second: int = 0) -> str:
    return datetime(2026, 8, 30, 9, minute, second, tzinfo=UTC).isoformat()


def _wake_row(skill="deadline-miss-escalator", minute=0, hashes=None, items=None):
    meta = {}
    if hashes is not None:
        meta["body_sha256"] = hashes
    if items is not None:
        meta["items"] = items
    return {
        "id": f"wake-{skill}-{minute}",
        "ts": _ts(minute),
        "action_type": "EMITTED_WAKE",
        "skill_name": skill,
        "metadata": json.dumps(meta),
    }


def _dispatch_row(skill="deadline-miss-escalator", minute=1, sha="", variant="full",
                  outcome="sent", extra=None):
    meta = {"outcome": outcome}
    if sha:
        meta["rendered_body_sha256"] = sha
        meta["body_variant"] = variant
    if extra:
        meta.update(extra)
    return {
        "id": f"disp-{skill}-{minute}",
        "ts": _ts(minute),
        "action_type": "CONFIRM_SEND_DISPATCHED",
        "skill_name": skill,
        "metadata": json.dumps(meta),
    }


def _declares(mode="templated"):
    template = "operator/skills/deadline-miss-escalator/references/output-format.md"
    return {
        "deadline-miss-escalator": sv.RenderDecl(
            skill="deadline-miss-escalator",
            render=mode,
            template=template if mode != "compositional" else None,
        ),
        "medical-records-chaser": sv.RenderDecl(
            skill="medical-records-chaser", render="compositional"
        ),
    }


# ---------------------------------------------------------------------------
# the canon function against the shared arbiter fixture
# ---------------------------------------------------------------------------


def test_canonical_hash_matches_every_shared_vector():
    """The fixture is the arbiter BOTH repos load. An implementation drift here
    fails this suite the same way it fails the overlay's."""
    fixture = json.loads((CONTRACTS / "fixtures" / "body-canon-vectors.json").read_text())
    vectors = fixture["vectors"]
    assert len(vectors) >= 8
    for vector in vectors:
        assert sv.canonical_body_sha256(vector["input"]) == vector["sha256"], vector["name"]


def test_the_required_trailing_newline_vector_exists_and_is_an_equivalence():
    fixture = json.loads((CONTRACTS / "fixtures" / "body-canon-vectors.json").read_text())
    by_name = {v["name"]: v for v in fixture["vectors"]}
    assert "trailing_newline" in by_name
    assert by_name["trailing_newline"]["sha256"] == by_name["plain_two_lines"]["sha256"]
    assert by_name["trailing_newline"]["input"] != by_name["plain_two_lines"]["input"]


# ---------------------------------------------------------------------------
# the committed contract file parses and is in the wave-1 authored state
# ---------------------------------------------------------------------------


def test_the_committed_send_render_contract_loads():
    declares = sv.load_send_render()
    # The cron x derived-outbound join on the authored seats (the arming gate
    # asserts the join itself; here we pin that the committed file names the
    # known-armed set so the verifier and the gate read the same skills).
    for skill in (
        "deadline-miss-escalator",
        "discovery-response-tracker",
        "client-verification-tracker",
        "medical-records-chaser",
        "lien-ledger-tracker",
        "minors-compromise-packet",
        "status-report-assembler",
    ):
        assert skill in declares, f"{skill} missing from send-render.yaml"


def test_a_templated_declaration_without_a_template_refuses(tmp_path):
    bad = tmp_path / "send-render.yaml"
    bad.write_text("schema_version: 1\nskills:\n  x:\n    render: templated\n")
    with pytest.raises(sv.SendRenderError):
        sv.load_send_render(str(bad))


def test_an_unknown_render_mode_refuses(tmp_path):
    bad = tmp_path / "send-render.yaml"
    bad.write_text("schema_version: 1\nskills:\n  x:\n    render: freestyle\n")
    with pytest.raises(sv.SendRenderError):
        sv.load_send_render(str(bad))


# ---------------------------------------------------------------------------
# primary check: the wake <-> dispatch hash join
# ---------------------------------------------------------------------------


def test_matching_hashes_grade_match():
    sha = sv.canonical_body_sha256("Deadline alert body\n")
    wakes = sv.index_wakes([_wake_row(hashes=[{"body_sha256_full": sha}])])
    dispatches = sv.index_dispatches([_dispatch_row(sha=sha)])
    verdicts = sv.verify_hash_join(wakes, dispatches, _declares())
    assert [v.verdict for v in verdicts] == [sv.VERDICT_MATCH]


def test_a_diverged_dispatch_hash_is_the_finding():
    wake_sha = sv.canonical_body_sha256("authored body")
    sent_sha = sv.canonical_body_sha256("recomposed body")
    wakes = sv.index_wakes([_wake_row(hashes=[{"body_sha256_full": wake_sha}])])
    dispatches = sv.index_dispatches([_dispatch_row(sha=sent_sha)])
    verdicts = sv.verify_hash_join(wakes, dispatches, _declares())
    assert [v.verdict for v in verdicts] == [sv.VERDICT_DIVERGED]
    assert verdicts[0].is_finding


def test_a_skeleton_match_grades_degraded_never_diverged():
    full = sv.canonical_body_sha256("full body")
    skeleton = sv.canonical_body_sha256("skeleton body")
    wakes = sv.index_wakes(
        [_wake_row(hashes=[{"body_sha256_full": full, "body_sha256_skeleton": skeleton}])]
    )
    dispatches = sv.index_dispatches([_dispatch_row(sha=skeleton, variant="skeleton")])
    verdicts = sv.verify_hash_join(wakes, dispatches, _declares())
    assert [v.verdict for v in verdicts] == [sv.VERDICT_DEGRADED]
    assert not verdicts[0].is_finding and not verdicts[0].is_hold


def test_a_templated_dispatch_with_no_wake_hash_holds_not_finds():
    """The designed interim state: render cluster not yet deployed to the seat."""
    sha = sv.canonical_body_sha256("body")
    dispatches = sv.index_dispatches([_dispatch_row(sha=sha)])
    verdicts = sv.verify_hash_join([], dispatches, _declares())
    assert [v.verdict for v in verdicts] == [sv.VERDICT_NO_WAKE_HASH]
    assert verdicts[0].is_hold and not verdicts[0].is_finding


def test_a_templated_dispatch_with_no_stamp_holds():
    sha = sv.canonical_body_sha256("body")
    wakes = sv.index_wakes([_wake_row(hashes=[{"body_sha256_full": sha}])])
    dispatches = sv.index_dispatches([_dispatch_row(sha="")])
    verdicts = sv.verify_hash_join(wakes, dispatches, _declares())
    assert [v.verdict for v in verdicts] == [sv.VERDICT_NO_DISPATCH_STAMP]
    assert verdicts[0].is_hold


def test_compositional_skills_are_never_hash_graded():
    sha = sv.canonical_body_sha256("body")
    wakes = sv.index_wakes([_wake_row(skill="medical-records-chaser", hashes=[{"body_sha256_full": sha}])])
    dispatches = sv.index_dispatches(
        [_dispatch_row(skill="medical-records-chaser", sha=sv.canonical_body_sha256("other"))]
    )
    assert sv.verify_hash_join(wakes, dispatches, _declares()) == []


def test_one_wake_cannot_launder_more_dispatches_than_it_stamped():
    """Consumption discipline: a wake with ONE stamped body accounts for ONE
    dispatch; the second dispatch in the window must answer for itself."""
    sha = sv.canonical_body_sha256("body")
    wakes = sv.index_wakes([_wake_row(hashes=[{"body_sha256_full": sha}])])
    dispatches = sv.index_dispatches(
        [_dispatch_row(minute=1, sha=sha), _dispatch_row(minute=2, sha=sha)]
    )
    verdicts = sv.verify_hash_join(wakes, dispatches, _declares())
    assert sorted(v.verdict for v in verdicts) == [sv.VERDICT_MATCH, sv.VERDICT_NO_WAKE_HASH]


def test_a_dispatch_outside_the_window_does_not_join():
    sha = sv.canonical_body_sha256("body")
    wakes = sv.index_wakes([_wake_row(minute=0, hashes=[{"body_sha256_full": sha}])])
    late = {
        "id": "disp-late",
        "ts": datetime(2026, 8, 30, 11, 1, tzinfo=UTC).isoformat(),  # > 3600s later
        "action_type": "CONFIRM_SEND_DISPATCHED",
        "skill_name": "deadline-miss-escalator",
        "metadata": json.dumps({"outcome": "sent", "rendered_body_sha256": sha}),
    }
    verdicts = sv.verify_hash_join(wakes, sv.index_dispatches([late]), _declares())
    assert [v.verdict for v in verdicts] == [sv.VERDICT_NO_WAKE_HASH]


def test_a_refused_dispatch_row_is_not_graded():
    sha = sv.canonical_body_sha256("body")
    rows = [_dispatch_row(sha=sha, outcome="refused")]
    assert sv.index_dispatches(rows) == []


# ---------------------------------------------------------------------------
# secondary check: the channel body fetch
# ---------------------------------------------------------------------------


def _sent_message(minute=1, mid="<m1>"):
    return {"message_id": mid, "timestamp": _ts(minute), "to": ["x@example.invalid"], "subject": "s"}


def test_channel_body_matching_the_wake_hash_grades_match():
    body = "Deadline alert body\n"
    sha = sv.canonical_body_sha256(body)
    wakes = sv.index_wakes([_wake_row(hashes=[{"body_sha256_full": sha}])])
    verdicts = sv.verify_channel_bodies(
        [_sent_message()], wakes, _declares(), lambda m: body
    )
    assert [v.verdict for v in verdicts] == [sv.VERDICT_MATCH]


def test_a_channel_mismatch_is_a_hold_until_rehearsal_calibrates():
    sha = sv.canonical_body_sha256("authored")
    wakes = sv.index_wakes([_wake_row(hashes=[{"body_sha256_full": sha}])])
    verdicts = sv.verify_channel_bodies(
        [_sent_message()], wakes, _declares(), lambda m: "<html>wrapped</html>"
    )
    assert [v.verdict for v in verdicts] == [sv.VERDICT_CHANNEL_MISMATCH]
    assert verdicts[0].is_hold and not verdicts[0].is_finding


def test_a_failed_body_fetch_holds():
    sha = sv.canonical_body_sha256("authored")
    wakes = sv.index_wakes([_wake_row(hashes=[{"body_sha256_full": sha}])])

    def _explode(_message):
        raise RuntimeError("HTTP 503")

    verdicts = sv.verify_channel_bodies([_sent_message()], wakes, _declares(), _explode)
    assert [v.verdict for v in verdicts] == [sv.VERDICT_BODY_UNAVAILABLE]


# ---------------------------------------------------------------------------
# cross-run invariants
# ---------------------------------------------------------------------------


_EMPTY_COMMITTED = {"recipients": {}, "ack_codes": {}}


def test_ack_codes_first_seen_against_empty_committed_are_proposals_not_findings():
    """The cold-start rule (PR #2651 review, finding 2): the day the render
    cluster's stamps land, every legitimate ACK code appears at once, and a
    control that pages on the fleet's first honest day is muted by its second.
    Two DIFFERENT codes for one uncommitted key surface as two proposals the
    invariants-PR reviewer sees side by side -- visible, not paged."""
    wakes = sv.index_wakes(
        [
            _wake_row(minute=0, items=[{"item_key": "matter-1|SOL", "ack_code": "AK7Q"}]),
            _wake_row(minute=30, items=[{"item_key": "matter-1|SOL", "ack_code": "ZZ99"}]),
        ]
    )
    findings, proposals = sv.ack_invariant(wakes, _declares(), _EMPTY_COMMITTED)
    assert findings == []
    assert [(p.rule, p.value) for p in proposals] == [
        ("ack_stability", "AK7Q"),
        ("ack_stability", "ZZ99"),
    ]
    # The raw item_key never appears; only its hash does.
    assert "matter-1" not in json.dumps(sv.as_dicts([], [], proposals)[2])


def test_a_committed_ack_code_that_conflicts_is_the_finding():
    key = sv._item_hash("deadline-miss-escalator", "matter-1|SOL")
    committed = {"recipients": {}, "ack_codes": {key: "AK7Q"}}
    wakes = sv.index_wakes([_wake_row(items=[{"item_key": "matter-1|SOL", "ack_code": "AK7Q"}])])
    assert sv.ack_invariant(wakes, _declares(), committed) == ([], [])
    drifted = sv.index_wakes([_wake_row(items=[{"item_key": "matter-1|SOL", "ack_code": "XX00"}])])
    findings, proposals = sv.ack_invariant(drifted, _declares(), committed)
    assert [(f.rule, f.expected, f.actual) for f in findings] == [
        ("ack_stability", "AK7Q", "XX00")
    ]
    assert proposals == []


def test_recipients_first_seen_against_empty_committed_are_proposals_not_findings():
    rows = [
        _dispatch_row(
            skill="medical-records-chaser",
            sha="",
            extra={"recipient": "records@vendor.invalid"},
        )
    ]
    findings, proposals = sv.recipient_invariant(rows, _declares(), _EMPTY_COMMITTED)
    assert findings == []
    assert [p.rule for p in proposals] == ["recipient_set"]
    emitted = json.dumps(sv.as_dicts([], [], proposals)[2])
    assert "records@vendor.invalid" not in emitted  # hashes only, ever
    # Committing the proposed hash quiets the proposal entirely.
    committed = {
        "recipients": {"medical-records-chaser": [proposals[0].hashed_key]},
        "ack_codes": {},
    }
    assert sv.recipient_invariant(rows, _declares(), committed) == ([], [])


def test_a_recipient_outside_a_nonempty_committed_set_is_the_flapping_finding():
    """Once a routine HAS a reviewed recipient set, a dispatch outside it is
    the recipient-flapping defect from the review week -- a conflict with a
    committed expectation, not a cold-start artifact."""
    rows = [
        _dispatch_row(
            skill="medical-records-chaser",
            sha="",
            extra={"recipient": "stranger@elsewhere.invalid"},
        )
    ]
    committed = {
        "recipients": {
            "medical-records-chaser": [
                sv._recipient_hash("medical-records-chaser", "records@vendor.invalid")
            ]
        },
        "ack_codes": {},
    }
    findings, proposals = sv.recipient_invariant(rows, _declares(), committed)
    assert [f.rule for f in findings] == ["recipient_set"]
    assert proposals == []
    assert "stranger@elsewhere.invalid" not in json.dumps(sv.as_dicts([], findings)[1])


def test_a_dispatch_row_with_no_recipient_stamp_is_skipped_not_guessed():
    rows = [_dispatch_row(skill="medical-records-chaser", sha="")]
    assert sv.recipient_invariant(rows, _declares(), _EMPTY_COMMITTED) == ([], [])


def test_missing_or_corrupt_invariants_file_loads_as_empty(tmp_path):
    assert sv.load_invariants(str(tmp_path / "absent.json")) == {
        "recipients": {},
        "ack_codes": {},
    }
    corrupt = tmp_path / "corrupt.json"
    corrupt.write_text("{not json")
    assert sv.load_invariants(str(corrupt)) == {"recipients": {}, "ack_codes": {}}


def test_the_committed_invariants_file_parses():
    loaded = sv.load_invariants()
    assert set(loaded) == {"recipients", "ack_codes"}


# ---------------------------------------------------------------------------
# LEAK SAFETY (the public-repo constraint)
# ---------------------------------------------------------------------------

_BODY_FIELD_PATTERN = re.compile(r"body(?!_sha256|_variant)|text|content|html", re.IGNORECASE)


def _walk_for_sentinel(value, path="$"):
    """Every string anywhere in a structure. Returns the paths that carry the
    sentinel -- the behavioral half of the leak test."""
    found = []
    if isinstance(value, str):
        if SENTINEL in value:
            found.append(path)
    elif isinstance(value, dict):
        for key, item in value.items():
            if isinstance(key, str) and SENTINEL in key:
                found.append(f"{path}.{key}(key)")
            found += _walk_for_sentinel(item, f"{path}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            found += _walk_for_sentinel(item, f"{path}[{index}]")
    return found


def test_verdict_dataclasses_are_structurally_body_free():
    for cls in (sv.BodyVerdict, sv.InvariantFinding):
        for name in cls.__dataclass_fields__:
            assert not _BODY_FIELD_PATTERN.fullmatch(name.split("_")[0]) or name in (
                "expected_sha256",
                "actual_sha256",
            ), f"{cls.__name__}.{name} could hold body content"
            assert name not in ("body", "text", "content", "html", "raw", "snippet"), (
                f"{cls.__name__}.{name} is a body-content field; the leak safety is structural"
            )


def _sentinel_report():
    """A full InboxReport whose channel body carries the sentinel and whose
    wake hash mismatches, driven through the real verifier."""
    body = f"Dear client,\n{SENTINEL}\nregards"
    wake_sha = sv.canonical_body_sha256("the authored body")
    rows = [
        _wake_row(hashes=[{"body_sha256_full": wake_sha}]),
        _dispatch_row(sha=sv.canonical_body_sha256(body)),
    ]
    verifier = sv.SendVerifier(_declares(), {"recipients": {}, "ack_codes": {}})
    verdicts, invariants, proposals = verifier.verify_inbox([_sent_message()], rows, lambda m: body)
    assert verdicts, "the sentinel run must actually grade something"
    report = rec.InboxReport(inbox="pilot-smokeball@agentmail.to", slug="pilot-smokeball")
    report.sent_total = 1
    report.body_verdicts = verdicts
    report.invariant_findings = invariants
    report.invariant_proposals = proposals
    return report


def test_the_sentinel_body_reaches_no_output_surface():
    report = _sentinel_report()
    rendered = rec.render([report])
    assert SENTINEL not in rendered
    as_json = json.dumps(rec.report_dict(report))
    assert _walk_for_sentinel(json.loads(as_json)) == []
    assert SENTINEL not in rec.finding_digest([report])
    assert _walk_for_sentinel(rec.baseline_entries([report])) == []


def test_the_walker_itself_can_fail():
    """The falsifier: a regressed verdict that carries the body IS caught by the
    walker. Without this, the test above is green for a reason nobody proved."""

    @dataclass
    class RegressedVerdict:
        skill_name: str
        verdict: str
        body: str  # the regression

        @property
        def is_finding(self):
            return True

        @property
        def is_hold(self):
            return False

    leaked = {"verdicts": [{"skill_name": "x", "verdict": "BODY_DIVERGED", "body": f"a {SENTINEL} b"}]}
    assert _walk_for_sentinel(leaked) != []
    # And the structural test would refuse the field name.
    assert "body" in RegressedVerdict.__dataclass_fields__


def test_render_lines_and_digest_keys_carry_hashes_only():
    report = _sentinel_report()
    lines = sv.render_lines(
        report.inbox, report.body_verdicts, report.invariant_findings, report.invariant_proposals
    )
    for line in lines:
        assert SENTINEL not in line
    for key in sv.digest_keys(report.inbox, report.body_verdicts, report.invariant_findings):
        assert SENTINEL not in key


# ---------------------------------------------------------------------------
# integration with the reconciler's contract
# ---------------------------------------------------------------------------


def test_a_body_finding_reddens_exit_and_joins_the_fingerprint():
    sha_wake = sv.canonical_body_sha256("authored")
    sha_sent = sv.canonical_body_sha256("recomposed")
    rows = [
        _wake_row(hashes=[{"body_sha256_full": sha_wake}]),
        _dispatch_row(sha=sha_sent),
    ]
    verifier = sv.SendVerifier(_declares(), {"recipients": {}, "ack_codes": {}})
    verdicts, invariants, proposals = verifier.verify_inbox([], rows, None)
    report = rec.InboxReport(inbox="i@agentmail.to", slug="pilot-smokeball")
    report.body_verdicts, report.invariant_findings = verdicts, invariants
    report.invariant_proposals = proposals
    assert report.is_finding
    assert rec.exit_code([report]) == rec.EXIT_FINDING
    assert rec.finding_digest([report]) != ""


def test_a_body_hold_reddens_without_filing():
    sha = sv.canonical_body_sha256("authored")
    rows = [_dispatch_row(sha=sha)]  # no wake -> hold
    verifier = sv.SendVerifier(_declares(), {"recipients": {}, "ack_codes": {}})
    verdicts, _findings, _proposals = verifier.verify_inbox([], rows, None)
    report = rec.InboxReport(inbox="i@agentmail.to", slug="pilot-smokeball")
    report.body_verdicts = verdicts
    assert not report.is_finding
    assert rec.exit_code([report]) == rec.EXIT_HOLD
    rendered = rec.render([report])
    assert "HOLD" in rendered and "no_wake_hash" in rendered
    assert rec.finding_digest([report]) == ""  # holds file nothing


def test_proposals_alone_neither_find_nor_redden():
    """The whole point of the tier: a cold-start fleet prints paste-ready
    proposal rows and exits CLEAN. No finding, no digest, no hold."""
    rows = [
        _wake_row(items=[{"item_key": "matter-1|SOL", "ack_code": "AK7Q"}]),
        _dispatch_row(
            skill="medical-records-chaser", sha="", extra={"recipient": "records@vendor.invalid"}
        ),
    ]
    verifier = sv.SendVerifier(_declares(), {"recipients": {}, "ack_codes": {}})
    verdicts, findings, proposals = verifier.verify_inbox([], rows, None)
    assert findings == [] and len(proposals) == 2
    report = rec.InboxReport(inbox="i@agentmail.to", slug="pilot-smokeball")
    report.body_verdicts, report.invariant_findings = verdicts, findings
    report.invariant_proposals = proposals
    assert not report.is_finding
    assert rec.exit_code([report]) == rec.EXIT_CLEAN
    assert rec.finding_digest([report]) == ""
    rendered = rec.render([report])
    assert "PROPOSAL" in rendered and "send-invariants.json" in rendered
    assert "records@vendor.invalid" not in rendered  # hashes only, always


def test_a_clean_report_stays_clean_with_the_verifier_attached():
    report = rec.InboxReport(inbox="i@agentmail.to", slug="pilot-smokeball")
    assert rec.exit_code([report]) == rec.EXIT_CLEAN
