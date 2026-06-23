"""mcp:smokeball — author-built MCP connector for the Smokeball practice-management
API (the law-firm wedge system of record). ADR 0053.

The first REAL author-built connector on the platform (the reference connector is
the synthetic self-test). Phase-1 exposes the Smokeball read surface + create_memo;
the trust-account fund-movement tools are never implemented and are hard-banned at
the overlay. See operator/verticals/law-firm/smokeball-surface.md.
"""
