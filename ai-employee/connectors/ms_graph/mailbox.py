"""``Email`` capability adapter -- Microsoft Graph mailbox surface.

Implements the Email interface from
`docs/specs/ai-employee/capability-contracts.md` Pattern A: read
threads, create drafts in the reviewer's drafts folder, apply labels,
move folders. **No ``send`` method.** Mail.Send is wave-2 (issue #881).

Graph endpoints used (delegated, Phase 1 scopes only):

* ``GET /me/messages`` -- list messages (filtered by conversationId
  in get_thread)
* ``GET /me/messages/{id}`` -- single message
* ``POST /me/messages`` -- create draft (the resulting message has
  ``isDraft: true`` and lives in the Drafts folder)
* ``PATCH /me/messages/{id}`` -- update draft
* ``POST /me/messages/{id}/move`` -- move to a named folder
* ``PATCH /me/messages/{id}`` -- categories edit (mapped to apply_label)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from ._client import GraphClient
from ._types import (
    AdapterError,
    CapabilitySet,
    DraftRef,
    EmailMessage,
    EmailParticipant,
    EmailThread,
    HealthStatus,
)


_SUPPORTED: tuple[str, ...] = (
    "describe_capabilities",
    "health_check",
    "list_threads",
    "get_thread",
    "create_draft",
    "update_draft",
    "apply_label",
    "move_to_folder",
    "get_scoped_folders",
)

# Methods declared by the Email interface but not shipped in v1 MS Graph adapter.
_UNSUPPORTED: tuple[str, ...] = (
    # `send` is intentionally excluded -- Pattern B / wave-2 issue #881.
    "list_sent_since",
    "get_sent_item",
)


class MSGraphMailbox:
    """``Email`` capability adapter."""

    capability = "Email"
    adapter = "microsoft-graph"
    version = "0.1.0"

    def __init__(
        self,
        client: GraphClient,
        *,
        scoped_folders: tuple[str, ...] = (),
    ) -> None:
        self._client = client
        self._scoped_folders = tuple(scoped_folders)

    # ----- AdapterBase -----

    def describe_capabilities(self) -> CapabilitySet:
        return CapabilitySet(
            capability=self.capability,
            adapter=self.adapter,
            version=self.version,
            supported_methods=_SUPPORTED,
            unsupported_methods=_UNSUPPORTED,
            features=("drafts", "categories", "folders"),
        )

    async def health_check(self) -> HealthStatus:
        try:
            await self._client.request("GET", "/me", capability=self.capability)
            return HealthStatus(
                healthy=True,
                last_ok_at=_now_iso(),
            )
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

    def get_scoped_folders(self) -> list[str]:
        """Folders the customer has authored as visible to the agent."""
        return list(self._scoped_folders)

    # ----- Supported methods -----

    async def list_threads(
        self,
        *,
        folder: Optional[str] = None,
        unread_only: bool = False,
        top: int = 50,
    ) -> list[EmailThread]:
        """Return one EmailThread per conversation in the named folder.

        Microsoft Graph models a thread as a ``conversationId``. The
        Phase 1 surface is "give me the most recent N messages in a
        folder grouped by conversation" -- adequate for inbox triage
        and reply drafting; deeper threading semantics ship in vertical
        extensions.
        """
        self._guard_folder(folder)
        params: dict[str, Any] = {
            "$top": min(max(top, 1), 100),
            "$orderby": "receivedDateTime desc",
            "$select": ",".join(
                (
                    "id",
                    "conversationId",
                    "subject",
                    "receivedDateTime",
                    "from",
                    "toRecipients",
                    "ccRecipients",
                    "bodyPreview",
                    "isRead",
                    "parentFolderId",
                )
            ),
        }
        if unread_only:
            params["$filter"] = "isRead eq false"
        path = "/me/messages"
        if folder:
            path = f"/me/mailFolders/{folder}/messages"
        resp = await self._client.request("GET", path, params=params, capability=self.capability)
        payload = resp.json()
        messages = payload.get("value") if isinstance(payload, dict) else None
        if not isinstance(messages, list):
            return []
        grouped: dict[str, list[EmailMessage]] = {}
        for raw in messages:
            if not isinstance(raw, dict):
                continue
            msg = _message_from_graph(raw, folder=folder or "")
            grouped.setdefault(msg.thread_id, []).append(msg)
        threads: list[EmailThread] = []
        for conv_id, msgs in grouped.items():
            msgs_sorted = tuple(sorted(msgs, key=lambda m: m.received_at, reverse=True))
            threads.append(
                EmailThread(
                    id=conv_id,
                    subject=msgs_sorted[0].subject,
                    last_message_at=msgs_sorted[0].received_at,
                    message_count=len(msgs_sorted),
                    messages=msgs_sorted,
                )
            )
        threads.sort(key=lambda t: t.last_message_at, reverse=True)
        return threads

    async def get_thread(self, thread_id: str) -> EmailThread:
        """Return all messages in the given conversation."""
        if not thread_id:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="get_thread requires non-empty thread_id",
            )
        # Microsoft Graph $filter on conversationId with $orderby requires
        # the orderby field to appear in the filter clause set; using
        # receivedDateTime as the secondary sort matches the inbox semantic.
        params: dict[str, Any] = {
            "$filter": f"conversationId eq '{_escape_odata(thread_id)}'",
            "$orderby": "receivedDateTime desc",
            "$top": 100,
            "$select": ",".join(
                (
                    "id",
                    "conversationId",
                    "subject",
                    "receivedDateTime",
                    "from",
                    "toRecipients",
                    "ccRecipients",
                    "bodyPreview",
                    "isRead",
                    "parentFolderId",
                )
            ),
        }
        resp = await self._client.request(
            "GET", "/me/messages", params=params, capability=self.capability
        )
        payload = resp.json()
        raw_messages = payload.get("value") if isinstance(payload, dict) else None
        if not isinstance(raw_messages, list) or not raw_messages:
            raise AdapterError(
                code="not_found",
                capability=self.capability,
                adapter=self.adapter,
                message=f"no messages found for conversationId={thread_id!r}",
            )
        messages = tuple(
            _message_from_graph(r, folder="") for r in raw_messages if isinstance(r, dict)
        )
        first = messages[0]
        return EmailThread(
            id=thread_id,
            subject=first.subject,
            last_message_at=first.received_at,
            message_count=len(messages),
            messages=messages,
        )

    async def create_draft(
        self,
        *,
        reviewer_account_id: str,
        to: list[str],
        subject: str,
        body_html: str,
        body_text: str,
        cc: Optional[list[str]] = None,
        bcc: Optional[list[str]] = None,
        thread_id: Optional[str] = None,
        matter_ref: Optional[str] = None,
    ) -> DraftRef:
        """Create a draft in the reviewer's Drafts folder.

        Pattern A invariant: the draft is created via the customer's
        delegated token. The reviewer sees it natively in Outlook /
        Outlook on the web and edits + sends from there. ``matter_ref``
        is recorded as a category so dashboards can correlate the
        draft to the originating matter.
        """
        if not reviewer_account_id:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="create_draft requires reviewer_account_id",
            )
        if not to or any(not addr for addr in to):
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="create_draft requires at least one valid 'to' address",
            )
        if not subject:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="create_draft requires non-empty subject",
            )
        if not body_html and not body_text:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="create_draft requires at least one of body_html or body_text",
            )
        body: dict[str, Any] = {
            "subject": subject,
            "body": {
                "contentType": "HTML" if body_html else "Text",
                "content": body_html or body_text,
            },
            "toRecipients": [_recipient(a) for a in to],
        }
        if cc:
            body["ccRecipients"] = [_recipient(a) for a in cc]
        if bcc:
            body["bccRecipients"] = [_recipient(a) for a in bcc]
        if thread_id:
            # Microsoft uses conversationId for thread association; setting
            # it on the draft is honored on POST.
            body["conversationId"] = thread_id
        if matter_ref:
            body["categories"] = [f"matter:{matter_ref}"]

        resp = await self._client.request(
            "POST",
            "/me/messages",
            json=body,
            capability=self.capability,
        )
        created = resp.json()
        draft_id = str(created.get("id") or "")
        if not draft_id:
            raise AdapterError(
                code="upstream_error",
                capability=self.capability,
                adapter=self.adapter,
                message="Microsoft Graph returned a draft without an id",
            )
        created_at = str(created.get("createdDateTime") or _now_iso())
        return DraftRef(
            id=draft_id,
            storage_uri=f"msgraph://me/messages/{draft_id}",
            created_at=created_at,
        )

    async def update_draft(
        self,
        draft_id: str,
        updates: dict[str, Any],
    ) -> DraftRef:
        """Patch a draft's content."""
        if not draft_id:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="update_draft requires draft_id",
            )
        if not updates:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="update_draft requires at least one update field",
            )
        body: dict[str, Any] = {}
        if "subject" in updates:
            body["subject"] = updates["subject"]
        if "body_html" in updates or "body_text" in updates:
            body_html = updates.get("body_html")
            body_text = updates.get("body_text")
            body["body"] = {
                "contentType": "HTML" if body_html else "Text",
                "content": body_html or body_text or "",
            }
        if "to" in updates and isinstance(updates["to"], list):
            body["toRecipients"] = [_recipient(a) for a in updates["to"]]
        if "cc" in updates and isinstance(updates["cc"], list):
            body["ccRecipients"] = [_recipient(a) for a in updates["cc"]]
        if "bcc" in updates and isinstance(updates["bcc"], list):
            body["bccRecipients"] = [_recipient(a) for a in updates["bcc"]]

        resp = await self._client.request(
            "PATCH",
            f"/me/messages/{draft_id}",
            json=body,
            capability=self.capability,
        )
        updated = resp.json()
        return DraftRef(
            id=draft_id,
            storage_uri=f"msgraph://me/messages/{draft_id}",
            created_at=str(updated.get("createdDateTime") or _now_iso()),
        )

    async def apply_label(self, thread_id: str, label: str) -> None:
        """Apply a category to every message in a thread.

        Microsoft Graph has no native "label" concept; categories are
        the closest equivalent and are visible in Outlook UI. We patch
        the most recent message in the conversation (Graph does not
        offer a thread-scoped category edit).
        """
        if not thread_id:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="apply_label requires thread_id",
            )
        if not label:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="apply_label requires non-empty label",
            )
        thread = await self.get_thread(thread_id)
        target = thread.messages[0]
        # Read current categories so we don't blow away ones already applied
        # to the message by the reviewer.
        existing_resp = await self._client.request(
            "GET",
            f"/me/messages/{target.id}",
            params={"$select": "categories"},
            capability=self.capability,
        )
        existing = existing_resp.json()
        existing_cats = list(existing.get("categories") or [])
        if label in existing_cats:
            return
        existing_cats.append(label)
        await self._client.request(
            "PATCH",
            f"/me/messages/{target.id}",
            json={"categories": existing_cats},
            capability=self.capability,
        )

    async def move_to_folder(self, thread_id: str, folder: str) -> None:
        """Move every message in a thread to the named folder.

        ``folder`` is a Graph mail-folder id (well-known names like
        ``archive``, ``inbox``, ``deleteditems`` resolve via the
        well-known-name aliasing Microsoft supports). The folder must
        appear in ``scoped_folders`` if the customer has authored a
        scope envelope.
        """
        if not thread_id:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="move_to_folder requires thread_id",
            )
        if not folder:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="move_to_folder requires folder",
            )
        self._guard_folder(folder)
        thread = await self.get_thread(thread_id)
        for msg in thread.messages:
            await self._client.request(
                "POST",
                f"/me/messages/{msg.id}/move",
                json={"destinationId": folder},
                capability=self.capability,
            )

    # ----- Internal helpers -----

    def _guard_folder(self, folder: Optional[str]) -> None:
        """Raise scope_violation if the folder is outside the visible envelope."""
        if folder is None or not self._scoped_folders:
            return
        if folder not in self._scoped_folders:
            raise AdapterError(
                code="scope_violation",
                capability=self.capability,
                adapter=self.adapter,
                message=(
                    f"folder {folder!r} is not in the customer's scoped_folders "
                    "envelope; refusing to traverse outside authored scope"
                ),
            )


