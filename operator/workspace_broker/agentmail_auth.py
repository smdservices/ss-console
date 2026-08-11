"""AgentMail send credential + recipient policy, owned exclusively by the broker.

WHY THIS EXISTS (ss#2258). On 2026-08-03/05/07/09 the pilot rehearsal seat sent
four fabricated emails to a real client principal, with **no audit row for any of
them**. Zero rows means the sending path never traversed the gateway's trust hook
— so no in-agent control could have stopped it, including controls we might add,
because the agent process holds a credential that answers to no one. The Captain's
requirement afterwards was exact: the seat "should never have been able to send to
an unapproved email address no matter where it came from."

"No matter where it came from" is only enforceable by whoever holds the key. That
is this module. Two fences stack, and neither is sufficient alone:

1. **The agent-reachable key cannot send at all** — vendor-enforced. The gateway's
   AgentMail key is inbox-scoped with `message_send`/`draft_send` withheld, so no
   code path on the Machine can transmit regardless of how it is reached. That
   fence lives at AgentMail, not here.
2. **The send-capable key fences the recipient** — this module. An inbox-scoped
   send key still sends anywhere, and the incident was the seat's own inbox
   mailing an unapproved human. So the credential holder decides who may be
   contacted, reading the authored answer from the customer.yaml the broker
   already trusts — never from the request.

WHAT THIS IS NOT. This is a *counterparty* fence: it answers "may this seat
contact this human at all?", never "was this particular send approved?" Approval
and the exposure ceiling stay in the gateway, which is the only place that knows
about pending approvals. The broker cannot see approval state and does not pretend
to; what it guarantees is that an unapproved *recipient* is unreachable, and that
every attempt leaves a row.

WHY THE AUTHORED SET AND NOT `outbound_roster` ALONE. The first law-firm seat
authors no `outbound_roster` at all; its principals are named in `scope.admins`
and reachable via a whole-domain grant in `scope.inbound_allow_from`. A
roster-only rule would refuse every legitimate send on that seat. The union of
what the seat's own config names is both correct there and sufficient for the
incident: the pilot's authored set is four SMD-owned addresses plus two stand-in
inboxes, and the recipient of those four messages is on none of them, so all four
are refused.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from email.utils import parseaddr
from pathlib import Path
from typing import Any

import yaml

#: Env var carrying the SEND-capable, inbox-scoped AgentMail key. Deliberately a
#: DIFFERENT name from the gateway's ``AGENTMAIL_API_KEY``: the two keys are not
#: interchangeable, and a shared name would let a future entrypoint edit silently
#: hand the send key to the agent — the exact failure this design exists to make
#: impossible. Root materializes this to a 0600 broker-owned file and unsets it
#: before the exec-drop, so it never reaches the gateway environment.
SEND_KEY_ENV = "AGENTMAIL_SEND_API_KEY"


def materialize_credential(credential_path: Path) -> None:
    """Write the send key into the broker-owned store, 0600.

    Mirrors ``google_auth.materialize_credential``: root calls this under the
    broker venv while it still holds the secret in env, then chowns the file to
    the broker uid and unsets the variable. The broker itself reads the FILE, so
    a respawn needs nothing the parent later dropped.

    A missing key is not an error here — a seat with no AgentMail connector never
    stages one. It becomes an error at send time, where it is fail-closed.
    """
    key = (os.environ.get(SEND_KEY_ENV) or "").strip()
    if not key:
        return
    credential_path.write_text(key, encoding="utf-8")
    credential_path.chmod(0o600)


def load_send_key(credential_path: Path) -> str:
    """Read the send key from the broker-owned file. Empty ⇒ caller fail-closes."""
    try:
        return credential_path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def normalize_address(value: Any) -> str:
    """Reduce any address shape to its bare, lowercased form.

    Mail carries addresses as ``"Display Name <addr@host>"`` at least as often as
    bare, and a fence that compares the display form against a roster refuses
    everyone — so this parses rather than merely lowercasing. Mirrors the
    overlay's ``inbound_message._bare_address`` deliberately: the two must agree
    on what an address IS, or the reply lane and the fence disagree about who
    sent a message. Mappings are tolerated for the same reason it does.
    """
    if isinstance(value, dict):
        for key in ("address", "email", "emailAddress"):
            nested = value.get(key)
            if isinstance(nested, dict):
                nested = nested.get("address") or nested.get("email")
            if isinstance(nested, str) and nested.strip():
                value = nested
                break
        else:
            return ""
    if not isinstance(value, str):
        return ""
    parsed = parseaddr(value)[1].strip().lower()
    # parseaddr yields "" for input it cannot read as an address; falling back to
    # the raw string would let an unparseable value be compared against the
    # roster, and the only safe comparison for garbage is one that fails.
    return parsed


def _domain_of(address: str) -> str:
    _, separator, domain = address.partition("@")
    return domain if separator else ""


def _split_authored(entries: Any) -> tuple[set[str], set[str]]:
    """Split authored entries into (exact addresses, domain grants).

    An entry beginning with ``@`` is a whole-domain grant (a law-firm seat
    authors ``@<its-own-domain>`` so every person at the firm is reachable).
    Anything else is an exact address. Entries that are not usable strings are
    DROPPED rather than guessed at — an unparseable entry must never widen the
    fence.
    """
    exact: set[str] = set()
    domains: set[str] = set()
    for entry in entries or []:
        # scope.outbound_roster entries are {address, class, note?} mappings;
        # inbound_allow_from and admins are bare strings.
        if isinstance(entry, dict):
            entry = entry.get("address")
        if not isinstance(entry, str):
            continue
        raw = entry.strip().lower()
        if not raw:
            continue
        # A domain grant is checked BEFORE address parsing: "@firm.example" is
        # not a valid address, so parseaddr discards it, and a grant silently
        # dropped here would refuse every person at that firm.
        if raw.startswith("@"):
            if len(raw) > 1:
                domains.add(raw[1:])
            continue
        parsed = normalize_address(raw)
        if parsed and "@" in parsed:
            exact.add(parsed)
    return exact, domains


@dataclass(frozen=True)
class RecipientPolicy:
    """The authored counterparty surface for one seat, read from customer.yaml."""

    exact: frozenset[str]
    domains: frozenset[str]
    blocked_domains: frozenset[str]
    #: Addresses/domains permitted to receive a REPLY — narrower than the send
    #: fence, because a reply goes to whoever wrote in and anyone on the internet
    #: can write in. Sourced from ``inbound_allow_from`` alone.
    reply_exact: frozenset[str]
    reply_domains: frozenset[str]

    def _blocked(self, address: str) -> bool:
        return _domain_of(address) in self.blocked_domains

    def allows_recipient(self, address: str) -> bool:
        """May this seat send to this address at all? Deny overrides allow."""
        value = normalize_address(address)
        if not value or "@" not in value or self._blocked(value):
            return False
        return value in self.exact or _domain_of(value) in self.domains

    def allows_reply_to(self, address: str) -> bool:
        """May this seat REPLY to this sender? (``inbound_allow_from`` only.)"""
        value = normalize_address(address)
        if not value or "@" not in value or self._blocked(value):
            return False
        return value in self.reply_exact or _domain_of(value) in self.reply_domains


def _scope(customer_path: Path) -> dict[str, Any]:
    data = yaml.safe_load(customer_path.read_text(encoding="utf-8")) or {}
    scope = data.get("scope") or {}
    if not isinstance(scope, dict):
        raise RuntimeError("customer.yaml scope must be an object")
    return scope


def authored_policy(customer_path: Path) -> RecipientPolicy:
    """Derive the seat's counterparty surface from its own authored config.

    The union of ``scope.outbound_roster`` (typed outbound authorization),
    ``scope.inbound_allow_from`` (who may talk to the seat, hence who the seat may
    answer), and ``scope.admins`` (the Named Administrators), minus
    ``scope.domain_blocks``.

    An **empty** authored surface yields a policy that permits nothing. That is
    deliberate: a seat whose config names no counterparty has no one to write to,
    and "unconfigured" must read as a safety state, never as permission.
    """
    scope = _scope(customer_path)
    roster_exact, roster_domains = _split_authored(scope.get("outbound_roster"))
    inbound_exact, inbound_domains = _split_authored(scope.get("inbound_allow_from"))
    admin_exact, admin_domains = _split_authored(scope.get("admins"))
    blocked_exact, blocked_domains = _split_authored(scope.get("domain_blocks"))
    return RecipientPolicy(
        exact=frozenset(roster_exact | inbound_exact | admin_exact),
        domains=frozenset(roster_domains | inbound_domains | admin_domains),
        # A bare domain in domain_blocks ("evil.com") and an @-prefixed one both
        # block the domain; a full address there blocks its domain too, which is
        # the conservative reading of a block list.
        blocked_domains=frozenset(
            blocked_domains | {_domain_of(a) for a in blocked_exact if _domain_of(a)}
        ),
        reply_exact=frozenset(inbound_exact),
        reply_domains=frozenset(inbound_domains),
    )


def seat_inbox_address(customer_path: Path, customer_slug: str) -> str:
    """The seat's OWN inbox address, from authored config or the slug convention.

    Taken from the broker's trusted customer.yaml and **never from the request**.
    Under overlay#244 the gateway resolved this itself and a bug there had it
    sending from whichever inbox the account listed first; here the identity is
    not something a caller can express, so that class cannot recur.
    """
    data = yaml.safe_load(customer_path.read_text(encoding="utf-8")) or {}
    connectors = data.get("connectors") or {}
    email = connectors.get("Email") if isinstance(connectors, dict) else None
    if isinstance(email, dict):
        authored = normalize_address(email.get("inbox_address"))
        if authored:
            return authored
    return f"{customer_slug.strip().lower()}@agentmail.to"
