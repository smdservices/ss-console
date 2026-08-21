"""establish_propose / establish_pending / establish_submit(firm_adjust).

The propose-read-back-confirm path (ss-console#2529, ADR 0085 §4 as amended
2026-08-21). A firm establishes how its letters read by saying so; the Operator
states the rule back with a tag; the person answers; the rule commits. The
compilers cannot gate any of that — every one of them refuses an empty corpus,
and a sentence in an email has no corpus — so the controls are the admin allow
list (seat-side), sender attribution, the untainted turn, and the readback.

WHAT THE READBACK IS WORTH, and therefore what these tests are about: the
person said yes to ONE sentence, and that yes means nothing unless the bytes
committed are the bytes they were shown. So the load-bearing assertions here are

* the committed text and subject come out of the pending ROW, never off the
  wire, and a request carrying a different text is REFUSED rather than quietly
  substituted (the substitution is the attack, and it would leave the firm
  holding a rule it never agreed to with a ledger row saying it confirmed one);
* a proposal commits exactly once, enforced by a conditional UPDATE rather than
  a read-then-write the caller could interleave;
* an expired proposal refuses BY NAME ("state it again"), never "in effect";
* a forged or unknown id installs nothing;
* a personal rule's subject is the person stating it, and only that person can
  confirm it;
* no row this path writes ever carries the rule's TEXT.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from workspace_broker.audit_ledger import LedgerWriter
from workspace_broker.establishment import (
    ESTABLISHMENT_SUBMITTED_ACTION_TYPE,
    MAX_RULE_TEXT_BYTES,
    PROPOSAL_TTL_SECONDS,
    RULE_PROPOSED_ACTION_TYPE,
    EstablishmentStore,
    EstablishmentValidationError,
    normalize_rule_text,
    readback_for,
)
from workspace_broker.server import Broker

AGENT_UID = 1000
GATEWAY_PID = 42

ADMIN = "christa@firm.com"
PARALEGAL = "sarah@firm.com"
RULE = "In client letters, be more formal and shorter; no pleasantries."


def _broker(tmp_path: Path) -> Broker:
    spool = tmp_path / "establish-spool"
    for child in ("staging", "runs", "results"):
        (spool / child).mkdir(parents=True)
    broker = Broker.__new__(Broker)
    broker.customer_slug = "smd"
    broker.gateway_pid = GATEWAY_PID
    broker.agent_uid = AGENT_UID
    db_path = str(tmp_path / "audit.db")
    broker.ledger = LedgerWriter(db_path)
    broker.establishment = EstablishmentStore(spool, broker.ledger, pending_db_path=db_path)
    broker.db_path = db_path
    return broker


def _call(broker: Broker, **request):
    return broker.handle(request, peer_pid=9999, peer_uid=AGENT_UID)


def _propose(broker: Broker, **over):
    request = {
        "action": "establish_propose",
        "scope": "firm_adjust",
        "subject": {"output_class": "outbound", "property": "voice"},
        "text": RULE,
        "instructed_by": ADMIN,
        "source_ref": "msg-41",
        "for_admin": False,
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


def _submission(broker: Broker, run_id: str) -> dict:
    return json.loads(
        (broker.establishment.runs_dir / run_id / "submission.json").read_text("utf-8")
    )


# ---------------------------------------------------------------------------
# propose
# ---------------------------------------------------------------------------


def test_propose_returns_the_readback_the_seat_must_send(tmp_path):
    broker = _broker(tmp_path)
    result = _propose(broker)
    assert result["ok"] is True
    assert len(result["proposal_id"]) == 8
    assert result["readback"] == f"[rule {result['proposal_id']}] {RULE}"
    assert result["scope"] == "firm_adjust"
    assert result["subject"] == {"output_class": "outbound", "property": "voice"}
    assert result["expires_at"] > time.time()


def test_nothing_is_installed_by_a_proposal(tmp_path):
    """A proposal is a question, not a change. Nothing reaches the spool until
    a person has answered it."""
    broker = _broker(tmp_path)
    _propose(broker)
    assert list(broker.establishment.runs_dir.iterdir()) == []


def test_the_proposal_row_carries_the_digest_and_never_the_sentence(tmp_path):
    broker = _broker(tmp_path)
    result = _propose(broker)
    rows = _rows(broker, RULE_PROPOSED_ACTION_TYPE)
    assert len(rows) == 1
    metadata = json.loads(rows[0]["metadata"])
    assert metadata["proposal_id"] == result["proposal_id"]
    assert metadata["scope"] == "firm_adjust"
    assert metadata["output_class"] == "outbound"
    assert metadata["property"] == "voice"
    assert metadata["instructed_by"] == ADMIN
    assert metadata["text_sha256"] == hashlib.sha256(RULE.encode()).hexdigest()
    assert RULE not in rows[0]["metadata"]
    assert "formal" not in rows[0]["metadata"]


def test_the_rule_text_is_folded_to_one_line_before_anything_sees_it(tmp_path):
    """The readback is one quoted line and the rendered adjustment is one
    bullet. A rule that renders differently from the sentence the person
    confirmed defeats the point of asking them."""
    broker = _broker(tmp_path)
    result = _propose(broker, text="Be formal.\r\n  Be short.\n")
    assert result["readback"].endswith("Be formal. Be short.")
    assert "\n" not in result["readback"]


def test_a_personal_rules_subject_must_be_the_person_stating_it(tmp_path):
    broker = _broker(tmp_path)
    with pytest.raises(EstablishmentValidationError, match="subject must be the person stating it"):
        _propose(
            broker,
            scope="person",
            subject={"person": PARALEGAL},
            instructed_by=ADMIN,
        )


def test_a_personal_rule_cannot_be_marked_for_an_admin(tmp_path):
    broker = _broker(tmp_path)
    with pytest.raises(EstablishmentValidationError, match="for_admin must be false"):
        _propose(
            broker,
            scope="person",
            subject={"person": ADMIN},
            for_admin=True,
        )


@pytest.mark.parametrize(
    "over,needle",
    [
        ({"scope": "firm"}, "scope must be one of"),
        ({"scope": "team"}, "scope must be one of"),
        ({"subject": "outbound"}, "subject must be an object"),
        ({"subject": {"output_class": "Outbound", "property": "voice"}}, "output_class must match"),
        ({"subject": {"output_class": "outbound", "property": "gates"}}, "property must be one of"),
        ({"text": "   "}, "text must not be empty"),
        ({"text": 7}, "text must be a string"),
        ({"text": "x" * (MAX_RULE_TEXT_BYTES + 1)}, "the ceiling is"),
        ({"instructed_by": "christa"}, "single person email address"),
        ({"for_admin": "yes"}, "for_admin must be a boolean"),
        ({"source_ref": ""}, "source_ref must not be empty"),
    ],
)
def test_malformed_proposals_are_refused_by_name(tmp_path, over, needle):
    broker = _broker(tmp_path)
    with pytest.raises(EstablishmentValidationError, match=needle):
        _propose(broker, **over)
    assert _rows(broker, RULE_PROPOSED_ACTION_TYPE) == []


# ---------------------------------------------------------------------------
# pending
# ---------------------------------------------------------------------------


def test_pending_returns_the_senders_own_open_rules(tmp_path):
    broker = _broker(tmp_path)
    mine = _propose(broker, instructed_by=ADMIN)
    _propose(broker, instructed_by=PARALEGAL, for_admin=True)
    result = _call(broker, action="establish_pending", sender=ADMIN)
    assert [p["proposal_id"] for p in result["pending"]] == [mine["proposal_id"]]
    assert result["pending"][0]["readback"] == mine["readback"]
    assert result["pending"][0]["text"] == RULE


def test_for_admin_rules_surface_only_when_the_caller_asks(tmp_path):
    """A paralegal's firm-level remark waits for an admin. The broker cannot
    tell who is an admin — customer.yaml is not readable at this uid — so the
    seat passes that decision in rather than the broker guessing at it."""
    broker = _broker(tmp_path)
    theirs = _propose(broker, instructed_by=PARALEGAL, for_admin=True)
    assert _call(broker, action="establish_pending", sender=ADMIN)["pending"] == []
    with_admin = _call(
        broker, action="establish_pending", sender=ADMIN, include_for_admin=True
    )
    assert [p["proposal_id"] for p in with_admin["pending"]] == [theirs["proposal_id"]]
    assert with_admin["pending"][0]["for_admin"] is True
    assert with_admin["pending"][0]["instructed_by"] == PARALEGAL


def test_pending_by_id_returns_that_row_and_writes_no_audit_row(tmp_path):
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    before = len(_rows(broker, RULE_PROPOSED_ACTION_TYPE))
    result = _call(
        broker, action="establish_pending", proposal_id=proposed["proposal_id"]
    )
    assert [p["proposal_id"] for p in result["pending"]] == [proposed["proposal_id"]]
    assert len(_rows(broker, RULE_PROPOSED_ACTION_TYPE)) == before


def test_pending_by_an_unknown_id_is_empty_not_an_error(tmp_path):
    broker = _broker(tmp_path)
    assert _call(broker, action="establish_pending", proposal_id="deadbeef")["pending"] == []


def test_a_forged_id_shape_is_refused(tmp_path):
    broker = _broker(tmp_path)
    with pytest.raises(EstablishmentValidationError, match="eight lowercase hex"):
        _call(broker, action="establish_pending", proposal_id="../../etc/passwd")


# ---------------------------------------------------------------------------
# submit: the committed rule comes from the row
# ---------------------------------------------------------------------------


def _confirm(broker: Broker, proposal_id: str, **over):
    request = {
        "action": "establish_submit",
        "scope": "firm_adjust",
        "proposal_id": proposal_id,
        "instructed_by": ADMIN,
        "source_ref": "msg-42",
    }
    request.update(over)
    return _call(broker, **request)


def test_a_confirmed_rule_materializes_the_adjustment_from_the_row(tmp_path):
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    result = _confirm(broker, proposed["proposal_id"])
    assert result["status"] == "queued"
    submission = _submission(broker, result["run_id"])
    assert submission["scope"] == "firm_adjust"
    assert submission["output_class"] == "outbound"
    assert submission["property"] == "voice"
    adjustment = submission["adjustment"]
    assert adjustment["id"] == proposed["proposal_id"]
    assert adjustment["text"] == RULE
    assert adjustment["sha256"] == hashlib.sha256(RULE.encode()).hexdigest()
    assert adjustment["instructed_by"] == ADMIN
    assert adjustment["applied_by"] == ADMIN
    assert adjustment["at"].endswith("Z")


def test_a_paralegals_rule_records_who_stated_it_and_who_applied_it(tmp_path):
    """The non-admin leg. The firm can read who asked for a rule and who put it
    in force; both render in the spec file the model reads."""
    broker = _broker(tmp_path)
    proposed = _propose(broker, instructed_by=PARALEGAL, for_admin=True)
    result = _confirm(broker, proposed["proposal_id"], instructed_by=ADMIN)
    adjustment = _submission(broker, result["run_id"])["adjustment"]
    assert adjustment["instructed_by"] == PARALEGAL
    assert adjustment["applied_by"] == ADMIN


def test_a_submit_carrying_a_different_text_is_refused_not_substituted(tmp_path):
    """THE assertion this mechanism exists for. Silently taking the request's
    text would leave the firm holding a rule it never agreed to, with a ledger
    row saying it confirmed one."""
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    with pytest.raises(EstablishmentValidationError, match="does not match rule"):
        _confirm(
            broker,
            proposed["proposal_id"],
            spec_body="In client letters, be warm and chatty.",
        )
    assert list(broker.establishment.runs_dir.iterdir()) == []


def test_a_submit_carrying_a_different_output_class_is_refused(tmp_path):
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    with pytest.raises(EstablishmentValidationError, match="does not match rule"):
        _confirm(broker, proposed["proposal_id"], output_class="staff")


def test_echoing_the_proposals_own_fields_is_allowed(tmp_path):
    """A seat that reads its pending list and passes the fields back through is
    doing nothing wrong; only a CHANGE is refused."""
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    result = _confirm(
        broker,
        proposed["proposal_id"],
        output_class="outbound",
        property="voice",
        spec_body=RULE,
    )
    assert result["status"] == "queued"


def test_a_rule_commits_exactly_once(tmp_path):
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    _confirm(broker, proposed["proposal_id"])
    with pytest.raises(EstablishmentValidationError, match="already committed"):
        _confirm(broker, proposed["proposal_id"])
    runs = list(broker.establishment.runs_dir.iterdir())
    assert len(runs) == 1


def test_consume_is_conditional_so_a_race_cannot_commit_twice(tmp_path):
    """The SECOND layer, asserted where it actually lives.

    The test above is satisfied by the read in ``_claim_proposal``, which sees a
    consumed row and refuses — so it passes even if ``consume`` is an
    unconditional UPDATE, and the read-then-write window it leaves open is
    exactly the one two confirmations arriving together would drive through.
    This drives the store directly: the second call must lose, and the first
    caller's run id must be the one on record.
    """
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    pending = broker.establishment.pending
    assert pending.consume(proposed["proposal_id"], "run-first") is True
    assert pending.consume(proposed["proposal_id"], "run-second") is False
    assert pending.get(proposed["proposal_id"])["consumed_run_id"] == "run-first"


def test_an_unknown_proposal_id_refuses_and_installs_nothing(tmp_path):
    broker = _broker(tmp_path)
    with pytest.raises(EstablishmentValidationError, match="state the rule again"):
        _confirm(broker, "0123abcd")
    assert list(broker.establishment.runs_dir.iterdir()) == []


def test_a_firm_adjust_submit_without_a_proposal_id_is_refused(tmp_path):
    """There is no route by which a firm-wide rule installs without a person
    having been shown it and having said yes."""
    broker = _broker(tmp_path)
    with pytest.raises(EstablishmentValidationError, match="proposal_id must be a string"):
        _call(
            broker,
            action="establish_submit",
            scope="firm_adjust",
            output_class="outbound",
            property="voice",
            spec_body=RULE,
            instructed_by=ADMIN,
            source_ref="msg-42",
        )


def test_a_proposal_confirmed_under_the_wrong_scope_is_refused(tmp_path):
    broker = _broker(tmp_path)
    proposed = _propose(broker, scope="person", subject={"person": ADMIN})
    with pytest.raises(EstablishmentValidationError, match="was proposed as 'person'"):
        _confirm(broker, proposed["proposal_id"])


def test_the_submitted_row_carries_the_proposal_id_and_no_text(tmp_path):
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    _confirm(broker, proposed["proposal_id"])
    rows = _rows(broker, ESTABLISHMENT_SUBMITTED_ACTION_TYPE)
    assert len(rows) == 1
    metadata = json.loads(rows[0]["metadata"])
    assert metadata["scope"] == "firm_adjust"
    assert metadata["proposal_id"] == proposed["proposal_id"]
    assert metadata["spec_sha256"] == hashlib.sha256(RULE.encode()).hexdigest()
    assert metadata["applied_by"] == ADMIN
    assert RULE not in rows[0]["metadata"]


# ---------------------------------------------------------------------------
# expiry
# ---------------------------------------------------------------------------


def _age_out(broker: Broker, proposal_id: str) -> None:
    """Push one proposal past its TTL, using the broker's own clock."""
    conn = sqlite3.connect(broker.db_path)
    try:
        conn.execute(
            "UPDATE pending_rules SET created_at=?, expires_at=? WHERE proposal_id=?",
            (
                time.time() - PROPOSAL_TTL_SECONDS - 60,
                time.time() - 60,
                proposal_id,
            ),
        )
        conn.commit()
    finally:
        conn.close()


