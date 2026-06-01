"""TOCTOU lockdown — assert the public adapter surface is namespaced-only.

Issue #861's wrapper PR (#1006) shipped the namespace assertion. The
adoption PR (#1012) added the factory helpers. This test file is the
hardening step: it locks the public adapter surface so any future
caller doing `from adapter import *` or `from adapter.audit_log import
*` cannot grab a raw client by accident.

Raw classes remain importable by *explicit* name — that is needed by:

* the writer path itself (`audit_log.writer_from_env` constructs an
  `HttpD1Executor` directly, per the audit-log immutability invariant
  documented in `hermes-smd-overlay/plugins/hermes-smd-audit/immutability.py`),
* the namespace-bridge adapters (`memory/namespaced.py` and
  `voice/namespaced.py` import the raw R2/Vectorize Protocols),
* and tests that build sqlite-backed harnesses.

The lockdown is enforced by removing the raw names from `__all__` in
each of: `adapter/__init__.py`, `adapter/audit_log.py`,
`adapter/memory/pipeline.py`, `adapter/voice/pipeline.py`. This test
guards each removal so a future PR that re-adds a raw name to `__all__`
breaks the build.

Run from repo root:

    cd operator && python -m pytest adapter/tests/test_namespace_surface_lockdown.py -v
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))  # operator/ on sys.path


# ---------------------------------------------------------------------------
# `adapter` top-level public surface
# ---------------------------------------------------------------------------


def test_adapter_public_surface_is_namespaced_only():
    """`from adapter import *` produces exactly the namespaced surface."""
    adapter = importlib.import_module("adapter")
    expected = {
        "NamespaceAssertionError",
        "NamespacedD1Executor",
        "NamespacedR2Client",
        "NamespacedVectorizeClient",
        "namespaced_executor_from_env",
    }
    assert set(adapter.__all__) == expected, (
        f"adapter.__all__ drifted: {set(adapter.__all__) ^ expected}; "
        "TOCTOU hardening requires the public surface to be namespaced-only"
    )


def test_adapter_star_import_does_not_pull_raw_executors():
    """Star-importing `adapter` does not grab `HttpD1Executor`/`SqliteExecutor`.

    Verifies the lockdown at the namespace level — even if a future PR
    accidentally re-exports a raw constructor from the package, this
    test catches it.
    """
    namespace: dict = {}
    exec("from adapter import *", namespace)  # noqa: S102 — controlled exec
    forbidden = {
        "HttpD1Executor",
        "SqliteExecutor",
        "StorageClient",
        "R2Client",
        "Executor",  # the bare Protocol from audit_log
    }
    leaked = forbidden & set(namespace)
    assert not leaked, (
        f"`from adapter import *` leaked raw constructors: {leaked}; "
        "TOCTOU hardening: route all raw access through "
        "adapter.d1_env.namespaced_executor_from_env or the factories"
    )


# ---------------------------------------------------------------------------
# `adapter.audit_log` submodule surface
# ---------------------------------------------------------------------------


def test_audit_log_all_excludes_raw_executors():
    audit_log = importlib.import_module("adapter.audit_log")
    raw_names = {"HttpD1Executor", "SqliteExecutor"}
    leaked = raw_names & set(audit_log.__all__)
    assert not leaked, (
        f"adapter.audit_log.__all__ exports raw executors: {leaked}; "
        "TOCTOU hardening removes them from the public surface "
        "(they remain importable by explicit name for the writer path "
        "and tests, per the audit-log immutability design)"
    )


def test_audit_log_raw_executors_still_importable_by_explicit_name():
    """Defense-in-depth: confirm the back-compat path still works.

    The writer path (`writer_from_env`) and 19+ in-tree tests rely on
    importing `HttpD1Executor` / `SqliteExecutor` by name. The lockdown
    removes them from `__all__` but does NOT remove the classes — that
    rename is deferred to a follow-on once consumers migrate.
    """
    from adapter.audit_log import HttpD1Executor, SqliteExecutor  # noqa: F401

    # If either import raises ImportError, the lockdown went too far.
    # The test passing means back-compat is preserved.


def test_audit_log_star_import_does_not_pull_raw_executors():
    namespace: dict = {}
    exec("from adapter.audit_log import *", namespace)  # noqa: S102
    forbidden = {"HttpD1Executor", "SqliteExecutor"}
    leaked = forbidden & set(namespace)
    assert not leaked, (
        f"`from adapter.audit_log import *` leaked raw executors: {leaked}"
    )


# ---------------------------------------------------------------------------
# `adapter.memory.pipeline` submodule surface
# ---------------------------------------------------------------------------


def test_memory_pipeline_all_excludes_raw_storage_protocol():
    pipeline = importlib.import_module("adapter.memory.pipeline")
    assert "StorageClient" not in pipeline.__all__, (
        "adapter.memory.pipeline.__all__ exports the raw StorageClient "
        "Protocol; TOCTOU hardening routes external consumers through "
        "adapter.memory.build_namespaced_memory_runner"
    )


def test_memory_pipeline_storage_client_still_importable_for_bridge():
    """The `namespaced.py` bridge imports `StorageClient` by explicit
    name; the lockdown must preserve that path."""
    from adapter.memory.pipeline import StorageClient  # noqa: F401


def test_memory_pipeline_star_import_does_not_pull_raw_storage_client():
    namespace: dict = {}
    exec("from adapter.memory.pipeline import *", namespace)  # noqa: S102
    assert "StorageClient" not in namespace


# ---------------------------------------------------------------------------
# `adapter.voice.pipeline` submodule surface
# ---------------------------------------------------------------------------


def test_voice_pipeline_all_excludes_raw_r2_client_protocol():
    pipeline = importlib.import_module("adapter.voice.pipeline")
    assert "R2Client" not in pipeline.__all__, (
        "adapter.voice.pipeline.__all__ exports the raw R2Client "
        "Protocol; TOCTOU hardening routes external consumers through "
        "adapter.voice.build_namespaced_voice_runner"
    )


def test_voice_pipeline_r2_client_still_importable_for_bridge():
    """The `namespaced.py` bridge imports `R2Client` by explicit name."""
    from adapter.voice.pipeline import R2Client  # noqa: F401


def test_voice_pipeline_star_import_does_not_pull_raw_r2_client():
    namespace: dict = {}
    exec("from adapter.voice.pipeline import *", namespace)  # noqa: S102
    assert "R2Client" not in namespace


# ---------------------------------------------------------------------------
# `adapter.memory` and `adapter.voice` package surfaces still expose the
# factory helpers (regression guard — accidental removal from the package
# `__init__.py` would silently take the migration entry point offline)
# ---------------------------------------------------------------------------


def test_memory_package_exports_factory():
    memory = importlib.import_module("adapter.memory")
    assert "build_namespaced_memory_runner" in memory.__all__
    assert callable(memory.build_namespaced_memory_runner)


def test_voice_package_exports_factory():
    voice = importlib.import_module("adapter.voice")
    assert "build_namespaced_voice_runner" in voice.__all__
    assert callable(voice.build_namespaced_voice_runner)
