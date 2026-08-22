"""establish_decline / establish_lapse_notified / the lapse sweep / duplicate propose.

The approval loop closing (ss-console#2546). Under #2529 a paralegal's firm-level
rule was recorded and an administrator could release it by replying "apply that".
Everything after that was silence: no administrator was told a rule was waiting,
an administrator's "no" did nothing at all, and a rule nobody answered was DELETED
by the sweep, so the person who asked could not even be told it had lapsed.

WHAT THESE TESTS ARE ABOUT, therefore, is the three ways a request now ends and
the one way it may not end:

* a rule gets seven days and an act keeps its day, read from the row's own kind
  so no caller can widen its own window;
* an expiry MARKS the row rather than removing it, because a deleted row is a
  person who never hears back;
* a decline is one administrator's act, taken once, enforced by the database,
  and it is not available to the person who stated the rule;
* the person who asked is told exactly once, and the mark that says so is
  written AFTER the send, so a failed send retries and a successful one cannot
  repeat;
* the same sentence stated twice does not page an administrator twice under two
  tags, only one of which answering would close.

Every assertion here has its falsifier beside it: the second decline, the second
lapse note, the act TTL that must NOT have moved, and the duplicate that must
still create a row when it is genuinely a different request.
"""

from __future__ import annotations

import json
import sqlite3
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from workspace_broker.audit_ledger import LedgerWriter
from workspace_broker.establishment import (
    PROPOSAL_TTL_SECONDS,
    RULE_DECLINED_ACTION_TYPE,
    RULE_LAPSED_ACTION_TYPE,
    RULE_PROPOSED_ACTION_TYPE,
    RULE_TTL_SECONDS,
    TERMINAL_RETENTION_SECONDS,
    EstablishmentStore,
    EstablishmentValidationError,
    PendingRuleStore,
    ttl_for_kind,
)
from workspace_broker.server import Broker

AGENT_UID = 1000

ADMIN = "christa@firm.com"
OTHER_ADMIN = "chris@firm.com"
PARALEGAL = "sarah@firm.com"
RULE = "In client letters, no pleasantries; keep that."


def _broker(tmp_path: Path) -> Broker:
    spool = tmp_path / "establish-spool"
    for child in ("staging", "runs", "results"):
        (spool / child).mkdir(parents=True)
    broker = Broker.__new__(Broker)
    broker.customer_slug = "smd"
    broker.gateway_pid = 42
    broker.agent_uid = AGENT_UID
    db_path = str(tmp_path / "audit.db")
    broker.ledger = LedgerWriter(db_path)
    broker.establishment = EstablishmentStore(spool, broker.ledger, pending_db_path=db_path)
    broker.db_path = db_path
    return broker


def _call(broker: Broker, **request):
    return broker.handle(request, peer_pid=9999, peer_uid=AGENT_UID)


def _propose(broker: Broker, **over):
    """A PARALEGAL's firm rule by default: for_admin, which is the shape the
    whole loop exists for."""
    request = {
        "action": "establish_propose",
        "scope": "firm_adjust",
        "subject": {"output_class": "outbound", "property": "voice"},
        "text": RULE,
        "instructed_by": PARALEGAL,
        "source_ref": "msg-41",
        "for_admin": True,
    }
    request.update(over)
    return _call(broker, **request)


def _decline(broker: Broker, proposal_id: str, **over):
    request = {
        "action": "establish_decline",
        "proposal_id": proposal_id,
        "declined_by": ADMIN,
        "source_ref": "msg-42",
    }
    request.update(over)
    return _call(broker, **request)


def _rows(broker: Broker, action_type: str) -> list[dict]:
    conn = sqlite3.connect(broker.db_path)
    conn.row_factory = sqlite3.Row
    try:
        return [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM audit_log WHERE action_type=? ORDER BY id", (action_type,)
            )
        ]
    finally:
        conn.close()


def _set_times(broker: Broker, proposal_id: str, *, created: float, expires: float) -> None:
    conn = sqlite3.connect(broker.db_path)
    try:
        conn.execute(
            "UPDATE pending_rules SET created_at=?, expires_at=? WHERE proposal_id=?",
            (created, expires, proposal_id),
        )
        conn.commit()
    finally:
        conn.close()


def _age_out(broker: Broker, proposal_id: str) -> None:
    """Push one proposal past its TTL, using the broker's own clock."""
    now = time.time()
    _set_times(broker, proposal_id, created=now - RULE_TTL_SECONDS - 60, expires=now - 60)


# ---------------------------------------------------------------------------
# TTL: a rule gets a week, an act keeps its day
# ---------------------------------------------------------------------------


def test_a_rule_is_answerable_for_seven_days(tmp_path):
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    assert RULE_TTL_SECONDS == 7 * 86_400
    assert proposed["expires_at"] == pytest.approx(time.time() + RULE_TTL_SECONDS, abs=30)


