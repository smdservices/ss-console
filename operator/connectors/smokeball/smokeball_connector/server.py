"""The mcp:smokeball tool surface — Smokeball-native names over the real REST API.

Scope (per operator/verticals/law-firm/smokeball-surface.md): the read surface,
``create_memo`` (the internal-log write the wedge uses), the document round-trip
writes ``add_file`` (INTERNAL_WRITE) + ``delete_file`` (DESTRUCTIVE), and the
deadline-engine / document-organization write cut — calendar events
(``create_event`` / ``update_event`` / ``create_event_reminder``), tasks
(``create_task`` / ``update_task``), and folders (``create_folder``) — all
INTERNAL_WRITE: the Operator writing computed deadlines, tracked items, and
staging folders into the firm's own record (never an external send). The
trust-account fund-movement tools (create_transaction/protect_funds/
unprotect_funds) are NEVER implemented here and are hard-BANNED at the overlay.
Every write tool's class is declared in manifest.toml and MUST agree with the
overlay's hand-authored action map.

Paths and query params are taken from the live OpenAPI spec
(docs.smokeball.com/openapi.json, 2026-06-23), which corrected several guesses in
the surface doc (e.g. /mattertypes not /matter-types; files at
/matters/{id}/documents/files; webhooks at /webhooks + /webhooks/types). Items
still marked ASSUMED are confirmed at the connect step against a live tenant.

The client is built LAZILY on first tool call, so the tool surface introspects
(conformance, list_tools) without credentials.
"""

from __future__ import annotations

import base64
import os
from typing import Any

from operator_connector_sdk.server import ConnectorServer

from .client import SmokeballClient

server = ConnectorServer("smokeball")

_DEFAULT_REFRESH_TOKEN_FILE = "/opt/data/.smokeball-mcp/refresh_token"

_client: SmokeballClient | None = None


def _read_refresh_token(token_file: str) -> str | None:
    """The firm-delegated refresh token's durable home (ADR 0054): the
    Machine-hosted OAuth callback writes this file. Prefer the file (it survives
    rotation); fall back to the SMOKEBALL_REFRESH_TOKEN env (cold-start seed)."""
    try:
        val = open(token_file, encoding="utf-8").read().strip()
        if val:
            return val
    except OSError:
        pass
    return os.environ.get("SMOKEBALL_REFRESH_TOKEN") or None


def _get_client() -> SmokeballClient:
    global _client
    if _client is None:
        # auth_mode/refresh_token/account_id are per-seat runtime selections, read
        # via .get so an absent value never crashes the default client_credentials
        # path (the manifest declares only the three required secrets). For the
        # authorization_code path the refresh token is read from the volume file
        # the OAuth callback writes (built lazily, so the connector self-heals once
        # the file appears — no restart needed).
        token_file = os.environ.get("SMOKEBALL_REFRESH_TOKEN_FILE") or _DEFAULT_REFRESH_TOKEN_FILE
        _client = SmokeballClient(
            region=os.environ.get("SMOKEBALL_REGION", "us"),
            environment=os.environ.get("SMOKEBALL_ENVIRONMENT", "staging"),
            client_id=os.environ["SMOKEBALL_CLIENT_ID"],
            client_secret=os.environ["SMOKEBALL_CLIENT_SECRET"],
            api_key=os.environ["SMOKEBALL_API_KEY"],
            auth_mode=os.environ.get("SMOKEBALL_AUTH_MODE", "client_credentials"),
            refresh_token=_read_refresh_token(token_file),
            refresh_token_file=token_file,
            account_id=os.environ.get("SMOKEBALL_ACCOUNT_ID") or None,
        )
    return _client


def _body(**fields: Any) -> dict[str, Any]:
    """Build a JSON write body, dropping unset (None) fields so an optional tool
    arg is simply absent rather than sent as ``null``."""
    return {k: v for k, v in fields.items() if v is not None}


# ---- Auth -----------------------------------------------------------------
@server.tool()
def auth_status() -> dict[str, Any]:
    """Confirm the connector can authenticate (mints a token; never returns it)."""
    return _get_client().auth_status()


# ---- Matters --------------------------------------------------------------
@server.tool()
def list_matters(
    status: str | None = None,
    is_lead: bool | None = None,
    matter_type_id: str | None = None,
    contact_id: str | None = None,
    search: str | None = None,
    updated_since: str | None = None,
    sort: str | None = None,
    limit: int = 500,
    offset: int = 0,
) -> Any:
    """List matters/leads. status=Open|Pending|Closed|Deleted|Cancelled;
    is_lead splits leads vs matters. updated_since is passed verbatim (the
    .NET-ticks vs ISO format is confirmed at connect)."""
    return _get_client().get(
        "/matters",
        Status=status,
        IsLead=is_lead,
        MatterTypeId=matter_type_id,
        ContactId=contact_id,
        Search=search,
        UpdatedSince=updated_since,
        Sort=sort,
        Limit=limit,
        Offset=offset,
    )


