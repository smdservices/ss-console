"""Text extraction for matter documents fetched via ``read_document``.

Bounded, dependency-light, and deliberately dumb: the goal is to hand the
agent the document's TEXT as data — never to render, execute, or interpret
anything inside it. Supported types are the three that cover a law office's
matter folder (PDF, DOCX, plain text); everything else returns an explicit
unsupported error so the skill can fail closed instead of guessing.
"""

from __future__ import annotations

import io

_PDF_MAGIC = b"%PDF"
_ZIP_MAGIC = b"PK\x03\x04"


class UnsupportedDocumentError(RuntimeError):
    """The file type has no text-extraction path. The message names the type so
    the agent can surface 'needs manual review' instead of guessing content."""


def extract_text(blob: bytes, *, file_name: str = "", file_extension: str = "") -> str:
    """Extract plain text from a document blob. Detection is magic-bytes first
    (the extension metadata is client-supplied and can lie), extension second."""
    ext = (file_extension or "").lower().lstrip(".")
    if blob.startswith(_PDF_MAGIC) or ext == "pdf":
        return _pdf_text(blob)
    if blob.startswith(_ZIP_MAGIC) and (ext in ("docx", "dotx", "docm", "dotm", "") or _looks_like_docx(blob)):
        return _docx_text(blob)
    if ext in ("txt", "text", "md", "csv", "log", "eml"):
        return blob.decode("utf-8", "replace")
    # Last resort: treat as text only when it plausibly IS text (no NUL bytes
    # in the first 4KB); otherwise refuse explicitly.
    if b"\x00" not in blob[:4096]:
        return blob.decode("utf-8", "replace")
    raise UnsupportedDocumentError(
        f"no text-extraction path for {file_name or 'document'!r} "
        f"(extension {file_extension or 'unknown'!r}); needs manual review"
    )


def _looks_like_docx(blob: bytes) -> bool:
    # A DOCX is a zip whose early central-directory bytes name its parts.
    return b"[Content_Types].xml" in blob[:4096] or b"word/" in blob[:4096]


def _pdf_text(blob: bytes) -> str:
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(blob))
        pages = [page.extract_text() or "" for page in reader.pages]
    except Exception as exc:  # noqa: BLE001 - malformed PDFs must fail closed, not crash the server
        raise UnsupportedDocumentError(f"PDF could not be parsed: {exc}") from exc
    return "\n\n".join(p.strip() for p in pages if p.strip())


def _docx_text(blob: bytes) -> str:
    from docx import Document

    from .docx_base import _dotx_to_docx_bytes, _is_dotx

    # A Word TEMPLATE (.dotx/.dotm) is a .docx with one content-type string
    # changed; python-docx refuses it as-is. A firm's letterhead template filed
    # on a matter must extract like any other document, not poison every
    # record check on that matter.
    if _is_dotx(blob):
        blob = _dotx_to_docx_bytes(blob)
    try:
        doc = Document(io.BytesIO(blob))
    except Exception as exc:  # noqa: BLE001 - malformed DOCX must fail closed, not crash the server
        raise UnsupportedDocumentError(f"DOCX could not be parsed: {exc}") from exc
    parts: list[str] = [p.text for p in doc.paragraphs if p.text.strip()]
    for table in doc.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells]
            if any(cells):
                parts.append(" | ".join(cells))
    return "\n".join(parts)
