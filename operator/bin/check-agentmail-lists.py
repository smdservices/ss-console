#!/usr/bin/env python3
"""Check AgentMail send lists against each seat's rostered recipients.

WHY (outbound-quality track, 2026-08). AgentMail's documented suppression
surface is LISTS: send/receive/reply x allow/block, at organization, pod, and
inbox scope, with the narrower scope overriding the broader. A rostered
recipient sitting on a send-block list -- or excluded by a NON-EMPTY send-allow
list -- is silently unreachable: the Operator "sends", the vendor drops it, and
nothing on our side records a failure. That is the suppression failure class,
and nothing was reading it.

VENDOR SHAPE -- PROBED, NEVER ASSUMED (probe date 2026-08-31, docs.agentmail.to;
llms-full.txt was empty on the 2026-08-31 fetch so the REST paths were probed
off the API reference pages directly):

    GET https://api.agentmail.to/v0/lists/{direction}/{type}
    GET https://api.agentmail.to/v0/inboxes/{inbox_id}/lists/{direction}/{type}

    direction in {send, receive, reply}; type in {allow, block};
    pagination via limit + page_token; bearer auth.

The ENTRY shape inside a page is NOT documented on those pages (create takes
``entry`` + ``reason``), so parsing accepts a bare string entry or a mapping
carrying ``entry``; any page whose entries fit neither is a HOLD for that
scope, never a guess. The pod scope is not checked: no seat authors a pod, and
probing a surface nothing authors would report on configuration nobody owns.

WHAT COUNTS AS ROSTERED, per agentmail-adapter seat, all from the seat's own
customer.yaml (no new PII class; this file only re-reads addresses the repo
already commits): ``users[].email``, ``escalation.red_flag_recipients`` +
``failure_recipients``, ``scope.outbound_roster[].address``, and the address
entries of ``scope.inbound_allow_from``.

FINDINGS: a rostered address (or its domain) matching a send-block entry at
org or inbox scope; a NON-EMPTY send-allow list at a scope that omits a
rostered address. Exit contract matches reconcile-sends: 0 clean, 1 findings,
2 HOLD (auth/transport -- nothing measured).

Usage:
    infisical run --env=prod --path=/ss -- python3 operator/bin/check-agentmail-lists.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml

AGENTMAIL_API_BASE = "https://api.agentmail.to/v0"
_HTTP_TIMEOUT_S = 30.0
_PAGE_LIMIT = 100

EXIT_CLEAN = 0
EXIT_FINDING = 1
EXIT_HOLD = 2


class ListsError(RuntimeError):
    """Transport, auth, or shape failure. Holds; never a finding."""


def _get(path: str, api_key: str, *, opener=None) -> dict:
    request = urllib.request.Request(
        AGENTMAIL_API_BASE + path, headers={"Authorization": f"Bearer {api_key}"}
    )
    open_fn = opener or urllib.request.urlopen
    try:
        with open_fn(request, timeout=_HTTP_TIMEOUT_S) as response:
            parsed = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            # A scope with no list configured. Documented-adjacent rather than
            # documented (the reference does not state the empty-scope status),
            # so 404 reads as "no entries" while every OTHER status holds.
            return {}
        raise ListsError(f"agentmail GET {path} failed: HTTP {exc.code}") from exc
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise ListsError(f"agentmail GET {path} failed: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ListsError(f"agentmail GET {path}: non-object payload")
    return parsed


def _entries_of(payload: dict, path: str) -> list[str]:
    """The entry strings of one list page set. Accepts a bare string or a
    mapping carrying ``entry``; anything else RAISES (a guessed parse of an
    undocumented shape is how a control reads a block list as empty)."""
    for key in ("entries", "lists", "data", "items"):
        raw = payload.get(key)
        if isinstance(raw, list):
            out: list[str] = []
            for item in raw:
                if isinstance(item, str):
                    out.append(item)
                elif isinstance(item, dict) and isinstance(item.get("entry"), str):
                    out.append(item["entry"])
                else:
                    raise ListsError(f"{path}: unrecognized list entry shape {type(item).__name__}")
            return out
    if not payload:
        return []
    raise ListsError(f"{path}: no recognizable entries key in payload")


def fetch_list(
    api_key: str, direction: str, kind: str, *, inbox: Optional[str] = None, opener=None
) -> list[str]:
    """One scope's list, drained across pages."""
    base = (
        f"/inboxes/{urllib.parse.quote(inbox)}/lists/{direction}/{kind}"
        if inbox
        else f"/lists/{direction}/{kind}"
    )
    entries: list[str] = []
    token: Optional[str] = None
    while True:
        path = f"{base}?limit={_PAGE_LIMIT}"
        if token:
            path += "&page_token=" + urllib.parse.quote(token)
        payload = _get(path, api_key, opener=opener)
        entries.extend(_entries_of(payload, base))
        token = payload.get("next_page_token") if isinstance(payload, dict) else None
        if not token:
            return entries


