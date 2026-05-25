"""Stub for mcp:google-gmail.

Documented tools (subset; the real MCP exposes more — we stub only what
the first-customer skills will call):

  - gmail.search_messages(query, max_results=10) -> {messages: [...]}
  - gmail.get_message(message_id, format='full') -> {message: {...}}
  - gmail.create_draft(to, subject, body, thread_id=None) -> {draft: {...}}
  - gmail.list_threads(query, max_results=10) -> {threads: [...]}
  - gmail.get_thread(thread_id) -> {thread: {...}}

Tools the trust-ceiling layer MUST refuse before they reach the MCP
(included for completeness, but the stub raises StubError if called —
the trust plugin should catch these earlier):

  - gmail.send_message — refused at trust-ceiling for draft_for_review
    skills

Canonical happy-path data shape derived from Google's Gmail API v1
``Users.messages`` resource. We do NOT simulate full Gmail attachment
encoding, MIME parts, or label management — those are out of scope for
the first-customer skill set.
"""

from __future__ import annotations

from typing import Any

from . import StubAuthError, StubError, StubNotFoundError


_HAPPY_MESSAGE = {
    "id": "msg_synthetic_001",
    "threadId": "thread_synthetic_001",
    "labelIds": ["INBOX", "UNREAD"],
    "snippet": "We received your demand letter and are reviewing it.",
    "internalDate": "1748160000000",
    "payload": {
        "headers": [
            {"name": "From", "value": "lori.mendez@saguaro-mutual.invalid"},
            {"name": "To", "value": "sarah.holcomb@holcomb-reyes.invalid"},
            {"name": "Subject", "value": "RE: Holloway claim SM-2026-049182"},
            {"name": "Date", "value": "Wed, 25 May 2026 12:00:00 -0700"},
        ],
        "mimeType": "text/plain",
        "body": {"data": "VGVzdCBib2R5IGNvbnRlbnQ=", "size": 21},
    },
}

_HAPPY_THREAD = {
    "id": "thread_synthetic_001",
    "messages": [_HAPPY_MESSAGE],
    "snippet": _HAPPY_MESSAGE["snippet"],
    "historyId": "synth_history_001",
}


def call_gmail(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Stub dispatcher. Returns the canonical happy-path for the documented tool."""
    if tool_name == "gmail.search_messages":
        query = args.get("query", "")
        max_results = int(args.get("max_results", 10))
        return {
            "messages": [
                {
                    "id": _HAPPY_MESSAGE["id"],
                    "threadId": _HAPPY_MESSAGE["threadId"],
                }
            ][:max_results],
            "resultSizeEstimate": 1,
            "_stub_metadata": {"query": query, "max_results": max_results},
        }
    if tool_name == "gmail.get_message":
        message_id = args.get("message_id")
        if not message_id:
            raise StubError("gmail.get_message requires message_id")
        if message_id != _HAPPY_MESSAGE["id"]:
            raise StubNotFoundError(f"message {message_id!r} not found")
        return {"message": _HAPPY_MESSAGE}
    if tool_name == "gmail.create_draft":
        to = args.get("to")
        subject = args.get("subject")
        body = args.get("body")
        if not to or not subject or not body:
            raise StubError("gmail.create_draft requires to, subject, body")
        return {
            "draft": {
                "id": "draft_synthetic_001",
                "message": {
                    "id": "msg_synthetic_draft_001",
                    "threadId": args.get("thread_id"),
                    "labelIds": ["DRAFT"],
                },
            }
        }
    if tool_name == "gmail.list_threads":
        return {
            "threads": [
                {
                    "id": _HAPPY_THREAD["id"],
                    "snippet": _HAPPY_THREAD["snippet"],
                    "historyId": _HAPPY_THREAD["historyId"],
                }
            ],
            "resultSizeEstimate": 1,
        }
    if tool_name == "gmail.get_thread":
        thread_id = args.get("thread_id")
        if not thread_id:
            raise StubError("gmail.get_thread requires thread_id")
        if thread_id != _HAPPY_THREAD["id"]:
            raise StubNotFoundError(f"thread {thread_id!r} not found")
        return {"thread": _HAPPY_THREAD}
    if tool_name == "gmail.send_message":
        # Trust layer SHOULD have caught this; stub refuses defensively.
        raise StubError(
            "gmail.send_message refused at stub layer — should be blocked "
            "by hermes-smd-trust pre_tool_call hook"
        )
    raise StubError(f"unknown gmail tool {tool_name!r}")


def force_auth_error(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Force a 401 auth error response. Used by L3 adversarial probes."""
    raise StubAuthError(
        f"401 Unauthorized: token expired or invalid (tool={tool_name!r})"
    )
