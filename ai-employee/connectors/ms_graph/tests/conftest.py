"""Pytest config -- extend sys.path so ``connectors.ms_graph`` is importable
when the suite is invoked from either ``ai-employee/`` or the repo root.
"""

from __future__ import annotations

import sys
from pathlib import Path


_HERE = Path(__file__).resolve()
# Make ``ai-employee/`` importable -> ``from connectors.ms_graph import ...``
sys.path.insert(0, str(_HERE.parents[3]))