# ---------------------------------------------------------------------------
# Translation helpers -- Graph JSON -> typed shapes (no fabrication)
# ---------------------------------------------------------------------------


def _participant(raw: Any) -> Optional[EmailParticipant]:
    if not isinstance(raw, dict):
        return None
    email_addr = raw.get("emailAddress")
    if not isinstance(email_addr, dict):
        return None
    address = email_addr.get("address")
    if not isinstance(address, str) or not address:
        return None
    name = email_addr.get("name")
    return EmailParticipant(
        name=str(name) if isinstance(name, str) and name else None,
        address=address,
    )


def _recipient(address: str) -> dict[str, Any]:
    return {"emailAddress": {"address": address}}


def _message_from_graph(raw: dict[str, Any], *, folder: str) -> EmailMessage:
    msg_id = str(raw.get("id") or "")
    thread_id = str(raw.get("conversationId") or msg_id)
    subject = str(raw.get("subject") or "")
    received_at = str(raw.get("receivedDateTime") or "")
    from_addr = _participant(raw.get("from")) or EmailParticipant(name=None, address="")
    to = tuple(
        p for p in (_participant(t) for t in (raw.get("toRecipients") or [])) if p is not None
    )
    cc = tuple(
        p for p in (_participant(t) for t in (raw.get("ccRecipients") or [])) if p is not None
    )
    return EmailMessage(
        id=msg_id,
        thread_id=thread_id,
        subject=subject,
        received_at=received_at,
        from_addr=from_addr,
        to=to,
        cc=cc,
        body_preview=str(raw.get("bodyPreview") or ""),
        is_read=bool(raw.get("isRead", False)),
        folder=folder or str(raw.get("parentFolderId") or ""),
    )


def _escape_odata(value: str) -> str:
    """Escape single quotes in an OData filter literal per Graph docs."""
    return value.replace("'", "''")


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


__all__ = [
    "MSGraphMailbox",
]
