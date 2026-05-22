"""Pytest config -- extend sys.path so ``connectors.no_pm`` is importable
when the suite is invoked from either ``ai-employee/`` or the repo
root.

Mirrors the Filevine connector's ``conftest.py`` so the two suites can
be run together with one ``pytest`` invocation from ``ai-employee/``.
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve()
# Make ``ai-employee/`` importable -> ``from connectors.no_pm import ...``
sys.path.insert(0, str(_HERE.parents[3]))
