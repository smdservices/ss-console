"""The mcp:smokeball tool surface — Smokeball-native names over the real REST API.

Phase-1 scope (per operator/verticals/law-firm/smokeball-surface.md): the read
surface + ``create_memo`` (the one internal-log write the wedge uses). Gated
writes (create_matter/patch_matter/create_task/...) are a phase-2 cut; the
trust-account fund-movement tools (create_transaction/protect_funds/
unprotect_funds) are NEVER implemented here and are hard-BANNED at the overlay.

Paths and query params are taken from the live OpenAPI spec
(docs.smokeball.com/openapi.json, 2026-06-23), which corrected several guesses in
the surface doc (e.g. /mattertypes not /matter-types; files at
/matters/{id}/documents/files; webhooks at /webhooks + /webhooks/types). Items
still marked ASSUMED are confirmed at the connect step against a live tenant.

The client is built LAZILY on first tool call, so the tool surface introspects
(conformance, list_tools) without credentials.
"""

from __future__ import annotations

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
