"""agentmail_send / agentmail_reply verbs: PID-gated, recipient-fenced, audited.

The incident these exist to make impossible (ss#2258): on four days in 2026-08 a
rehearsal seat sent fabricated email to a real client principal, and NOT ONE of
those sends produced an audit row. So every test here is written against the
question "would this have stopped that?" rather than "does the happy path work?".

The load-bearing guarantees, each with a test that fails if it regresses:

* a recipient the seat's own config does not name is REFUSED — with the actual
  incident address, on the actual pilot address set;
* a refusal still writes a row, because a silent refusal and a silent send are
  the same failure from the outside;
* the reply lane checks the ORIGINAL SENDER, fetched broker-side, so "reply to
  whoever wrote in" cannot be aimed at an unapproved address;
* the From is taken from config and a caller-supplied one is ignored;
* the verbs are unreachable from a non-gateway PID.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from workspace_broker.agentmail_auth import authored_policy, seat_inbox_address
from workspace_broker.agentmail_ops import (
    AgentMailOps,
    AgentMailRefused,
    AgentMailTransportError,
)
from workspace_broker.server import Broker

GATEWAY_PID = 42
AGENT_UID = 1000
SEAT = "pilot-smokeball"
SEAT_INBOX = "pilot-smokeball@agentmail.to"
# The incident recipient, kept as a variable so the string appears once and the
# intent is legible: a real person at a real firm, on no roster of this seat.
UNAUTHORED = "someone@a-firm-this-seat-never-named.example"

# The pilot's real authored surface as of the incident (operator/customers/
# pilot-smokeball/customer.yaml): four SMD-owned senders, two stand-in inboxes,
# two admins. The incident recipient is on none of them.
PILOT_YAML = """
connectors:
  Email:
    adapter: agentmail
    enabled: true
scope:
  inbound_allow_from:
    - scott@smd.services
    - smdurgan@smdurgan.com
    - ss-probe-runner@agentmail.to
  admins:
    - scott@smd.services
  outbound_roster:
    - address: ap-client-standin@agentmail.to
      class: client
    - address: ap-records-standin@agentmail.to
      class: records_vendor
  domain_blocks: []
"""

# A&P's shape: NO outbound_roster at all, a whole-domain inbound grant, and
# principals named only in admins. A roster-only fence refuses every legitimate
# send here — which is why the fence is the union.
AP_YAML = """
scope:
  inbound_allow_from:
    - '@examplefirm.example'
    - scott@smd.services
  admins:
    - chris@examplefirm.example