# ---------------------------------------------------------------------------
# roster
# ---------------------------------------------------------------------------


def _customers_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "customers"


def _addresses(value) -> list[str]:
    if isinstance(value, str) and "@" in value:
        return [value]
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            if isinstance(item, str) and "@" in item:
                out.append(item)
            elif isinstance(item, dict):
                for key in ("address", "email"):
                    if isinstance(item.get(key), str) and "@" in item[key]:
                        out.append(item[key])
        return out
    return []


def rostered_recipients(config: dict) -> list[str]:
    """Every address this seat is authored to reach or escalate to, deduped,
    lowercased. Extractive: nothing here is guessed or derived."""
    out: list[str] = []
    out += _addresses(config.get("users"))
    escalation = config.get("escalation")
    if isinstance(escalation, dict):
        out += _addresses(escalation.get("red_flag_recipients"))
        out += _addresses(escalation.get("failure_recipients"))
    scope = config.get("scope")
    if isinstance(scope, dict):
        out += _addresses(scope.get("outbound_roster"))
        out += _addresses(scope.get("inbound_allow_from"))
    seen: list[str] = []
    for address in out:
        lowered = address.lower()
        if lowered not in seen:
            seen.append(lowered)
    return seen


def agentmail_seats() -> list[str]:
    seats: list[str] = []
    root = _customers_dir()
    for entry in sorted(root.iterdir()):
        if not entry.is_dir() or entry.name.startswith(("_", ".")):
            continue
        path = entry / "customer.yaml"
        if not path.exists():
            continue
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError):
            continue
        email = ((data.get("connectors") or {}).get("Email")) or {}
        if isinstance(email, dict) and email.get("adapter") == "agentmail":
            seats.append(entry.name)
    return seats


def load_config(slug: str) -> Optional[dict]:
    try:
        parsed = yaml.safe_load(
            (_customers_dir() / slug / "customer.yaml").read_text(encoding="utf-8")
        )
    except (OSError, yaml.YAMLError):
        return None
    return parsed if isinstance(parsed, dict) else None


# ---------------------------------------------------------------------------
# grading
# ---------------------------------------------------------------------------


@dataclass
class ListsFinding:
    scope: str  # org | inbox:<address>
    kind: str  # send_block_match | send_allow_omission
    entry: str  # the matched list entry, or the omitted rostered address
    recipient: str


@dataclass
class SeatListsReport:
    slug: str
    inbox: str
    rostered: int = 0
    findings: list[ListsFinding] = field(default_factory=list)
    held: Optional[str] = None

    @property
    def is_finding(self) -> bool:
        return self.held is None and bool(self.findings)


def _matches(entry: str, address: str) -> bool:
    entry = entry.strip().lower()
    if not entry:
        return False
    domain = address.split("@", 1)[1] if "@" in address else ""
    return entry in (address, domain, f"@{domain}")