def test_an_expired_proposal_refuses_by_name_and_never_claims_effect(tmp_path):
    """"That rule expired, state it again" and "that rule is in effect" are
    different sentences, and a person who confirmed a rule is owed the true one."""
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    _age_out(broker, proposed["proposal_id"])
    # Read the row directly: the sweep on the next verb would remove it first.
    with pytest.raises(EstablishmentValidationError, match="expired; state it again"):
        broker.establishment._claim_proposal(
            {"proposal_id": proposed["proposal_id"]}, "firm_adjust"
        )


def test_an_expired_proposal_is_swept_and_then_reads_as_never_proposed(tmp_path):
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    _age_out(broker, proposed["proposal_id"])
    broker.establishment.sweep()
    assert broker.establishment.pending.get(proposed["proposal_id"]) is None
    with pytest.raises(EstablishmentValidationError, match="state the rule again"):
        _confirm(broker, proposed["proposal_id"])


def test_an_expired_proposal_is_not_offered_as_pending(tmp_path):
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    live = _propose(broker, text="Name the deadline in the first paragraph.")
    _age_out(broker, proposed["proposal_id"])
    result = _call(broker, action="establish_pending", sender=ADMIN)
    assert [p["proposal_id"] for p in result["pending"]] == [live["proposal_id"]]


