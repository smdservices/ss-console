"""msgraph_send / msgraph_reply verbs: PID-gated, recipient-fenced, audited.

The msgraph sibling of ``test_agentmail_send``, written against the same question
— "would this have stopped the incident?" — and against one the AgentMail file
does not have to ask.

On four days in 2026-08 a rehearsal seat sent fabricated email to a real client
principal and NOT ONE of those sends produced an audit row. The AgentMail fix
stacks two fences: the vendor makes the agent's key incapable of transmitting,
and the broker fences the recipient. This channel gets only the second, because
a Graph app-only token is always ``/.default`` and the agent legitimately needs
Graph credentials for the inbound poller and its mail tools.

So these tests pin what IS true here, and the file says plainly what is not:

* a recipient the seat's own config does not name is REFUSED — including in bcc,
  which delivers and which a fence reading only the visible recipients misses;
* a refusal still writes a row, because a silent refusal and a silent send look
  identical from outside;
* the reply lane checks the ORIGINAL SENDER, fetched broker-side, so "reply to
  whoever wrote in" cannot be aimed at an unapproved address;
* the mailbox comes from customer.yaml and a caller-supplied one is ignored;
* the verbs are unreachable from a non-gateway PID.

NOT proven here, and not provable here: that no path can reach Graph. Only a
second, read-only app registration in the tenant makes that sentence true.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from workspace_broker.msgraph_auth import (  # noqa: E402
    load_credential,
    materialize_credential,
    seat_mailbox,
)
from workspace_broker.msgraph_ops import (  # noqa: E402
    MsGraphOps,
    MsGraphRefused,
    MsGraphTransportError,
)
from workspace_broker.server import Broker  # noqa: E402

GATEWAY_PID = 42
AGENT_UID = 1000
SEAT = "smd-staging"
MAILBOX = "operator@opslab.example"
# A real person at a real firm, on no authored list of this seat — the shape of
# the address the incident actually reached.
UNAUTHORED = "someone@a-firm-this-seat-never-named.example"

# The staging seat's shape: an msgraph mailbox, two authored senders, no
# outbound_roster. A roster-only fence would refuse every legitimate send here.
STAGING_YAML = f"""
connectors:
  Email:
    adapter: msgraph
    backend: mcp:msgraph-mail
    enabled: true
    msgraph_auth:
      tenant_id: '11111111-1111-1111-1111-111111111111'
      client_id: '22222222-2222-2222-2222-222222222222'
      mailbox: {MAILBOX}
scope:
  inbound_allow_from:
    - scott@smd.services
  admins:
    - scott@smd.services
  domain_blocks: []
"""

# A law-firm shape on the Graph channel: a whole-domain inbound grant, principals
# named only in admins, and a blocked domain to prove deny beats allow.
FIRM_YAML = f"""
connectors:
  Email:
    adapter: msgraph
    enabled: true
    msgraph_auth:
      mailbox: {MAILBOX}
scope:
  inbound_allow_from:
    - '@examplefirm.example'
  admins:
    - chris@examplefirm.example
  domain_blocks:
    - blocked.example
"""

# A seat that authors NO counterparty at all. Must permit nothing: unconfigured
# is a safety state, never permission.
EMPTY_YAML = f"""
connectors:
  Email:
    adapter: msgraph
    enabled: true
    msgraph_auth:
      mailbox: {MAILBOX}
