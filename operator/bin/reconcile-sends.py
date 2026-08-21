#!/usr/bin/env python3
"""Reconcile what left an Operator's mailbox against what its audit log recorded.

WHY THIS EXISTS (ss#2258). The audit log is what a law firm is offered as the
record of what its Operator did. On 2026-08-11 a message left the pilot seat's
inbox with no audit row at all, and reconciling the whole mailbox found it was
not alone: 9 of 117 sends had no record, four of them to a real client. Nothing
was watching, because nothing compared the two sides.

The comparison runs CONSOLE-SIDE on purpose. The seat cannot be the auditor of
its own egress: a seat-side check can only see its own inbox, so a send from an
inbox belonging to a decommissioned seat -- or to no seat at all -- is exactly
the case it could never represent. From here, an inbox with no owning seat is the
LOUDEST signal rather than an invisible one.

Both halves already exist and needed no new plumbing:
  * AgentMail  -- ``GET /v0/inboxes`` and per-inbox messages (account-wide key)
  * msgraph    -- ``GET /users/{mailbox}/mailFolders/sentitems/messages`` per seat
  * audit rows -- the ADR 0043 runtime-read seam (``operator/bin/lib/seam_pull.py``)

TWO CHANNELS, ONE MATCHER (ss#2499). This control covered ZERO msgraph seats
until now, and the paying firm sends through msgraph: the service agreement puts
its mail in its own Microsoft 365 tenant, and AgentMail is not used for it at
all. So a foreign send from that mailbox would have met a ledger whose silence
nobody could read either way. The msgraph half reads the seat's own Sent Items
folder, READ-ONLY and scoped to the one mailbox the seat is authored to send
from (agreement 4.6), normalizes each message into the same shape the AgentMail
half produces, and hands it to the SAME two-pass matcher. One matcher on
purpose: two hand-maintained copies of an audit comparison drift silently, and
in the direction of the copy nobody is reading.

MATCHING, two passes:
  1. EXACT. Every audited send records the AgentMail message id -- REPLY_SENT
     carries ``sent_message_id``, REPLY_HELD carries ``message_id`` (121 of 121
     rows observed). This pass needs no tolerance and cannot drift.
     On msgraph the exact key is stronger still, because the broker MINTS it:
     every message it transmits carries an ``X-SMD-Audit-Row`` internet header
     whose value is written onto the same audit row (ss#2499). That join lives on
     the message itself, so it survives the case where the broker could not read
     its own vendor id back -- the header is in the mailbox whether or not the
     lookup worked. A message in Sent Items with NO such header did not come
     through the broker, which is precisely the finding this control is for.
  2. TOOL PATH. ``mcp_agentmail_send_message`` audits as TOOL_CALL_COMPLETED with
     action_class=external_send and records NO message id, so time is the only
     available key. Observed skew is sub-second (341 ms on 2026-08-01), so the
     window is deliberately tight and each audit row is CONSUMED once -- two
     messages can never claim the same row.

FAIL-CLOSED, THE OTHER WAY. A failed seam read must never read as "zero audit
rows", which would mark every send unaccounted and mute this within a week. A
transport failure HOLDS: it accuses nobody and files no issue, and only a
successful read with unmatched sends is a finding. Same tri-state as
connector_check: absence is a hold, corruption is a page.

A HOLD IS NOT A PASS (ss#2386 review). It exits 2 and reddens the run. The
ss#2258 lesson is that a control must not page on its own blips, which is why a
hold files no issue -- but a hold that exits 0 leaves an unevaluated control
looking identical to a healthy one, and that is how a watchdog sits inert for
weeks. Exit codes: 0 clean, 1 findings, 2 nothing measured, anything else the
control itself broke. The sibling watchdogs hold the same posture
(control-probes.py exits 2 on hold, reconcile-outcomes.py exits 3).

MEMORY (ss#2386). A watchdog with no memory re-reports its own history: this one
filed a fresh P1 every scheduled run for the same 11 finds until five copies of
one finding were open at once, which trains the reader to skim exactly the report
that will one day carry a new send. ``reconcile-sends-baseline.json`` is that
memory -- fingerprints of sends already reported, so a run alerts only on what is
absent from it. The file is COMMITTED and updated by PR because this repo takes
no pushes to main, which also makes silencing a send a reviewed act rather than a
side effect of a scheduled job. Two properties hold the safety:

  * a missing or corrupt baseline yields the EMPTY set, so the failure mode is
    over-reporting, never silence;
  * the baseline can only ever quiet a send it NAMES BY MESSAGE ID, so a new
    send from the same routine, to the same recipient, with the same subject is
    still a finding.

AND THE MSGRAPH HALF INHERITS THAT MEMORY RATHER THAN GROWING ITS OWN (#2345).
It uses the same baseline file, the same fingerprint function and the same
"already reported" arithmetic, keyed on (mailbox, message id) exactly as the
AgentMail half is keyed on (inbox, message id). This is the whole reason the
msgraph adapter could not simply copy today's shape: an acknowledgement-free
watchdog on the PAYING seat would carry the cry-wolf to the mailbox where it
matters most, and the day it carried a real leak it would look like the thirty
days before it.

Usage:
    infisical run --env=prod --path=/ss -- python3 operator/bin/reconcile-sends.py
    ... --since 2026-08-01 --json
    ... --no-baseline          # report everything, baseline ignored
    ... --channel msgraph      # one channel only (default: both)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))

import seam_pull  # noqa: E402 — path injected above

AGENTMAIL_API_BASE = "https://api.agentmail.to/v0"
_HTTP_TIMEOUT_S = 30.0
_PAGE_LIMIT = 100

#: ss#2499 -- the msgraph half.
GRAPH_API_BASE = "https://graph.microsoft.com/v1.0"
GRAPH_TOKEN_HOST = "https://login.microsoftonline.com"
GRAPH_SCOPE = "https://graph.microsoft.com/.default"

#: The header the broker stamps on every message it transmits, and the exact key
#: this reconciler joins on. Matched case-insensitively: header names are
#: case-insensitive per RFC5322 and Exchange re-cases freely, so a case-sensitive
#: compare would report every send as unaudited -- a broken instrument that looks
#: exactly like a mailbox full of foreign mail.
AUDIT_ROW_HEADER = "X-SMD-Audit-Row"

#: Metadata key carrying that header's value on the audit row.
_AUDIT_TOKEN_KEY = "audit_row_token"

#: ``internetMessageHeaders`` is not returned unless selected BY NAME. Omitting
#: it does not error -- it silently yields messages with no headers, which reads
#: as "nothing came through the broker" and would turn this control into a
#: machine for accusing the Operator of every send it made.
_GRAPH_SELECT = (
    "id,internetMessageId,internetMessageHeaders,conversationId,"
    "sentDateTime,subject,toRecipients,ccRecipients,bccRecipients"
)

#: Newest-first pages of this size, and a hard cap on how many are walked. The
#: cap exists so a mailbox with years of history cannot make a scheduled run
#: unbounded; a run that hits it says so and HOLDS rather than reporting the
#: truncated set as complete.
_GRAPH_PAGE_SIZE = 100
_GRAPH_MAX_PAGES = 50

#: The env var holding one seat's READ app secret. Per-seat by design (ADR 0010,
#: firm-custodied credentials): the paying firm's Graph secret is its own, and a
#: shared fallback would let a missing per-seat secret quietly authenticate as
#: somebody else's app.
_GRAPH_SECRET_ENV = "MSGRAPH_CLIENT_SECRET__{slug}"

#: How far apart an AgentMail send and its tool-path audit row may be and still
#: be the same event. Observed skew is sub-second; this is 5s of headroom, not a
#: tuning knob. Widening it past a send's own cadence would let one row absorb a
#: neighbouring message, so it is asserted in tests rather than left to taste.
TOOL_PATH_WINDOW_S = 5.0

#: Metadata keys that carry an AgentMail message id on an audited send.
_ID_KEY_SUBSTRING = "message_id"

#: Inboxes that deliberately have no Operator seat behind them, and why. These
#: are OUR OWN rigs on the shared account -- test harnesses, an opposing-counsel
#: simulator, other ventures' mailboxes -- so their sends have no seat ledger to
#: reconcile against and reporting them is noise. The first live run flagged 135
#: such sends across six inboxes; a control that loud gets muted in a week.
#:
#: This is an ALLOWLIST, not a skip-list: an inbox that is NOT here and has no
#: owning seat stays the loudest signal in the report, because that is the shape
#: of a decommissioned seat still sending or a mailbox nobody authored. Adding an
#: entry costs a PR, which is the review gate.
KNOWN_NON_SEAT_INBOXES: dict[str, str] = {
    "ss-probe-admin@agentmail.to": "SS probe harness (inbound driver for seat rehearsals)",
    "ss-probe-runner@agentmail.to": "SS probe harness (runner)",
    "ap-records-standin@agentmail.to": "A&P rehearsal: records-vendor stand-in",
    "ap-client-standin@agentmail.to": "A&P rehearsal: client stand-in",
    "sim-opposing-counsel@agentmail.to": "Halloran Sload LLP opposing-counsel simulator",
    "agentcrane@agentmail.to": "Crane venture mailbox, not an SMD Operator seat",
    "smdcrane@agentmail.to": "Crane SMD Services mailbox, not an Operator seat",
}

#: Exit codes, and the whole contract of this script.
#:
#: EXIT_HOLD is NON-ZERO on purpose (ss#2386 review). A hold still never files an
#: issue and still never accuses anyone -- that half of ss#2258 is unchanged --
#: but it must not be reported as a pass, because an unevaluated control that
#: looks green is how a control sits inert for weeks with nobody noticing. Same
#: posture as the sibling watchdogs: control-probes.py exits 2 on hold,
#: reconcile-outcomes.py exits 3.
EXIT_CLEAN = 0
EXIT_FINDING = 1
EXIT_HOLD = 2

#: Sends this control has already reported, so a scheduled run alerts only on
#: what is new. Committed and PR-updated on purpose (ss#2386, see module header).
DEFAULT_BASELINE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "reconcile-sends-baseline.json"
)


class ReconcileError(RuntimeError):
    """A transport or credential failure. Holds; never reported as a finding."""


@dataclass
class InboxReport:
    inbox: str
    slug: str | None
    #: Which mailbox provider this row was read from. Rendered so a reader can
    #: tell at a glance that BOTH halves ran -- a channel that silently stopped
    #: being scanned is the failure this control cannot afford, and an absent
    #: line is much harder to notice than a wrong one.
    channel: str = "agentmail"
    sent_total: int = 0
    matched_exact: int = 0
    matched_tool_path: int = 0
    unaccounted: list[dict] = field(default_factory=list)
    baselined: int = 0  # unaccounted, but already reported (ss#2386)
    held: str | None = None  # set when we could not evaluate
    non_seat_reason: str | None = None  # authored as seat-less on purpose

    @property
    def is_finding(self) -> bool:
        return self.held is None and bool(self.unaccounted)


def _parse_ts(value) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)


def _agentmail_get(path: str, api_key: str, *, opener=None) -> dict:
    request = urllib.request.Request(
        AGENTMAIL_API_BASE + path, headers={"Authorization": f"Bearer {api_key}"}
    )
    open_fn = opener or urllib.request.urlopen
    try:
        with open_fn(request, timeout=_HTTP_TIMEOUT_S) as response:
            return json.loads(response.read())
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise ReconcileError(f"agentmail GET {path} failed: {exc}") from exc


def list_inboxes(api_key: str, *, opener=None) -> list[str]:
    parsed = _agentmail_get("/inboxes", api_key, opener=opener)
    inboxes = parsed.get("inboxes") if isinstance(parsed, dict) else None
    if not isinstance(inboxes, list):
        raise ReconcileError("agentmail /inboxes returned no list")
    return [i["inbox_id"] for i in inboxes if isinstance(i, dict) and i.get("inbox_id")]


def list_sent(inbox: str, api_key: str, *, since: datetime | None = None, opener=None) -> list[dict]:
    """Every message this inbox has SENT, newest-first, paged."""
    out: list[dict] = []
    token: str | None = None
    while True:
        path = f"/inboxes/{urllib.parse.quote(inbox)}/messages?limit={_PAGE_LIMIT}"
        if token:
            path += "&page_token=" + urllib.parse.quote(token)
        page = _agentmail_get(path, api_key, opener=opener)
        messages = page.get("messages") or []
        for message in messages:
            if "sent" not in (message.get("labels") or []):
                continue
            if since and _parse_ts(message.get("timestamp")) < since:
                continue
            out.append(message)
        token = page.get("next_page_token")
        if not token or not messages:
            return out


@dataclass
class MsGraphSeat:
    """One seat's authored Graph identity, read from its own customer.yaml."""

    slug: str
    mailbox: str
    tenant_id: str
    client_id: str

    @property
    def secret_env(self) -> str:
        return _GRAPH_SECRET_ENV.format(slug=self.slug.upper().replace("-", "_"))