def test_an_act_still_expires_in_a_day(tmp_path):
    """The falsifier for the widening. The Captain authorized the confirm ceiling
    for acts under a 24 h bound; a change that quietly moved acts onto the rule's
    week would widen a commitment nobody widened, and it would pass every other
    test in this file."""
    assert PROPOSAL_TTL_SECONDS == 86_400
    assert ttl_for_kind("tool_call") == 86_400
    assert ttl_for_kind("rule") == 7 * 86_400

    broker = _broker(tmp_path)
    store = broker.establishment.pending
    act = store.create(
        scope="act",
        subject={"tool": "mcp_smokeball_create_matter"},
        text="Create Smokeball matter",
        instructed_by=ADMIN,
        for_admin=False,
        kind="tool_call",
        payload={"number": "OPS-1"},
    )
    assert act["expires_at"] - act["created_at"] == PROPOSAL_TTL_SECONDS

    rule = store.create(
        scope="firm_adjust",
        subject={"output_class": "outbound", "property": "voice"},
        text=RULE,
        instructed_by=PARALEGAL,
        for_admin=True,
    )
    assert rule["expires_at"] - rule["created_at"] == RULE_TTL_SECONDS


def test_the_ttl_is_read_from_the_stored_kind_not_from_the_caller(tmp_path):
    """A row's window cannot be widened by asking. ``kind`` is the only input,
    and it is also what the readback and the commit path branch on."""
    broker = _broker(tmp_path)
    store = broker.establishment.pending
    row = store.create(
        scope="act",
        subject={"tool": "t"},
        text="x",
        instructed_by=ADMIN,
        for_admin=False,
        kind="tool_call",
    )
    stored = store.get(row["proposal_id"])
    assert stored["kind"] == "tool_call"
    assert stored["expires_at"] - stored["created_at"] == PROPOSAL_TTL_SECONDS


# ---------------------------------------------------------------------------
# the sweep: expiry MARKS, it does not delete
# ---------------------------------------------------------------------------


def test_an_unanswered_rule_lapses_and_the_row_survives_to_be_reported(tmp_path):
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    _age_out(broker, proposed["proposal_id"])

    broker.establishment.sweep()

    row = broker.establishment.pending.get(proposed["proposal_id"])
    assert row is not None, "a deleted row is a person who never hears back"
    assert row["lapsed_at"] is not None
    assert row["consumed_at"] is None and row["declined_at"] is None


def test_a_lapsed_row_is_deleted_once_it_is_older_than_the_retention(tmp_path):
    """The table still stays bounded. The tombstone outlives the window in which
    somebody could still be quoting the tag, and then goes."""
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    _age_out(broker, proposed["proposal_id"])
    broker.establishment.sweep()

    old = time.time() - TERMINAL_RETENTION_SECONDS - 60
    conn = sqlite3.connect(broker.db_path)
    try:
        conn.execute(
            "UPDATE pending_rules SET lapsed_at=? WHERE proposal_id=?",
            (old, proposed["proposal_id"]),
        )
        conn.commit()
    finally:
        conn.close()

    assert broker.establishment.pending.sweep() == 1
    assert broker.establishment.pending.get(proposed["proposal_id"]) is None


def test_the_sweep_does_not_touch_a_row_that_already_ended(tmp_path):
    """Falsifier for the marking pass: a committed or declined row must not be
    re-marked as lapsed, or its state would depend on when a sweep happened to
    run rather than on what a person did."""
    broker = _broker(tmp_path)
    declined = _propose(broker)
    _decline(broker, declined["proposal_id"])
    _age_out(broker, declined["proposal_id"])

    broker.establishment.sweep()

    row = broker.establishment.pending.get(declined["proposal_id"])
    assert row["declined_at"] is not None
    assert row["lapsed_at"] is None


def test_a_lapsed_rule_cannot_commit_on_a_late_yes(tmp_path):
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    _age_out(broker, proposed["proposal_id"])
    broker.establishment.sweep()

    with pytest.raises(EstablishmentValidationError, match="lapsed unanswered"):
        _call(
            broker,
            action="establish_submit",
            scope="firm_adjust",
            proposal_id=proposed["proposal_id"],
            instructed_by=ADMIN,
            source_ref="msg-99",
        )


# ---------------------------------------------------------------------------
# establish_decline
# ---------------------------------------------------------------------------


def test_an_administrators_no_declines_the_rule_and_names_who_to_tell(tmp_path):
    broker = _broker(tmp_path)
    proposed = _propose(broker)

    result = _decline(broker, proposed["proposal_id"])

    assert result["ok"] is True
    assert result["state"] == "declined"
    assert result["declined_by"] == ADMIN
    # The seat composes the note to the requester from the ROW, not from the
    # wire: who asked, and the sentence they asked for.
    assert result["instructed_by"] == PARALEGAL
    assert result["text"] == RULE
    assert result["readback"] == f"[rule {proposed['proposal_id']}] {RULE}"

    row = broker.establishment.pending.get(proposed["proposal_id"])
    assert row["declined_at"] is not None
    assert row["declined_by"] == ADMIN


