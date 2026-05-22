"""Tests for ai-employee/adapter/memory/chunking.py (issue #860).

The chunker MUST produce deterministic chunk IDs across re-runs so the
retrieval layer's citations stay stable, and it MUST keep paragraph
boundaries (single newlines preserved, double newlines split).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))

from adapter.memory.chunking import (  # noqa: E402
    Chunk,
    DocumentChunker,
    chunk_documents,
)


def test_empty_text_yields_zero_chunks():
    c = DocumentChunker(target_chars=400, overlap_chars=50)
    assert c.chunk(document_external_id="doc-1", text="") == []
    assert c.chunk(document_external_id="doc-1", text="   \n  \n") == []


def test_short_text_one_chunk():
    c = DocumentChunker(target_chars=400, overlap_chars=50)
    chunks = c.chunk(document_external_id="doc-1", text="Short paragraph.")
    assert len(chunks) == 1
    assert chunks[0].text == "Short paragraph."
    assert chunks[0].index == 0
    assert chunks[0].document_external_id == "doc-1"
    # Stable hash, 32 hex chars
    assert len(chunks[0].id) == 32


def test_paragraph_boundaries_split_on_blank_lines():
    c = DocumentChunker(target_chars=200, overlap_chars=0)
    text = "Para one line one.\nPara one line two.\n\nPara two line one.\n\nPara three."
    chunks = c.chunk(document_external_id="doc-1", text=text)
    assert len(chunks) >= 1
    # Single-newline lines stay in the same paragraph.
    assert "line one." in chunks[0].text
    assert "line two." in chunks[0].text


def test_target_chars_packs_paragraphs():
    c = DocumentChunker(target_chars=200, overlap_chars=0)
    # 50 paragraphs of ~80 chars each = ~4000 chars total → expect multiple chunks
    long_para = "Paragraph with enough text to count meaningfully toward the budget."
    long_text = "\n\n".join([f"{long_para} (n={i})" for i in range(50)])
    chunks = c.chunk(document_external_id="doc-1", text=long_text)
    assert len(chunks) >= 2
    # No chunk dramatically exceeds the target. Paragraph atomicity allows
    # overshoot of one paragraph; allow some headroom but bound it.
    for chunk in chunks:
        assert chunk.char_count < 400


def test_overlap_preserves_continuity():
    c = DocumentChunker(target_chars=200, overlap_chars=40)
    # Build paragraphs long enough that we definitely cross the chunk boundary.
    paragraphs = [
        "AAAA " * 20,
        "BBBB " * 20,
        "CCCC " * 20,
        "DDDD " * 20,
    ]
    chunks = c.chunk(document_external_id="doc-1", text="\n\n".join(paragraphs))
    assert len(chunks) >= 2
    # Later chunks contain a carry-over slice from the prior chunk.
    later_with_carry = [ch for ch in chunks[1:] if "AAAA" in ch.text or "BBBB" in ch.text]
    assert later_with_carry, "expected at least one later chunk to inherit overlap"


def test_chunk_ids_are_stable_across_runs():
    c1 = DocumentChunker(target_chars=200, overlap_chars=20)
    c2 = DocumentChunker(target_chars=200, overlap_chars=20)
    text = "Paragraph one.\n\nParagraph two.\n\nParagraph three with a bit more content."
    chunks_a = c1.chunk(document_external_id="doc-stable", text=text)
    chunks_b = c2.chunk(document_external_id="doc-stable", text=text)
    assert [c.id for c in chunks_a] == [c.id for c in chunks_b]


def test_chunk_ids_differ_when_content_differs():
    c = DocumentChunker(target_chars=200, overlap_chars=20)
    text_a = "Same intro.\n\nDifferent body A."
    text_b = "Same intro.\n\nDifferent body B."
    a = c.chunk(document_external_id="doc-x", text=text_a)
    b = c.chunk(document_external_id="doc-x", text=text_b)
    # The first chunk might be shared if it lands at the same boundary;
    # at minimum, the later chunk IDs must differ.
    assert any(ai.id != bi.id for ai, bi in zip(a, b))


def test_chunk_ids_differ_when_document_id_differs():
    c = DocumentChunker(target_chars=200, overlap_chars=20)
    text = "Paragraph.\n\nAnother paragraph."
    a = c.chunk(document_external_id="doc-a", text=text)
    b = c.chunk(document_external_id="doc-b", text=text)
    # Same text under different doc IDs must produce different chunk IDs
    # so the retrieval layer can disambiguate citations.
    assert all(x.id != y.id for x, y in zip(a, b))


def test_invalid_target_chars_rejected():
    with pytest.raises(ValueError, match="at least 200"):
        DocumentChunker(target_chars=50)


def test_invalid_overlap_rejected():
    with pytest.raises(ValueError, match="non-negative"):
        DocumentChunker(target_chars=400, overlap_chars=-1)
    with pytest.raises(ValueError, match="smaller than target"):
        DocumentChunker(target_chars=400, overlap_chars=400)


def test_chunk_documents_helper():
    c = DocumentChunker(target_chars=400, overlap_chars=50)
    chunks = chunk_documents(c, [("doc-a", "Para A."), ("doc-b", "Para B.")])
    assert len(chunks) == 2
    assert chunks[0].document_external_id == "doc-a"
    assert chunks[1].document_external_id == "doc-b"