scope: {{}}
"""


class _Response:
    def __init__(self, text: str) -> None:
        self._text = text

    def read(self) -> bytes:
        return self._text.encode()

    def __enter__(self):
        return self

    def __exit__(self, *_exc) -> bool:
        return False


class FakeGraph:
    """Records requests and replays canned responses; no network is touched.

    Answers the token mint, returns an empty body for ``sendMail``/``reply`` (Graph
    really does answer 202 with nothing), and serves a source message for the
    reply lane's independent sender fetch.
    """

    def __init__(self, *, source_from: str | None = None) -> None:
        self.calls: list[tuple[str, str, dict | None]] = []
        self._source_from = source_from

    def __call__(self, request, timeout=None):  # noqa: ANN001 - urllib signature
        url = request.full_url
        raw = request.data
        body: dict | None = None
        if raw and url.endswith("/token"):
            body = {"form": raw.decode()}
        elif raw:
            body = json.loads(raw.decode())
        self.calls.append((request.method, url, body))
        if url.endswith("/token"):
            return _Response(json.dumps({"access_token": "tok", "expires_in": 3600}))
        if request.method == "GET" and "/messages/" in url:
            return _Response(
                json.dumps({"from": {"emailAddress": {"address": self._source_from or ""}}})
            )
        # sendMail / reply: 202, no body.
        return _Response("")

    def graph_posts(self) -> list[tuple[str, str, dict | None]]:
        return [c for c in self.calls if c[0] == "POST" and not c[1].endswith("/token")]


def _seat(tmp_path: Path, yaml_text: str = STAGING_YAML) -> tuple[Path, Path]:
    customer = tmp_path / "customer.yaml"
    customer.write_text(yaml_text)
    credential = tmp_path / "msgraph.json"
    credential.write_text(
        json.dumps({"tenant_id": "tid", "client_id": "cid", "client_secret": "shh"})
    )
    return customer, credential


def _ops(tmp_path: Path, http: FakeGraph, yaml_text: str = STAGING_YAML) -> MsGraphOps:
    customer, credential = _seat(tmp_path, yaml_text)
    return MsGraphOps(credential, customer, opener=http)


# ---------------------------------------------------------------------------
# The fence — would it have stopped the incident?
# ---------------------------------------------------------------------------


def test_the_incident_recipient_is_refused(tmp_path: Path) -> None:
    """The whole point. An address no authored list names cannot be written to."""
    http = FakeGraph()
    ops = _ops(tmp_path, http)
    with pytest.raises(MsGraphRefused) as exc:
        ops.send({"to": [UNAUTHORED], "subject": "6 items need you", "body_text": "..."})
    assert UNAUTHORED in str(exc.value)
    # Nothing was transmitted, and no token was even minted: the refusal precedes
    # every network call, so a fenced send costs the credential nothing.
    assert http.calls == []


def test_an_authored_recipient_sends(tmp_path: Path) -> None:
    """Law 12: the refusal above means nothing if nothing can ever pass."""
    http = FakeGraph()
    ops = _ops(tmp_path, http)
    result = ops.send({"to": ["scott@smd.services"], "body_text": "hello"})
    assert result["mailbox"] == MAILBOX
    posts = http.graph_posts()
    assert len(posts) == 1 and posts[0][1].endswith("/sendMail")


def test_bcc_is_fenced_because_bcc_delivers(tmp_path: Path) -> None:
    """A fence reading only to/cc passes a message whose blind copy goes anywhere,
    and writes a row naming the wrong people — clean-looking and wrong."""
    http = FakeGraph()
    ops = _ops(tmp_path, http)
    with pytest.raises(MsGraphRefused) as exc:
        ops.send({"to": ["scott@smd.services"], "bcc": [UNAUTHORED], "body_text": "x"})
    assert UNAUTHORED in str(exc.value)
    assert http.calls == []


def test_a_domain_grant_authorizes_every_person_at_that_firm(tmp_path: Path) -> None:
    ops = _ops(tmp_path, FakeGraph(), FIRM_YAML)
    assert ops.send({"to": ["anyone@examplefirm.example"], "body_text": "hi"})["mailbox"]


def test_admins_are_reachable_with_no_outbound_roster(tmp_path: Path) -> None:
    ops = _ops(tmp_path, FakeGraph(), FIRM_YAML)
    assert ops.send({"to": ["chris@examplefirm.example"], "body_text": "hi"})["mailbox"]


def test_a_blocked_domain_beats_an_allow(tmp_path: Path) -> None:
    http = FakeGraph()
    ops = _ops(tmp_path, http, FIRM_YAML)
    with pytest.raises(MsGraphRefused):
        ops.send({"to": ["someone@blocked.example"], "body_text": "x"})
    assert http.calls == []


def test_an_unconfigured_seat_permits_nothing(tmp_path: Path) -> None:
    """Unconfigured is a safety state, never permission."""
    ops = _ops(tmp_path, FakeGraph(), EMPTY_YAML)
    with pytest.raises(MsGraphRefused):
        ops.send({"to": ["scott@smd.services"], "body_text": "x"})


def test_one_bad_recipient_refuses_the_whole_send(tmp_path: Path) -> None:
    """No partial sends: a message whose visible To is not what shipped is a lie."""
    http = FakeGraph()
    ops = _ops(tmp_path, http)
    with pytest.raises(MsGraphRefused):
        ops.send({"to": ["scott@smd.services"], "cc": [UNAUTHORED], "body_text": "x"})
    assert http.calls == []


def test_a_send_with_no_recipient_is_refused(tmp_path: Path) -> None:
    ops = _ops(tmp_path, FakeGraph())
    with pytest.raises(MsGraphRefused):
        ops.send({"subject": "S", "body_text": "B"})


def test_a_display_name_recipient_is_parsed_not_compared_raw(tmp_path: Path) -> None:
    """Mail carries "Name <addr>" as often as bare; comparing that raw refuses
    everyone, which would look like a working fence and be a broken product."""
    ops = _ops(tmp_path, FakeGraph())
    assert ops.send({"to": ['"Scott" <Scott@SMD.Services>'], "body_text": "x"})["mailbox"]


# ---------------------------------------------------------------------------
# Identity — the From is not the caller's to choose
# ---------------------------------------------------------------------------


def test_the_mailbox_comes_from_config_and_a_supplied_one_is_ignored(tmp_path: Path) -> None:
    http = FakeGraph()
    ops = _ops(tmp_path, http)
    ops.send(
        {
            "to": ["scott@smd.services"],
            "body_text": "x",
            "mailbox": "attacker@evil.example",
            "from": "attacker@evil.example",
            "sender": "attacker@evil.example",
        }
    )
    method, url, body = http.graph_posts()[0]
    assert f"/users/{MAILBOX}/sendMail" in url
    assert "evil.example" not in json.dumps(body)


def test_a_seat_with_no_authored_msgraph_mailbox_refuses(tmp_path: Path) -> None:
    """An agentmail seat has no Graph identity; absence must not become a default."""
    ops = _ops(
        tmp_path,
        FakeGraph(),
        "connectors:\n  Email:\n    adapter: agentmail\n    enabled: true\n"
        "scope:\n  admins:\n    - scott@smd.services\n",
    )
    with pytest.raises(MsGraphTransportError):
        ops.send({"to": ["scott@smd.services"], "body_text": "x"})


def test_seat_mailbox_reads_only_an_msgraph_adapter(tmp_path: Path) -> None:
    path = tmp_path / "c.yaml"
    path.write_text(STAGING_YAML)
    assert seat_mailbox(path) == MAILBOX
    path.write_text(STAGING_YAML.replace("adapter: msgraph", "adapter: agentmail"))
    assert seat_mailbox(path) == ""


# ---------------------------------------------------------------------------
# Body shaping — what reaches the wire, and what cannot
# ---------------------------------------------------------------------------


def test_both_body_spellings_reach_the_wire(tmp_path: Path) -> None:
    """The confirm path sends `body_text`, the send tool sends `text`. One verb
    serves both, so neither caller silently ships an empty message."""
    for key in ("body_text", "text"):
        http = FakeGraph()
        ops = _ops(tmp_path, http)
        ops.send({"to": ["scott@smd.services"], key: "the body"})
        _m, _u, body = http.graph_posts()[0]
        assert body["message"]["body"]["content"] == "the body"
        assert body["message"]["body"]["contentType"] == "Text"


def test_an_html_body_is_sent_as_html(tmp_path: Path) -> None:
    http = FakeGraph()
    ops = _ops(tmp_path, http)
    ops.send({"to": ["scott@smd.services"], "text": "plain", "html": "<p>rich</p>"})
    _m, _u, body = http.graph_posts()[0]
    assert body["message"]["body"] == {"contentType": "HTML", "content": "<p>rich</p>"}


def test_unknown_payload_keys_never_reach_the_wire(tmp_path: Path) -> None:
    """A closed allowlist: no grant, approval marker, or caller bookkeeping rides
    along, and no `from`-shaped key can reach Graph at all."""
    http = FakeGraph()
    ops = _ops(tmp_path, http)
    ops.send(
        {
            "to": ["scott@smd.services"],
            "body_text": "x",
            "smd_grant": "secret-grant",
            "approved": True,
        }
    )
    _m, _u, body = http.graph_posts()[0]
    assert "smd_grant" not in json.dumps(body)
    assert set(body["message"]) <= {
        "subject",
        "body",
        "toRecipients",
        "ccRecipients",
        "bccRecipients",
        "replyTo",
    }


def test_a_202_with_no_body_is_success_not_a_parse_error(tmp_path: Path) -> None:
    """Graph answers sendMail with an empty body. Reading that as malformed would
    turn every successful send into a reported failure."""
    ops = _ops(tmp_path, FakeGraph())
    assert ops.send({"to": ["scott@smd.services"], "body_text": "x"})["message_id"] == ""


# ---------------------------------------------------------------------------
# The reply lane — anyone can email this mailbox
# ---------------------------------------------------------------------------


def test_reply_refuses_when_the_original_sender_is_not_authored(tmp_path: Path) -> None:
    http = FakeGraph(source_from=UNAUTHORED)
    ops = _ops(tmp_path, http)
    with pytest.raises(MsGraphRefused):
        ops.reply({"message_id": "AAMk123", "comment": "sure"})
    assert http.graph_posts() == []


def test_reply_allows_an_authored_sender(tmp_path: Path) -> None:
    """Law 12 control for the refusal above."""
    http = FakeGraph(source_from="scott@smd.services")
    ops = _ops(tmp_path, http)
    result = ops.reply({"message_id": "AAMk123", "comment": "sure"})
    assert result["recipients"] == ["scott@smd.services"]
    assert http.graph_posts()[0][1].endswith("/reply")


def test_reply_uses_the_fetched_sender_not_a_supplied_one(tmp_path: Path) -> None:
    """A caller that can name the sender can name any sender."""
    http = FakeGraph(source_from=UNAUTHORED)
    ops = _ops(tmp_path, http)
    with pytest.raises(MsGraphRefused):
        ops.reply(
            {"message_id": "AAMk123", "comment": "sure", "from": "scott@smd.services"}
        )


def test_reply_refuses_when_the_sender_cannot_be_determined(tmp_path: Path) -> None:
    ops = _ops(tmp_path, FakeGraph(source_from=""))
    with pytest.raises(MsGraphRefused):
        ops.reply({"message_id": "AAMk123", "comment": "sure"})


def test_reply_refuses_without_a_message_id_or_a_comment(tmp_path: Path) -> None:
    ops = _ops(tmp_path, FakeGraph(source_from="scott@smd.services"))
    with pytest.raises(MsGraphRefused):
        ops.reply({"comment": "sure"})
    with pytest.raises(MsGraphRefused):
        ops.reply({"message_id": "AAMk123", "comment": "   "})


def test_the_reply_lane_is_narrower_than_the_send_lane(tmp_path: Path) -> None:
    """``admins`` may be written to; only ``inbound_allow_from`` may be answered.

    On FIRM_YAML the admin is NOT on inbound_allow_from as an exact entry — the
    domain grant is what covers them — so this also pins that the reply check
    honours domain grants rather than exact entries alone.
    """
    http = FakeGraph(source_from="chris@examplefirm.example")
    ops = _ops(tmp_path, http, FIRM_YAML)
    assert ops.reply({"message_id": "m1", "comment": "ok"})["recipients"]


# ---------------------------------------------------------------------------
# Credential custody
# ---------------------------------------------------------------------------


def test_a_partially_staged_credential_refuses_to_boot(tmp_path: Path, monkeypatch) -> None:
    """A half-wired send path must not boot a seat that believes it can send."""
    monkeypatch.setenv("MSGRAPH_SEND_TENANT_ID", "tid")
    monkeypatch.setenv("MSGRAPH_SEND_CLIENT_ID", "cid")
    monkeypatch.delenv("MSGRAPH_SEND_CLIENT_SECRET", raising=False)
    with pytest.raises(RuntimeError) as exc:
        materialize_credential(tmp_path / "msgraph.json")
    assert "MSGRAPH_SEND_CLIENT_SECRET" in str(exc.value)
    assert "tid" not in str(exc.value)  # names, never values


def test_no_staged_credential_is_a_no_op_not_an_error(tmp_path: Path, monkeypatch) -> None:
    """A seat with no msgraph connector stages nothing; absence fails closed at
    send time, which is where it belongs."""
    for name in ("MSGRAPH_SEND_TENANT_ID", "MSGRAPH_SEND_CLIENT_ID", "MSGRAPH_SEND_CLIENT_SECRET"):
        monkeypatch.delenv(name, raising=False)
    target = tmp_path / "msgraph.json"
    materialize_credential(target)
    assert not target.exists()


def test_a_materialized_credential_is_0600(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("MSGRAPH_SEND_TENANT_ID", "tid")
    monkeypatch.setenv("MSGRAPH_SEND_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_SEND_CLIENT_SECRET", "shh")
    target = tmp_path / "msgraph.json"
    materialize_credential(target)
    assert target.stat().st_mode & 0o777 == 0o600
    assert load_credential(target)["client_secret"] == "shh"


@pytest.mark.parametrize(
    "content", ["", "not json", "[]", json.dumps({"tenant_id": "t", "client_id": "c"})]
)
def test_an_unusable_credential_file_reads_as_absent(tmp_path: Path, content: str) -> None:
    """Every failure mode collapses to "no credential", so a truncated or partial
    file refuses rather than half-attempting a send with a partial value."""
    path = tmp_path / "msgraph.json"
    path.write_text(content)
    assert load_credential(path) == {}


def test_a_missing_credential_refuses_at_send_time(tmp_path: Path) -> None:
    customer = tmp_path / "customer.yaml"
    customer.write_text(STAGING_YAML)
    ops = MsGraphOps(tmp_path / "absent.json", customer, opener=FakeGraph())
    with pytest.raises(MsGraphTransportError):
        ops.send({"to": ["scott@smd.services"], "body_text": "x"})


def test_the_client_secret_never_appears_in_a_token_error(tmp_path: Path) -> None:
    """The token endpoint echoes request parameters in its error bodies, and one
    of those parameters is the secret. Status only, never the body."""
    import urllib.error

    def _reject(request, timeout=None):  # noqa: ANN001
        raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, None)

    customer, credential = _seat(tmp_path)
    ops = MsGraphOps(credential, customer, opener=_reject)
    with pytest.raises(MsGraphTransportError) as exc:
        ops.send({"to": ["scott@smd.services"], "body_text": "x"})
    assert "401" in str(exc.value)
    assert "shh" not in str(exc.value)


# ---------------------------------------------------------------------------
# The verb surface — gating and the audit row
# ---------------------------------------------------------------------------


class RecordingLedger:
    def __init__(self) -> None:
        self.rows: list[dict] = []

    def append(self, row: dict) -> str:
        self.rows.append(row)
        return f"row-{len(self.rows)}"


def _broker(tmp_path: Path, http: FakeGraph, yaml_text: str = STAGING_YAML) -> Broker:
    broker = Broker.__new__(Broker)
    broker.customer_slug = SEAT
    broker.gateway_pid = GATEWAY_PID
    broker.agent_uid = AGENT_UID
    broker.ledger = RecordingLedger()
    broker.msgraph = _ops(tmp_path, http, yaml_text)
    return broker


def _meta(broker: Broker, index: int = 0) -> dict:
    return json.loads(broker.ledger.rows[index]["metadata"])


def test_verb_is_unreachable_from_a_non_gateway_pid(tmp_path: Path) -> None:
    """Not agent-uid gated, by design: a cron child must not be able to send."""
    broker = _broker(tmp_path, FakeGraph())
    with pytest.raises(PermissionError):
        broker.handle(
            {"action": "msgraph_send", "payload": {"to": ["scott@smd.services"]}},
            peer_pid=9999,
            peer_uid=AGENT_UID,
        )
    assert broker.ledger.rows == []


def test_dispatch_writes_a_row_naming_the_mailbox_and_recipients(tmp_path: Path) -> None:
    broker = _broker(tmp_path, FakeGraph())
    response = broker.handle(
        {
            "action": "msgraph_send",
            "payload": {"to": ["scott@smd.services"], "body_text": "hi"},
        },
        peer_pid=GATEWAY_PID,
        peer_uid=AGENT_UID,
    )
    assert response["ok"]
    row = broker.ledger.rows[0]
    assert row["action_type"] == "CONFIRM_SEND_DISPATCHED"
    meta = _meta(broker)
    assert meta["outcome"] == "sent"
    assert meta["recipients"] == ["scott@smd.services"]
    assert meta["mailbox"] == MAILBOX
    assert meta["verb"] == "msgraph_send"
    assert meta["input_digest"]


def test_a_refusal_is_audited_not_silent(tmp_path: Path) -> None:
    """A refused send that leaves no trace is indistinguishable from no send."""
    broker = _broker(tmp_path, FakeGraph())
    with pytest.raises(MsGraphRefused):
        broker.handle(
            {"action": "msgraph_send", "payload": {"to": [UNAUTHORED], "body_text": "x"}},
            peer_pid=GATEWAY_PID,
            peer_uid=AGENT_UID,
        )
    assert broker.ledger.rows[0]["action_type"] == "CONFIRM_SEND_FAILED"
    meta = _meta(broker)
    assert meta["outcome"] == "refused"
    assert meta["recipients"] == [UNAUTHORED]


def test_a_transport_failure_is_not_recorded_as_a_refusal(tmp_path: Path) -> None:
    """The seat WAS permitted to write and the vendor call failed; the message may
    even have gone out. Recording that as "forbidden" would be a lie in the
    ledger's own language, and the reconciler reads this field."""
    import urllib.error

    def _boom(request, timeout=None):  # noqa: ANN001
        if request.full_url.endswith("/token"):
            return _Response(json.dumps({"access_token": "tok", "expires_in": 3600}))
        raise urllib.error.HTTPError(request.full_url, 503, "nope", {}, None)

    customer, credential = _seat(tmp_path)
    broker = Broker.__new__(Broker)
    broker.customer_slug = SEAT
    broker.gateway_pid = GATEWAY_PID
    broker.agent_uid = AGENT_UID
    broker.ledger = RecordingLedger()
    broker.msgraph = MsGraphOps(credential, customer, opener=_boom)
    with pytest.raises(MsGraphTransportError):
        broker.handle(
            {
                "action": "msgraph_send",
                "payload": {"to": ["scott@smd.services"], "body_text": "x"},
            },
            peer_pid=GATEWAY_PID,
            peer_uid=AGENT_UID,
        )
    assert _meta(broker)["outcome"] == "transport_error"