def test_the_declined_row_carries_ids_and_never_the_sentence(tmp_path):
    """Same posture as RULE_PROPOSED. The two rows join on the digest, so the
    ledger shows WHICH rule was refused without holding the firm's words."""
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    _decline(broker, proposed["proposal_id"])

    rows = _rows(broker, RULE_DECLINED_ACTION_TYPE)
    assert len(rows) == 1
    metadata = json.loads(rows[0]["metadata"])
    assert metadata["proposal_id"] == proposed["proposal_id"]
    assert metadata["instructed_by"] == PARALEGAL
    assert metadata["declined_by"] == ADMIN
    assert metadata["output_class"] == "outbound"
    assert metadata["property"] == "voice"
    proposed_meta = json.loads(_rows(broker, RULE_PROPOSED_ACTION_TYPE)[0]["metadata"])
    assert metadata["text_sha256"] == proposed_meta["text_sha256"]
    assert RULE not in rows[0]["metadata"]


def test_a_rule_is_declined_exactly_once(tmp_path):
    """THE FALSIFIER for decline-once. A second "no" must change nothing and
    must not write a second row, or the feed would show one request refused
    twice by two people who each answered once."""
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    _decline(broker, proposed["proposal_id"])

    with pytest.raises(EstablishmentValidationError, match="already declined"):
        _decline(broker, proposed["proposal_id"], declined_by=OTHER_ADMIN)

    assert len(_rows(broker, RULE_DECLINED_ACTION_TYPE)) == 1
    assert broker.establishment.pending.get(proposed["proposal_id"])["declined_by"] == ADMIN


def test_decline_is_conditional_so_a_race_cannot_decline_twice(tmp_path):
    """The store-level check, below the by-name refusals: two callers that both
    read an open row still produce exactly one decline."""
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    store = broker.establishment.pending

    assert store.decline(proposed["proposal_id"], ADMIN) is True
    assert store.decline(proposed["proposal_id"], OTHER_ADMIN) is False


def test_the_person_who_stated_a_rule_cannot_decline_it(tmp_path):
    """One address must not be able to both raise and refuse a rule: that is a
    loop with no second person in it, and the decline row would read as though
    somebody in authority had answered."""
    broker = _broker(tmp_path)
    proposed = _propose(broker)

    with pytest.raises(EstablishmentValidationError, match="cannot decline it"):
        _decline(broker, proposed["proposal_id"], declined_by=PARALEGAL)

    assert broker.establishment.pending.get(proposed["proposal_id"])["declined_at"] is None
    assert _rows(broker, RULE_DECLINED_ACTION_TYPE) == []


def test_a_rule_not_waiting_on_an_administrator_cannot_be_declined(tmp_path):
    """An admin's own rule, or a personal preference, is not somebody else's to
    refuse; not confirming it is how it dies."""
    broker = _broker(tmp_path)
    proposed = _propose(broker, instructed_by=ADMIN, for_admin=False)

    with pytest.raises(EstablishmentValidationError, match="not waiting on an administrator"):
        _decline(broker, proposed["proposal_id"], declined_by=OTHER_ADMIN)


def test_a_committed_rule_cannot_be_declined_afterwards(tmp_path):
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    _call(
        broker,
        action="establish_submit",
        scope="firm_adjust",
        proposal_id=proposed["proposal_id"],
        instructed_by=ADMIN,
        source_ref="msg-50",
    )

    with pytest.raises(EstablishmentValidationError, match="already committed"):
        _decline(broker, proposed["proposal_id"])


def test_a_lapsed_rule_cannot_be_declined(tmp_path):
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    _age_out(broker, proposed["proposal_id"])
    broker.establishment.sweep()

    with pytest.raises(EstablishmentValidationError, match="lapsed unanswered"):
        _decline(broker, proposed["proposal_id"])


def test_an_unknown_proposal_cannot_be_declined(tmp_path):
    broker = _broker(tmp_path)
    with pytest.raises(EstablishmentValidationError, match="nothing to decline"):
        _decline(broker, "deadbeef")
    assert _rows(broker, RULE_DECLINED_ACTION_TYPE) == []


def test_a_declined_rule_never_commits(tmp_path):
    """The load-bearing consequence. A "no" that a later "yes" could overwrite
    would be advice, not an answer."""
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    _decline(broker, proposed["proposal_id"])

    with pytest.raises(EstablishmentValidationError, match="declined by an administrator"):
        _call(
            broker,
            action="establish_submit",
            scope="firm_adjust",
            proposal_id=proposed["proposal_id"],
            instructed_by=OTHER_ADMIN,
            source_ref="msg-51",
        )