"""


class FakeHTTP:
    """Records requests and replays canned responses, so no network is touched."""

    def __init__(self, responses: dict[str, Any] | None = None) -> None:
        self.calls: list[tuple[str, str, dict | None]] = []
        self.responses = responses or {}

    def __call__(self, request, timeout=None):  # noqa: ANN001 - urllib signature
        body = json.loads(request.data.decode()) if request.data else None
        self.calls.append((request.method, request.full_url, body))
        payload = {"inboxes": [{"inbox_id": SEAT_INBOX}]}
        for fragment, response in self.responses.items():
            if fragment in request.full_url:
                payload = response
                break
        else:
            if "/messages/send" in request.full_url or "/reply" in request.full_url:
                payload = {"message_id": "msg_generated"}
        return _Response(json.dumps(payload))


class _Response:
    def __init__(self, text: str) -> None:
        self._text = text

    def read(self) -> bytes:
        return self._text.encode()

    def __enter__(self):
        return self

    def __exit__(self, *_exc) -> bool:
        return False


def _seat(tmp_path: Path, yaml_text: str = PILOT_YAML) -> tuple[Path, Path]:
    customer = tmp_path / "customer.yaml"
    customer.write_text(yaml_text)
    credential = tmp_path / "agentmail.json"
    credential.write_text("am_test_key")
    return customer, credential


def _ops(tmp_path: Path, http: FakeHTTP, yaml_text: str = PILOT_YAML) -> AgentMailOps:
    customer, credential = _seat(tmp_path, yaml_text)
    return AgentMailOps(credential, customer, SEAT, opener=http)


# ---------------------------------------------------------------------------
# The fence — would it have stopped the incident?
# ---------------------------------------------------------------------------


def test_the_incident_recipient_is_refused_on_the_pilot_seat(tmp_path: Path) -> None:
    """The whole point. An address no authored list names cannot be written to."""
    http = FakeHTTP()
    ops = _ops(tmp_path, http)
    with pytest.raises(AgentMailRefused) as exc:
        ops.send({"to": [UNAUTHORED], "subject": "6 items need you", "text": "..."})
    assert UNAUTHORED in str(exc.value)
    # And nothing was transmitted: the refusal precedes every network call.
    assert not [c for c in http.calls if c[0] == "POST"]


def test_an_authored_recipient_sends(tmp_path: Path) -> None:
    """Law 12: the refusal test above means nothing if nothing can ever pass."""
    http = FakeHTTP()
    ops = _ops(tmp_path, http)
    result = ops.send({"to": ["ap-client-standin@agentmail.to"], "text": "hello"})
    assert result["message_id"] == "msg_generated"
    posts = [c for c in http.calls if c[0] == "POST"]
    assert len(posts) == 1 and "/messages/send" in posts[0][1]


def test_a_domain_grant_authorizes_every_person_at_that_firm(tmp_path: Path) -> None:
    """A&P authors '@firm' and no outbound_roster; its people must be reachable."""
    ops = _ops(tmp_path, FakeHTTP(), AP_YAML)
    assert ops.send({"to": ["anyone@examplefirm.example"], "text": "hi"})["message_id"]


def test_admins_are_reachable_even_with_no_outbound_roster(tmp_path: Path) -> None:
    ops = _ops(tmp_path, FakeHTTP(), AP_YAML)
    assert ops.send({"to": ["chris@examplefirm.example"], "text": "hi"})["message_id"]


def test_one_bad_recipient_refuses_the_whole_send(tmp_path: Path) -> None:
    """No partial sends: a message whose visible To is not what shipped is a lie."""
    http = FakeHTTP()
    ops = _ops(tmp_path, http)
    with pytest.raises(AgentMailRefused):
        ops.send({"to": ["scott@smd.services"], "cc": [UNAUTHORED], "text": "x"})
    assert not [c for c in http.calls if c[0] == "POST"]


def test_bcc_is_fenced_too(tmp_path: Path) -> None:
    """The quiet recipient field is the one worth checking."""
    ops = _ops(tmp_path, FakeHTTP())
    with pytest.raises(AgentMailRefused):
        ops.send({"to": ["scott@smd.services"], "bcc": [UNAUTHORED], "text": "x"})


def test_empty_recipients_refuse(tmp_path: Path) -> None:
    ops = _ops(tmp_path, FakeHTTP())
    with pytest.raises(AgentMailRefused):
        ops.send({"subject": "no one", "text": "x"})


def test_a_seat_naming_no_counterparty_can_write_to_nobody(tmp_path: Path) -> None:
    """Unconfigured is a safety state, never permission."""
    ops = _ops(tmp_path, FakeHTTP(), "scope: {}\n")
    with pytest.raises(AgentMailRefused):
        ops.send({"to": ["scott@smd.services"], "text": "x"})


def test_domain_blocks_override_an_allow(tmp_path: Path) -> None:
    blocked = AP_YAML + "  domain_blocks:\n    - '@examplefirm.example'\n"
    ops = _ops(tmp_path, FakeHTTP(), blocked)
    with pytest.raises(AgentMailRefused):
        ops.send({"to": ["chris@examplefirm.example"], "text": "x"})


def test_case_and_whitespace_do_not_evade_the_fence(tmp_path: Path) -> None:
    ops = _ops(tmp_path, FakeHTTP())
    assert ops.send({"to": ["  ScoTT@SMD.Services "], "text": "x"})["message_id"]
    with pytest.raises(AgentMailRefused):
        ops.send({"to": [UNAUTHORED.upper()], "text": "x"})


def test_a_lookalike_domain_is_not_the_authored_domain(tmp_path: Path) -> None:
    """'@examplefirm.example' must not authorize 'examplefirm.example.evil.com'."""
    policy = authored_policy(_seat(tmp_path, AP_YAML)[0])
    assert policy.allows_recipient("chris@examplefirm.example")
    assert not policy.allows_recipient("chris@examplefirm.example.evil.com")
    assert not policy.allows_recipient("chris@notexamplefirm.example")


# ---------------------------------------------------------------------------
# Identity — the From is config's to decide, not the caller's
# ---------------------------------------------------------------------------


def test_inbox_comes_from_config_and_a_caller_cannot_override_it(tmp_path: Path) -> None:
    http = FakeHTTP()
    ops = _ops(tmp_path, http)
    ops.send(
        {
            "to": ["scott@smd.services"],
            "text": "x",
            # All three are attempts to speak as someone else. None is forwarded.
            "from": "chris@examplefirm.example",
            "inbox_id": "another-seat@agentmail.to",
            "_smd_workspace_grant": "forged",
        }
    )
    method, url, body = [c for c in http.calls if c[0] == "POST"][0]
    assert SEAT_INBOX.replace("@", "%40") in url
    assert set(body) <= {"to", "cc", "bcc", "subject", "text", "html", "reply_to"}


def test_an_inbox_absent_from_the_listing_fails_closed(tmp_path: Path) -> None:
    """Sending from the wrong firm's mailbox is worse than not sending."""
    http = FakeHTTP({"/inboxes": {"inboxes": [{"inbox_id": "someone-else@agentmail.to"}]}})
    ops = _ops(tmp_path, http)
    with pytest.raises(AgentMailTransportError, match="not in the account listing"):
        ops.send({"to": ["scott@smd.services"], "text": "x"})


