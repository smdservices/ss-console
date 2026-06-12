"""Pytest path setup for the Google connector suite.

The Google connectors are standalone CLIs (run as `python .../crane_*.py`), so
at runtime `sys.path[0]` is the connector dir and `import _google_auth` resolves.
For the test suite we insert the same dir, plus `operator/` so the cross-language
capability-name source of truth (`connectors.capability_contract.CAPABILITY_NAMES`)
is importable.
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve()
# operator/connectors/google/ -> import crane_gmail / crane_calendar / crane_drive / _google_auth
sys.path.insert(0, str(_HERE.parent.parent))
# operator/ -> from connectors.capability_contract import CAPABILITY_NAMES
sys.path.insert(0, str(_HERE.parents[3]))