def test_a_declined_rule_is_no_longer_offered_for_confirmation(tmp_path):
    """Without this the Operator would go on offering an administrator a rule
    that has already been refused."""
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    _decline(broker, proposed["proposal_id"])

    result = _call(
        broker, action="establish_pending", sender=OTHER_ADMIN, include_for_admin=True
    )
    assert [p["proposal_id"] for p in result["pending"]] == []


# ---------------------------------------------------------------------------
# establish_pending: state, and the requester's unreported outcomes
# ---------------------------------------------------------------------------


def test_an_open_row_reads_as_open_and_unreported(tmp_path):
    broker = _broker(tmp_path)
    _propose(broker)
    view = _call(broker, action="establish_pending", sender=PARALEGAL)["pending"][0]
    assert view["state"] == "open"
    assert view["lapse_notified"] is False
    assert view["declined_by"] is None


def test_the_requester_is_shown_a_decline_and_a_lapse_when_asked(tmp_path):
    broker = _broker(tmp_path)
    declined = _propose(broker)
    _decline(broker, declined["proposal_id"])
    lapsed = _propose(broker, text="Name the deadline in the first paragraph.")
    _age_out(broker, lapsed["proposal_id"])
    broker.establishment.sweep()

    result = _call(
        broker, action="establish_pending", sender=PARALEGAL, include_outcomes=True
    )
    by_id = {p["proposal_id"]: p for p in result["pending"]}
    assert by_id[declined["proposal_id"]]["state"] == "declined"
    assert by_id[declined["proposal_id"]]["declined_by"] == ADMIN
    assert by_id[lapsed["proposal_id"]]["state"] == "lapsed"


def test_outcomes_are_opt_in_so_an_older_seat_sees_only_confirmable_rows(tmp_path):
    """THE VERSION-SKEW FALSIFIER. This module ships in the seat image and the
    plugin that reads it ships at the pinned OVERLAY_REF; the two move in
    separate PRs. A seat running this broker under the older plugin must see
    exactly what it saw before, or it will offer the firm a rule that has
    already been refused."""
    broker = _broker(tmp_path)
    declined = _propose(broker)
    _decline(broker, declined["proposal_id"])

    default_view = _call(broker, action="establish_pending", sender=PARALEGAL)
    assert default_view["pending"] == []

    asked = _call(
        broker, action="establish_pending", sender=PARALEGAL, include_outcomes=True
    )
    assert [p["proposal_id"] for p in asked["pending"]] == [declined["proposal_id"]]


def test_an_outcome_belongs_to_the_person_who_asked_not_to_the_administrator(tmp_path):
    """An administrator who is shown every lapse in the firm is being shown
    other people's business; the decline is news for the person who asked."""
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    _decline(broker, proposed["proposal_id"])

    admin_view = _call(
        broker,
        action="establish_pending",
        sender=ADMIN,
        include_for_admin=True,
        include_outcomes=True,
    )
    assert admin_view["pending"] == []


def test_the_sweeper_can_ask_what_ended_unreported_across_the_seat(tmp_path):
    """The one query with no sender, and the reason it has to exist: a lapse has
    nobody in front of it. Waiting for the requester's next message would make
    the report depend on them continuing to talk to an Operator that has just
    gone silent on them."""
    broker = _broker(tmp_path)
    mine = _propose(broker)
    theirs = _propose(broker, instructed_by="dana@firm.com")
    _age_out(broker, mine["proposal_id"])
    _age_out(broker, theirs["proposal_id"])
    broker.establishment.sweep()

    result = _call(broker, action="establish_pending", include_outcomes=True)
    by_id = {p["proposal_id"]: p for p in result["pending"]}
    assert set(by_id) == {mine["proposal_id"], theirs["proposal_id"]}
    # Each row still names its own author, which is what keeps the sweeper's
    # note going to the person who asked and to nobody else.
    assert by_id[mine["proposal_id"]]["instructed_by"] == PARALEGAL
    assert by_id[theirs["proposal_id"]]["instructed_by"] == "dana@firm.com"


def test_the_seat_wide_query_returns_nothing_confirmable(tmp_path):
    """FALSIFIER for the widening this could have been. A senderless listing
    that included OPEN rows would be a second way to reach somebody else's
    pending rule; it returns terminal rows only."""
    broker = _broker(tmp_path)
    open_row = _propose(broker)
    declined = _propose(broker, text="Name the deadline in the first paragraph.")
    _decline(broker, declined["proposal_id"])

    result = _call(broker, action="establish_pending", include_outcomes=True)
    ids = [p["proposal_id"] for p in result["pending"]]
    assert ids == [declined["proposal_id"]]
    assert open_row["proposal_id"] not in ids


