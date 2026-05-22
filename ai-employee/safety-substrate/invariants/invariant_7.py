"""Invariant #7 - cross-Machine query prohibition.

Per platform PRD §7.5:

    Cross-Machine query prohibition. No agent reads storage bound to
    another customer's Machine. At Machine boot, the runtime verifies
    its storage bindings include only its own customer's namespaces
    and refuses to start if it detects bindings outside its namespace.

This module implements the boot-time enforcement of that promise. Cross-
Machine isolation is the platform's load-bearing trust commitment: any
customer who can convince themselves that another customer's data could
ever surface inside their agent will not sign. The mechanism is
deliberately mechanical - no heuristics, no machine-learning, no fuzzy
matching. The Machine's bindings either match the expected per-customer
naming pattern derived from ``customer.yaml`` or the runtime refuses to
serve.

Source of the naming contract: ``docs/specs/ai-employee/r2-vectorize-
naming.md`` §"Per-customer Cloudflare bindings". Every per-customer
binding is named ``hermes-{customer-slug}-{kind}`` with kind in the
closed set ``{d1, r2, vault, corrections}``. The D1 binding's
``database_name`` follows the same pattern (``hermes-{slug}-d1``); the
R2 binding's ``bucket_name``; the Vectorize bindings' ``index_name``.
This module compares every observed binding against that derived
expected set.

Design notes
------------

* **Boot-time only.** This invariant is not a runtime filter. It runs
  once at Machine startup before any request is served and refuses to
  start the runtime on any mismatch. Once the Machine is running, the
  bindings are immutable - Fly/Cloudflare don't permit live rebinding
  - so a single boot-time check is sufficient. The companion runtime
  check is **dead-letter**: any attempt to read a binding by an
  unexpected name at runtime is a bug in the binding-resolver helper
  (``adapter/r2_helper.py`` and its TS twin), not a runtime invariant
  failure.

* **Closed set of binding names.** The runtime declares the expected
  bindings explicitly. Adding a new binding kind requires an ADR and
  a corresponding update here. We do NOT enumerate-and-validate every
  binding present in the env, because the Fly env contains all sorts
  of unrelated bindings (secrets, KVs from other features). We validate
  the SAFETY-RELEVANT bindings and refuse on any mismatch in those.

* **Refusal shape.** The function returns a result object describing
  any mismatches. Production callers MUST treat ``passed=False`` as
  a fatal boot failure and exit with a non-zero status (``sys.exit(3)``
  per ``r2-vectorize-naming.md``). The function itself does not
  ``sys.exit`` - that keeps the module testable.

* **Audit emission.** A failure writes one ``INVARIANT_BOOT_CHECK_FAILED``
  audit row with metadata describing every mismatch. The PRD §10
  ``09-boot-checks.csv`` compliance-evidence row sources from these
  audit entries. A pass writes no audit row at boot - the row would be
  noise; the absence of a failure row is the evidence. (Optional:
  callers can record a ``BOOT_CHECK_PASSED`` row via a separate path
  if their compliance posture requires positive boot evidence; this
  module focuses on the failure path.)

* **No PII in the failure row.** The metadata names the EXPECTED and
  OBSERVED binding names. Binding names embed the customer slug, which
  is not PII (slug == business slug, not natural-person identifier).
  No customer data is exfiltrated by the failure row.

Module shape
------------

::

    from invariants.invariant_7 import (
        BindingSnapshot,
        verify_storage_bindings,
    )

    snapshot = BindingSnapshot(
        d1_database_name="hermes-acme-d1",
        r2_bucket_name="hermes-acme-r2",
        vectorize_vault_index="hermes-acme-vault",
        vectorize_corrections_index="hermes-acme-corrections",
    )
    result = verify_storage_bindings(
        customer_slug="acme",
        snapshot=snapshot,
    )
    if not result.passed:
        # Emit audit row, then exit.
        await writer.write(AuditEvent(
            action_type="INVARIANT_BOOT_CHECK_FAILED",
            actor="agent",
            actor_role=ActorRole.AGENT,
            metadata={"invariant": 7, **result.to_audit_metadata()},
        ))
        sys.exit(3)
"""

from __future__ import annotations

import enum
import logging
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))  # ai-employee/ on sys.path

log = logging.getLogger("aie.invariants.invariant_7")


# ---------------------------------------------------------------------------
# Binding kinds (closed set, mirroring r2-vectorize-naming.md)
# ---------------------------------------------------------------------------


class BindingKind(str, enum.Enum):
    """The four safety-relevant binding kinds per ``r2-vectorize-naming.md``.

    Adding a new kind requires (a) an ADR, (b) updates here, (c) updates
    in the binding-resolver helper, and (d) updates in
    ``provision-customer.sh``.
    """

    D1 = "d1"
    R2 = "r2"
    VECTORIZE_VAULT = "vault"
    VECTORIZE_CORRECTIONS = "corrections"


