"""Document chunking — paragraph + overlap strategy.

The strategy is deliberately simple and deterministic: split on blank-line
paragraph boundaries, then re-pack into ~``target_chars`` chunks with a small
overlap so a span that straddles a chunk boundary still has a coherent
neighbor. Chunk IDs are stable across re-runs of the same content so a
no-change re-ingestion does not re-shuffle vector IDs (the pipeline
detects no-change via content_digest before re-chunking).

This is intentionally not a smart semantic-aware chunker. The retrieval
layer cites chunk IDs (per PRD §10 "cite specific chunk IDs when
retrieved"); a deterministic chunker keeps citations stable across runs.

The chunker is host-language-agnostic — it does not call the embedding
model. The pipeline calls :class:`DocumentChunker` then hands chunks to
the :class:`EmbeddingClient` (see ``pipeline.py``).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class Chunk:
    """One chunk of a document.

    ``id`` is content-derived so two runs over the same source produce
    the same chunk IDs.
    """

    id: str
    document_external_id: str
    index: int
    text: str

    @property
    def char_count(self) -> int:
        return len(self.text)


def _paragraphs(text: str) -> list[str]:
    """Split on blank-line paragraph boundaries.

    Single newlines inside a paragraph are preserved. The boundary is
    one or more blank lines. Leading/trailing whitespace per paragraph
    is stripped.
    """
    paras: list[str] = []
    buf: list[str] = []
    for line in text.splitlines():
        if line.strip() == "":
            if buf:
                paras.append("\n".join(buf).strip())
                buf = []
        else:
            buf.append(line)
    if buf:
        paras.append("\n".join(buf).strip())
    return [p for p in paras if p]


def _chunk_id(document_external_id: str, index: int, text: str) -> str:
    """Stable chunk ID derived from (document_id, index, sha256(text)).

    A re-ingestion that produces the same paragraphs in the same order
    yields the same chunk IDs. A content edit that shifts later paragraphs
    by one slot does change later IDs — that is intentional, since the
    embedded text changed.
    """
    h = hashlib.sha256()
    h.update(document_external_id.encode("utf-8"))
    h.update(b"\x00")
    h.update(str(index).encode("ascii"))
    h.update(b"\x00")
    h.update(text.encode("utf-8"))
    return h.hexdigest()[:32]


class DocumentChunker:
    """Paragraph + overlap chunker.

    ``target_chars`` is the soft cap per chunk; the chunker packs whole
    paragraphs until adding the next paragraph would exceed it.
    ``overlap_chars`` is replayed from the previous chunk so a span that
    straddles a boundary still has neighbor context.
    """

    def __init__(self, *, target_chars: int = 1800, overlap_chars: int = 200) -> None:
        if target_chars < 200:
            raise ValueError("target_chars must be at least 200 (sensible chunk floor)")
        if overlap_chars < 0:
            raise ValueError("overlap_chars must be non-negative")
        if overlap_chars >= target_chars:
            raise ValueError("overlap_chars must be smaller than target_chars")
        self._target = target_chars
        self._overlap = overlap_chars

    def chunk(self, *, document_external_id: str, text: str) -> list[Chunk]:
        """Return chunks for one document. Empty input yields zero chunks."""
        if not text or not text.strip():
            return []
        paras = _paragraphs(text)
        if not paras:
            return []

        chunks: list[Chunk] = []
        current: list[str] = []
        current_len = 0
        idx = 0

        def _flush(carry_over: str = "") -> None:
            nonlocal current, current_len, idx
            if not current:
                return
            body = "\n\n".join(current).strip()
            if not body:
                current = []
                current_len = 0
                return
            text_with_overlap = (carry_over + body) if carry_over else body
            chunks.append(
                Chunk(
                    id=_chunk_id(document_external_id, idx, text_with_overlap),
                    document_external_id=document_external_id,
                    index=idx,
                    text=text_with_overlap,
                )
            )
            idx += 1
            current = []
            current_len = 0

        carry = ""
        for p in paras:
            p_len = len(p) + 2  # +2 for the joining "\n\n"
            if current and current_len + p_len > self._target:
                _flush(carry)
                # carry over the last `overlap_chars` of the just-emitted chunk
                if self._overlap > 0 and chunks:
                    last_text = chunks[-1].text
                    carry_seed = last_text[-self._overlap :]
                    # Trim to a word boundary to avoid splitting mid-token
                    space = carry_seed.find(" ")
                    if space != -1:
                        carry_seed = carry_seed[space + 1 :]
                    carry = carry_seed + "\n\n" if carry_seed else ""
                else:
                    carry = ""
            current.append(p)
            current_len += p_len
        _flush(carry)
        return chunks


def chunk_documents(
    chunker: DocumentChunker, docs: Iterable[tuple[str, str]]
) -> list[Chunk]:
    """Chunk a stream of (external_id, text) pairs into a flat chunk list."""
    out: list[Chunk] = []
    for external_id, text in docs:
        out.extend(chunker.chunk(document_external_id=external_id, text=text))
    return out


__all__ = ["Chunk", "DocumentChunker", "chunk_documents"]
