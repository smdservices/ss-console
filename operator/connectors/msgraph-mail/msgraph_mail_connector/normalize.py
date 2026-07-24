"""Graph message -> the provider-neutral ``InboundMessage`` DTO (email-channel-seam
D2). This is the seam's normalization point for the msgraph adapter: every inbound
Graph message becomes the ONE shape roster / taint / prompts / skills consume, so
nothing downstream of the seam branches on provider.

Fail-safe (ADR 0078 §4): a field the adapter cannot populate degrades toward
``None`` / ``""`` / ``[]`` — it is NEVER invented. An adapter that cannot populate a
governance-required field yields a quarantine-friendly empty value, never a
plausible guess.
"""

from __future__ import annotations

import html
from html.parser import HTMLParser
from typing import Any

PROVIDER = "msgraph"

# Tags whose text content is not body copy (drop it entirely).
_DROP_CONTENT_TAGS = {"script", "style", "head", "title"}
# Tags that imply a line break in the flattened text.
_BREAK_TAGS = {"br", "p", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6"}


class _TextExtractor(HTMLParser):
    """Collect visible text from an HTML fragment, dropping script/style content
    and inserting newlines at block boundaries. ``convert_charrefs=True`` (the
    default) means entities arrive already decoded in ``handle_data``."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag in _DROP_CONTENT_TAGS:
            self._skip_depth += 1
        elif tag in _BREAK_TAGS:
            self._parts.append("\n")

    def handle_startendtag(self, tag: str, attrs: Any) -> None:
        if tag in _BREAK_TAGS:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _DROP_CONTENT_TAGS and self._skip_depth:
            self._skip_depth -= 1
        elif tag in _BREAK_TAGS:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip_depth:
            self._parts.append(data)

    def get_text(self) -> str:
        return "".join(self._parts)


def html_to_text(raw_html: str) -> str:
    """Strip an HTML mail body to plain text (stdlib only): block boundaries become
    line breaks, empty lines are dropped, and each line is trimmed; entities are
    decoded. The result is content, not a layout-faithful render."""
    parser = _TextExtractor()
    parser.feed(raw_html)
    parser.close()
    text = html.unescape(parser.get_text())
    lines = [ln.strip() for ln in text.splitlines()]
    return "\n".join(ln for ln in lines if ln)


def _bare_address(recipient: Any) -> str | None:
    """A Graph recipient (``{"emailAddress": {"address": ...}}``) -> a bare,
    lowercased address, or None when absent/malformed (never invented)."""
    if not isinstance(recipient, dict):
        return None
    email = recipient.get("emailAddress")
    if not isinstance(email, dict):
        return None
    addr = (email.get("address") or "").strip().lower()
    return addr or None


def _address_list(recipients: Any) -> list[str]:
    """A Graph recipient array -> bare lowercased addresses (blanks dropped)."""
    if not isinstance(recipients, list):
        return []
    return [a for a in (_bare_address(r) for r in recipients) if a]


def _body_text(raw: dict[str, Any]) -> str:
    """Plain-text body: strip HTML when ``body.contentType == 'html'``; otherwise
    the text content verbatim. ``""`` when the message carries no body content."""
    body = raw.get("body")
    if not isinstance(body, dict):
        return ""
    content = body.get("content") or ""
    if not content:
        return ""
    if (body.get("contentType") or "").lower() == "html":
        return html_to_text(content)
    return content.strip()


def has_body_content(raw: dict[str, Any]) -> bool:
    """Whether a raw Graph message carries body content — the poller's signal to
    fall back to the read path for a delta item that omitted the body."""
    body = raw.get("body")
    return isinstance(body, dict) and bool(body.get("content"))


def normalize_message(raw: dict[str, Any], *, mailbox: str) -> dict[str, Any]:
    """A raw Graph message -> the ``InboundMessage`` DTO (spec D2).

    ``provider_refs`` is opaque and carries the Graph ids the reply transport needs
    (the reply path depends on inbound-carried ids). Missing fields degrade to
    empty/None, never a guess."""
    message_id = raw.get("id") or ""
    conversation_id = raw.get("conversationId")
    from_addr = _bare_address(raw.get("from")) or ""
    return {
        "provider": PROVIDER,
        "mailbox": mailbox,
        "message_id": message_id,
        "thread_ref": conversation_id,
        "from_addr": from_addr,
        "to": _address_list(raw.get("toRecipients")),
        "cc": _address_list(raw.get("ccRecipients")),
        "subject": raw.get("subject") or "",
        "body_text": _body_text(raw),
        "received_at": raw.get("receivedDateTime"),
        "provider_refs": {
            "graph_message_id": message_id,
            "conversation_id": conversation_id,
        },
    }
