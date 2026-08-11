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
  * audit rows -- the ADR 0043 runtime-read seam (``operator/bin/lib/seam_pull.py``)

MATCHING, two passes:
  1. EXACT. Every audited send records the AgentMail message id -- REPLY_SENT
     carries ``sent_message_id``, REPLY_HELD carries ``message_id`` (121 of 121
     rows observed). This pass needs no tolerance and cannot drift.
  2. TOOL PATH. ``mcp_agentmail_send_message`` audits as TOOL_CALL_COMPLETED with
     action_class=external_send and records NO message id, so time is the only
     available key. Observed skew is sub-second (341 ms on 2026-08-01), so the
     window is deliberately tight and each audit row is CONSUMED once -- two
     messages can never claim the same row.

FAIL-CLOSED, THE OTHER WAY. A failed seam read must never read as "zero audit
rows", which would mark every send unaccounted and mute this within a week. A
transport failure HOLDS (exit 0, reported as unknown); only a successful read
with unmatched sends is a finding. Same tri-state as connector_check: absence is
a hold, corruption is a page.

Usage:
    infisical run --env=prod --path=/ss -- python3 operator/bin/reconcile-sends.py
    ... --since 2026-08-01 --json
"""

from __future__ import annotations

import argparse
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


class ReconcileError(RuntimeError):
    """A transport or credential failure. Holds; never reported as a finding."""


@dataclass
class InboxReport:
    inbox: str
    slug: str | None
    sent_total: int = 0
    matched_exact: int = 0
    matched_tool_path: int = 0
    unaccounted: list[dict] = field(default_factory=list)
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


def _metadata(row: dict) -> dict:
    raw = row.get("metadata")
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except ValueError:
            return {}
    return raw if isinstance(raw, dict) else {}


def index_audit(rows: list[dict]) -> tuple[set[str], list[dict]]:
    """Split audit rows into (message ids ever recorded, tool-path send rows)."""
    known_ids: set[str] = set()
    tool_sends: list[dict] = []
    for row in rows:
        meta = _metadata(row)
        for key, value in meta.items():
            if _ID_KEY_SUBSTRING in key and isinstance(value, str) and value:
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

    remaining = [m for m in sent if m.get("message_id") not in known_ids]
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


def slug_for_inbox(inbox: str, slugs: list[str]) -> str | None:
    """The seat that owns this inbox, by local part. None ⇒ nobody owns it, which
    is a finding in itself rather than a reason to skip the inbox."""
    local = inbox.split("@", 1)[0].lower()
    return next((s for s in slugs if s.lower() == local), None)


def reconcile_inbox(inbox: str, slugs: list[str], api_key: str, since, *, opener=None,
                    client_factory=seam_pull.seam_client_from_env) -> InboxReport:
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
        report.unaccounted = sent
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
    report.unaccounted = unaccounted
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
            f"sent={report.sent_total} exact={report.matched_exact} "
            f"tool={report.matched_tool_path} unaccounted={len(report.unaccounted)}"
        )
        for message in sorted(report.unaccounted, key=lambda m: str(m.get("timestamp") or "")):
            lines.append(
                f"        {message.get('timestamp')} -> "
                f"{','.join(message.get('to') or [])}  {str(message.get('subject'))[:72]}"
            )
    lines.append("")
    lines.append(
        f"{len(findings)} inbox(es) with unaccounted sends, {len(held)} held, "
        f"{len(reports)} scanned"
    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", help="ISO date; only consider sends at/after this")
    parser.add_argument("--days", type=int, help="only consider sends in the last N days")
    parser.add_argument("--inbox", action="append", help="limit to these inboxes")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args(argv)

    api_key = os.environ.get("AGENTMAIL_API_KEY")
    if not api_key:
        print("HOLD: AGENTMAIL_API_KEY unset (run under infisical)", file=sys.stderr)
        return 0  # hold, not a finding

    since = None
    if args.days:
        since = datetime.now(timezone.utc) - timedelta(days=args.days)
    elif args.since:
        since = _parse_ts(args.since if "T" in args.since else args.since + "T00:00:00Z")

    slugs = sorted(
        d for d in os.listdir(_customers_dir()) if not d.startswith("_") and not d.startswith(".")
    )

    try:
        inboxes = args.inbox or list_inboxes(api_key)
    except ReconcileError as exc:
        print(f"HOLD: {exc}", file=sys.stderr)
        return 0

    reports = [reconcile_inbox(i, slugs, api_key, since) for i in inboxes]

    if args.json:
        print(
            json.dumps(
                [
                    {
                        "inbox": r.inbox,
                        "slug": r.slug,
                        "sent_total": r.sent_total,
                        "matched_exact": r.matched_exact,
                        "matched_tool_path": r.matched_tool_path,
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

    # Non-zero ONLY on a real finding. A hold exits 0 so a transport blip cannot
    # page anyone -- the report still names it.
    return 1 if any(r.is_finding for r in reports) else 0


def _customers_dir() -> str:
    return os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "customers"
    )


if __name__ == "__main__":
    raise SystemExit(main())