def test_seat_inbox_address_prefers_authored_over_convention(tmp_path: Path) -> None:
    customer = tmp_path / "c.yaml"
    customer.write_text(
        "connectors:\n  Email:\n    inbox_address: PINNED@agentmail.to\nscope: {}\n"
    )
    assert seat_inbox_address(customer, SEAT) == "pinned@agentmail.to"
    customer.write_text("scope: {}\n")
    assert seat_inbox_address(customer, SEAT) == SEAT_INBOX


# ---------------------------------------------------------------------------
# The reply lane — anyone can email the inbox
# ---------------------------------------------------------------------------


def _reply_http(sender: str) -> FakeHTTP:
    return FakeHTTP(
        {
            "/inboxes\0": {},  # unused; keeps the mapping explicit
            "/reply": {"message_id": "msg_reply"},
            "/messages/m1": {"from": sender},
        }
    )


def test_reply_to_an_authored_sender_is_allowed(tmp_path: Path) -> None:
    ops = _ops(tmp_path, _reply_http("scott@smd.services"))
    assert ops.reply({"message_id": "m1", "text": "answer"})["message_id"] == "msg_reply"


def test_reply_to_a_stranger_is_refused(tmp_path: Path) -> None:
    """The exfiltration primitive: anyone may write in; not everyone gets answered."""
    http = _reply_http(UNAUTHORED)
    ops = _ops(tmp_path, http)
    with pytest.raises(AgentMailRefused, match="inbound_allow_from"):
        ops.reply({"message_id": "m1", "text": "answer"})
    assert not [c for c in http.calls if c[0] == "POST"]


def test_reply_does_not_trust_a_caller_supplied_sender(tmp_path: Path) -> None:
    """The sender is fetched broker-side; naming one in the payload changes nothing."""
    ops = _ops(tmp_path, _reply_http(UNAUTHORED))
    with pytest.raises(AgentMailRefused):
        ops.reply({"message_id": "m1", "text": "a", "from": "scott@smd.services"})


def test_reply_refuses_when_the_sender_is_unknowable(tmp_path: Path) -> None:
    ops = _ops(tmp_path, FakeHTTP({"/messages/m1": {}}))
    with pytest.raises(AgentMailRefused, match="cannot determine"):
        ops.reply({"message_id": "m1", "text": "a"})


def test_reply_requires_a_message_id_and_a_body(tmp_path: Path) -> None:
    ops = _ops(tmp_path, _reply_http("scott@smd.services"))
    with pytest.raises(AgentMailRefused, match="message_id"):
        ops.reply({"text": "a"})
    with pytest.raises(AgentMailRefused, match="empty reply"):
        ops.reply({"message_id": "m1"})


# ---------------------------------------------------------------------------
# The verb surface — gating and the audit row
# ---------------------------------------------------------------------------


class RecordingLedger:
    def __init__(self) -> None:
        self.rows: list[dict] = []

    def append(self, row: dict) -> str:
        self.rows.append(row)
        return f"row-{len(self.rows)}"