def _expected_binding_name(customer_slug: str, kind: BindingKind) -> str:
    """Compute the expected resource name for one binding.

    Mirrors the substitution ``provision-customer.sh`` performs against
    ``config/fly/hermes-template.toml``. This is the single source of
    truth inside the runtime for what each binding MUST be named.
    """
    return f"hermes-{customer_slug}-{kind.value}"


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class BindingSnapshot:
    """Observed binding names at Machine boot.

    Production callers populate this from the Cloudflare/Fly runtime's
    binding metadata. Tests populate it directly. Every field MUST be
    non-empty - an absent binding is itself a violation (the runtime
    cannot serve without all four bindings present).
    """

    d1_database_name: str
    r2_bucket_name: str
    vectorize_vault_index: str
    vectorize_corrections_index: str

    def __post_init__(self) -> None:
        for field_name in (
            "d1_database_name",
            "r2_bucket_name",
            "vectorize_vault_index",
            "vectorize_corrections_index",
        ):
            value = getattr(self, field_name)
            if not isinstance(value, str):
                raise TypeError(f"{field_name} must be a string, got {type(value).__name__}")

    def to_kind_map(self) -> dict[BindingKind, str]:
        """Render as a kind-keyed map for comparison logic."""
        return {
            BindingKind.D1: self.d1_database_name,
            BindingKind.R2: self.r2_bucket_name,
            BindingKind.VECTORIZE_VAULT: self.vectorize_vault_index,
            BindingKind.VECTORIZE_CORRECTIONS: self.vectorize_corrections_index,
        }


@dataclass(frozen=True)
class BindingMismatch:
    """One binding that does not match the expected name."""

    kind: BindingKind
    expected: str
    observed: str
    reason: str


@dataclass(frozen=True)
class Invariant7Violation:
    """Aggregated result of :func:`verify_storage_bindings`.

    Empty ``mismatches`` tuple = the snapshot matches the expected
    bindings; ``passed`` is True. Any mismatch flips ``passed`` to
    False and the runtime MUST refuse to start.
    """

    customer_slug: str
    mismatches: tuple[BindingMismatch, ...] = field(default_factory=tuple)

    @property
    def passed(self) -> bool:
        return len(self.mismatches) == 0

    def __bool__(self) -> bool:
        # Truthy iff there is a violation. Lets callers write
        # ``if violation := verify_storage_bindings(...): exit(3)``.
        return not self.passed

    def to_audit_metadata(self) -> dict:
        """Stable shape for ``INVARIANT_BOOT_CHECK_FAILED`` rows."""
        return {
            "invariant": 7,
            "customer_slug": self.customer_slug,
            "mismatches": [
                {
                    "kind": m.kind.value,
                    "expected": m.expected,
                    "observed": m.observed,
                    "reason": m.reason,
                }
                for m in self.mismatches
            ],
        }

    def refusal_message(self) -> str:
        """One-line operator-facing summary for stdout per
        ``r2-vectorize-naming.md`` §"Invariant #7 boot-check"."""
        if self.passed:
            return ""
        parts = [
            f"{m.kind.value}={m.observed!r} (expected {m.expected!r})"
            for m in self.mismatches
        ]
        return (
            f"INVARIANT_7_VIOLATION: customer_slug={self.customer_slug!r} "
            f"bindings mismatch: {'; '.join(parts)}"
        )


# ---------------------------------------------------------------------------
# Core check
# ---------------------------------------------------------------------------


_VALID_SLUG_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789-")


def _is_valid_slug(slug: str) -> bool:
    """Mirror the ``customer.yaml`` validator's slug rule. Lowercase
    letters, digits, hyphens. No leading/trailing hyphen. 2-32 chars.

    A malformed slug at boot is itself an invariant failure - the
    expected-name derivation would otherwise produce nonsense.
    """
    if not slug or len(slug) < 2 or len(slug) > 32:
        return False
    if slug.startswith("-") or slug.endswith("-"):
        return False
    return all(c in _VALID_SLUG_CHARS for c in slug)