@server.tool()
def get_matter(matter_id: str) -> Any:
    """Get one matter by id (includes personResponsibleStaffId, status, isLead)."""
    return _get_client().get(f"/matters/{matter_id}")


@server.tool()
def list_matter_types() -> Any:
    """List the firm's matter types (practice areas)."""
    return _get_client().get("/mattertypes")


@server.tool()
def get_stage_sets() -> Any:
    """List stage sets (the matter-stage definitions)."""
    return _get_client().get("/stagesets")


@server.tool()
def get_stage_to_matter_mappings() -> Any:
    """List matter stages (the stage model joined to matters). ASSUMED to be the
    global /stages list; the exact stage<->matter-type join is confirmed at connect."""
    return _get_client().get("/stages")


# ---- Contacts -------------------------------------------------------------
@server.tool()
def get_contacts(
    search: str | None = None,
    type: str | None = None,
    updated_since: str | None = None,
    sort: str | None = None,
    limit: int = 500,
    offset: int = 0,
) -> Any:
    """Search/list contacts (intake dedupe + conflict cross-check)."""
    return _get_client().get(
        "/contacts",
        Search=search,
        Type=type,
        UpdatedSince=updated_since,
        Sort=sort,
        Limit=limit,
        Offset=offset,
    )


@server.tool()
def get_contact(contact_id: str) -> Any:
    """Get one contact by id."""
    return _get_client().get(f"/contacts/{contact_id}")


@server.tool()
def get_contact_relations(contact_id: str) -> Any:
    """Get a contact's relationships to other contacts."""
    return _get_client().get(f"/contacts/{contact_id}/relations")


# ---- Tasks ----------------------------------------------------------------
@server.tool()
def list_tasks(
    matter_id: str | None = None,
    is_completed: bool | None = None,
    updated_since: str | None = None,
    limit: int = 500,
    offset: int = 0,
) -> Any:
    """List tasks (authored court/filing deadlines carry a due date). Filter by
    matter and completion state."""
    return _get_client().get(
        "/tasks",
        MatterId=matter_id,
        IsCompleted=is_completed,
        UpdatedSince=updated_since,
        Limit=limit,
        Offset=offset,
    )


@server.tool()
def get_task(task_id: str) -> Any:
    """Get one task by id."""
    return _get_client().get(f"/tasks/{task_id}")


@server.tool()
def create_task(
    staff_id: str,
    subject: str,
    matter_id: str | None = None,
    note: str | None = None,
    due_date: str | None = None,
    assignee_ids: list[str] | None = None,
) -> Any:
    """Create a task — the tracked-deadline / chase-item write. ``staff_id`` is the
    owning staff member (Smokeball requires it); ``due_date`` is a date-only string
    (YYYY-MM-DD) mapped to the API's ``dueDateOnly`` (the non-deprecated field).
    Classified INTERNAL_WRITE: the Operator writing a tracked item into the firm's
    own record, never an external send."""
    return _get_client().request(
        "POST",
        "/tasks",
        json=_body(
            staffId=staff_id,
            subject=subject,
            matterId=matter_id,
            note=note,
            dueDateOnly=due_date,
            assigneeIds=assignee_ids,
        ),
    )


@server.tool()
def update_task(
    task_id: str,
    subject: str | None = None,
    note: str | None = None,
    due_date: str | None = None,
    is_completed: bool | None = None,
    assignee_ids: list[str] | None = None,
) -> Any:
    """Update a task — reschedule a deadline, mark it complete, or reassign it. Only
    the supplied fields change; ``due_date`` maps to ``dueDateOnly``. Classified
    INTERNAL_WRITE."""
    return _get_client().request(
        "PUT",
        f"/tasks/{task_id}",
        json=_body(
            subject=subject,
            note=note,
            dueDateOnly=due_date,
            isCompleted=is_completed,
            assigneeIds=assignee_ids,
        ),
    )


# ---- Calendar / events ----------------------------------------------------
@server.tool()
def list_events(
    matter_id: str | None = None,
    from_: str | None = None,
    to: str | None = None,
    updated_since: str | None = None,
    exclude_deleted: bool | None = None,
    limit: int = 500,
    offset: int = 0,
) -> Any:
    """List calendar events. ``from_`` / ``to`` bound the window (ISO 8601);
    ``matter_id`` filters to one matter. Used to read back / dedupe the deadlines
    the Operator calendars before writing a new one."""
    return _get_client().get(
        "/events",
        MatterId=matter_id,
        From=from_,
        To=to,
        UpdatedSince=updated_since,
        ExcludeDeletedEvents=exclude_deleted,
        Limit=limit,
        Offset=offset,
    )


