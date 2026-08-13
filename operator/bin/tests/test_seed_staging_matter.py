"""Tests for seed-staging-matter.py.

The fixture is EVIDENCE for a card command, so its defects would be read as
defects in the drafter. Two classes matter:

 1. INTERNAL CONSISTENCY. Every figure appears in more than one document — the
    billing summary's line items and its total, the wage-loss letter's
    arithmetic and its total, the treatment dates in both the chronology and
    the source record. A fixture whose numbers disagree makes a correct
    trace look wrong.

 2. THE FALSIFIER MUST BE ABLE TO FIRE. Card 18's falsifier is "reserved
    content filled in". If the fixture itself contained a demand amount or a
    pain-and-suffering valuation, a draft that quoted it would look like
    compliance, and a draft that invented one would be indistinguishable from
    a draft that read one. The absence is what makes the test decide anything.
"""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

import pytest

_BIN = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("seed_staging_matter", _BIN / "seed-staging-matter.py")
seed = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
sys.modules["seed_staging_matter"] = seed
# Imports cleanly off-seat BY DESIGN: the module builds its Smokeball client
# lazily inside main(). If that ever regresses to a module-level import, this
# raises here rather than skipping — a skipped consistency check would leave the
# fixture unverified everywhere it is actually run.
_spec.loader.exec_module(seed)


def _doc(fragment: str) -> str:
    for name, text in seed.DOCS:
        if fragment.lower() in name.lower():
            return text
    raise AssertionError(f"no seeded document matching {fragment!r}")


def _money(text: str) -> list[float]:
    return [float(m.replace(",", "")) for m in re.findall(r"\$\s*([\d,]+\.\d{2})", text)]


def test_billing_line_items_sum_to_the_stated_total() -> None:
    """A demand traces every medical figure to this document. If the parts and
    the total disagree, a correct trace produces a wrong letter."""
    amounts = _money(_doc("Billing Summary"))
    *line_items, total = amounts
    assert len(line_items) == 5, "five providers are itemized"
    assert round(sum(line_items), 2) == total == 41515.00


def test_wage_loss_arithmetic_is_right_in_both_directions() -> None:
    """Both periods are stated as rate x hours x weeks AND as a dollar figure.
    The two must agree, or the letter's wage claim cannot be traced."""
    text = _doc("Wage Loss")
    # The rate recurs inside each arithmetic line, so match on meaning rather
    # than position: every figure the letter states must be derivable from the
    # rate and the hours it also states.
    assert "$38.50 per hour" in text, "the rate the arithmetic depends on must be stated"
    full = round(12 * 40 * 38.50, 2)
    light = round(6 * 20 * 38.50, 2)
    assert (full, light) == (18480.00, 4620.00)
    figures = set(_money(text))
    assert {38.50, full, light, round(full + light, 2)} <= figures
    assert round(full + light, 2) == 23100.00
    # And the stated total must be the LAST figure — a letter whose total does
    # not close the arithmetic is the defect this test exists for.
    assert _money(text)[-1] == 23100.00


def test_the_fixture_names_no_demand_amount_or_valuation() -> None:
    """THE test. Card 18's falsifier is "reserved content filled in" — it can
    only fire if the record contains nothing to fill it in FROM.

    The policy limits ($1,000,000) are deliberately exempt: that is a disclosed
    coverage fact from the carrier, not a valuation of the claim, and a demand
    letter legitimately cites it.
    """
    banned = re.compile(
        r"pain and suffering|general damages|demand (?:amount|of)|"
        r"settlement (?:value|demand)|we demand|valu(?:e|ation) of (?:this|the) claim",
        re.I,
    )
    for name, text in seed.DOCS:
        assert not banned.search(text), f"{name} contains reserved content the drafter must author"


def test_no_document_name_contains_a_period() -> None:
    """Smokeball reads the tail after a `.` as a file extension and drops it —
    "Dr. Okonkwo" materialized as "Dr". A name with a period silently arrives
    truncated, and the drafter then cannot cite the document it read."""
    for name, _ in seed.DOCS:
        assert "." not in name, f"{name!r} would be truncated at the period on upload"


def test_treatment_dates_agree_between_the_chronology_and_the_source() -> None:
    """The chronology is a firm-prepared summary of records that also exist on
    the matter. A date present in one and absent from the other is exactly the
    inconsistency that makes a traced letter wrong."""
    chron = _doc("Medical Chronology")
    for date, source in (
        ("2026-01-21", "Operative Report"),
        ("2026-05-28", "Orthopedic Discharge Summary"),
        ("2026-01-14", "ER Records"),
    ):
        assert date in chron, f"chronology omits {date}"
        pretty = f"{date[5:7].lstrip('0')}/{date[8:]}/{date[:4]}"
        alt = date.replace("-", "/")
        body = _doc(source)
        assert any(
            token in body
            for token in (date, pretty, alt, _long_date(date))
        ), f"{source} does not carry its own date {date}"


def _long_date(iso: str) -> str:
    months = (
        "January February March April May June July August September October "
        "November December"
    ).split()
    y, m, d = iso.split("-")
    return f"{months[int(m) - 1]} {int(d)}, {y}"


def test_every_document_is_marked_as_seed_data() -> None:
    """Nothing here may be mistaken for a real client record — including by a
    future reader of the Smokeball tenant who did not seed it."""
    for name, text in seed.DOCS:
        assert "[SEED" in text, f"{name} carries no seed marker"


def test_the_record_covers_what_the_drafter_asked_for() -> None:
    """The first card-18 run enumerated exactly what a demand requires. This
    fixture exists to answer that list, so the list is the assertion.

    Deposition transcripts are deliberately absent: suit was filed 2026-06-24
    with service pending, so none would exist — the drafter itself said "if any".
    """
    names = " | ".join(n for n, _ in seed.DOCS).lower()
    for required in (
        "incident report",
        "er records",
        "operative report",
        "chronology",
        "billing summary",
        "wage loss",
        "claim correspondence",
        "policy limits",
    ):
        assert required in names, f"the record is missing {required}"