def verify_storage_bindings(
    *,
    customer_slug: str,
    snapshot: BindingSnapshot,
) -> Invariant7Violation:
    """Compare observed bindings against the per-slug expected names.

    Parameters
    ----------
    customer_slug
        The Machine's ``customer.yaml.customer_id``. Used to derive the
        expected binding names. A malformed slug produces a violation
        on every binding.
    snapshot
        Observed binding metadata captured at Machine boot.

    Returns
    -------
    Invariant7Violation
        ``violation.passed`` is True iff every binding's observed name
        matches its expected derivation. A False result means the
        runtime MUST exit non-zero before serving any request.
    """
    if not _is_valid_slug(customer_slug):
        # A malformed slug is a configuration error upstream. Every
        # binding is reported mismatched against ``<malformed>`` so the
        # audit row carries the offending slug.
        observed_map = snapshot.to_kind_map()
        mismatches = tuple(
            BindingMismatch(
                kind=kind,
                expected=f"hermes-{customer_slug}-{kind.value}",
                observed=observed_map[kind],
                reason=(
                    f"customer_slug={customer_slug!r} is not a valid slug; "
                    "expected lowercase letters, digits, hyphens (2-32 chars, "
                    "no leading or trailing hyphen)"
                ),
            )
            for kind in BindingKind
        )
        return Invariant7Violation(customer_slug=customer_slug, mismatches=mismatches)

    expected = {kind: _expected_binding_name(customer_slug, kind) for kind in BindingKind}
    observed = snapshot.to_kind_map()

    mismatches: list[BindingMismatch] = []
    for kind in BindingKind:
        observed_name = observed[kind]
        if not observed_name:
            mismatches.append(
                BindingMismatch(
                    kind=kind,
                    expected=expected[kind],
                    observed="",
                    reason="binding is empty / unbound",
                )
            )
            continue
        if observed_name != expected[kind]:
            # Two failure modes to distinguish for the audit row.
            if not observed_name.startswith(f"hermes-{customer_slug}-"):
                # The binding points to ANOTHER customer's resource. This
                # is the explicit cross-Machine leakage failure mode.
                reason = (
                    "observed binding does not start with the expected "
                    f"per-customer prefix 'hermes-{customer_slug}-' - "
                    "this is the cross-Machine isolation failure mode"
                )
            else:
                # Same prefix, wrong suffix. Typically a config drift
                # (e.g., d1 binding pointing at the vault index).
                reason = (
                    "observed binding has the right per-customer prefix "
                    "but the wrong kind suffix"
                )
            mismatches.append(
                BindingMismatch(
                    kind=kind,
                    expected=expected[kind],
                    observed=observed_name,
                    reason=reason,
                )
            )

    return Invariant7Violation(
        customer_slug=customer_slug,
        mismatches=tuple(mismatches),
    )


# ---------------------------------------------------------------------------
# Substrate-runner entrypoint
# ---------------------------------------------------------------------------


def _self_check_fixtures() -> tuple[bool, str]:
    """Boot-time smoke fixtures. Comprehensive coverage lives in
    ``tests/test_invariant_7.py``.

    Two cases:
      1. Snapshot whose bindings all match the slug → passes.
      2. Snapshot whose D1 binding points to ANOTHER customer's database
         → fails with the cross-Machine reason text.
    """
    slug = "smoke"

    ok_snapshot = BindingSnapshot(
        d1_database_name="hermes-smoke-d1",
        r2_bucket_name="hermes-smoke-r2",
        vectorize_vault_index="hermes-smoke-vault",
        vectorize_corrections_index="hermes-smoke-corrections",
    )
    ok_result = verify_storage_bindings(customer_slug=slug, snapshot=ok_snapshot)
    if not ok_result.passed:
        return (
            False,
            f"FAIL: passing snapshot reported mismatches: {ok_result.refusal_message()}",
        )

    bad_snapshot = BindingSnapshot(
        d1_database_name="hermes-other-d1",  # pointing at another customer
        r2_bucket_name="hermes-smoke-r2",
        vectorize_vault_index="hermes-smoke-vault",
        vectorize_corrections_index="hermes-smoke-corrections",
    )
    bad_result = verify_storage_bindings(customer_slug=slug, snapshot=bad_snapshot)
    if bad_result.passed:
        return (
            False,
            "FAIL: cross-Machine D1 binding should have triggered a mismatch",
        )
    if "cross-Machine isolation failure mode" not in bad_result.mismatches[0].reason:
        return (
            False,
            f"FAIL: mismatch reason did not name the cross-Machine failure mode: "
            f"{bad_result.mismatches[0].reason!r}",
        )

    return (
        True,
        "PASS: invariant 7 detects cross-Machine binding mismatch "
        "(2 of 2 self-check fixtures held)",
    )


def run() -> tuple[bool, str]:
    """Substrate-runner shape - boot-time smoke check.

    Returns ``(ok, message)``. ``ok=True`` iff the module's enforcement
    loop produces the expected behavior on the bundled self-check
    fixtures. Detailed coverage lives in ``tests/test_invariant_7.py``.
    """
    try:
        return _self_check_fixtures()
    except Exception as e:  # noqa: BLE001
        return (False, f"FAIL: invariant 7 self-check raised {type(e).__name__}: {e}")


__all__ = [
    "BindingKind",
    "BindingMismatch",
    "BindingSnapshot",
    "Invariant7Violation",
    "run",
    "verify_storage_bindings",
]


if __name__ == "__main__":
    ok, msg = run()
    print(msg)
    sys.exit(0 if ok else 1)
