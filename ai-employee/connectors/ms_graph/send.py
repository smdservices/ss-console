"""Reviewer-as-sender concrete implementation for Microsoft Graph.

Wave-2 (issue #881) follow-on to the Phase-1 draft surface in
[mailbox.py](./mailbox.py). Implements the partner-tap-triggered send
of an existing draft, per
[ADR 0005](../../../../docs/adr/0005-reviewer-as-sender.md).

Pattern A flow:

1. The Email capability adapter (mailbox.py) creates a draft in the
   reviewer's Drafts folder via `POST /me/messages` (Phase-1 scope:
   ``Mail.ReadWrite``). The reviewer sees it natively in Outlook /
   Outlook on the web.
2. The reviewer reviews. If they want to ship it via their own
   client they hit Send from Outlook directly -- the agent never
   touches that path.
3. The reviewer can also approve from the AI Employee dashboard.
   When they do, the dashboard fires the send via this module as a
   partner-tap action. The send goes through the reviewer's OAuth
   grant (delegated permissions); the resulting message lands in the
   reviewer's Sent folder, signed by and sent from their identity.

The agent never holds a send token. The reviewer always does. The
dashboard is not "the agent sending on the reviewer's behalf" -- it is
a tool that fires an API call on the reviewer's behalf only after
their explicit tap, the same way Outlook's Send button does.

Capability surface
------------------

The Email capability interface deliberately omits a ``send`` method
(see [capability-contracts.md](../../../../docs/specs/ai-employee/capability-contracts.md)
§"Pattern A vs Pattern B resolution"). Skills MUST NOT call this
module. It is reachable only from the dashboard's send endpoint as a
direct partner-tap binding -- a separate code path from the capability
adapter surface.

The module's exports are deliberately functional (not bound to an
``Email``-shaped class) so that the capability runtime's CI grep at
``connector-smoke-tests.md`` and the conformance test
(``no method named send_*`` on Email) keep passing. The send path is
a sibling of the Email surface, not an extension of it.

OAuth scope requirement
-----------------------

This module requires the reviewer's OAuth grant to carry
``Mail.Send`` (wave-2 scope) in addition to the Phase-1 ``Mail.ReadWrite``
scope used by ``mailbox.create_draft``. Customers opt in by completing
the wave-2 re-consent flow, which requests scopes from
``oauth.PHASE_2_SCOPES``. If the reviewer's stored token lacks
``Mail.Send`` (e.g., still on Phase-1 consent), the Graph API rejects
with HTTP 403 and the client maps that to
``AdapterError(code="forbidden")``; the dashboard surfaces a
re-consent prompt rather than fabricating a successful send.

Audit attribution
-----------------

Every send emits a ``send_approved`` audit row through the per-customer
Hermes audit_log. The audit metadata carries the four data points
ADR 0005 lists as the human-in-the-loop defense: drafted-by-agent,
approved-by-reviewer, sent-via-reviewer-account, and the persona slug
that drafted the message (per ADR 0011 §3 -- nullable in v1, populated
from ``customer.yaml.personas[0].slug`` for the single-persona
customer-zero shape).

The audit emission itself lives at the dashboard endpoint
(``src/pages/api/portal/ai-employee/drafts/[id]/send.ts``); this
module returns a structured ``SendOutcome`` that the endpoint records.
Splitting the persistence from the network send keeps this module
side-effect-free with respect to D1.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal, Optional

from ._client import GraphClient
from ._types import AdapterError


_CAPABILITY = "Email"
_ADAPTER = "microsoft-graph"

# Closed vocabulary for the SendOutcome.status field. Mirrors the TS
# ``SendStatus`` union in ``src/lib/portal/ai-employee/send-as.ts`` so
# the dashboard endpoint and the connector agree on what each value
# means. ``queued_undo`` is owned by the dashboard (it resolves to
# ``sent`` or ``failed`` after the undo window elapses) and is never
# returned by this module -- listed here for documentation only.
SendStatus = Literal["sent", "failed"]


@dataclass(frozen=True)
class SendOutcome:
    """Result of a partner-tap-triggered send.

    Attributes
    ----------
    status:
        ``"sent"`` when Graph accepted the send (HTTP 202). ``"failed"``
        when Graph returned a non-success response. The dashboard maps
        ``failed`` back to the closed ``SendStatus`` vocabulary the UI
        understands (``sent`` | ``send_failed``).

    sent_at:
        ISO 8601 UTC timestamp of the send attempt. Populated for both
        ``sent`` and ``failed`` outcomes -- the time of the attempt is
        load-bearing for the audit row regardless of outcome.

    reviewer_email:
        The email account the message was sent under. This is the
        identity the recipient sees in the From: header. ADR 0005
        invariant: this is always a human reviewer's email, never a
        persona / agent / system identity.

    error:
        Non-null only when ``status == "failed"``. Carries the
        AdapterError code (``forbidden`` / ``auth_expired`` /
        ``upstream_error`` / etc.) and the upstream message. The
        dashboard surfaces this inline so the reviewer can act on it
        (re-consent, retry, escalate to Captain).
    """

    status: SendStatus
    sent_at: str
    reviewer_email: str
    error: Optional[str] = None


async def send_draft_as_reviewer(
    client: GraphClient,
    *,
    draft_id: str,
    reviewer_email: str,
) -> SendOutcome:
    """Send an existing draft via the reviewer's mailbox.

    Pattern A invariant: this is only invoked AFTER the reviewer taps
    Approve in the dashboard. The agent does not call this function;
    the dashboard's send endpoint does, with the reviewer's identity
    on the request.

    The send routes through ``POST /me/messages/{id}/send`` which:

    * requires the ``Mail.Send`` scope on the access token (wave-2
      consent),
    * accepts no body (the draft has already been authored via
      ``mailbox.create_draft``),
    * returns HTTP 202 Accepted on success -- no body, no message id
      (Graph queues the message internally and the sent copy appears
      in the reviewer's Sent folder asynchronously),
    * returns 403 if the scope is missing (mapped to AdapterError
      ``forbidden`` by ``GraphClient._raise_from_response``).

    Parameters
    ----------
    client:
        Authenticated ``GraphClient`` bound to the reviewer's OAuth
        grant. The client's ``oauth`` must carry a token with
        ``Mail.Send`` in its scopes. Validating the scope is the
        OAuth layer's job; this function reports failure (forbidden
        / auth_expired) rather than pre-flighting.

    draft_id:
        The draft's Graph message id, as returned by
        ``mailbox.create_draft``. Required.

    reviewer_email:
        The reviewer's email address. Carried through to the
        ``SendOutcome`` so the dashboard endpoint can record it on
        the audit row without re-resolving identity. Required.

    Returns
    -------
    SendOutcome:
        ``status="sent"`` with ``error=None`` on HTTP 202.
        ``status="failed"`` with ``error`` populated when Graph
        returned a structured error. The function only raises if
        ``draft_id`` or ``reviewer_email`` is empty (validation_failed).

    Raises
    ------
    AdapterError(code="validation_failed"):
        ``draft_id`` or ``reviewer_email`` is empty. Inputs are
        load-bearing; refusing on empty values is preferable to
        firing a Graph call that would 404.
    """
    if not draft_id:
        raise AdapterError(
            code="validation_failed",
            capability=_CAPABILITY,
            adapter=_ADAPTER,
            message="send_draft_as_reviewer requires non-empty draft_id",
        )
    if not reviewer_email:
        raise AdapterError(
            code="validation_failed",
            capability=_CAPABILITY,
            adapter=_ADAPTER,
            message="send_draft_as_reviewer requires non-empty reviewer_email",
        )

    sent_at = _now_iso()
    try:
        # Graph's send endpoint returns 202 Accepted with no body.
        # The GraphClient.request() helper raises on non-2xx; any
        # raised AdapterError is caught below and surfaced on the
        # SendOutcome so the dashboard endpoint can record the
        # audit row uniformly across success + failure.
        await client.request(
            "POST",
            f"/me/messages/{draft_id}/send",
            capability=_CAPABILITY,
        )
    except AdapterError as exc:
        return SendOutcome(
            status="failed",
            sent_at=sent_at,
            reviewer_email=reviewer_email,
            error=f"{exc.code}: {exc}",
        )

    return SendOutcome(
        status="sent",
        sent_at=sent_at,
        reviewer_email=reviewer_email,
        error=None,
    )


def _now_iso() -> str:
    """ISO 8601 UTC timestamp with millisecond precision and explicit Z."""
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


__all__ = [
    "SendOutcome",
    "SendStatus",
    "send_draft_as_reviewer",
]