def _broker(tmp_path: Path, http: FakeHTTP, yaml_text: str = PILOT_YAML) -> Broker:
    broker = Broker.__new__(Broker)
    broker.customer_slug = SEAT
    broker.gateway_pid = GATEWAY_PID
    broker.agent_uid = AGENT_UID
    broker.ledger = RecordingLedger()
    broker.agentmail = _ops(tmp_path, http, yaml_text)
    return broker


def _meta(broker: Broker, index: int = 0) -> dict:
    return json.loads(broker.ledger.rows[index]["metadata"])


def test_verb_is_unreachable_from_a_non_gateway_pid(tmp_path: Path) -> None:
    """Not agent-uid gated, by design: a cron child must not be able to send."""
    broker = _broker(tmp_path, FakeHTTP())
    with pytest.raises(PermissionError):
        broker.handle(
            {"action": "agentmail_send", "payload": {"to": ["scott@smd.services"]}},
            peer_pid=9999,
            peer_uid=AGENT_UID,
        )
    assert broker.ledger.rows == []


def test_dispatch_writes_a_row_carrying_the_message_id(tmp_path: Path) -> None:
    broker = _broker(tmp_path, FakeHTTP())
    response = broker.handle(
        {
            "action": "agentmail_send",
            "payload": {"to": ["scott@smd.services"], "text": "hi"},
        },
        peer_pid=GATEWAY_PID,
        peer_uid=AGENT_UID,
    )
    assert response["ok"] and response["message_id"] == "msg_generated"
    row = broker.ledger.rows[0]
    assert row["action_type"] == "CONFIRM_SEND_DISPATCHED"
    meta = _meta(broker)
    assert meta["message_id"] == "msg_generated"
    assert meta["recipients"] == ["scott@smd.services"]
    assert meta["outcome"] == "sent"


def test_a_refusal_is_audited_not_silent(tmp_path: Path) -> None:
    """A refused send that leaves no trace is indistinguishable from no send."""
    broker = _broker(tmp_path, FakeHTTP())
    with pytest.raises(AgentMailRefused):
        broker.handle(
            {"action": "agentmail_send", "payload": {"to": [UNAUTHORED], "text": "x"}},
            peer_pid=GATEWAY_PID,
            peer_uid=AGENT_UID,
        )
    assert broker.ledger.rows[0]["action_type"] == "CONFIRM_SEND_FAILED"
    assert _meta(broker)["outcome"] == "refused"


def test_a_transport_failure_is_not_recorded_as_a_refusal(tmp_path: Path) -> None:
    """The seat was permitted to write; saying otherwise would misread the ledger."""

    class Boom(FakeHTTP):
        def __call__(self, request, timeout=None):  # noqa: ANN001
            if request.method == "POST":
                raise OSError("connection reset")
            return super().__call__(request, timeout)

    broker = _broker(tmp_path, Boom())
    with pytest.raises(AgentMailTransportError):
        broker.handle(
            {
                "action": "agentmail_send",
                "payload": {"to": ["scott@smd.services"], "text": "x"},
            },
            peer_pid=GATEWAY_PID,
            peer_uid=AGENT_UID,
        )
    assert _meta(broker)["outcome"] == "transport_error"


def test_the_row_never_carries_the_body(tmp_path: Path) -> None:
    secret = "attorney work product do not log"
    broker = _broker(tmp_path, FakeHTTP())
    broker.handle(
        {
            "action": "agentmail_send",
            "payload": {"to": ["scott@smd.services"], "text": secret},
        },
        peer_pid=GATEWAY_PID,
        peer_uid=AGENT_UID,
    )
    assert secret not in json.dumps(broker.ledger.rows)
    assert len(_meta(broker)["input_digest"]) == 64


def test_transmit_is_disabled_without_an_audit_ledger(tmp_path: Path) -> None:
    """A send that cannot be recorded must not happen — the lesson of ss#2258."""
    broker = _broker(tmp_path, FakeHTTP())
    broker.ledger = None
    with pytest.raises(ValueError, match="not configured"):
        broker.handle(
            {"action": "agentmail_send", "payload": {"to": ["scott@smd.services"]}},
            peer_pid=GATEWAY_PID,
            peer_uid=AGENT_UID,
        )