def test_a_senderless_listing_without_the_flag_is_still_refused(tmp_path):
    """The old shape is unchanged: no sender and no flag is a malformed call,
    not an invitation to list the seat."""
    broker = _broker(tmp_path)
    _propose(broker)
    with pytest.raises(EstablishmentValidationError, match="sender"):
        _call(broker, action="establish_pending")


def test_include_outcomes_must_be_a_boolean(tmp_path):
    broker = _broker(tmp_path)
    with pytest.raises(EstablishmentValidationError, match="include_outcomes"):
        _call(
            broker, action="establish_pending", sender=PARALEGAL, include_outcomes="yes"
        )


# ---------------------------------------------------------------------------
# establish_lapse_notified
# ---------------------------------------------------------------------------


def test_reporting_a_lapse_marks_it_and_writes_one_row(tmp_path):
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    _age_out(broker, proposed["proposal_id"])
    broker.establishment.sweep()

    result = _call(
        broker, action="establish_lapse_notified", proposal_id=proposed["proposal_id"]
    )
    assert result["state"] == "lapsed"

    rows = _rows(broker, RULE_LAPSED_ACTION_TYPE)
    assert len(rows) == 1
    metadata = json.loads(rows[0]["metadata"])
    assert metadata["proposal_id"] == proposed["proposal_id"]
    assert metadata["instructed_by"] == PARALEGAL
    assert RULE not in rows[0]["metadata"]


def test_a_reported_outcome_leaves_the_requesters_list(tmp_path):
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    _age_out(broker, proposed["proposal_id"])
    broker.establishment.sweep()
    _call(broker, action="establish_lapse_notified", proposal_id=proposed["proposal_id"])

    result = _call(
        broker, action="establish_pending", sender=PARALEGAL, include_outcomes=True
    )
    assert result["pending"] == []


def test_an_outcome_is_reported_exactly_once(tmp_path):
    """THE FALSIFIER for the second note. A seat that retries must lose the race
    and send nothing, or the person who asked hears the same bad news twice."""
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    _age_out(broker, proposed["proposal_id"])
    broker.establishment.sweep()
    _call(broker, action="establish_lapse_notified", proposal_id=proposed["proposal_id"])

    with pytest.raises(EstablishmentValidationError, match="already reported"):
        _call(
            broker, action="establish_lapse_notified", proposal_id=proposed["proposal_id"]
        )
    assert len(_rows(broker, RULE_LAPSED_ACTION_TYPE)) == 1


def test_reporting_a_decline_writes_no_lapse_row(tmp_path):
    """One pinned action type per writing verb, and the honest reading of it: a
    decline was already recorded by RULE_DECLINED at the moment the
    administrator answered. Telling the requester is delivery, not a second
    decision, and a RULE_LAPSED row here would say a rule died unanswered when
    somebody answered it."""
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    _decline(broker, proposed["proposal_id"])

    result = _call(
        broker, action="establish_lapse_notified", proposal_id=proposed["proposal_id"]
    )
    assert result["state"] == "declined"
    assert _rows(broker, RULE_LAPSED_ACTION_TYPE) == []
    assert len(_rows(broker, RULE_DECLINED_ACTION_TYPE)) == 1
    assert broker.establishment.pending.get(proposed["proposal_id"])["lapse_notified_at"]


def test_an_open_rule_has_no_outcome_to_report(tmp_path):
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    with pytest.raises(EstablishmentValidationError, match="still open"):
        _call(
            broker, action="establish_lapse_notified", proposal_id=proposed["proposal_id"]
        )
    assert _rows(broker, RULE_LAPSED_ACTION_TYPE) == []


def test_an_unknown_proposal_has_no_outcome_to_report(tmp_path):
    broker = _broker(tmp_path)
    with pytest.raises(EstablishmentValidationError, match="nothing to report"):
        _call(broker, action="establish_lapse_notified", proposal_id="deadbeef")


# ---------------------------------------------------------------------------
# duplicate propose
# ---------------------------------------------------------------------------


def test_the_same_sentence_twice_returns_the_row_that_already_exists(tmp_path):
    broker = _broker(tmp_path)
    first = _propose(broker)
    second = _propose(broker)

    assert second["duplicate_of"] == first["proposal_id"]
    assert second["proposal_id"] == first["proposal_id"]
    assert second["readback"] == first["readback"]
    # Nothing was created and nothing was recorded: one request, one row, one
    # tag, one email to an administrator.
    assert len(_rows(broker, RULE_PROPOSED_ACTION_TYPE)) == 1
    assert len(broker.establishment.pending.open_for(PARALEGAL, True)) == 1


