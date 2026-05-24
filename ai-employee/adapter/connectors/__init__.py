"""Connector-side adapter modules.

Per-customer enforcement that complements the structural per-Machine
isolation declared by ADR 0007 / 0009. The composio_assertion module is
the runtime backstop for Composio-managed connectors (Gmail, Slack,
GitHub), where OAuth lives inside Composio's infra and the
cross-customer perimeter depends on connection-ID scoping at every API
call site.
"""

from .composio_assertion import (
    ComposioConnectionGuard,
    ComposioIsolationError,
    classify_composio_connection_id,
    composio_connection_id_for_slug_prefix,
)

__all__ = [
    "ComposioConnectionGuard",
    "ComposioIsolationError",
    "classify_composio_connection_id",
    "composio_connection_id_for_slug_prefix",
]
