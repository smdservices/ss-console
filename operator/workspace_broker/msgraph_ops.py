"""Microsoft Graph transmit operations executed inside the broker security domain.

The msgraph sibling of ``agentmail_ops``, deliberately the same shape: two verbs,
both fail-closed, both fencing the recipient against the seat's authored
counterparty surface before the credential is used, and both leaving a row that
the credential holder writes rather than the caller.

* ``send``  — a fresh message via ``POST /users/{mailbox}/sendMail``. Every
  recipient must be on the seat's authored surface; the From is the mailbox
  pinned in customer.yaml.
* ``reply`` — an answer via ``POST /users/{mailbox}/messages/{id}/reply``. Graph
  derives the recipients from the source message, so the check that matters is on
  the ORIGINAL SENDER, which the broker fetches itself. Without that check the
  reply lane is an exfiltration primitive: anyone on the internet may email the
  operator mailbox, so "reply to whoever wrote in" reaches arbitrary unapproved
  addresses — and would do it carrying a clean audit row, which is worse than no
  row at all.

TWO CREDENTIALS, ONE VERB (overlay#280). Under the two-app fence the send app
holds ``Mail.Send`` only, so the sender-verification GET above can never succeed
on the send credential — 403 by construction, observed live on the first
production two-app seat. The GET therefore runs on the READ app's credential
(the same registration the agent already holds; reading is the lower privilege)
from a second broker-store file, and the POST stays on the send credential.
Absent read credential ⇒ the reply fails closed: verifying the sender is the
load-bearing step and must not be skipped or delegated to the caller.

WHY THE BROKER SPEAKS GRAPH ITSELF rather than importing the overlay's client:
the overlay runs in the agent's address space and this process exists to be
outside it. A shared import would be a shared dependency across the boundary the
whole design draws. The subset needed here is small — mint a token, POST twice,
GET once — and it is written against the same endpoints the overlay client uses,
so the two agree on the wire without agreeing on code.

Policy refusals raise ``MsGraphRefused``; anything else raises
``MsGraphTransportError``. The distinction matters: a refusal is a decision worth
auditing as such, while a transport failure must never be recorded as though the
seat had been forbidden to write.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from .msgraph_auth import load_credential, seat_mailbox
from .recipient_policy import RecipientPolicy, authored_policy, normalize_address

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
TOKEN_HOST = "https://login.microsoftonline.com"
GRAPH_SCOPE = "https://graph.microsoft.com/.default"
TIMEOUT_S = 15.0

#: Re-mint this far before the stated expiry, so a token that is valid when we
#: check is still valid when Graph reads it.
_TOKEN_SKEW_S = 60

#: Every field that can put an address on the wire. The fence enumerates THIS
#: tuple, and ``_message`` below builds the Graph payload from the same one, so a
#: recipient field cannot exist in the message without having been checked. Adding
#: one in only a single place is the mistake this pairing exists to prevent.
_RECIPIENT_FIELDS = ("to", "cc", "bcc")

#: Body-text under either spelling the two callers use. The out-of-band confirm
#: dispatch carries ``body_text`` (the flat ``mcp_msgraph_mail_send_message`` arg
#: shape, ADR 0078 D4); the ``smd_send_message`` tool carries ``text`` (the shape
#: its schema advertises). Accepting both is what lets ONE broker verb serve both
#: callers rather than a second verb that can drift from this one.
_TEXT_FIELDS = ("body_text", "text")


class MsGraphRefused(RuntimeError):
    """The authored policy forbids this send. Never retried, always audited."""


class MsGraphTransportError(RuntimeError):
    """The send could not be attempted or its outcome is unknown."""


def _as_addresses(value: Any) -> list[str]:
    """Normalize a recipient field that may be a bare string, a list, or Graph's
    own ``{"emailAddress": {"address": …}}`` nesting."""
    if isinstance(value, str):
        candidates: list[Any] = [value]
    elif isinstance(value, list):
        candidates = list(value)
    elif value is None:
        return []
    elif isinstance(value, dict):
        candidates = [value]
    else:
        raise MsGraphRefused(
            f"recipient field must be a string, list, or address object, got {type(value).__name__}"
        )
    return [normalize_address(v) for v in candidates if normalize_address(v)]


def collect_recipients(payload: dict[str, Any]) -> list[str]:
    """Every address this payload would reach, across to/cc/bcc.

    ``bcc`` is here because it DELIVERS. A fence that reads only the visible
    recipients would pass a message whose blind copy goes anywhere, and it would
    write an audit row naming the wrong set of people — a row that looks clean
    and is wrong, which is worse than a missing one.
    """
    found: list[str] = []
    for field in _RECIPIENT_FIELDS:
        for address in _as_addresses(payload.get(field)):
            if address not in found:
                found.append(address)
    return found


def enforce_recipients(policy: RecipientPolicy, recipients: list[str]) -> None:
    """Refuse unless EVERY recipient is on the seat's authored surface.

    All-or-nothing on purpose: a partial send is not a safer send, and dropping
    the offending address silently would deliver a message whose visible
    recipient list is a lie.
    """
    if not recipients:
        raise MsGraphRefused("refusing a send with no recipient")
    refused = [a for a in recipients if not policy.allows_recipient(a)]
    if refused:
        raise MsGraphRefused(
            f"{len(refused)} recipient(s) are not on this seat's authored "
            "counterparty surface (scope.outbound_roster + inbound_allow_from + "
            "admins, minus domain_blocks). A seat may only write to people its "
            "own configuration names (ss#2258): " + ", ".join(sorted(refused))
        )


#: Characters a Graph id may legitimately contain. Graph message ids are a
#: URL-safe base64 variant, so alphanumerics plus ``-_=`` covers them; ``.`` and
#: ``~`` are permitted because they are unreserved in a path and harmless.
#: Everything else — most importantly ``/``, ``?`` and ``#`` — is refused.
_SEGMENT_ALLOWED = set(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_=.~"
)


def _safe_segment(value: str) -> str:
    """A path segment that cannot restructure the URL it is placed in.

    The segments reaching here are a fixed verb (``sendMail``, ``messages``,
    ``reply``) and one caller-supplied message id. Since segments are passed to
    Graph raw, an id carrying ``/`` would silently add a path element and an id
    carrying ``?`` would start a query string — so the id is validated instead of
    escaped, and an invalid one is a refusal rather than a request that quietly
    addresses something else.
    """
    if not value or any(ch not in _SEGMENT_ALLOWED for ch in value):
        raise MsGraphRefused(
            "refusing a Graph path segment with characters outside the id "
            f"alphabet: {value!r}"
        )
    return value


def _recipients(addresses: Any) -> list[dict[str, Any]]:
    """Flat addresses → Graph's ``toRecipients``/``ccRecipients`` nesting."""
    items = [addresses] if isinstance(addresses, str) else list(addresses or [])
    return [
        {"emailAddress": {"address": str(a).strip()}} for a in items if str(a or "").strip()
    ]