def test_a_first_proposal_says_plainly_that_it_is_not_a_duplicate(tmp_path):
    broker = _broker(tmp_path)
    assert _propose(broker)["duplicate_of"] is None


def test_a_different_sentence_is_a_different_request(tmp_path):
    """FALSIFIER. Deduplication that swallowed a genuinely new rule would be far
    worse than the double page it prevents."""
    broker = _broker(tmp_path)
    first = _propose(broker)
    second = _propose(broker, text="Name the deadline in the first paragraph.")

    assert second["duplicate_of"] is None
    assert second["proposal_id"] != first["proposal_id"]
    assert len(_rows(broker, RULE_PROPOSED_ACTION_TYPE)) == 2


def test_two_people_asking_for_the_same_thing_are_two_requests(tmp_path):
    """Same sentence, different author. Collapsing them would attribute one
    person's rule to another and leave the second person with nothing pending."""
    broker = _broker(tmp_path)
    first = _propose(broker)
    second = _propose(broker, instructed_by="dana@firm.com")

    assert second["duplicate_of"] is None
    assert second["proposal_id"] != first["proposal_id"]


def test_a_rule_can_be_stated_again_after_it_was_declined_or_lapsed(tmp_path):
    """Deduplication is against OPEN rows only. A refused or lapsed request must
    be re-raisable, or a "no" today would silently be a "no" forever."""
    broker = _broker(tmp_path)
    declined = _propose(broker)
    _decline(broker, declined["proposal_id"])

    again = _propose(broker)
    assert again["duplicate_of"] is None
    assert again["proposal_id"] != declined["proposal_id"]

    _age_out(broker, again["proposal_id"])
    broker.establishment.sweep()
    third = _propose(broker)
    assert third["duplicate_of"] is None
    assert third["proposal_id"] != again["proposal_id"]


def test_the_same_sentence_under_a_different_scope_is_a_different_request(tmp_path):
    broker = _broker(tmp_path)
    firm = _propose(broker)
    personal = _propose(
        broker,
        scope="person",
        subject={"person": PARALEGAL},
        for_admin=False,
    )
    assert personal["duplicate_of"] is None
    assert personal["proposal_id"] != firm["proposal_id"]


# ---------------------------------------------------------------------------
# migration
# ---------------------------------------------------------------------------


def test_a_table_written_before_this_change_gains_the_columns_and_reads_as_open(tmp_path):
    """The additive-ALTER idiom, exercised rather than asserted. A seat that
    proposed a rule last week keeps that row, and it reads as what it is: still
    waiting on somebody."""
    db_path = tmp_path / "pending.db"
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "CREATE TABLE pending_rules ("
            "proposal_id TEXT PRIMARY KEY, scope TEXT NOT NULL, subject_json TEXT NOT NULL, "
            "text TEXT NOT NULL, text_sha256 TEXT NOT NULL, instructed_by TEXT NOT NULL, "
            "for_admin INTEGER NOT NULL DEFAULT 0, created_at REAL NOT NULL, "
            "expires_at REAL NOT NULL, consumed_at REAL, consumed_run_id TEXT)"
        )
        conn.execute(
            "INSERT INTO pending_rules (proposal_id, scope, subject_json, text, "
            "text_sha256, instructed_by, for_admin, created_at, expires_at) "
            "VALUES ('aaaaaaaa', 'firm_adjust', '{}', ?, 'sha', ?, 1, ?, ?)",
            (RULE, PARALEGAL, time.time(), time.time() + 3600),
        )
        conn.commit()
    finally:
        conn.close()

    store = PendingRuleStore(db_path)
    row = store.get("aaaaaaaa")
    assert row["declined_at"] is None
    assert row["lapsed_at"] is None
    assert row["lapse_notified_at"] is None
    assert row["kind"] == "rule"
    assert [r["proposal_id"] for r in store.open_for(PARALEGAL, True)] == ["aaaaaaaa"]


# ---------------------------------------------------------------------------
# The fourth outcome: a rule that was APPLIED (ss-console#2546 follow-up)
#
# LIVE DEFECT (pilot, 2026-08-22T20:31Z, overlay 119f6bf). A non-admin stated a
# firm rule, an administrator replied "apply that", the submit was accepted at
# 20:31:32Z and the intake installed it at 20:31:52Z. The person who asked was
# never told. Two reasons, and both are broker-side:
#
# * the seat looked the row up by id straight after committing it, to learn
#   whether it was for_admin and who had asked -- and the by-id lookup returned
#   open rows only, so committing the rule is exactly what made it invisible;
# * the install result is a ONE-SHOT read, so whether a rule went into force
#   survived for a single call and then existed nowhere queryable. No later path
#   could recover it, which is why there was no fallback to catch the miss.
#
# So: the lookup answers "what became of this" when asked to, an observed
# install is stamped on the proposal, and an installed rule joins declined and
# lapsed as an outcome its author is owed a note about. The line these tests
# hold is that INSTALLED is not COMMITTED -- between them sit a converge window
# and a failure mode, and only the first entitles anyone to say "in effect".
# ---------------------------------------------------------------------------