def grade_seat(
    slug: str,
    inbox: str,
    rostered: list[str],
    org_block: list[str],
    org_allow: list[str],
    inbox_block: list[str],
    inbox_allow: list[str],
) -> SeatListsReport:
    report = SeatListsReport(slug=slug, inbox=inbox, rostered=len(rostered))
    scopes = (("org", org_block, org_allow), (f"inbox:{inbox}", inbox_block, inbox_allow))
    for scope_name, block, allow in scopes:
        for recipient in rostered:
            for entry in block:
                if _matches(entry, recipient):
                    report.findings.append(
                        ListsFinding(scope=scope_name, kind="send_block_match",
                                     entry=entry, recipient=recipient)
                    )
            if allow and not any(_matches(entry, recipient) for entry in allow):
                report.findings.append(
                    ListsFinding(scope=scope_name, kind="send_allow_omission",
                                 entry=recipient, recipient=recipient)
                )
    return report


def finding_fingerprint(reports: list[SeatListsReport]) -> str:
    keys = sorted(
        f"{report.inbox}|{finding.scope}|{finding.kind}|{finding.entry}|{finding.recipient}"
        for report in reports
        for finding in report.findings
    )
    if not keys:
        return ""
    return hashlib.sha256("\n".join(keys).encode()).hexdigest()[:16]


def render(reports: list[SeatListsReport]) -> str:
    lines: list[str] = []
    for report in reports:
        if report.held:
            lines.append(f"HOLD  {report.inbox}: {report.held}")
            continue
        verdict = "FIND" if report.is_finding else "ok  "
        lines.append(
            f"{verdict}  {report.inbox} [{report.slug}] rostered={report.rostered} "
            f"list-findings={len(report.findings)}"
        )
        for finding in report.findings:
            if finding.kind == "send_block_match":
                lines.append(
                    f"        {finding.scope} send-block entry '{finding.entry}' matches "
                    f"rostered recipient {finding.recipient} -- sends to them are "
                    "silently dropped"
                )
            else:
                lines.append(
                    f"        {finding.scope} has a non-empty send-allow list that omits "
                    f"rostered recipient {finding.recipient} -- sends to them are "
                    "silently dropped"
                )
    findings = sum(len(r.findings) for r in reports if r.held is None)
    held = [r for r in reports if r.held]
    lines.append("")
    lines.append(
        f"{findings} suppression finding(s), {len(held)} held, {len(reports)} seat(s) checked "
        "(AgentMail Lists: org + per-inbox send scope)"
    )
    fingerprint = finding_fingerprint(reports)
    if fingerprint:
        lines.append(f"lists-fingerprint: {fingerprint}")
    return "\n".join(lines)


def check_seat(slug: str, api_key: str, org_lists, *, opener=None) -> SeatListsReport:
    inbox = f"{slug}@agentmail.to"
    config = load_config(slug)
    if config is None:
        report = SeatListsReport(slug=slug, inbox=inbox)
        report.held = f"customer.yaml unreadable for {slug}"
        return report
    rostered = rostered_recipients(config)
    try:
        inbox_block = fetch_list(api_key, "send", "block", inbox=inbox, opener=opener)
        inbox_allow = fetch_list(api_key, "send", "allow", inbox=inbox, opener=opener)
    except ListsError as exc:
        report = SeatListsReport(slug=slug, inbox=inbox, rostered=len(rostered))
        report.held = str(exc)
        return report
    org_block, org_allow = org_lists
    return grade_seat(slug, inbox, rostered, org_block, org_allow, inbox_block, inbox_allow)


def main(argv: Optional[list[str]] = None) -> int:
    api_key = os.environ.get("AGENTMAIL_API_KEY")
    if not api_key:
        print("HOLD  agentmail: AGENTMAIL_API_KEY unset (run under infisical)")
        return EXIT_HOLD
    try:
        org_lists = (
            fetch_list(api_key, "send", "block"),
            fetch_list(api_key, "send", "allow"),
        )
    except ListsError as exc:
        print(f"HOLD  agentmail: org-scope lists unreadable: {exc}")
        return EXIT_HOLD
    seats = agentmail_seats()
    if not seats:
        print("HOLD  agentmail: no seat authors adapter agentmail; nothing was evaluated")
        return EXIT_HOLD
    reports = [check_seat(slug, api_key, org_lists) for slug in seats]
    print(render(reports))
    if any(r.is_finding for r in reports):
        return EXIT_FINDING
    if any(r.held for r in reports):
        return EXIT_HOLD
    return EXIT_CLEAN


if __name__ == "__main__":
    raise SystemExit(main())