class MsGraphOps:
    """Transmit operations bound to one seat's pinned mailbox and authored policy."""

    def __init__(
        self,
        credential_path: Path,
        customer_path: Path,
        *,
        read_credential_path: Path | None = None,
        graph_base: str = GRAPH_BASE,
        token_host: str = TOKEN_HOST,
        opener: Any | None = None,
    ) -> None:
        self._credential_path = credential_path
        self._read_credential_path = read_credential_path
        self._customer_path = customer_path
        self._graph_base = graph_base.rstrip("/")
        self._token_host = token_host.rstrip("/")
        self._opener = opener
        # One token cache PER CREDENTIAL FILE. A shared cache would let reply()'s
        # read-token mint (the GET runs first) leak onto the send POST — the
        # send would then carry a token that cannot send, failing at Graph with
        # a confusing 403 that looks like the fence misfiring.
        self._tokens: dict[str, tuple[str, float]] = {}

    # -- identity ----------------------------------------------------------

    def mailbox(self) -> str:
        """The seat's own operator mailbox, re-read from config on every call.

        Not cached: customer.yaml is root-owned and can be re-applied under a
        running broker, and a stale mailbox would mean sending as an identity the
        seat no longer holds. The read is a local file; the send is a network
        round trip.
        """
        address = seat_mailbox(self._customer_path)
        if not address:
            raise MsGraphTransportError(
                "this seat authors no msgraph mailbox (connectors.Email.msgraph_auth); "
                "refusing to send"
            )
        return address

    # -- transport ---------------------------------------------------------

    def _bearer(self, credential_path: Path | None = None, *, role: str = "send") -> str:
        path = credential_path or self._credential_path
        cache_key = str(path)
        cached = self._tokens.get(cache_key)
        if cached and time.monotonic() < cached[1]:
            return cached[0]
        credential = load_credential(path)
        if not credential:
            raise MsGraphTransportError(
                f"no msgraph {role} credential in the broker store; refusing to {role}"
            )
        data = urllib.parse.urlencode(
            {
                "grant_type": "client_credentials",
                "client_id": credential["client_id"],
                "client_secret": credential["client_secret"],
                "scope": GRAPH_SCOPE,
            }
        ).encode()
        url = f"{self._token_host}/{credential['tenant_id']}/oauth2/v2.0/token"
        request = urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
        )
        try:
            opener = self._opener or urllib.request.urlopen
            # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
            with opener(request, timeout=TIMEOUT_S) as response:
                raw = response.read().decode("utf-8") or "{}"
        except urllib.error.HTTPError as exc:
            # The token endpoint echoes request parameters in its error bodies,
            # and one of those parameters is the client secret. Status only.
            raise MsGraphTransportError(
                f"msgraph token mint rejected with HTTP {exc.code}"
            ) from exc
        except Exception as exc:  # noqa: BLE001 - urllib raises a wide family
            raise MsGraphTransportError(f"msgraph token mint failed: {exc}") from exc
        try:
            parsed = json.loads(raw)
        except ValueError as exc:
            raise MsGraphTransportError("msgraph token response was not JSON") from exc
        token = parsed.get("access_token") if isinstance(parsed, dict) else None
        if not isinstance(token, str) or not token:
            raise MsGraphTransportError("msgraph token response carried no access_token")
        expires_in = parsed.get("expires_in")
        lifetime = expires_in if isinstance(expires_in, int) else 3600
        deadline = time.monotonic() + max(lifetime - _TOKEN_SKEW_S, 0)
        self._tokens[cache_key] = (token, deadline)
        return token

    def _request(
        self,
        path: str,
        method: str,
        body: dict[str, Any] | None,
        *,
        credential_path: Path | None = None,
        role: str = "send",
    ) -> dict[str, Any]:
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            self._graph_base + path,
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self._bearer(credential_path, role=role)}",
                "Accept": "application/json",
                **({"Content-Type": "application/json"} if data else {}),
            },
        )
        try:
            opener = self._opener or urllib.request.urlopen
            # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
            with opener(request, timeout=TIMEOUT_S) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            raise MsGraphTransportError(
                f"msgraph {method} {path} failed: HTTP {exc.code}"
            ) from exc
        except Exception as exc:  # noqa: BLE001 - urllib raises a wide family
            raise MsGraphTransportError(f"msgraph {method} {path} failed: {exc}") from exc
        # sendMail and reply answer 202 with no body; that is success, not a
        # malformed response, so an empty payload must not raise here.
        if not raw.strip():
            return {}
        try:
            parsed = json.loads(raw)
        except ValueError as exc:
            raise MsGraphTransportError("msgraph returned non-JSON") from exc
        return parsed if isinstance(parsed, dict) else {}

    def _mail_path(self, *parts: str) -> str:
        """A path under the PINNED mailbox, built from RAW segments.

        Nothing here is percent-encoded, and that is a deliberate match to the
        live-proven wire format rather than a convenience. The overlay's Graph
        client and the sandbox-verified connector both pass these segments raw,
        and the client says why for the mailbox: Graph wants the bare address and
        encoding the ``@`` breaks the route. Message ids ride the same way there.
        Encoding them here on a guess would mean this process speaks a different
        wire format from the one that was actually proven against the tenant —
        and the failure would appear as a 404 on a reply, at runtime, on a client
        seat.

        Safety therefore comes from ``_safe_segment`` below rather than from
        quoting: a caller-supplied id that could restructure the path is refused
        outright, which is the stronger control anyway. Encoding turns a
        traversal attempt into a lookup that merely fails; refusing it makes the
        attempt itself visible in the ledger.
        """
        suffix = "/".join(_safe_segment(p) for p in parts)
        return f"/users/{self.mailbox()}/{suffix}"

    # -- verbs -------------------------------------------------------------

    def _message(self, payload: dict[str, Any]) -> dict[str, Any]:
        """The Graph ``message`` resource, built from a CLOSED set of fields.

        Nothing reaches the wire that is not named here, so an internal key — a
        broker grant, an approval marker, a caller's bookkeeping — cannot ride
        along, and no caller can smuggle a ``from``/``sender``/``mailbox``
        override past the identity pinned from customer.yaml.
        """
        html = payload.get("html")
        if isinstance(html, str) and html.strip():
            body = {"contentType": "HTML", "content": html}
        else:
            text = next(
                (
                    str(payload[key])
                    for key in _TEXT_FIELDS
                    if isinstance(payload.get(key), str) and payload[key]
                ),
                "",
            )
            body = {"contentType": "Text", "content": text}
        message: dict[str, Any] = {
            "subject": str(payload.get("subject") or ""),
            "body": body,
            "toRecipients": _recipients(payload.get("to")),
        }
        for field, graph_key in (("cc", "ccRecipients"), ("bcc", "bccRecipients")):
            nested = _recipients(payload.get(field))
            if nested:
                message[graph_key] = nested
        # `replyTo` names where a REPLY should go, not where this message goes, so
        # it delivers nothing and is not fenced — matching the AgentMail verb,
        # which passes its `reply_to` through the same way. Worth knowing it is a
        # deliberate parity call and not an oversight.
        reply_to = _recipients(payload.get("reply_to"))
        if reply_to:
            message["replyTo"] = reply_to
        return message

    def send(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Fence every recipient, then transmit from this seat's pinned mailbox."""
        policy = authored_policy(self._customer_path)
        recipients = collect_recipients(payload)
        enforce_recipients(policy, recipients)
        mailbox = self.mailbox()
        self._request(
            self._mail_path("sendMail"),
            "POST",
            {"message": self._message(payload), "saveToSentItems": True},
        )
        return {
            # Graph answers sendMail with 202 and no body, so there is no vendor
            # id to record. Empty is the truthful value; the row's input_digest is
            # what identifies this transmit to the console reconciler.
            "message_id": "",
            "recipients": recipients,
            "mailbox": mailbox,
        }

    def reply(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Answer an inbound message, but only one from an allowed sender.

        The recipient is structural — Graph derives it from the source message —
        so the check that matters is on the ORIGINAL SENDER, fetched here rather
        than taken from the caller. A caller that could name the sender could name
        any sender.

        The fetch runs on the READ credential: under the two-app fence the send
        app cannot read (overlay#280), and skipping or delegating the fetch is
        not an option — it is the load-bearing check. No read credential means
        no reply, fail-closed. Scope honesty: this GET defends against a caller
        naming the sender; it does not defend against an agent that PATCHes the
        stored message's from/replyTo with its own Mail.ReadWrite — that is a
        pre-existing property of replying to mutable message objects.
        """
        message_id = str(payload.get("message_id") or "").strip()
        if not message_id:
            raise MsGraphRefused("reply requires the source message_id")
        comment = str(payload.get("comment") or "").strip()
        if not comment:
            raise MsGraphRefused("refusing to send an empty reply")
        if self._read_credential_path is None:
            raise MsGraphTransportError(
                "reply requires the broker read credential to verify the sender "
                "under the two-app fence (overlay#280); this seat staged none — "
                "reprovision materializes it"
            )
        source = self._request(
            self._mail_path("messages", message_id),
            "GET",
            None,
            credential_path=self._read_credential_path,
            role="read",
        )
        sender = normalize_address(source.get("from") or source.get("sender"))
        if not sender:
            raise MsGraphRefused(
                f"cannot determine who sent message {message_id!r}; refusing to reply"
            )
        policy = authored_policy(self._customer_path)
        if not policy.allows_reply_to(sender):
            raise MsGraphRefused(
                "the sender of that message is not on scope.inbound_allow_from, so "
                "this seat may not answer it. Anyone can email this mailbox; only "
                "authored senders get replies (ss#2258)"
            )
        self._request(
            self._mail_path("messages", message_id, "reply"), "POST", {"comment": comment}
        )
        return {"message_id": "", "recipients": [sender], "mailbox": self.mailbox()}
