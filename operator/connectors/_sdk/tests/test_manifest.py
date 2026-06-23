"""SDK-level tests for the manifest contract and runtime-name derivation."""

from __future__ import annotations

import pytest
from operator_connector_sdk.manifest import AuthModel, ConnectorManifest, SecretSpec
from operator_connector_sdk.naming import runtime_tool_name


def test_minimal_manifest() -> None:
    m = ConnectorManifest(name="x", capability="Cap", auth_model="static")
    assert m.auth_model is AuthModel.STATIC
    assert m.required_secrets == []
    assert m.tool_classes == {}


def test_rejects_duplicate_secret_envs() -> None:
    with pytest.raises(ValueError):
        ConnectorManifest(
            name="x",
            capability="Cap",
            auth_model="static",
            required_secrets=[
                SecretSpec(runtime_env="DUP"),
                SecretSpec(runtime_env="DUP"),
            ],
        )


def test_rejects_bad_env_shape() -> None:
    with pytest.raises(ValueError):
        SecretSpec(runtime_env="1bad-name")


def test_rejects_unknown_auth_model() -> None:
    with pytest.raises(ValueError):
        ConnectorManifest(name="x", capability="Cap", auth_model="magic")


def test_accepts_known_tool_classes() -> None:
    m = ConnectorManifest(
        name="x",
        capability="Cap",
        auth_model="static",
        tool_classes={"a": "read", "b": "internal_write"},
    )
    assert m.tool_classes["b"] == "internal_write"


def test_rejects_unknown_tool_class() -> None:
    with pytest.raises(ValueError):
        ConnectorManifest(
            name="x",
            capability="Cap",
            auth_model="static",
            tool_classes={"a": "read_only"},
        )


def test_rejects_refused_as_a_declared_class() -> None:
    # 'refused' is the fail-closed sentinel for an UNclassified tool — a
    # connector must never be able to declare it.
    with pytest.raises(ValueError):
        ConnectorManifest(
            name="x",
            capability="Cap",
            auth_model="static",
            tool_classes={"a": "refused"},
        )


def test_runtime_tool_name_folds_dashes() -> None:
    assert runtime_tool_name("clio-oktopeak", "list_matters") == "mcp_clio_oktopeak_list_matters"
    assert runtime_tool_name("reference", "record") == "mcp_reference_record"
