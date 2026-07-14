"""Sync gate for the vendored escalation_ledger.py copies (WP-A / WP-B).

CANONICAL SOURCE is ``operator/workspace_broker/escalation_ledger.py``. Skills
carry a byte-identical copy in their own dir so a stdlib-only ``pre_run.py`` and
the agent's ``execute_code`` turn can import it without a package install. Edit
the canonical, restamp the copies — never edit a copy.
"""

from __future__ import annotations

from pathlib import Path

_OPERATOR_ROOT = Path(__file__).resolve().parents[1]
_CANONICAL = _OPERATOR_ROOT / "workspace_broker" / "escalation_ledger.py"

# Every skill that imports the shared ledger carries a vendored copy. WP-B adds
# client-verification-tracker here when it graduates to a bespoke gate.
VENDORED_SKILLS = (
    "deadline-miss-escalator",
    "daily-needs-you-digest",
)


def test_canonical_exists() -> None:
    assert _CANONICAL.is_file(), f"canonical escalation_ledger.py missing at {_CANONICAL}"


def test_vendored_copies_are_byte_identical() -> None:
    canonical = _CANONICAL.read_bytes()
    missing, drifted = [], []
    for skill in VENDORED_SKILLS:
        copy = _OPERATOR_ROOT / "skills" / skill / "escalation_ledger.py"
        if not copy.is_file():
            missing.append(skill)
        elif copy.read_bytes() != canonical:
            drifted.append(skill)
    assert not missing, f"missing escalation_ledger.py copy: {missing}"
    assert not drifted, (
        f"escalation_ledger.py drifted from workspace_broker/escalation_ledger.py: "
        f"{drifted} — edit the canonical and restamp, never the copy"
    )
