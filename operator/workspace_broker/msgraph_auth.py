"""Microsoft Graph send credential and pinned mailbox, owned only by the broker.

The msgraph half of ss#2258. ``agentmail_auth`` states the incident; this module
states the ONE way this channel differs, because that difference decides how much
of the fix is available to us and how much is not.

WHY MSGRAPH ONLY GETS ONE OF THE TWO FENCES TODAY.

The AgentMail fix stacks two independent fences: the vendor makes the agent's key
*incapable* of transmitting (an inbox-scoped key with ``message_send`` withheld),
and the broker fences the recipient. Fence 1 there is a gift of that vendor's
credential model, not a property of our design.

Microsoft Graph app-only auth has no equivalent. The client-credentials flow must
request ``/.default``, which means "every application permission already granted
and admin-consented for this app registration" — there is no narrower token, and
no per-request scope-down. One app registration is therefore one permission set:
if it can read mail it can also send mail, whenever ``Mail.Send`` is among its
grants.

And the agent process legitimately needs Graph credentials. Two consumers, both
read-side and both real: the delta poller that pulls inbound mail
(``shared/msgraph_poller``, running in the gateway) and the ``msgraph-mail`` MCP
server that is the agent's own mail tool surface. Stripping ``MSGRAPH_*`` from the
gateway today would not harden the seat; it would blind it.

So the honest position, stated here rather than discovered later:

* **Fence 2 is live** — every governed send and reply crosses this boundary, is
  checked against the seat's authored counterparty surface, and leaves a row
  written by the credential holder.
* **Fence 1 is NOT live for msgraph.** A rogue in-agent path can still mint its
  own Graph token from ``MSGRAPH_CLIENT_SECRET`` and POST ``/sendMail`` directly,
  which is the shape of the original incident. Closing it needs a SECOND app
  registration in the tenant — a read-only one (``Mail.ReadWrite``, no
  ``Mail.Send``) for the agent, and a send-capable one whose secret only ever
  reaches this file. That is a tenant action requiring admin consent, which for a
  client seat is the client's to grant, not ours to take.

The env names below are already the ones a separate send-only app would use, so
that migration is a provisioning change with no code change. Today they may carry
the same app registration's values as the gateway's ``MSGRAPH_*``; the day a
send-only app exists, only what the provisioner stages changes.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import yaml

from .recipient_policy import normalize_address

#: The send-capable Graph app credential, named apart from the gateway's
#: ``MSGRAPH_*`` on purpose. Sharing the names would make the eventual split
#: invisible in config and let a future entrypoint edit hand the agent the send
#: app by accident — the exact failure the AgentMail key split exists to prevent.
#: The MAILBOX is deliberately absent: it comes from customer.yaml (below), so a
#: caller cannot express it and a secret cannot contradict the authored config.
SEND_ENV = (
    "MSGRAPH_SEND_TENANT_ID",
    "MSGRAPH_SEND_CLIENT_ID",
    "MSGRAPH_SEND_CLIENT_SECRET",
)


def materialize_credential(credential_path: Path) -> None:
    """Write the Graph send credential into the broker-owned store, 0600.

    Mirrors ``google_auth`` / ``agentmail_auth``: root calls this under the broker
    venv while it still holds the secrets in env, then chowns the file to the
    broker uid. The broker reads the FILE, so a respawn needs nothing the parent
    later dropped.

    None of the three present ⇒ no-op. A seat with no msgraph connector never
    stages them, and absence becomes a fail-closed refusal at send time.

    SOME but not all present ⇒ raise. A half-staged credential is a provisioning
    mistake, and the seat must not boot believing it has a send path it does not
    have. Names only in the error; never a value.
    """
    present = {name: (os.environ.get(name) or "").strip() for name in SEND_ENV}
    missing = [name for name, value in present.items() if not value]
    if len(missing) == len(SEND_ENV):
        return
    if missing:
        raise RuntimeError(
            "msgraph send credential is partially staged; refusing to boot a seat "
            f"with a half-wired send path. Missing: {', '.join(sorted(missing))}"
        )
    credential_path.write_text(
        json.dumps(
            {
                "tenant_id": present["MSGRAPH_SEND_TENANT_ID"],
                "client_id": present["MSGRAPH_SEND_CLIENT_ID"],
                "client_secret": present["MSGRAPH_SEND_CLIENT_SECRET"],
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    credential_path.chmod(0o600)


def load_credential(credential_path: Path) -> dict[str, str]:
    """Read the Graph send credential. ``{}`` ⇒ the caller fail-closes.

    Every failure mode collapses to "no credential" on purpose: an unreadable,
    truncated, or non-JSON credential file must refuse a send, never half-attempt
    one with a partial value.
    """
    try:
        raw = credential_path.read_text(encoding="utf-8")
    except OSError:
        return {}
    try:
        parsed = json.loads(raw)
    except ValueError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    fields = ("tenant_id", "client_id", "client_secret")
    values = {key: str(parsed.get(key) or "").strip() for key in fields}
    return values if all(values.values()) else {}


def _email_connector(customer_path: Path) -> dict[str, Any]:
    data = yaml.safe_load(customer_path.read_text(encoding="utf-8")) or {}
    connectors = data.get("connectors") or {}
    email = connectors.get("Email") if isinstance(connectors, dict) else None
    return email if isinstance(email, dict) else {}


def seat_mailbox(customer_path: Path) -> str:
    """The mailbox this seat sends AS, from ``connectors.Email.msgraph_auth``.

    Read from the broker's trusted customer.yaml and **never from the request**,
    for the same reason the AgentMail inbox is pinned: a caller that can name the
    mailbox can name someone else's. Graph's own client also pins the mailbox at
    construction (every path is ``/users/{mailbox}/…``), so this is the second of
    two locks, and the tenant-side ApplicationAccessPolicy is the third.

    Returns ``""`` when the seat authors no msgraph mailbox — which the ops layer
    treats as "this seat has no Graph send path", not as a default.
    """
    email = _email_connector(customer_path)
    if str(email.get("adapter") or "").strip().lower() != "msgraph":
        return ""
    auth = email.get("msgraph_auth")
    if not isinstance(auth, dict):
        return ""
    return normalize_address(auth.get("mailbox"))


__all__ = [
    "SEND_ENV",
    "load_credential",
    "materialize_credential",
    "seat_mailbox",
]