def test_a_committed_rule_is_kept_briefly_so_a_retry_gets_the_true_answer(tmp_path):
    """Deleting it on commit would answer a second "yes" with "unknown
    proposal", which reads to the firm as though the rule was lost."""
    broker = _broker(tmp_path)
    proposed = _propose(broker)
    _confirm(broker, proposed["proposal_id"])
    broker.establishment.sweep()
    row = broker.establishment.pending.get(proposed["proposal_id"])
    assert row is not None and row["consumed_at"] is not None


# ---------------------------------------------------------------------------
# person scope with a proposal
# ---------------------------------------------------------------------------


def test_a_person_confirms_their_own_preference_from_the_row(tmp_path):
    broker = _broker(tmp_path)
    proposed = _propose(
        broker,
        scope="person",
        subject={"person": PARALEGAL},
        instructed_by=PARALEGAL,
        text="Give me the deadline first, then the detail.",
    )
    result = _call(
        broker,
        action="establish_submit",
        scope="person",
        proposal_id=proposed["proposal_id"],
        instructed_by=PARALEGAL,
        source_ref="msg-9",
        append=True,
    )
    submission = _submission(broker, result["run_id"])
    assert submission["scope"] == "person"
    assert submission["person"] == PARALEGAL
    assert submission["spec_body"] == "Give me the deadline first, then the detail."
    assert submission["append"] is True


