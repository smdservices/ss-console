"""MCP stub servers for first-customer-bound connectors.

Per test plan v2 §"Layer 1 — Contract & Boot — Static contract checks" +
Pragmatist #10 from the critique: each stub replays one canonical
happy-path response + one canonical error response, derived from real
vendor documentation and hand-checked against a one-time real-vendor
call as part of L1's MCP contract test track.

Scoped to first-customer-bound MCPs only (per ADR 0020 + the Week 0
procurement table in the plan). Other ADR 0020 vendors (Xero, Stripe,
HubSpot, Salesforce, Slack, Teams, DocuSign-beta) are deferred until a
customer binds them — no stubs authored against accounts we don't have.

The stubs are pure Python — no network, no subprocess. The shape is:

  def call_<vendor>(tool_name: str, args: dict) -> dict
      Returns the canonical JSON response shape the real MCP would
      emit. Raises ``StubError`` for undocumented tools.

Consumers (scenario harness, L1 contract tests) inject the stub via
the same SelectorCaller/AnthropicCaller protocol pattern used in
ai-employee/judging/judge.py — kept SDK-free at import time so unit
tests run without wrangler or network.

Documented vendors:

  - gmail.py             mcp:google-gmail
  - google_calendar.py   mcp:google-calendar
  - clio.py              mcp:clio-oktopeak (community MCP)
  - courtlistener.py     mcp:courtlistener (Free Law Project hosted)
  - lawpay.py            build:lawpay (NOT MCP — Python adapter shape;
                         included here for harness symmetry)
"""

from __future__ import annotations


class StubError(Exception):
    """Raised when a stub is called with an undocumented tool name."""


class StubAuthError(Exception):
    """Canonical 401 response — simulates an expired / wrong OAuth token."""


class StubNotFoundError(Exception):
    """Canonical 404 response — simulates a missing resource."""