@server.tool()
def create_event(
    subject: str,
    start_time: str,
    end_time: str,
    matter_id: str | None = None,
    description: str | None = None,
    location: str | None = None,
    all_day: bool | None = None,
    attendees: list[str] | None = None,
    time_zone: str | None = None,
) -> Any:
    """Create a calendar event — the Operator writing a computed deadline into the
    Smokeball calendar (the single-source-of-truth consolidation). ``start_time`` /
    ``end_time`` are ISO 8601; ``attendees`` are staff ids. Always created as a
    non-recurring (``Normal``) event — recurring events are read-only on the API.
    Classified INTERNAL_WRITE."""
    return _get_client().request(
        "POST",
        "/events",
        json=_body(
            subject=subject,
            startTime=start_time,
            endTime=end_time,
            matterId=matter_id,
            description=description,
            location=location,
            allDay=all_day,
            attendees=attendees,
            timeZone=time_zone,
            type="Normal",
        ),
    )


@server.tool()
def update_event(
    event_id: str,
    subject: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
    description: str | None = None,
    location: str | None = None,
    all_day: bool | None = None,
    attendees: list[str] | None = None,
    time_zone: str | None = None,
) -> Any:
    """Update a calendar event — e.g. recompute a deadline when a trial date moves.
    Only the supplied fields change. Non-recurring events only. INTERNAL_WRITE."""
    return _get_client().request(
        "PUT",
        f"/events/{event_id}",
        json=_body(
            subject=subject,
            startTime=start_time,
            endTime=end_time,
            description=description,
            location=location,
            allDay=all_day,
            attendees=attendees,
            timeZone=time_zone,
        ),
    )


@server.tool()
def create_event_reminder(
    event_id: str,
    offset: int,
    offset_type_id: int,
    is_all_day_reminder: bool | None = None,
    user_ids: list[str] | None = None,
) -> Any:
    """Add a reminder to an event — the reminder cascade on a deadline. ``offset``
    + ``offset_type_id`` set how far ahead it fires (the unit encoding is confirmed
    at the connect step against a live tenant). ``user_ids`` are the staff to remind.
    Classified INTERNAL_WRITE."""
    return _get_client().request(
        "POST",
        f"/events/{event_id}/reminders",
        json=_body(
            offset=offset,
            offsetTypeId=offset_type_id,
            isAllDayReminder=is_all_day_reminder,
            userIds=user_ids,
        ),
    )


# ---- Staff ----------------------------------------------------------------
@server.tool()
def search_staff(search: str | None = None, limit: int = 500, offset: int = 0) -> Any:
    """Search staff/users (responsible-attorney attribution)."""
    return _get_client().get("/staff", Search=search, Limit=limit, Offset=offset)


@server.tool()
def get_staff(staff_id: str) -> Any:
    """Get one staff member by id."""
    return _get_client().get(f"/staff/{staff_id}")


# ---- Roles / relationships ------------------------------------------------
@server.tool()
def get_roles_on_matter(matter_id: str) -> Any:
    """Get the roles (parties) on a matter."""
    return _get_client().get(f"/matters/{matter_id}/roles")


@server.tool()
def get_relationships_on_matter(matter_id: str, role_id: str) -> Any:
    """Get the relationships attached to a role on a matter. (The API nests
    relationships under a role, so role_id is required — a connect-step
    refinement of the surface-doc single-arg signature.)"""
    return _get_client().get(f"/matters/{matter_id}/roles/{role_id}/relationships")


# ---- Files / documents ----------------------------------------------------
@server.tool()
def get_files_on_matter(matter_id: str, limit: int = 500, offset: int = 0) -> Any:
    """List documents/files on a matter."""
    return _get_client().get(
        f"/matters/{matter_id}/documents/files", Limit=limit, Offset=offset
    )


@server.tool()
def get_file(matter_id: str, file_id: str) -> Any:
    """Get one file's metadata. (Needs matter_id + file_id — the file lives under
    its matter, not a flat /files/{id}.)"""
    return _get_client().get(f"/matters/{matter_id}/documents/files/{file_id}")


@server.tool()
def get_download_url(matter_id: str, file_id: str) -> Any:
    """Get a download URL/stream reference for a file."""
    return _get_client().get(f"/matters/{matter_id}/documents/files/{file_id}/download")


@server.tool()
def list_folders(matter_id: str, limit: int = 500, offset: int = 0) -> Any:
    """List the document folders on a matter."""
    return _get_client().get(
        f"/matters/{matter_id}/documents/folders", Limit=limit, Offset=offset
    )


