"""Capability-grant invariants for the Workspace broker."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from workspace_broker.server import Broker, GrantStore


class _Operations:
    @staticmethod
    def supports(operation: str) -> bool:
        return operation == "workspace_docs_create"

    @staticmethod
    def dispatch(operation: str, payload: dict) -> dict:
        return {"operation": operation, "title": payload["title"]}


def _broker(tmp_path: Path) -> Broker:
    broker = Broker.__new__(Broker)
    broker.customer_slug = "smd"
    broker.gateway_pid = 42
    broker.credential_path = tmp_path / "google.json"
    broker.operations = _Operations()
    broker.grants = GrantStore()
    return broker


def test_grant_is_payload_bound_and_single_use() -> None:
    store = GrantStore()
    expected = {
        "customer_slug": "smd",
        "operation": "workspace_docs_create",
        "payload_digest": "digest-1",
    }
    token = store.mint(expected)

    claims = store.consume(token, expected)
    assert claims["operation"] == "workspace_docs_create"

    with pytest.raises(ValueError, match="already used"):
        store.consume(token, expected)


def test_grant_rejects_operation_widening() -> None:
    store = GrantStore()
    token = store.mint(
        {
            "customer_slug": "smd",
            "operation": "workspace_drive_get",
            "payload_digest": "digest-1",
        }
    )

    with pytest.raises(ValueError, match="operation mismatch"):
        store.consume(
            token,
            {
                "customer_slug": "smd",
                "operation": "workspace_docs_append",
                "payload_digest": "digest-1",
            },
        )


def test_broker_rejects_non_gateway_peer(tmp_path: Path) -> None:
    broker = _broker(tmp_path)

    with pytest.raises(PermissionError, match="gateway process"):
        broker.handle(
            {
                "action": "authorize",
                "operation": "workspace_docs_create",
                "payload": {"title": "Test"},
            },
            peer_pid=43,
        )


def test_broker_authorize_execute_writes_receipt_journal(tmp_path: Path) -> None:
    broker = _broker(tmp_path)
    request = {
        "operation": "workspace_docs_create",
        "payload": {"title": "Test"},
    }
    authorization = broker.handle(
        {
            **request,
            "action": "authorize",
            "session_id": "session-1",
            "tool_call_id": "call-1",
        },
        peer_pid=42,
    )

    response = broker.handle(
        {**request, "action": "execute", "grant": authorization["grant"]},
        peer_pid=42,
    )

    assert response["result"]["title"] == "Test"
    assert response["receipt"]["signature"]
    assert (tmp_path / "execution-receipts.jsonl").is_file()
