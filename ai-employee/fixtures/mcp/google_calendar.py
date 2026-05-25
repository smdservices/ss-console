"""Stub for mcp:google-calendar.

Documented tools (subset):

  - calendar.list_events(time_min, time_max, calendar_id='primary',
      max_results=10) -> {items: [...]}
  - calendar.get_event(event_id, calendar_id='primary') -> {event: {...}}
  - calendar.create_event(...) -> {event: {...}}
  - calendar.list_calendars() -> {items: [...]}

Canonical response shape derived from Google Calendar API v3
``Events`` resource. Recurrence + attendee response statuses are
simplified — full RFC 5545 recurrence is out of scope for the
first-customer skill set.
"""

from __future__ import annotations

from typing import Any

from . import StubAuthError, StubError, StubNotFoundError


_HAPPY_EVENT = {
    "kind": "calendar#event",
    "id": "evt_synthetic_001",
    "status": "confirmed",
    "summary": "Settlement conference — Holloway v. Saguaro Mutual",
    "description": "Conference at mediator's office.",
    "location": "300 W Clarendon Ave, Suite 200, Phoenix AZ 85013",
    "start": {"dateTime": "2026-06-15T09:00:00-07:00", "timeZone": "America/Phoenix"},
    "end": {"dateTime": "2026-06-15T11:00:00-07:00", "timeZone": "America/Phoenix"},
    "attendees": [
        {"email": "sarah.holcomb@holcomb-reyes.invalid", "responseStatus": "accepted"},
        {"email": "lori.mendez@saguaro-mutual.invalid", "responseStatus": "tentative"},
    ],
    "creator": {"email": "sarah.holcomb@holcomb-reyes.invalid"},
    "organizer": {"email": "sarah.holcomb@holcomb-reyes.invalid"},
    "htmlLink": "https://calendar.google.com/event?eid=evt_synthetic_001",
}

_HAPPY_CALENDAR = {
    "kind": "calendar#calendar",
    "id": "primary",
    "summary": "Sarah Holcomb",
    "timeZone": "America/Phoenix",
}


def call_calendar(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Stub dispatcher. Returns the canonical happy-path for the documented tool."""
    if tool_name == "calendar.list_events":
        time_min = args.get("time_min")
        time_max = args.get("time_max")
        max_results = int(args.get("max_results", 10))
        if not time_min or not time_max:
            raise StubError("calendar.list_events requires time_min and time_max")
        return {
            "kind": "calendar#events",
            "items": [_HAPPY_EVENT][:max_results],
            "_stub_metadata": {"time_min": time_min, "time_max": time_max},
        }
    if tool_name == "calendar.get_event":
        event_id = args.get("event_id")
        if not event_id:
            raise StubError("calendar.get_event requires event_id")
        if event_id != _HAPPY_EVENT["id"]:
            raise StubNotFoundError(f"event {event_id!r} not found")
        return {"event": _HAPPY_EVENT}
    if tool_name == "calendar.create_event":
        summary = args.get("summary")
        start = args.get("start")
        end = args.get("end")
        if not summary or not start or not end:
            raise StubError("calendar.create_event requires summary, start, end")
        return {
            "event": {
                **_HAPPY_EVENT,
                "id": "evt_synthetic_new_001",
                "summary": summary,
                "start": start,
                "end": end,
            }
        }
    if tool_name == "calendar.list_calendars":
        return {"kind": "calendar#calendarList", "items": [_HAPPY_CALENDAR]}
    raise StubError(f"unknown calendar tool {tool_name!r}")


def force_auth_error(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    raise StubAuthError(
        f"401 Unauthorized: token expired or invalid (tool={tool_name!r})"
    )
