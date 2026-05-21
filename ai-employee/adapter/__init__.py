"""SMD AI Employee — pluggable adapter for Hermes.

Wraps Hermes' tool dispatch with the trust-ceiling enforcement layer
required by ADR 0004 and the safety substrate (Phase A.5). The adapter
loads a customer's `customer.yaml`, resolves skill version pins, and
enforces per-skill autonomous / draft_for_review / refused ceilings
against every tool call regardless of what the model prompt says.

The adapter is loaded by `bootstrap.sh` when the customer's container
starts. The trust-ceiling enforcement code lives in `trust_ceiling.py`;
the customer-config loader in `connector_loader.py`; the runtime hook
that registers with Hermes in `aie_adapter.py`.
"""

__version__ = "0.1.0"
