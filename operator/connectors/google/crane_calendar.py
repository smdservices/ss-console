#!/usr/bin/env python3
"""crane_calendar.py - thin Google Calendar CLI for the Operator.

Mirrors crane_gmail.py: a deliberately minimal CLI the agent shells to via
`execute_code`. Customer Workspace deployments normally use a customer-owned
service-account key with domain-wide delegation.

  list-events           read events in a window (calendar.events / .readonly)
  get-event <id>        read one event
  create-event-draft    create an event, defaulting to no invite notifications
  update-event-draft    edit an event, defaulting to no invite notifications
  capabilities          print this adapter's CapabilitySet (ADR 0006; no token)

Token resolution shared with the sibling Google CLIs via _google_auth.py.
"""

from __future__ import annotations

import argparse
import json
import sys

from _google_auth import add_token_arg, service

CAPABILITY = "Calendar"
ADAPTER = "google-calendar"
VERSION = "1.0.0"
# Contract method names (calendar.ts). CLI exposes read + draft; the rest are
# declared unsupported (suggest_time needs freebusy; scoped-calendars is a
# customer.yaml envelope concern, not a CLI verb).
SUPPORTED_METHODS = ["list_events", "get_event", "create_event_draft", "update_event_draft"]
UNSUPPORTED_METHODS = ["suggest_time", "get_scoped_calendars"]


def describe_capabilities() -> dict:
    """CapabilitySet for the capability-disclosure / conformance contract."""
    return {
        "capability": CAPABILITY,
        "adapter": ADAPTER,
        "version": VERSION,
        "supported_methods": SUPPORTED_METHODS,
        "unsupported_methods": UNSUPPORTED_METHODS,
    }


def _service(token_path: str):
    return service("calendar", "v3", token_path)


def cmd_list_events(svc, args) -> int:
    params = {
        "calendarId": args.calendar_id,
        "maxResults": args.max,
        "singleEvents": True,
        "orderBy": "startTime",
    }
    if args.time_min:
        params["timeMin"] = args.time_min
    if args.time_max:
        params["timeMax"] = args.time_max
    if args.q:
        params["q"] = args.q
    resp = svc.events().list(**params).execute()
    # Echo source items verbatim — no fabricated fields (NO_FIELD_FABRICATION).
    print(json.dumps(resp.get("items", []), ensure_ascii=False))
    return 0


def cmd_get_event(svc, args) -> int:
    event = svc.events().get(calendarId=args.calendar_id, eventId=args.id).execute()
    print(json.dumps(event, ensure_ascii=False))
    return 0


def cmd_create_event_draft(svc, args) -> int:
    body: dict = {
        "summary": args.title,
        "status": "tentative",
        "start": {"dateTime": args.start},
        "end": {"dateTime": args.end},
    }
    if args.description:
        body["description"] = args.description
    if args.location:
        body["location"] = args.location
    if args.attendee:
        body["attendees"] = [{"email": email} for email in args.attendee]
    created = svc.events().insert(
        calendarId=args.calendar_id, body=body, sendUpdates=args.send_updates
    ).execute()
    print(json.dumps({
        "id": created.get("id"),
        "calendar_id": args.calendar_id,
        "status_in_reviewer_ui": "tentative",
        "created_at": created.get("created"),
        "drafted_by_skill": args.drafted_by_skill,
        "send_updates": args.send_updates,
    }, ensure_ascii=False))
    return 0


def cmd_update_event_draft(svc, args) -> int:
    patch: dict = {}
    if args.title is not None:
        patch["summary"] = args.title
    if args.description is not None:
        patch["description"] = args.description
    if args.location is not None:
        patch["location"] = args.location
    if args.start is not None:
        patch["start"] = {"dateTime": args.start}
    if args.end is not None:
        patch["end"] = {"dateTime": args.end}
    if args.attendee:
        patch["attendees"] = [{"email": email} for email in args.attendee]
    if not patch:
        print("crane_calendar error: update-event-draft requires at least one field", file=sys.stderr)
        return 1
    updated = svc.events().patch(
        calendarId=args.calendar_id, eventId=args.id, body=patch, sendUpdates=args.send_updates
    ).execute()
    print(json.dumps({
        "id": updated.get("id"),
        "calendar_id": args.calendar_id,
        "status_in_reviewer_ui": updated.get("status", "tentative"),
        "created_at": updated.get("created"),
        "send_updates": args.send_updates,
    }, ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="crane_calendar.py")
    add_token_arg(ap)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("capabilities", help="print this adapter's CapabilitySet (no token needed)")

    le = sub.add_parser("list-events")
    le.add_argument("--calendar-id", default="primary")
    le.add_argument("--time-min", help="RFC3339 lower bound (e.g. 2026-06-01T00:00:00Z)")
    le.add_argument("--time-max", help="RFC3339 upper bound")
    le.add_argument("--q", help="free-text search")
    le.add_argument("--max", type=int, default=25)

    ge = sub.add_parser("get-event")
    ge.add_argument("id")
    ge.add_argument("--calendar-id", default="primary")

    ce = sub.add_parser("create-event-draft")
    ce.add_argument("--title", required=True)
    ce.add_argument("--start", required=True, help="RFC3339 start dateTime")
    ce.add_argument("--end", required=True, help="RFC3339 end dateTime")
    ce.add_argument("--description")
    ce.add_argument("--location")
    ce.add_argument("--attendee", action="append", default=[])
    ce.add_argument("--send-updates", choices=["none", "all", "externalOnly"], default="none")
    ce.add_argument("--calendar-id", default="primary")
    ce.add_argument("--drafted-by-skill", required=True, help="audit: skill that authored the draft")

    ue = sub.add_parser("update-event-draft")
    ue.add_argument("id")
    ue.add_argument("--calendar-id", default="primary")
    ue.add_argument("--title")
    ue.add_argument("--description")
    ue.add_argument("--location")
    ue.add_argument("--start")
    ue.add_argument("--end")
    ue.add_argument("--attendee", action="append", default=[])
    ue.add_argument("--send-updates", choices=["none", "all", "externalOnly"], default="none")

    return ap


def main() -> int:
    args = build_parser().parse_args()
    if args.cmd == "capabilities":
        print(json.dumps(describe_capabilities(), ensure_ascii=False))
        return 0
    dispatch = {
        "list-events": cmd_list_events,
        "get-event": cmd_get_event,
        "create-event-draft": cmd_create_event_draft,
        "update-event-draft": cmd_update_event_draft,
    }
    try:
        svc = _service(args.token)
        return dispatch[args.cmd](svc, args)
    except Exception as exc:  # noqa: BLE001 — surface the raw error for the agent/operator
        print(f"crane_calendar error: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