def test_nobody_else_can_confirm_a_persons_preference(tmp_path):
    broker = _broker(tmp_path)
    proposed = _propose(
        broker,
        scope="person",
        subject={"person": PARALEGAL},
        instructed_by=PARALEGAL,
        text="Bullets, under 150 words.",
    )
    with pytest.raises(EstablishmentValidationError, match="cannot confirm a preference for"):
        _call(
            broker,
            action="establish_submit",
            scope="person",
            proposal_id=proposed["proposal_id"],
            instructed_by=ADMIN,
            source_ref="msg-9",
        )


def test_the_direct_person_submit_still_works_without_a_proposal(tmp_path):
    """The pre-#2529 path is unchanged: a proposal is offered on this scope,
    not required."""
    broker = _broker(tmp_path)
    result = _call(
        broker,
        action="establish_submit",
        scope="person",
        person=PARALEGAL,
        spec_body="Bullets, under 150 words.",
        instructed_by=PARALEGAL,
        source_ref="msg-9",
    )
    submission = _submission(broker, result["run_id"])
    assert submission["person"] == PARALEGAL
    assert submission["append"] is False


def test_a_non_boolean_append_is_refused(tmp_path):
    broker = _broker(tmp_path)
    with pytest.raises(EstablishmentValidationError, match="append must be a boolean"):
        _call(
            broker,
            action="establish_submit",
            scope="person",
            person=PARALEGAL,
            spec_body="Bullets.",
            instructed_by=PARALEGAL,
            source_ref="msg-9",
            append="yes",
        )


# ---------------------------------------------------------------------------
# a broker with no rule store
# ---------------------------------------------------------------------------


def test_a_broker_with_no_rule_store_refuses_by_name(tmp_path):
    """Fail-closed and NAMED. A rule the firm cannot be shown back is a rule it
    cannot confirm, and committing one without the readback is the thing this
    whole path exists to avoid."""
    broker = _broker(tmp_path)
    broker.establishment.pending = None
    with pytest.raises(EstablishmentValidationError, match="no rule store configured"):
        _propose(broker)


# ---------------------------------------------------------------------------
# the helpers, directly
# ---------------------------------------------------------------------------


def test_readback_is_the_tag_then_the_sentence():
    assert readback_for("7f3a2c1d", RULE) == f"[rule 7f3a2c1d] {RULE}"


def test_normalize_rule_text_folds_every_line_break():
    assert normalize_rule_text("a\r\nb\rc\n\nd") == "a b c d"