def test_the_row_never_carries_the_body(tmp_path: Path) -> None:
    broker = _broker(tmp_path, FakeGraph())
    broker.handle(
        {
            "action": "msgraph_send",
            "payload": {
                "to": ["scott@smd.services"],
                "subject": "Quarterly",
                "body_text": "SECRET-BODY-TEXT",
            },
        },
        peer_pid=GATEWAY_PID,
        peer_uid=AGENT_UID,
    )
    assert "SECRET-BODY-TEXT" not in json.dumps(broker.ledger.rows)


def test_an_unconfigured_broker_refuses_the_verb(tmp_path: Path) -> None:
    """No ops object ⇒ no send. Absence must not read as permission."""
    broker = _broker(tmp_path, FakeGraph())
    broker.msgraph = None
    with pytest.raises(ValueError):
        broker.handle(
            {"action": "msgraph_send", "payload": {"to": ["scott@smd.services"]}},
            peer_pid=GATEWAY_PID,
            peer_uid=AGENT_UID,
        )


def test_the_reply_verb_writes_its_own_row(tmp_path: Path) -> None:
    broker = _broker(tmp_path, FakeGraph(source_from="scott@smd.services"))
    broker.handle(
        {"action": "msgraph_reply", "payload": {"message_id": "m1", "comment": "ok"}},
        peer_pid=GATEWAY_PID,
        peer_uid=AGENT_UID,
    )
    meta = _meta(broker)
    assert meta["verb"] == "msgraph_reply"
    assert meta["recipients"] == ["scott@smd.services"]