def msgraph_seats(customers_dir: str | None = None) -> list[MsGraphSeat]:
    """Every seat whose authored mail adapter is msgraph.

    Read from customer.yaml rather than from a list maintained here, so a seat
    provisioned onto Graph is covered by this control on the day it is authored.
    A hand-kept list is how a channel ends up with zero coverage and nobody
    notices -- which is the state ss#2499 found.

    A seat missing any of the three identity fields is SKIPPED HERE and reported
    as a hold by the caller, never silently dropped.
    """
    import yaml  # deferred: only the msgraph half needs it

    root = customers_dir or _customers_dir()
    seats: list[MsGraphSeat] = []
    for slug in sorted(os.listdir(root)):
        if slug.startswith("_") or slug.startswith("."):
            continue
        path = os.path.join(root, slug, "customer.yaml")
        if not os.path.exists(path):
            continue
        try:
            with open(path, encoding="utf-8") as handle:
                data = yaml.safe_load(handle) or {}
        except (OSError, ValueError, yaml.YAMLError):
            continue
        email = ((data.get("connectors") or {}).get("Email")) or {}
        if not isinstance(email, dict) or email.get("adapter") != "msgraph":
            continue
        auth = email.get("msgraph_auth") or {}
        seats.append(
            MsGraphSeat(
                slug=slug,
                mailbox=str((auth or {}).get("mailbox") or ""),
                tenant_id=str((auth or {}).get("tenant_id") or ""),
                client_id=str((auth or {}).get("client_id") or ""),
            )
        )
    return seats