def _commit(broker: Broker, proposal_id: str, run_id: str = "run-install-1") -> str:
    """Take a proposal the way a confirmed submit does: consume it, naming the run."""
    assert broker.establishment.pending.consume(proposal_id, run_id)
    return run_id


def _write_result(broker: Broker, run_id: str, status: str = "installed") -> None:
    (broker.establishment.results_dir / f"{run_id}.json").write_text(
        json.dumps({"status": status, "phase": "install", "scope": "firm_adjust"})
    )


def _status(broker: Broker, run_id: str):
    return _call(broker, action="establish_status", run_id=run_id)


def test_a_committed_rule_is_visible_to_a_lookup_that_asks_for_outcomes(tmp_path):
    """THE LIVE DEFECT, in one assertion. The seat asks the broker about the rule
    it has just committed, and gets the row."""
    broker = _broker(tmp_path)
    proposal_id = _propose(broker)["proposal_id"]
    _commit(broker, proposal_id)

    found = _call(
        broker,
        action="establish_pending",
        proposal_id=proposal_id,
        include_outcomes=True,
    )["pending"]
    assert [r["proposal_id"] for r in found] == [proposal_id]
    assert found[0]["state"] == "committed"
    assert found[0]["for_admin"] is True
    assert found[0]["instructed_by"] == PARALEGAL


def test_the_old_lookup_still_answers_the_old_question(tmp_path):
    """The falsifier for the change above, and the compatibility guarantee: a
    caller that does not ask for outcomes still sees confirmable rows only, so a
    seat running the old plugin is handed exactly what it was handed before."""
    broker = _broker(tmp_path)
    proposal_id = _propose(broker)["proposal_id"]
    assert _call(broker, action="establish_pending", proposal_id=proposal_id)["pending"]

    _commit(broker, proposal_id)
    assert _call(broker, action="establish_pending", proposal_id=proposal_id)["pending"] == []


def test_reading_an_installed_result_stamps_the_proposal(tmp_path):
    """The one-shot read leaves something behind. Without this the fact that a
    rule went into force lives for exactly one call."""
    broker = _broker(tmp_path)
    proposal_id = _propose(broker)["proposal_id"]
    run_id = _commit(broker, proposal_id)
    _write_result(broker, run_id)

    assert _status(broker, run_id)["result"]["status"] == "installed"
    assert broker.establishment.pending.get(proposal_id)["installed_at"] is not None


def test_a_result_that_is_not_installed_stamps_nothing(tmp_path):
    """The falsifier. A run that failed its write gates must not leave the
    proposal looking like a rule in force."""
    broker = _broker(tmp_path)
    proposal_id = _propose(broker)["proposal_id"]
    run_id = _commit(broker, proposal_id)
    _write_result(broker, run_id, status="refused")

    assert _status(broker, run_id)["result"]["status"] == "refused"
    assert broker.establishment.pending.get(proposal_id)["installed_at"] is None


def test_the_stamp_follows_the_run_the_broker_itself_recorded(tmp_path):
    """A result for a run no proposal was committed under stamps nothing. The
    link is consumed_run_id, written by the broker at commit, so no request field
    can point an install at somebody else's rule."""
    broker = _broker(tmp_path)
    proposal_id = _propose(broker)["proposal_id"]
    _commit(broker, proposal_id, run_id="run-mine")
    _write_result(broker, "run-someone-elses")

    assert _status(broker, "run-someone-elses")["result"]["status"] == "installed"
    assert broker.establishment.pending.get(proposal_id)["installed_at"] is None


def test_an_installed_rule_is_an_outcome_its_author_has_not_been_told_about(tmp_path):
    """The sweeper's senderless view carries it, so a seat that missed the
    observation in the turn still reports it afterwards."""
    broker = _broker(tmp_path)
    proposal_id = _propose(broker)["proposal_id"]
    run_id = _commit(broker, proposal_id)
    _write_result(broker, run_id)
    _status(broker, run_id)

    outstanding = _call(broker, action="establish_pending", include_outcomes=True)["pending"]
    assert [r["proposal_id"] for r in outstanding] == [proposal_id]
    assert outstanding[0]["state"] == "committed"
    assert outstanding[0]["installed"] is True
    assert outstanding[0]["lapse_notified"] is False


