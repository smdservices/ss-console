"""Shared types and constants for the format renderer (no python-docx import)."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

# Product default typography (the starter look). One place, by design.
DEFAULT_FONT = "Times New Roman"
DEFAULT_SIZE_PT = 12

NAMED_STYLES = (
    "SMD Body",
    "SMD Item Label",
    "SMD Item Text",
    "SMD Heading 1",
    "SMD Heading 2",
    "SMD Heading 3",
    "SMD Caption",
    "SMD Signature",
)


class FormatRefused(RuntimeError):
    """The base document cannot be used as a template; nothing is rendered."""


@dataclass
class FormatReport:
    """What the renderer actually applied, for the delivery note. Honest by
    construction: every fallback is listed, the base's header/footer text is
    surfaced (it bypasses every content gate), and ``templateExpected`` lets
    the note say "the firm's template did not resolve" instead of a null that
    reads like "never configured"."""

    document_class: str
    template_used: dict[str, Any] | None = None
    template_expected: bool = False
    base_header_footer_text: list[str] = field(default_factory=list)
    styles_honored: list[str] = field(default_factory=list)
    fallbacks: list[str] = field(default_factory=list)
    blocks_styled: dict[str, int] = field(default_factory=lambda: {"labels": 0, "tables": 0, "headings": 0})
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        return {
            "class": d["document_class"],
            "templateUsed": d["template_used"],
            "templateExpected": d["template_expected"],
            "baseHeaderFooterText": d["base_header_footer_text"],
            "stylesHonored": sorted(set(d["styles_honored"])),
            "fallbacks": sorted(set(d["fallbacks"])),
            "blocksStyled": d["blocks_styled"],
            "notes": d["notes"],
        }
