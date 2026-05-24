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

Per-customer namespace isolation enforcement (issue #861, ADR 0009)
lives in `namespace_assertion.py`. The factory helpers
(`namespaced_executor_from_env` in `d1_env.py`,
`memory.build_namespaced_memory_runner`, and
`voice.build_namespaced_voice_runner`) are the ONLY supported
construction path for per-customer D1 / R2 / Vectorize access — see
issue [#1009](https://github.com/venturecrane/ss-console/issues/1009)
for the fork-side adoption track.

Public adapter surface (TOCTOU hardening, #861 follow-on)
---------------------------------------------------------

`from ai_employee.adapter import *` produces exactly the names below:

* `NamespaceAssertionError` — the structured refusal raised on
  cross-customer access attempts.
* `NamespacedD1Executor`, `NamespacedR2Client`,
  `NamespacedVectorizeClient` — the three slug-bound wrappers.
* `namespaced_executor_from_env` — the env-bound D1 entry point.

The raw underlying constructors (`HttpD1Executor`, `SqliteExecutor` in
`audit_log.py`; the `StorageClient` Protocol in `memory.pipeline`; the
`R2Client` Protocol in `voice.pipeline`) are still importable by
explicit name for the writer path (per the audit-log immutability
invariant), the namespace-bridge adapters, and tests — but they are NOT
in any `__all__` and `from ... import *` will not surface them. New
consumers must construct per-customer storage through the factories
above; the fork overlay built against this surface will therefore use
namespaced wrappers from day one.
"""

from .d1_env import namespaced_executor_from_env
from .namespace_assertion import (
    NamespaceAssertionError,
    NamespacedD1Executor,
    NamespacedR2Client,
    NamespacedVectorizeClient,
)

__version__ = "0.1.0"

__all__ = [
    "NamespaceAssertionError",
    "NamespacedD1Executor",
    "NamespacedR2Client",
    "NamespacedVectorizeClient",
    "namespaced_executor_from_env",
]