def test_a_committed_rule_nobody_has_seen_install_is_not_reportable_yet(tmp_path):
    """THE HONESTY OF THE WHOLE CHANGE. Committed means the submission reached
    the intake; the converge window is still open and the run can still fail. A
    view keyed on consumed_at would mail 'your rule is in effect' about a rule
    that never installed."""
    broker = _broker(tmp_path)
    proposal_id = _propose(broker)["proposal_id"]
    _commit(broker, proposal_id)

    assert _call(broker, action="establish_pending", include_outcomes=True)["pending"] == []
    with pytest.raises(EstablishmentValidationError) as excinfo:
        _call(broker, action="establish_lapse_notified", proposal_id=proposal_id)
    assert "not been observed installed" in str(excinfo.value)


def test_an_installed_rule_nobody_waited_on_is_nobodys_news(tmp_path):
    """An administrator's OWN rule is not for_admin, so nobody is waiting to hear
    that it landed. It must not enter the outcome view at all."""
    broker = _broker(tmp_path)
    proposal_id = _propose(broker, instructed_by=ADMIN, for_admin=False)["proposal_id"]
    run_id = _commit(broker, proposal_id)
    _write_result(broker, run_id)
    _status(broker, run_id)

    assert broker.establishment.pending.get(proposal_id)["installed_at"] is not None
    assert _call(broker, action="establish_pending", include_outcomes=True)["pending"] == []


def test_an_installed_rule_is_reported_exactly_once(tmp_path):
    """The cross-path lock. Three observers can reach the mark and one wins the
    UPDATE, so the person who asked gets one letter and not three."""
    broker = _broker(tmp_path)
    proposal_id = _propose(broker)["proposal_id"]
    run_id = _commit(broker, proposal_id)
    _write_result(broker, run_id)
    _status(broker, run_id)

    assert _call(broker, action="establish_lapse_notified", proposal_id=proposal_id)["ok"]
    with pytest.raises(EstablishmentValidationError) as excinfo:
        _call(broker, action="establish_lapse_notified", proposal_id=proposal_id)
    assert "already reported" in str(excinfo.value)
    assert _call(broker, action="establish_pending", include_outcomes=True)["pending"] == []


def test_reporting_an_install_forges_no_lapse(tmp_path):
    """RULE_LAPSED is the record that a rule died unanswered. A rule that went
    into force must not write one -- the run already left its own result row."""
    broker = _broker(tmp_path)
    proposal_id = _propose(broker)["proposal_id"]
    run_id = _commit(broker, proposal_id)
    _write_result(broker, run_id)
    _status(broker, run_id)
    _call(broker, action="establish_lapse_notified", proposal_id=proposal_id)

    assert _rows(broker, RULE_LAPSED_ACTION_TYPE) == []


def test_two_reads_of_one_result_stamp_once(tmp_path):
    """mark_installed is conditional, like every other mark here."""
    broker = _broker(tmp_path)
    proposal_id = _propose(broker)["proposal_id"]
    run_id = _commit(broker, proposal_id)
    store = broker.establishment.pending

    assert store.mark_installed(run_id) == proposal_id
    stamped = store.get(proposal_id)["installed_at"]
    assert store.mark_installed(run_id) == ""
    assert store.get(proposal_id)["installed_at"] == stamped


def test_an_uncommitted_proposal_cannot_be_stamped_installed(tmp_path):
    """Nothing installs a rule an administrator never applied."""
    broker = _broker(tmp_path)
    _propose(broker)
    assert broker.establishment.pending.mark_installed("run-nothing-committed") == ""


def test_a_table_written_before_the_column_reads_as_not_installed(tmp_path):
    """The additive-ALTER idiom again, exercised rather than asserted."""
    db_path = tmp_path / "pending-old.db"
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "CREATE TABLE pending_rules ("
            "proposal_id TEXT PRIMARY KEY, scope TEXT NOT NULL, subject_json TEXT NOT NULL, "
            "text TEXT NOT NULL, text_sha256 TEXT NOT NULL, instructed_by TEXT NOT NULL, "
            "for_admin INTEGER NOT NULL DEFAULT 0, created_at REAL NOT NULL, "
            "expires_at REAL NOT NULL, consumed_at REAL, consumed_run_id TEXT)"
        )
        conn.execute(
            "INSERT INTO pending_rules (proposal_id, scope, subject_json, text, "
            "text_sha256, instructed_by, for_admin, created_at, expires_at, "
            "consumed_at, consumed_run_id) "
            "VALUES ('bbbbbbbb', 'firm_adjust', '{}', ?, 'sha', ?, 1, ?, ?, ?, 'run-old')",
            (RULE, PARALEGAL, time.time(), time.time() + 3600, time.time()),
        )
        conn.commit()
    finally:
        conn.close()

    store = PendingRuleStore(db_path)
    assert store.get("bbbbbbbb")["installed_at"] is None
    assert store.unreported_outcomes_for(None) == []
    assert store.mark_installed("run-old") == "bbbbbbbb"
    assert [r["proposal_id"] for r in store.unreported_outcomes_for(None)] == ["bbbbbbbb"]
