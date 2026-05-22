"""Tests for invariant #7 - cross-Machine query prohibition (boot-time).

Coverage:

* PASSES when every binding name matches the per-slug derivation.
* FIRES on the explicit cross-Machine failure mode (a binding points at
  another customer's resource - wrong prefix).
* FIRES when a binding has the right prefix but the wrong kind suffix
  (config drift, e.g., D1 binding pointing at the vault index).
* FIRES on empty / unbound binding names.
* FIRES on malformed customer slug - the upstream config is bad.
* Reports the correct failure-mode reason text per mismatch.
* Generates a stable :meth:`Invariant7Violation.refusal_message` for stdout
  per ``r2-vectorize-naming.md``.
* Generates audit metadata with the documented shape.
* The boolean ``__bool__`` flips on violation so callers can write the
  ``if violation := verify_storage_bindings(...):`` pattern.

Run from repo root:

    cd ai-employee && uv run --with pytest python -m pytest \
        safety-substrate/tests/test_invariant_7.py -v
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[1]))  # safety-substrate/ on path

from invariants.invariant_7 import (  # noqa: E402
    BindingKind,
    BindingSnapshot,
    Invariant7Violation,
    run as run_module_self_check,
    verify_storage_bindings,
)


# ---------------------------------------------------------------------------
# BindingSnapshot contract
# ---------------------------------------------------------------------------


def test_snapshot_rejects_non_string_field():
    with pytest.raises(TypeError):
        BindingSnapshot(
            d1_database_name=42,  # type: ignore[arg-type]
            r2_bucket_name="hermes-x-r2",
            vectorize_vault_index="hermes-x-vault",
            vectorize_corrections_index="hermes-x-corrections",
        )


def test_snapshot_to_kind_map_covers_every_kind():
    snap = BindingSnapshot(
        d1_database_name="hermes-acme-d1",
        r2_bucket_name="hermes-acme-r2",
        vectorize_vault_index="hermes-acme-vault",
        vectorize_corrections_index="hermes-acme-corrections",
    )
    m = snap.to_kind_map()
    assert set(m.keys()) == set(BindingKind)


# ---------------------------------------------------------------------------
# Passing case
# ---------------------------------------------------------------------------


def test_passes_when_every_binding_matches_slug():
    result = verify_storage_bindings(
        customer_slug="acme",
        snapshot=BindingSnapshot(
            d1_database_name="hermes-acme-d1",
            r2_bucket_name="hermes-acme-r2",
            vectorize_vault_index="hermes-acme-vault",
            vectorize_corrections_index="hermes-acme-corrections",
        ),
    )
    assert result.passed
    assert result.mismatches == ()
    assert result.refusal_message() == ""
    assert not bool(result)


# ---------------------------------------------------------------------------
# Cross-Machine failure mode (the named PRD edge case)
# ---------------------------------------------------------------------------


def test_fires_on_cross_machine_d1_binding():
    """The named PRD §7.5 invariant - a binding points to ANOTHER
    customer's resource. This is the existential isolation-leak failure
    mode the invariant exists to catch.
    """
    result = verify_storage_bindings(
        customer_slug="acme",
        snapshot=BindingSnapshot(
            d1_database_name="hermes-other-d1",  # ← cross-Machine
            r2_bucket_name="hermes-acme-r2",
            vectorize_vault_index="hermes-acme-vault",
            vectorize_corrections_index="hermes-acme-corrections",
        ),
    )
    assert not result.passed
    assert bool(result)
    assert len(result.mismatches) == 1
    m = result.mismatches[0]
    assert m.kind is BindingKind.D1
    assert m.expected == "hermes-acme-d1"
    assert m.observed == "hermes-other-d1"
    assert "cross-Machine isolation failure mode" in m.reason


def test_fires_on_multiple_cross_machine_bindings():
    result = verify_storage_bindings(
        customer_slug="acme",
        snapshot=BindingSnapshot(
            d1_database_name="hermes-other-d1",
            r2_bucket_name="hermes-acme-r2",
            vectorize_vault_index="hermes-third-vault",
            vectorize_corrections_index="hermes-acme-corrections",
        ),
    )
    assert not result.passed
    assert len(result.mismatches) == 2
    kinds = {m.kind for m in result.mismatches}
    assert kinds == {BindingKind.D1, BindingKind.VECTORIZE_VAULT}
    for m in result.mismatches:
        assert "cross-Machine isolation failure mode" in m.reason


# ---------------------------------------------------------------------------
# Wrong-kind-suffix failure mode (config drift)
# ---------------------------------------------------------------------------


def test_fires_on_right_prefix_wrong_kind_suffix():
    # D1 binding has the right per-customer prefix but the wrong kind
    # suffix (e.g., resource name typo at provisioning time).
    result = verify_storage_bindings(
        customer_slug="acme",
        snapshot=BindingSnapshot(
            d1_database_name="hermes-acme-r2",  # ← wrong kind suffix
            r2_bucket_name="hermes-acme-r2",
            vectorize_vault_index="hermes-acme-vault",
            vectorize_corrections_index="hermes-acme-corrections",
        ),
    )
    assert not result.passed
    assert len(result.mismatches) == 1
    m = result.mismatches[0]
    assert m.kind is BindingKind.D1
    assert "wrong kind suffix" in m.reason
    # Cross-Machine reason text MUST NOT appear - different failure mode.
    assert "cross-Machine" not in m.reason


# ---------------------------------------------------------------------------
# Empty binding failure mode
# ---------------------------------------------------------------------------


def test_fires_on_empty_binding_name():
    result = verify_storage_bindings(
        customer_slug="acme",
        snapshot=BindingSnapshot(
            d1_database_name="",  # ← empty
            r2_bucket_name="hermes-acme-r2",
            vectorize_vault_index="hermes-acme-vault",
            vectorize_corrections_index="hermes-acme-corrections",
        ),
    )
    assert not result.passed
    assert len(result.mismatches) == 1
    m = result.mismatches[0]
    assert m.kind is BindingKind.D1
    assert m.observed == ""
    assert "unbound" in m.reason


# ---------------------------------------------------------------------------
# Malformed slug failure mode (upstream config error)
# ---------------------------------------------------------------------------


def test_fires_on_uppercase_slug():
    result = verify_storage_bindings(
        customer_slug="Acme",
        snapshot=BindingSnapshot(
            d1_database_name="hermes-Acme-d1",
            r2_bucket_name="hermes-Acme-r2",
            vectorize_vault_index="hermes-Acme-vault",
            vectorize_corrections_index="hermes-Acme-corrections",
        ),
    )
    assert not result.passed
    # Every binding flagged because the slug itself is invalid.
    assert len(result.mismatches) == 4
    for m in result.mismatches:
        assert "is not a valid slug" in m.reason


def test_fires_on_empty_slug():
    result = verify_storage_bindings(
        customer_slug="",
        snapshot=BindingSnapshot(
            d1_database_name="hermes--d1",
            r2_bucket_name="hermes--r2",
            vectorize_vault_index="hermes--vault",
            vectorize_corrections_index="hermes--corrections",
        ),
    )
    assert not result.passed
    assert len(result.mismatches) == 4


def test_fires_on_slug_with_leading_hyphen():
    result = verify_storage_bindings(
        customer_slug="-acme",
        snapshot=BindingSnapshot(
            d1_database_name="hermes--acme-d1",
            r2_bucket_name="hermes--acme-r2",
            vectorize_vault_index="hermes--acme-vault",
            vectorize_corrections_index="hermes--acme-corrections",
        ),
    )
    assert not result.passed


# ---------------------------------------------------------------------------
# Output shape contracts
# ---------------------------------------------------------------------------


def test_refusal_message_names_every_mismatch():
    result = verify_storage_bindings(
        customer_slug="acme",
        snapshot=BindingSnapshot(
            d1_database_name="hermes-other-d1",
            r2_bucket_name="hermes-third-r2",
            vectorize_vault_index="hermes-acme-vault",
            vectorize_corrections_index="hermes-acme-corrections",
        ),
    )
    msg = result.refusal_message()
    assert msg.startswith("INVARIANT_7_VIOLATION:")
    assert "customer_slug='acme'" in msg
    assert "d1=" in msg
    assert "r2=" in msg


def test_to_audit_metadata_shape():
    result = verify_storage_bindings(
        customer_slug="acme",
        snapshot=BindingSnapshot(
            d1_database_name="hermes-other-d1",
            r2_bucket_name="hermes-acme-r2",
            vectorize_vault_index="hermes-acme-vault",
            vectorize_corrections_index="hermes-acme-corrections",
        ),
    )
    meta = result.to_audit_metadata()
    assert meta["invariant"] == 7
    assert meta["customer_slug"] == "acme"
    assert isinstance(meta["mismatches"], list)
    assert len(meta["mismatches"]) == 1
    m = meta["mismatches"][0]
    assert m["kind"] == "d1"
    assert m["expected"] == "hermes-acme-d1"
    assert m["observed"] == "hermes-other-d1"
    assert "reason" in m


def test_violation_bool_is_truthy_iff_violation():
    ok = verify_storage_bindings(
        customer_slug="acme",
        snapshot=BindingSnapshot(
            d1_database_name="hermes-acme-d1",
            r2_bucket_name="hermes-acme-r2",
            vectorize_vault_index="hermes-acme-vault",
            vectorize_corrections_index="hermes-acme-corrections",
        ),
    )
    assert not bool(ok)
    bad = verify_storage_bindings(
        customer_slug="acme",
        snapshot=BindingSnapshot(
            d1_database_name="hermes-other-d1",
            r2_bucket_name="hermes-acme-r2",
            vectorize_vault_index="hermes-acme-vault",
            vectorize_corrections_index="hermes-acme-corrections",
        ),
    )
    assert bool(bad)


# ---------------------------------------------------------------------------
# Substrate-runner entrypoint smoke check
# ---------------------------------------------------------------------------


def test_module_run_callable_returns_pass():
    ok, msg = run_module_self_check()
    assert ok, f"module-level run() should pass on a clean import; got: {msg}"
    assert "invariant 7" in msg.lower()


# ---------------------------------------------------------------------------
# Substrate-runner shape (run_invariants.py compatibility)
# ---------------------------------------------------------------------------


def run() -> tuple[bool, str]:
    """Aggregated harness entrypoint for run_invariants.py."""
    return run_module_self_check()


if __name__ == "__main__":
    ok, msg = run()
    print(msg)
    sys.exit(0 if ok else 1)