@server.tool()
def create_folder(
    matter_id: str, name: str, parent_folder_id: str | None = None
) -> Any:
    """Create a document folder on a matter — e.g. a ``Discovery/[set]`` folder the
    Operator stages served requests + supporting docs into for BriefPoint/CoCounsel
    to draw from. ``parent_folder_id`` nests it (matter root if omitted). Classified
    INTERNAL_WRITE."""
    return _get_client().request(
        "POST",
        f"/matters/{matter_id}/documents/folders",
        json=_body(name=name, parentFolderId=parent_folder_id),
    )


@server.tool()
def add_file(
    matter_id: str,
    file_name: str,
    content_base64: str,
    folder_id: str | None = None,
) -> Any:
    """Upload a document to a matter. ``content_base64`` is the file's raw bytes
    base64-encoded (any file type); ``folder_id`` is optional (root if omitted).
    Runs Smokeball's two-stage upload (metadata POST -> presigned S3 PUT);
    materialization is asynchronous, so the file may take a moment to appear in
    ``get_files_on_matter``. Returns the new ``fileId``.

    Classified INTERNAL_WRITE at the overlay: this is the agent saving its own
    work product into the firm's record — the save-back half of the read ->
    work -> save document round-trip — never an external send."""
    try:
        data = base64.b64decode(content_base64, validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"content_base64 is not valid base64: {exc}") from exc
    return _get_client().add_file(matter_id, file_name, data, folder_id=folder_id)


@server.tool()
def delete_file(matter_id: str, file_id: str) -> Any:
    """Delete a file from a matter (needs matter_id + file_id — files live under
    their matter). Irreversible loss of a document.

    Classified DESTRUCTIVE at the overlay: it is taint-gated (an untrusted-fed
    turn can never trigger it autonomously) and requires an authored
    ``destructive`` ceiling on the seat — fail-closed otherwise. Returns the
    async tracking link."""
    return _get_client().delete_file(matter_id, file_id)


# ---- Memos ----------------------------------------------------------------
@server.tool()
def get_memos_on_matter(matter_id: str, limit: int = 500, offset: int = 0) -> Any:
    """List memos (internal log entries) on a matter."""
    return _get_client().get(f"/matters/{matter_id}/memos", Limit=limit, Offset=offset)


@server.tool()
def create_memo(matter_id: str, text: str) -> Any:
    """Create an internal-log memo on a matter (the Clio create_note analogue —
    the one autonomous internal write the wedge uses). The exact body field is
    ASSUMED ``text`` and confirmed at the connect step against the live memo
    schema; classified INTERNAL_WRITE at the overlay (never external send)."""
    return _get_client().request("POST", f"/matters/{matter_id}/memos", json={"text": text})


# ---- Trust / bank accounts (READS ONLY — fund movement is hard-banned) -----
@server.tool()
def get_bank_accounts(type: str | None = None, matter_id: str | None = None) -> Any:
    """List bank accounts (trust/operating). Read-only — no fund movement."""
    return _get_client().get("/bankaccounts", type=type, matterId=matter_id)


@server.tool()
def get_matter_balances(
    bank_account_id: str,
    matter_id: str | None = None,
    limit: int = 500,
    offset: int = 0,
) -> Any:
    """Per-matter trust balances (balance / protectedBalance / availableBalance).
    The low-trust flag is availableBalance vs the firm's authored floor."""
    return _get_client().get(
        f"/bankaccounts/{bank_account_id}/matter-balances",
        MatterId=matter_id,
        Limit=limit,
        Offset=offset,
    )


# ---- Billing (AR — kept distinct from trust) ------------------------------
@server.tool()
def get_matter_billing_config(matter_id: str) -> Any:
    """Get a matter's billing configuration."""
    return _get_client().get(f"/matters/{matter_id}/billingconfiguration")


@server.tool()
def get_fees(matter_id: str, limit: int = 500, offset: int = 0) -> Any:
    """List fee entries on a matter (AR, not trust)."""
    return _get_client().get(f"/matters/{matter_id}/fees", Limit=limit, Offset=offset)


@server.tool()
def get_expenses(
    matter_id: str, updated_since: str | None = None, limit: int = 500, offset: int = 0
) -> Any:
    """List expense entries on a matter (AR, not trust)."""
    return _get_client().get(
        f"/matters/{matter_id}/expenses",
        UpdatedSince=updated_since,
        Limit=limit,
        Offset=offset,
    )


# ---- Webhooks (provisioning-time event wiring) ----------------------------
@server.tool()
def get_webhook_subscriptions() -> Any:
    """List the firm's webhook subscriptions."""
    return _get_client().get("/webhooks")


@server.tool()
def get_event_types() -> Any:
    """List the webhook event types the API can push (drives the event skills)."""
    return _get_client().get("/webhooks/types")