def graph_token(seat: MsGraphSeat, secret: str, *, opener=None) -> str:
    """A client-credentials token for the seat's READ app registration.

    The READ app, deliberately: this control only ever reads, and the read
    registration is the one the tenant's ApplicationAccessPolicy scopes to this
    single mailbox. Borrowing the SEND app's credential here would hand a
    watchdog transmit rights it has no use for.
    """
    data = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": seat.client_id,
            "client_secret": secret,
            "scope": GRAPH_SCOPE,
        }
    ).encode()
    request = urllib.request.Request(
        f"{GRAPH_TOKEN_HOST}/{seat.tenant_id}/oauth2/v2.0/token",
        data=data,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    open_fn = opener or urllib.request.urlopen
    try:
        with open_fn(request, timeout=_HTTP_TIMEOUT_S) as response:
            parsed = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        # Status only. The token endpoint echoes request parameters back in its
        # error bodies, and one of those parameters is the client secret.
        raise ReconcileError(f"msgraph token mint rejected with HTTP {exc.code}") from exc
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise ReconcileError(f"msgraph token mint failed for {seat.slug}") from exc
    token = parsed.get("access_token") if isinstance(parsed, dict) else None
    if not isinstance(token, str) or not token:
        raise ReconcileError(f"msgraph token response for {seat.slug} carried no access_token")
    return token


def _graph_get(url: str, token: str, *, opener=None) -> dict:
    """One READ against Graph. There is no other verb in this module, on purpose.

    The seat's mail is the client's, held in the client's own tenant under
    agreement 4.6, and a reconciler is an instrument -- it observes and never
    touches. GET is the only method built here, so a future edit that wanted to
    mutate would have to add the capability rather than pass a flag.
    """
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    open_fn = opener or urllib.request.urlopen
    try:
        with open_fn(request, timeout=_HTTP_TIMEOUT_S) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        raise ReconcileError(f"msgraph GET failed: HTTP {exc.code}") from exc
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise ReconcileError(f"msgraph GET failed: {exc}") from exc


def _audit_token_of(message: dict) -> str:
    """The ``X-SMD-Audit-Row`` value on a Graph message, or ``""``."""
    headers = message.get("internetMessageHeaders")
    if not isinstance(headers, list):
        return ""
    wanted = AUDIT_ROW_HEADER.lower()
    for header in headers:
        if isinstance(header, dict) and str(header.get("name") or "").lower() == wanted:
            return str(header.get("value") or "")
    return ""


def _graph_addresses(message: dict) -> list[str]:
    """Everyone a message reached, across to/cc/bcc, flattened out of Graph's
    ``{"emailAddress": {"address": ...}}`` nesting.

    ``bcc`` is included because it DELIVERS. A report naming only the visible
    recipients of an unaudited send describes the wrong set of people, and a
    finding that is confidently wrong is worse to a reader than a vague one.
    """
    out: list[str] = []
    for field_name in ("toRecipients", "ccRecipients", "bccRecipients"):
        for item in message.get(field_name) or []:
            address = ((item or {}).get("emailAddress") or {}).get("address")
            if address and address not in out:
                out.append(str(address))
    return out


def normalize_graph_message(message: dict) -> dict:
    """A Graph message in the shape the shared matcher and baseline already read.

    ``message_id`` is the RFC2822 ``internetMessageId`` and not the Graph id, for
    two reasons that both point the same way: it is what the broker records on
    the audit row as ``vendor_message_id``, and it is what survives outside this
    mailbox -- in a bounce, in the recipient's copy, in whatever a firm forwards
    when it asks "did you send this?". The mailbox-local Graph id rides along
    separately for anyone who has to go and look at the message.
    """
    return {
        "message_id": str(message.get("internetMessageId") or ""),
        "graph_id": str(message.get("id") or ""),
        "timestamp": str(message.get("sentDateTime") or ""),
        "to": _graph_addresses(message),
        "subject": str(message.get("subject") or ""),
        _AUDIT_TOKEN_KEY: _audit_token_of(message),
    }


def list_sent_msgraph(
    seat: MsGraphSeat, token: str, *, since: datetime | None = None, opener=None
) -> list[dict]:
    """Every message in this seat's Sent Items, newest-first, paged and bounded.

    Ordered newest-first so a ``--since`` window can stop paging as soon as it
    passes the boundary rather than walking the whole mailbox to filter at the
    end. The page cap is a guard, not a window: hitting it raises rather than
    returning a truncated list, because a partial scan reported as a complete one
    is how a control quietly stops covering the oldest half of a mailbox.
    """
    url = (
        f"{GRAPH_API_BASE}/users/{seat.mailbox}/mailFolders/sentitems/messages"
        f"?$select={_GRAPH_SELECT}&$top={_GRAPH_PAGE_SIZE}"
        "&$orderby=" + urllib.parse.quote("sentDateTime desc", safe="")
    )
    out: list[dict] = []
    for _page in range(_GRAPH_MAX_PAGES):
        page = _graph_get(url, token, opener=opener)
        messages = page.get("value")
        for message in messages if isinstance(messages, list) else []:
            normalized = normalize_graph_message(message)
            if since and normalized["timestamp"]:
                if _parse_ts(normalized["timestamp"]) < since:
                    return out
            out.append(normalized)
        url = str(page.get("@odata.nextLink") or "")
        if not url:
            return out
    raise ReconcileError(
        f"{seat.mailbox}: more than {_GRAPH_MAX_PAGES} pages of sent mail; "
        "narrow the run with --days rather than trusting a truncated scan"
    )


def reconcile_mailbox(
    seat: MsGraphSeat,
    since,
    *,
    opener=None,
    client_factory=seam_pull.seam_client_from_env,
    baseline: set[str] | None = None,
    secret: str | None = None,
) -> InboxReport:
    """The msgraph twin of ``reconcile_inbox``, on the same tri-state.

    One difference, and it is a simplification: the owning seat is KNOWN here.
    An msgraph mailbox is reached only because a customer.yaml names it, so the
    "inbox with no owning seat" case the AgentMail half treats as its loudest
    signal cannot arise on this channel -- there is no account-wide key that
    could show us somebody else's mailbox.
    """
    report = InboxReport(inbox=seat.mailbox or seat.slug, slug=seat.slug, channel="msgraph")
    if not (seat.mailbox and seat.tenant_id and seat.client_id):
        report.held = (
            f"{seat.slug}: customer.yaml authors adapter msgraph but not a complete "
            "msgraph_auth (mailbox/tenant_id/client_id)"
        )
        return report
    key = secret if secret is not None else os.environ.get(seat.secret_env)
    if not key:
        report.held = f"{seat.slug}: {seat.secret_env} unset (run under infisical)"
        return report
    try:
        token = graph_token(seat, key, opener=opener)
        sent = list_sent_msgraph(seat, token, since=since, opener=opener)
    except ReconcileError as exc:
        report.held = str(exc)
        return report
    report.sent_total = len(sent)
    if not sent:
        return report

    client = client_factory(seat.slug)
    if client is None:
        report.held = f"no runtime-read client for {seat.slug} (seam env incomplete)"
        return report
    try:
        rows = client.read_all("audit_export")
    except Exception as exc:  # noqa: BLE001 — any transport failure HOLDS
        report.held = f"audit_export read failed for {seat.slug}: {exc}"
        return report
    if not rows:
        report.held = f"audit_export returned no rows for {seat.slug}"
        return report

    exact, tool_path, unaccounted = reconcile(sent, rows)
    report.matched_exact = exact
    report.matched_tool_path = tool_path
    report.unaccounted, report.baselined = split_baselined(
        report.inbox, unaccounted, baseline or set()
    )
    return report


def _metadata(row: dict) -> dict:
    raw = row.get("metadata")
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except ValueError:
            return {}
    return raw if isinstance(raw, dict) else {}


def index_audit(rows: list[dict]) -> tuple[set[str], list[dict]]:
    """Split audit rows into (exact keys ever recorded, tool-path send rows).

    The key set is deliberately a UNION rather than a per-channel switch. It
    holds every vendor message id a row recorded (any metadata key containing
    ``message_id``) and, since ss#2499, every ``audit_row_token`` -- the value of
    the header the broker stamped on the message itself. A msgraph send matches
    on either, and matching on either is what makes the join survive a broker
    that transmitted fine and could not read its own vendor id back afterwards.
    The two key spaces cannot collide: one is an RFC2822/vendor id, the other a
    26-character ULID.
    """
    known_ids: set[str] = set()
    tool_sends: list[dict] = []
    for row in rows:
        meta = _metadata(row)
        for key, value in meta.items():
            if not isinstance(value, str) or not value:
                continue
            if _ID_KEY_SUBSTRING in key or key == _AUDIT_TOKEN_KEY:
                known_ids.add(value)
        if (
            row.get("action_type") == "TOOL_CALL_COMPLETED"
            and meta.get("action_class") == "external_send"
            and meta.get("outcome") == "ok"
        ):
            tool_sends.append({"ts": _parse_ts(row["ts"]), "claimed": False})
    return known_ids, tool_sends


def reconcile(sent: list[dict], rows: list[dict]) -> tuple[int, int, list[dict]]:
    """Return (matched_exact, matched_tool_path, unaccounted)."""
    known_ids, tool_sends = index_audit(rows)

    remaining = [
        m
        for m in sent
        if m.get("message_id") not in known_ids
        and (m.get(_AUDIT_TOKEN_KEY) or "\x00") not in known_ids
    ]
    matched_exact = len(sent) - len(remaining)

    unaccounted: list[dict] = []
    matched_tool = 0
    # Oldest-first so the pairing is deterministic regardless of page order.
    for message in sorted(remaining, key=lambda m: str(m.get("timestamp") or "")):
        stamp = _parse_ts(message.get("timestamp"))
        claim = next(
            (
                candidate
                for candidate in tool_sends
                if not candidate["claimed"]
                and abs((candidate["ts"] - stamp).total_seconds()) <= TOOL_PATH_WINDOW_S
            ),
            None,
        )
        if claim is None:
            unaccounted.append(message)
        else:
            claim["claimed"] = True  # consumed: no second message may claim it
            matched_tool += 1
    return matched_exact, matched_tool, unaccounted


def fingerprint(inbox: str, message: dict) -> str:
    """Stable identity of one send.

    The AgentMail message id is assigned by the sending infrastructure and is
    never reused, so it alone would identify the send; the inbox rides along so a
    baseline entry can never reach across mailboxes. Deliberately NOT derived
    from subject, recipient or day: every one of those repeats on the next run of
    the same routine, and a fingerprint that repeats is a fingerprint that
    silences a new send.
    """
    message_id = message.get("message_id")
    if message_id:
        return f"{inbox}|{message_id}"
    # No id at all has never been observed on a sent message. Fall back to the
    # exact millisecond timestamp rather than to anything coarser, and keep the
    # marker so the two key spaces can never collide.
    return f"{inbox}|ts:{message.get('timestamp')}"


def load_baseline(path: str | None = None) -> set[str]:
    """Fingerprints of sends already reported.

    A missing, unreadable or malformed baseline returns the EMPTY set ON PURPOSE.
    This file's only failure mode must be over-reporting: a baseline that fails
    open would turn a deleted or corrupted JSON file into a silent watchdog,
    which is the exact failure ss#2258 exists to prevent.
    """
    try:
        with open(path or DEFAULT_BASELINE_PATH, encoding="utf-8") as handle:
            parsed = json.load(handle)
    except (OSError, ValueError):
        return set()
    entries = parsed.get("dispositioned") if isinstance(parsed, dict) else parsed
    if not isinstance(entries, list):
        return set()
    return {
        fingerprint(entry["inbox"], entry)
        for entry in entries
        if isinstance(entry, dict)
        and entry.get("inbox")
        and (entry.get("message_id") or entry.get("timestamp"))
    }


def split_baselined(inbox: str, messages: list[dict], baseline: set[str]) -> tuple[list[dict], int]:
    """Return (sends to report, count already reported)."""
    if not baseline:
        return list(messages), 0
    fresh = [m for m in messages if fingerprint(inbox, m) not in baseline]
    return fresh, len(messages) - len(fresh)


def finding_digest(reports: list[InboxReport]) -> str:
    """A stable key for THIS SET of findings, carried in the issue body so the
    workflow can recognise its own report and decline to file it twice.

    The baseline only quiets a find once its PR has merged; between the first
    report and that merge, this is what keeps the second, third and fifth issue
    from being opened. It is derived from the fingerprints themselves, so one
    genuinely new send changes the digest and a new issue still opens.
    """
    keys = sorted(
        fingerprint(report.inbox, message)
        for report in reports
        if report.is_finding
        for message in report.unaccounted
    )
    if not keys:
        return ""
    return hashlib.sha256("\n".join(keys).encode()).hexdigest()[:16]


def exit_code(reports: list[InboxReport]) -> int:
    """0 clean, 1 findings, 2 nothing measured.

    A finding outranks a hold so the issue still gets filed when both are true;
    the workflow reddens the run off the HOLD lines in the report, not off this
    code, so a hold can never be lost behind a finding.
    """
    if any(report.is_finding for report in reports):
        return EXIT_FINDING
    if any(report.held for report in reports):
        return EXIT_HOLD
    return EXIT_CLEAN


def baseline_entries(reports: list[InboxReport]) -> list[dict]:
    """The findings, shaped as baseline rows a human can paste into a PR."""
    return [
        {
            "inbox": report.inbox,
            "channel": report.channel,
            "message_id": message.get("message_id"),
            "timestamp": message.get("timestamp"),
            "to": ", ".join(message.get("to") or []),
            "subject": str(message.get("subject") or ""),
            "reported_in": None,
        }
        for report in reports
        if report.is_finding
        for message in sorted(report.unaccounted, key=lambda m: str(m.get("timestamp") or ""))
    ]


def slug_for_inbox(inbox: str, slugs: list[str]) -> str | None:
    """The seat that owns this inbox, by local part. None ⇒ nobody owns it, which
    is a finding in itself rather than a reason to skip the inbox."""
    local = inbox.split("@", 1)[0].lower()
    return next((s for s in slugs if s.lower() == local), None)


def reconcile_inbox(inbox: str, slugs: list[str], api_key: str, since, *, opener=None,
                    client_factory=seam_pull.seam_client_from_env,
                    baseline: set[str] | None = None) -> InboxReport:
    slug = slug_for_inbox(inbox, slugs)
    report = InboxReport(inbox=inbox, slug=slug)
    if slug is None:
        # Label it before any early return, so a quiet rig still reads as a rig
        # rather than as an unowned mailbox.
        report.non_seat_reason = KNOWN_NON_SEAT_INBOXES.get(inbox)
    try:
        sent = list_sent(inbox, api_key, since=since, opener=opener)
    except ReconcileError as exc:
        report.held = str(exc)
        return report
    report.sent_total = len(sent)
    if not sent:
        return report

    if slug is None:
        if report.non_seat_reason:
            # Authored as seat-less on purpose: our own rig. Counted and named in
            # the report, but not a finding -- there is no ledger it could fail
            # to appear in.
            return report
        # Nobody owns this inbox and nobody authored it as ours. No audit log can
        # account for its sends, and that is exactly the shape of a decommissioned
        # seat still sending, or a mailbox somebody stood up unrecorded. This is
        # the case a seat-side check could never represent, so it stays loud.
        report.unaccounted, report.baselined = split_baselined(inbox, sent, baseline or set())
        return report

    client = client_factory(slug)
    if client is None:
        report.held = f"no runtime-read client for {slug} (seam env incomplete)"
        return report
    try:
        rows = client.read_all("audit_export")
    except Exception as exc:  # noqa: BLE001 — any transport failure HOLDS
        report.held = f"audit_export read failed for {slug}: {exc}"
        return report
    if not rows:
        # Distinguishable from "read fine, found nothing": a seat with sends but a
        # literally empty ledger is unmeasurable, not clean.
        report.held = f"audit_export returned no rows for {slug}"
        return report

    exact, tool_path, unaccounted = reconcile(sent, rows)
    report.matched_exact = exact
    report.matched_tool_path = tool_path
    # Baselining is the LAST step, applied to sends the audit log genuinely does
    # not account for. A held inbox returns above and can never be quieted by it:
    # "already reported" is a statement about a finding, and a hold is not one.
    report.unaccounted, report.baselined = split_baselined(inbox, unaccounted, baseline or set())
    return report


def render(reports: list[InboxReport]) -> str:
    lines: list[str] = []
    findings = [r for r in reports if r.is_finding]
    held = [r for r in reports if r.held]
    for report in reports:
        if report.held:
            lines.append(f"HOLD  {report.inbox}: {report.held}")
            continue
        if report.non_seat_reason:
            lines.append(
                f"n/a   {report.inbox} sent={report.sent_total} "
                f"— not a seat: {report.non_seat_reason}"
            )
            continue
        owner = report.slug or "UNOWNED"
        lines.append(
            f"{'FIND' if report.is_finding else 'ok  '}  {report.inbox} [{owner}] "
            f"({report.channel}) sent={report.sent_total} exact={report.matched_exact} "
            f"tool={report.matched_tool_path} unaccounted={len(report.unaccounted)} "
            f"already-reported={report.baselined}"
        )
        for message in sorted(report.unaccounted, key=lambda m: str(m.get("timestamp") or "")):
            lines.append(
                f"        {message.get('timestamp')} -> "
                f"{','.join(message.get('to') or [])}  {str(message.get('subject'))[:72]}"
            )
    lines.append("")
    scanned_channels = ", ".join(sorted({r.channel for r in reports})) or "none"
    lines.append(
        f"{len(findings)} inbox(es) with unaccounted sends, {len(held)} held, "
        f"{len(reports)} scanned across [{scanned_channels}], "
        f"{sum(r.baselined for r in reports)} already reported "
        f"(operator/bin/reconcile-sends-baseline.json)"
    )
    digest = finding_digest(reports)
    if digest:
        # Printed so the workflow can read it back out of the report and carry it
        # into the issue body: the key that keeps one find from filing five
        # issues while its baseline PR is still open.
        lines.append(f"reconcile-fingerprint: {digest}")
        lines.append("")
        lines.append(
            "Once dispositioned, add these to operator/bin/reconcile-sends-baseline.json "
            "in a PR (fill reported_in with the issue number) so this stops being re-reported:"
        )
        lines.append(json.dumps(baseline_entries(reports), indent=2))
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", help="ISO date; only consider sends at/after this")
    parser.add_argument("--days", type=int, help="only consider sends in the last N days")
    parser.add_argument("--inbox", action="append", help="limit to these inboxes")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument(
        "--baseline", help=f"path to the already-reported baseline (default {DEFAULT_BASELINE_PATH})"
    )
    parser.add_argument(
        "--no-baseline",
        action="store_true",
        help="report every unaccounted send, including ones already reported",
    )
    parser.add_argument(
        "--channel",
        choices=("all", "agentmail", "msgraph"),
        default="all",
        help="which mailbox provider(s) to reconcile (default: all)",
    )
    args = parser.parse_args(argv)

    since = None
    if args.days:
        since = datetime.now(timezone.utc) - timedelta(days=args.days)
    elif args.since:
        since = _parse_ts(args.since if "T" in args.since else args.since + "T00:00:00Z")

    slugs = sorted(
        d for d in os.listdir(_customers_dir()) if not d.startswith("_") and not d.startswith(".")
    )

    baseline = set() if args.no_baseline else load_baseline(args.baseline)
    reports: list[InboxReport] = []

    # ONE CHANNEL'S FAILURE IS NOT THE RUN'S (ss#2499). A missing AgentMail key
    # used to return EXIT_HOLD from here, before anything else ran. With a second
    # channel that would mean an unrelated missing secret silences the control on
    # the PAYING seat, so the miss is recorded as a hold for its own channel and
    # every other mailbox is still scanned.
    if args.channel in ("all", "agentmail"):
        reports.extend(_reconcile_agentmail(args, slugs, since, baseline))
    if args.channel in ("all", "msgraph"):
        reports.extend(_reconcile_msgraph(args, since, baseline))

    if args.json:
        print(
            json.dumps(
                [
                    {
                        "inbox": r.inbox,
                        "slug": r.slug,
                        "channel": r.channel,
                        "sent_total": r.sent_total,
                        "matched_exact": r.matched_exact,
                        "matched_tool_path": r.matched_tool_path,
                        "baselined": r.baselined,
                        "held": r.held,
                        "unaccounted": [
                            {
                                "message_id": m.get("message_id"),
                                "timestamp": m.get("timestamp"),
                                "to": m.get("to"),
                                "subject": m.get("subject"),
                            }
                            for m in r.unaccounted
                        ],
                    }
                    for r in reports
                ],
                indent=2,
            )
        )
    else:
        print(render(reports))

    return exit_code(reports)


def _reconcile_agentmail(args, slugs, since, baseline: set[str]) -> list[InboxReport]:
    """The AgentMail half, unchanged in behaviour and now able to hold alone."""
    api_key = os.environ.get("AGENTMAIL_API_KEY")
    if not api_key:
        return [
            InboxReport(
                inbox="agentmail",
                slug=None,
                held="AGENTMAIL_API_KEY unset (run under infisical)",
            )
        ]
    try:
        inboxes = args.inbox or list_inboxes(api_key)
    except ReconcileError as exc:
        return [InboxReport(inbox="agentmail", slug=None, held=str(exc))]
    return [reconcile_inbox(i, slugs, api_key, since, baseline=baseline) for i in inboxes]


def _reconcile_msgraph(args, since, baseline: set[str]) -> list[InboxReport]:
    """The msgraph half: every seat whose authored mail adapter is msgraph.

    ``--inbox`` narrows this the same way it narrows the AgentMail half, matching
    on the mailbox address or the seat slug so an operator can aim a dispatch run
    at one seat without learning a second flag.

    NO SEATS IS A HOLD, not a pass. Zero msgraph seats means either the file
    layout moved or the parse failed, and a control that reports "all clear" on a
    channel it could not enumerate is the exact shape of the gap this closes.
    """
    seats = msgraph_seats()
    if args.inbox:
        wanted = {str(i).lower() for i in args.inbox}
        seats = [s for s in seats if s.mailbox.lower() in wanted or s.slug.lower() in wanted]
        if not seats:
            return []
    if not seats:
        return [
            InboxReport(
                inbox="msgraph",
                slug=None,
                channel="msgraph",
                held="no seat authors adapter msgraph; the channel was not evaluated",
            )
        ]
    return [reconcile_mailbox(seat, since, baseline=baseline) for seat in seats]


def _customers_dir() -> str:
    return os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "customers"
    )


if __name__ == "__main__":
    raise SystemExit(main())
