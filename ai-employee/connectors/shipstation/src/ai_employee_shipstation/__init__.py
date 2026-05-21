"""ShipStation MCP wrapper — Tier-1 connector for SMD's manufacturing AI Employee.

Wraps docs.shipstation.com REST API (V2). Read-only by default; label
creation + order management are gated per the trust ceiling.

Authentication: API key in header (not OAuth). Per-customer key stored
in customer.yaml's Fly secrets.
"""

__version__ = "0.1.0"
