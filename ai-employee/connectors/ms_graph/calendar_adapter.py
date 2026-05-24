"""``Calendar`` capability adapter -- Microsoft Graph calendar surface.

Implements the Calendar interface from
`docs/specs/ai-employee/capability-contracts.md`. Pattern A discipline
applies to invites and RSVPs too: the agent creates event drafts and
RSVP drafts; the reviewer confirms before any commitment is recorded
on their behalf (see capability-contracts.md "Resolved decisions"
``Calendar.respond_to_invitation_draft shape``).

Graph endpoints used (delegated, Phase 1 scopes only):

* ``GET /me/calendarView`` -- list events in a time window
* ``GET /me/events/{id}`` -- single event
* ``POST /me/events`` -- create event (subject + start + end + attendees)
* ``POST /me/calendar/getSchedule`` -- find free/busy windows
* Draft RSVPs are stored as local DraftRefs -- the actual
  ``accept``/``decline``/``tentativelyAccept`` call only fires after
  the reviewer taps in the dashboard.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from ._client import GraphClient
from ._types import (
    AdapterError,
    CalendarAttendee,
    CalendarEvent,
    CapabilitySet,
    DraftRef,
    EmailParticipant,
    HealthStatus,
    TimeSlot,
)


_SUPPORTED: tuple[str, ...] = (
    "describe_capabilities",
    "health_check",
    "list_events",
    "get_event",
    "create_event_draft",
    "update_event_draft",
    "suggest_times",
    "respond_to_invitation_draft",
)

_UNSUPPORTED: tuple[str, ...] = ()


class MSGraphCalendar:
    """``Calendar`` capability adapter."""

    capability = "Calendar"
    adapter = "microsoft-graph"
    version = "0.1.0"

    def __init__(self, client: GraphClient) -> None:
        self._client = client

    def describe_capabilities(self) -> CapabilitySet:
        return CapabilitySet(
            capability=self.capability,
            adapter=self.adapter,
            version=self.version,
            supported_methods=_SUPPORTED,
            unsupported_methods=_UNSUPPORTED,
            features=("free-busy", "rsvp-draft"),
        )

    async def health_check(self) -> HealthStatus:
        try:
            await self._client.request(
                "GET",
                "/me/calendar",
                capability=self.capability,
            )
            return HealthStatus(healthy=True, last_ok_at=_now_iso())
        except AdapterError as exc:
            return HealthStatus(
                healthy=False,
                last_ok_at="",
                last_error={
                    "kind": exc.code,
                    "capability": self.capability,
                    "adapter": self.adapter,
                },
            )

    async def list_events(
        self,
        *,
        start: str,
        end: str,
        top: int = 50,
    ) -> list[CalendarEvent]:
        """Events in the half-open window ``[start, end)``.

        ``start`` and ``end`` MUST be ISO 8601 UTC strings; Graph's
        ``calendarView`` enforces a sane upper bound (currently 5
        years) and we let it surface its own error if exceeded.
        """
        if not start or not end:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="list_events requires start and end (ISO 8601 UTC)",
            )
        params = {
            "startDateTime": start,
            "endDateTime": end,
            "$top": min(max(top, 1), 100),
            "$orderby": "start/dateTime",
            "$select": ",".join(
                (
                    "id",
                    "subject",
                    "start",
                    "end",
                    "location",
                    "bodyPreview",
                    "organizer",
                    "attendees",
                    "isAllDay",
                )
            ),
        }
        resp = await self._client.request(
            "GET",
            "/me/calendarView",
            params=params,
            capability=self.capability,
        )
        payload = resp.json()
        rows = payload.get("value") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            return []
        return [_event_from_graph(r) for r in rows if isinstance(r, dict)]

    async def get_event(self, event_id: str) -> Optional[CalendarEvent]:
        if not event_id:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="get_event requires event_id",
            )
        try:
            resp = await self._client.request(
                "GET",
                f"/me/events/{event_id}",
                capability=self.capability,
            )
        except AdapterError as exc:
            if exc.code == "not_found":
                return None
            raise
        return _event_from_graph(resp.json())

    async def create_event_draft(
        self,
        *,
        subject: str,
        start: str,
        end: str,
        attendees: Optional[list[str]] = None,
        location: Optional[str] = None,
        body_text: Optional[str] = None,
        matter_ref: Optional[str] = None,
    ) -> DraftRef:
        """Create an unsent event on the reviewer's calendar.

        Microsoft Graph does not expose a first-class "calendar draft"
        concept -- the closest thing is creating an event with
        ``responseRequested: false`` and no attendees pre-invited.
        Per Pattern A discipline, the v1 adapter creates the event
        with ``responseRequested: false`` and an attendee list, so it
        appears in the reviewer's calendar; the dashboard surfaces it
        as a draft and the reviewer manually fires the invite. This
        avoids the agent inadvertently sending invitations.
        """
        if not subject:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="create_event_draft requires subject",
            )
        if not start or not end:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="create_event_draft requires start and end (ISO 8601 UTC)",
            )
        body: dict[str, Any] = {
            "subject": subject,
            "start": {"dateTime": start, "timeZone": "UTC"},
            "end": {"dateTime": end, "timeZone": "UTC"},
            "responseRequested": False,
            "isReminderOn": False,
        }
        if location:
            body["location"] = {"displayName": location}
        if body_text:
            body["body"] = {"contentType": "Text", "content": body_text}
        if attendees:
            body["attendees"] = [
                {
                    "emailAddress": {"address": a},
                    "type": "required",
                }
                for a in attendees
            ]
        if matter_ref:
            body["categories"] = [f"matter:{matter_ref}"]

        resp = await self._client.request(
            "POST",
            "/me/events",
            json=body,
            capability=self.capability,
        )
        created = resp.json()
        event_id = str(created.get("id") or "")
        if not event_id:
            raise AdapterError(
                code="upstream_error",
                capability=self.capability,
                adapter=self.adapter,
                message="Microsoft Graph returned an event without an id",
            )
        return DraftRef(
            id=event_id,
            storage_uri=f"msgraph://me/events/{event_id}",
            created_at=str(created.get("createdDateTime") or _now_iso()),
        )

    async def update_event_draft(
        self,
        draft_id: str,
        updates: dict[str, Any],
    ) -> DraftRef:
        if not draft_id:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="update_event_draft requires draft_id",
            )
        if not updates:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="update_event_draft requires at least one update field",
            )
        body: dict[str, Any] = {}
        if "subject" in updates:
            body["subject"] = updates["subject"]
        if "start" in updates:
            body["start"] = {"dateTime": updates["start"], "timeZone": "UTC"}
        if "end" in updates:
            body["end"] = {"dateTime": updates["end"], "timeZone": "UTC"}
        if "location" in updates:
            body["location"] = {"displayName": updates["location"]}
        if "body_text" in updates:
            body["body"] = {"contentType": "Text", "content": updates["body_text"]}
        if "attendees" in updates and isinstance(updates["attendees"], list):
            body["attendees"] = [
                {"emailAddress": {"address": a}, "type": "required"}
                for a in updates["attendees"]
            ]
        resp = await self._client.request(
            "PATCH",
            f"/me/events/{draft_id}",
            json=body,
            capability=self.capability,
        )
        updated = resp.json()
        return DraftRef(
            id=draft_id,
            storage_uri=f"msgraph://me/events/{draft_id}",
            created_at=str(updated.get("createdDateTime") or _now_iso()),
        )

    async def suggest_times(
        self,
        *,
        attendees: list[str],
        start: str,
        end: str,
        duration_minutes: int,
    ) -> list[TimeSlot]:
        """Return free-busy windows in the [start, end) range.

        Uses Graph's ``/me/calendar/getSchedule`` endpoint, which
        returns busy/tentative/oof intervals per attendee. We invert
        the merged busy set to derive free slots of the requested
        minimum duration.
        """
        if not attendees:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="suggest_times requires at least one attendee",
            )
        if duration_minutes <= 0:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="suggest_times requires positive duration_minutes",
            )
        body = {
            "schedules": attendees,
            "startTime": {"dateTime": start, "timeZone": "UTC"},
            "endTime": {"dateTime": end, "timeZone": "UTC"},
            "availabilityViewInterval": 30,
        }
        resp = await self._client.request(
            "POST",
            "/me/calendar/getSchedule",
            json=body,
            capability=self.capability,
        )
        payload = resp.json()
        rows = payload.get("value") if isinstance(payload, dict) else []
        # Merge busy intervals across all attendees.
        busy_intervals: list[tuple[float, float]] = []
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict):
                continue
            for item in row.get("scheduleItems") or []:
                if not isinstance(item, dict):
                    continue
                status = str(item.get("status") or "")
                if status not in ("busy", "tentative", "oof", "workingElsewhere"):
                    continue
                s = item.get("start")
                e = item.get("end")
                if not (isinstance(s, dict) and isinstance(e, dict)):
                    continue
                s_iso = str(s.get("dateTime") or "")
                e_iso = str(e.get("dateTime") or "")
                if not (s_iso and e_iso):
                    continue
                try:
                    s_ts = _iso_to_ts(s_iso)
                    e_ts = _iso_to_ts(e_iso)
                except ValueError:
                    continue
                if e_ts > s_ts:
                    busy_intervals.append((s_ts, e_ts))
        try:
            window_start = _iso_to_ts(start)
            window_end = _iso_to_ts(end)
        except ValueError as exc:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message=f"suggest_times start/end could not be parsed: {exc}",
            ) from exc
        free = _merge_free(busy_intervals, window_start, window_end, duration_minutes * 60)
        return [
            TimeSlot(start=_ts_to_iso(s), end=_ts_to_iso(e)) for s, e in free
        ]

    async def respond_to_invitation_draft(
        self,
        event_id: str,
        response: str,
        comment: Optional[str] = None,
    ) -> DraftRef:
        """Draft an RSVP -- does NOT actually accept/decline.

        Per capability-contracts.md resolved decision: the API call to
        accept/decline is partner-fired from the dashboard. The
        adapter returns a DraftRef the dashboard renders. The
        ``response`` argument is validated here so the dashboard layer
        can't drift the vocabulary.
        """
        if response not in ("accept", "decline", "tentative"):
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message=f"response must be accept | decline | tentative, got {response!r}",
            )
        if not event_id:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="respond_to_invitation_draft requires event_id",
            )
        # No upstream call is made here -- the draft lives in the
        # dashboard until the reviewer taps. The storage_uri encodes
        # the response so the dashboard can fire the right Graph
        # endpoint when the reviewer confirms.
        draft_id = f"rsvp-{event_id}-{response}"
        storage_uri = f"msgraph-draft://rsvp/{event_id}/{response}"
        if comment:
            storage_uri += f"?comment={_safe_qs(comment)}"
        return DraftRef(
            id=draft_id,
            storage_uri=storage_uri,
            created_at=_now_iso(),
        )


# ---------------------------------------------------------------------------
# Translation helpers
# ---------------------------------------------------------------------------


def _event_from_graph(raw: dict[str, Any]) -> CalendarEvent:
    organizer = raw.get("organizer")
    organizer_p: Optional[EmailParticipant] = None
    if isinstance(organizer, dict):
        email_addr = organizer.get("emailAddress")
        if isinstance(email_addr, dict):
            address = email_addr.get("address")
            if isinstance(address, str) and address:
                organizer_p = EmailParticipant(
                    name=str(email_addr.get("name") or "") or None,
                    address=address,
                )

    raw_attendees = raw.get("attendees") or []
    attendees: list[CalendarAttendee] = []
    if isinstance(raw_attendees, list):
        for a in raw_attendees:
            if not isinstance(a, dict):
                continue
            email_addr = a.get("emailAddress")
            if not isinstance(email_addr, dict):
                continue
            address = email_addr.get("address")
            if not isinstance(address, str) or not address:
                continue
            status = a.get("status")
            response = ""
            if isinstance(status, dict):
                response = str(status.get("response") or "")
            attendees.append(
                CalendarAttendee(
                    address=address,
                    name=str(email_addr.get("name") or "") or None,
                    response_status=response or None,
                )
            )
    start = ""
    end = ""
    raw_start = raw.get("start")
    raw_end = raw.get("end")
    if isinstance(raw_start, dict):
        start = str(raw_start.get("dateTime") or "")
    if isinstance(raw_end, dict):
        end = str(raw_end.get("dateTime") or "")
    location_text: Optional[str] = None
    raw_location = raw.get("location")
    if isinstance(raw_location, dict):
        loc_name = raw_location.get("displayName")
        if isinstance(loc_name, str) and loc_name:
            location_text = loc_name
    return CalendarEvent(
        id=str(raw.get("id") or ""),
        subject=str(raw.get("subject") or ""),
        start=start,
        end=end,
        location=location_text,
        body_preview=str(raw.get("bodyPreview") or "") or None,
        organizer=organizer_p,
        attendees=tuple(attendees),
        is_all_day=bool(raw.get("isAllDay", False)),
    )


def _merge_free(
    busy: list[tuple[float, float]],
    window_start: float,
    window_end: float,
    min_duration_seconds: int,
) -> list[tuple[float, float]]:
    """Return free intervals of at least ``min_duration_seconds`` inside the window.

    Busy intervals are coalesced (sorted, overlapping merged); the
    complement inside ``[window_start, window_end)`` is split into
    intervals long enough to satisfy the requested duration.
    """
    if window_end <= window_start:
        return []
    if not busy:
        if window_end - window_start >= min_duration_seconds:
            return [(window_start, window_end)]
        return []
    sorted_busy = sorted(busy, key=lambda iv: iv[0])
    merged: list[tuple[float, float]] = []
    cur_s, cur_e = sorted_busy[0]
    for s, e in sorted_busy[1:]:
        if s <= cur_e:
            cur_e = max(cur_e, e)
        else:
            merged.append((cur_s, cur_e))
            cur_s, cur_e = s, e
    merged.append((cur_s, cur_e))

    free: list[tuple[float, float]] = []
    cursor = window_start
    for s, e in merged:
        if e <= cursor:
            continue
        if s >= window_end:
            break
        if s > cursor:
            gap_end = min(s, window_end)
            if gap_end - cursor >= min_duration_seconds:
                free.append((cursor, gap_end))
        cursor = max(cursor, e)
        if cursor >= window_end:
            break
    if cursor < window_end and window_end - cursor >= min_duration_seconds:
        free.append((cursor, window_end))
    return free


def _iso_to_ts(iso: str) -> float:
    """Parse ISO 8601 to a UNIX timestamp.

    Graph returns timestamps as 'YYYY-MM-DDTHH:MM:SS.fffffff' WITHOUT
    a zone designator inside the ``dateTime`` field (the zone is in
    the sibling ``timeZone`` field). We treat the bare timestamp as
    UTC, which matches our request shape (``timeZone: "UTC"``).
    """
    cleaned = iso.replace("Z", "")
    # Truncate fractional seconds to 6 digits (Python's strptime limit).
    if "." in cleaned:
        head, frac = cleaned.split(".", 1)
        frac = frac[:6]
        cleaned = f"{head}.{frac}"
    try:
        dt = datetime.fromisoformat(cleaned)
    except ValueError as exc:
        raise ValueError(f"cannot parse ISO timestamp {iso!r}") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def _ts_to_iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _safe_qs(value: str) -> str:
    from urllib.parse import quote

    return quote(value, safe="")


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


__all__ = [
    "MSGraphCalendar",
]
