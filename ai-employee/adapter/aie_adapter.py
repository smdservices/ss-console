"""AIEmployee adapter — Hermes integration point.

Registers a tool-dispatch middleware with Hermes that runs every tool call
through `trust_ceiling.enforce()` before execution. Refusals + draft-routed
actions are logged to the customer's audit log.

Loading mechanism: bootstrap.sh sets PYTHONPATH=/app/adapter:/app:..., then
runs `hermes run --adapter aiemployee`. Hermes' adapter loader (per the
Hermes plugin spec) imports `aie_adapter` and calls `register()`.

Phase A: this module is a stub — Hermes runs without the adapter registered.
Phase A.5 implements the registration handshake against Hermes' tool
dispatch hooks (the upstream `agent/tool_router.py` exposes the hook point
we need; this is the integration work that lands in Phase A.5).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None  # tolerated for unit-test import; bootstrap requires it

from .trust_ceiling import ActionClass, Ceiling, enforce

log = logging.getLogger("aie.adapter")


def _load_customer_config() -> dict:
    """Read /app/customer.yaml at adapter init time."""
    yaml_path = os.environ.get("AIE_CUSTOMER_YAML", "/app/customer.yaml")
    if yaml is None:
        log.warning("pyyaml unavailable; adapter operating with empty config")
        return {}
    p = Path(yaml_path)
    if not p.exists():
        log.warning("customer.yaml not at %s; adapter operating with empty config", yaml_path)
        return {}
    with open(p) as f:
        return yaml.safe_load(f) or {}


def register() -> None:
    """Hermes adapter entrypoint.

    Phase A: this is a no-op. Phase A.5 implementation:

      1. Import Hermes' tool dispatch hook (agent/tool_router.py)
      2. Wrap each registered tool call in a function that:
         - Resolves the current skill from Hermes' execution context
         - Looks up the skill's trust_ceiling from SKILL.md frontmatter +
           customer.yaml overrides
         - Categorizes the tool call by ActionClass
         - Calls trust_ceiling.enforce()
         - Allows / drafts / refuses per the decision
         - Logs every decision to the customer's audit log
      3. Hook the compaction event: re-inject the "don't act" pinned slots
         on compaction so they survive (invariant #4)
    """
    cfg = _load_customer_config()
    customer_id = cfg.get("customer_id", "unknown")
    log.info("AIEmployee adapter registered for customer=%s (Phase A stub)", customer_id)
    log.info(
        "Phase A.5 will hook trust_ceiling.enforce() into Hermes' tool dispatch."
    )
    # Phase A.5 work goes here — for now just announce and return.


# Re-export for convenience
__all__ = ["ActionClass", "Ceiling", "enforce", "register"]
