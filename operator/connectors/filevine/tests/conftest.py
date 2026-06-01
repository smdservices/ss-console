"""Pytest config -- extend sys.path so `connectors.filevine` and the
sibling `_helpers` module are importable when the suite is invoked from
either `operator/` or the repo root.

Test helpers (`FakeHttpClient`, `make_client`, etc.) live in `_helpers.py`
rather than this module so test files can import them as plain functions
without depending on pytest fixture autodiscovery semantics.
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve()
# Make `operator/` importable -> `from connectors.filevine import ...`
sys.path.insert(0, str(_HERE.parents[3]))
# Make the `tests/` dir importable -> `from _helpers import ...`
sys.path.insert(0, str(_HERE.parent))
