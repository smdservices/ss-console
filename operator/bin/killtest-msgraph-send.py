#!/usr/bin/env python3
"""Prove the msgraph unaudited-send reconciler can actually catch one (ss#2499).

WHY A HARNESS AND NOT A UNIT TEST. Every assertion in
``operator/bin/tests/test_reconcile_sends.py`` is made against a fake Graph this
repo also wrote, so all of them together prove the matcher agrees with our model
of a mailbox. None of them can prove the model is the mailbox. The only thing
that settles that is a real message, sent around the broker, into a real Sent
Items folder, found by a real scheduled run. That is what this script sends.

WHAT IT DELIBERATELY DOES WRONG. It transmits with the SEND app credential
directly, bypassing the workspace broker entirely -- so no audit row is written
and no ``X-SMD-Audit-Row`` header is stamped. That is precisely the shape of the
event this control exists for: a message that left the Operator's mailbox with
nothing in the ledger to account for it. The AgentMail twin of this test is on
record: ``[UNAUDITED-KILLTEST-2258]``, 2026-08-13, reported and then baselined
(``operator/bin/reconcile-sends-baseline.json``).

WHERE IT MAY RUN, AND WHY THAT IS A HARD FENCE. Only a sandbox seat named in
``SANDBOX_SEATS`` below. A client's mailbox is the client's; deliberately posting
a message into it to see whether our watchdog barks would be an unannounced
artifact in a firm's live correspondence, and the firm is the only party that can
see its own Sent Items UI. The refusal is by SEAT SLUG rather than by a flag,
because a flag is a thing an operator in a hurry passes.

RUNNING IT (a Captain act, not an agent's -- it transmits):

    infisical run --env=prod --path=/ss -- \\
        python3 operator/bin/killtest-msgraph-send.py --seat smd-staging --confirm

    # then, after the daily run or a manual dispatch:
    infisical run --env=prod --path=/ss -- \\
        python3 operator/bin/reconcile-sends.py --channel msgraph --days 2

The second command must report the message this one prints, as a FIND. If it does
not, the control does not work and the green runs before it meant nothing.

AFTER IT PASSES (operator/CLAUDE.md, probe-artifact contract): add the printed
message id to ``reconcile-sends-baseline.json`` in a PR with ``reported_in``
naming the issue, so this deliberate send stops being re-reported. An entry there
means REPORTED AND TRACKED, never RESOLVED.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

GRAPH_API_BASE = "https://graph.microsoft.com/v1.0"
GRAPH_TOKEN_HOST = "https://login.microsoftonline.com"
GRAPH_SCOPE = "https://graph.microsoft.com/.default"
TIMEOUT_S = 30.0

#: The subject marker, identical to the AgentMail kill test of 2026-08-13 so the
#: two read as one control in the baseline file and in any issue that quotes them.
KILLTEST_MARKER = "[UNAUDITED-KILLTEST-2258]"

#: Seats this may transmit from. A SANDBOX ONLY list, enforced below.
#:
#: ashton-price is absent and must stay absent. It is a real firm's live mailbox
#: in the firm's own tenant; SMD has no UI access to it, so the firm would be the
#: only party able to see the artifact, and it would see it as unexplained mail
#: from its own Operator. The falsifier for THIS channel runs on the sandbox and
#: the reconciler code path it exercises is the same one.
SANDBOX_SEATS: dict[str, str] = {
    "smd-staging": "SMD's own M365 sandbox seat; no client correspondence lives here",
}

#: Where the deliberate send is addressed. SMD's own operational address, never a
#: client one: a kill test that reaches a client is not a test.
KILLTEST_RECIPIENT = "team@smd.services"


class KillTestRefused(RuntimeError):
    """This may not run here. Never retried, never overridden by a flag."""


def _seat_config(slug: str) -> dict:
    import yaml

    path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "customers",
        slug,
        "customer.yaml",
    )
    with open(path, encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    email = ((data.get("connectors") or {}).get("Email")) or {}
    if email.get("adapter") != "msgraph":
        raise KillTestRefused(f"{slug} does not author adapter msgraph")
    auth = email.get("msgraph_auth") or {}
    mailbox = str(auth.get("mailbox") or "")
    tenant = str(auth.get("tenant_id") or "")
    if not (mailbox and tenant):
        raise KillTestRefused(f"{slug} authors no complete msgraph_auth")
    return {"mailbox": mailbox, "tenant_id": tenant}


def send_credential(slug: str) -> tuple[str, str]:
    """The SEND app's client id and secret for this seat.

    The SEND app on purpose, and it is the whole point: the broker's read
    credential could not transmit, and a kill test that cannot transmit proves
    nothing. Provisioning stages these under ``MSGRAPH_SEND_*__<SLUG>``
    (provision-customer.sh msgraph-two-app-fence).
    """
    key = slug.upper().replace("-", "_")
    client_id = os.environ.get(f"MSGRAPH_SEND_CLIENT_ID__{key}") or ""
    secret = os.environ.get(f"MSGRAPH_SEND_CLIENT_SECRET__{key}") or ""
    if not (client_id and secret):
        raise KillTestRefused(
            f"MSGRAPH_SEND_CLIENT_ID__{key} / MSGRAPH_SEND_CLIENT_SECRET__{key} "
            "are not in this environment; run under infisical"
        )
    return client_id, secret


def mint_token(tenant_id: str, client_id: str, secret: str, *, opener=None) -> str:
    data = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": secret,
            "scope": GRAPH_SCOPE,
        }
    ).encode()
    request = urllib.request.Request(
        f"{GRAPH_TOKEN_HOST}/{tenant_id}/oauth2/v2.0/token",
        data=data,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    open_fn = opener or urllib.request.urlopen
    try:
        with open_fn(request, timeout=TIMEOUT_S) as response:
            parsed = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        # Status only: the token endpoint echoes the client secret back in its
        # error bodies.
        raise KillTestRefused(f"token mint rejected with HTTP {exc.code}") from exc
    token = parsed.get("access_token") if isinstance(parsed, dict) else None
    if not token:
        raise KillTestRefused("token response carried no access_token")
    return str(token)


def killtest_subject(now: datetime | None = None) -> str:
    """The subject, stamped so a human reading the mailbox knows what it is.

    Two markers, both deliberate. ``KILLTEST_MARKER`` is what the reconciler
    report and the baseline entry will show. The creation stamp is the
    probe-artifact contract in operator/CLAUDE.md: firm staff reading a task or
    message list are the other consumer that can mistake a probe for real work.
    """
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%MZ")
    return f"{KILLTEST_MARKER} {stamp} deliberate unaudited send, reconciler kill test"


def killtest_message(subject: str) -> dict:
    """The Graph payload. Carries NO ``internetMessageHeaders``, which is the
    whole experiment: an unstamped message is exactly what a send that did not
    come through the broker looks like."""
    return {
        "message": {
            "subject": subject,
            "body": {
                "contentType": "Text",
                "content": (
                    "Deliberate unaudited send. This message bypassed the workspace "
                    "broker, so no audit row exists for it and it carries no "
                    "X-SMD-Audit-Row header.\n\n"
                    "The next unaudited-send-reconcile run must report it. If it "
                    "does not, the control is not working (ss#2499).\n\n"
                    "Once it has been reported, add it to "
                    "operator/bin/reconcile-sends-baseline.json in a PR."
                ),
            },
            "toRecipients": [{"emailAddress": {"address": KILLTEST_RECIPIENT}}],
        },
        "saveToSentItems": True,
    }


def transmit(mailbox: str, token: str, payload: dict, *, opener=None) -> None:
    request = urllib.request.Request(
        f"{GRAPH_API_BASE}/users/{mailbox}/sendMail",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    open_fn = opener or urllib.request.urlopen
    try:
        with open_fn(request, timeout=TIMEOUT_S) as response:
            response.read()
    except urllib.error.HTTPError as exc:
        raise KillTestRefused(f"sendMail failed with HTTP {exc.code}") from exc


def guard(slug: str) -> str:
    """Refuse every seat that is not an authored sandbox.

    By slug rather than by flag: a flag is a thing an operator in a hurry passes,
    and the cost of getting this wrong is an unexplained message in a client's
    own correspondence that only the client can see.
    """
    if slug not in SANDBOX_SEATS:
        raise KillTestRefused(
            f"{slug!r} is not a sandbox seat. This script transmits a real message "
            "into a real mailbox and may only do so on: "
            + ", ".join(f"{k} ({v})" for k, v in SANDBOX_SEATS.items())
        )
    return SANDBOX_SEATS[slug]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seat", required=True, help="sandbox seat slug to send from")
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="actually transmit; without it this prints what it would send",
    )
    args = parser.parse_args(argv)

    try:
        why_allowed = guard(args.seat)
        config = _seat_config(args.seat)
        subject = killtest_subject()
        payload = killtest_message(subject)
        if not args.confirm:
            print(f"DRY RUN. {args.seat} is allowed: {why_allowed}")
            print(f"would send from {config['mailbox']} to {KILLTEST_RECIPIENT}")
            print(f"subject: {subject}")
            print("re-run with --confirm to transmit.")
            return 0
        client_id, secret = send_credential(args.seat)
        token = mint_token(config["tenant_id"], client_id, secret)
        transmit(config["mailbox"], token, payload)
    except KillTestRefused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2

    print(f"sent from {config['mailbox']}")
    print(f"subject: {subject}")
    print()
    print("Graph answers sendMail with 202 and no body, so this script cannot")
    print("print the message id -- find it by subject in Sent Items, or in the")
    print("reconciler report, which is the point of the exercise:")
    print()
    print("  python3 operator/bin/reconcile-sends.py --channel msgraph --days 2")
    print()
    print("It must appear as a FIND. Then baseline it in a PR.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
