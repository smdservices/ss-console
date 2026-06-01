"""LawPay MCP wrapper — Tier-1 connector for SMD's law-firm Operator vertical pack.

Wraps the developers.8am.com REST API and exposes it as MCP tools. Read-only
by default; write tools are explicitly gated. Refused operations (refunds,
trust-account modifications, bulk-delete) are not exposed at all.

Per the safety-substrate policy, all destructive / external-send / commitment
operations require explicit current-turn operator approval — this wrapper
implements that gate at the tool boundary.
"""

__version__ = "0.1.0"
