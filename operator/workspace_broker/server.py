"""Unix-socket broker with peer-bound, single-use capability grants."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import socket
import socketserver
import struct
import threading
import time
from pathlib import Path
from typing import Any

from .google_auth import materialize_credential
from .operations import WorkspaceOperations

MAX_REQUEST_BYTES = 1_048_576
GRANT_TTL_SECONDS = 10


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class GrantStore:
    """Mint and consume payload-bound grants."""

    def __init__(self) -> None:
        self._key = secrets.token_bytes(32)
        self._pending: dict[str, int] = {}
        self._lock = threading.Lock()

    def mint(self, claims: dict[str, Any]) -> str:
        nonce = secrets.token_urlsafe(18)
        now = int(time.time())
        body = {**claims, "nonce": nonce, "iat": now, "exp": now + GRANT_TTL_SECONDS}
        encoded = _b64encode(_canonical(body))
        signature = _b64encode(
            hmac.new(self._key, encoded.encode(), hashlib.sha256).digest()
        )
        with self._lock:
            self._pending[nonce] = body["exp"]
        return f"{encoded}.{signature}"

    def consume(self, token: str, expected: dict[str, Any]) -> dict[str, Any]:
        encoded, separator, signature = token.partition(".")
        if not separator:
            raise ValueError("malformed grant")
        actual = hmac.new(self._key, encoded.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(actual, _b64decode(signature)):
            raise ValueError("invalid grant signature")
        claims = json.loads(_b64decode(encoded))
        now = int(time.time())
        if claims.get("exp", 0) < now:
            raise ValueError("expired grant")
        for key, value in expected.items():
            if claims.get(key) != value:
                raise ValueError(f"grant {key} mismatch")
        nonce = claims.get("nonce")
        with self._lock:
            expiry = self._pending.pop(nonce, None)
        if expiry is None or expiry < now:
            raise ValueError("grant already used or unknown")
        return claims

    def sign_receipt(self, receipt: dict[str, Any]) -> str:
        """Sign execution evidence with the broker-only grant key."""
        return _b64encode(
            hmac.new(self._key, _canonical(receipt), hashlib.sha256).digest()
        )


class Broker:
    """Authorize and execute reviewed Workspace operations."""

    def __init__(self) -> None:
        self.socket_path = Path(os.environ["SMD_WORKSPACE_BROKER_SOCKET"])
        self.customer_path = Path(os.environ["SMD_CUSTOMER_YAML"])
        self.credential_path = Path(os.environ["SMD_WORKSPACE_CREDENTIAL_PATH"])
        self.customer_slug = os.environ["CUSTOMER_SLUG"]
        self.gateway_pid = int(os.environ["SMD_GATEWAY_PID"])
        materialize_credential(self.credential_path)
        self.operations = WorkspaceOperations(self.credential_path, self.customer_path)
        self.grants = GrantStore()

    def handle(self, request: dict[str, Any], peer_pid: int) -> dict[str, Any]:
        action = request.get("action")
        if action == "health":
            return {
                "ok": True,
                "credential_ready": self.credential_path.is_file(),
                "customer_ready": self.customer_path.is_file(),
            }
        if peer_pid != self.gateway_pid:
            raise PermissionError("request did not originate from the gateway process")
        operation = str(request.get("operation") or "")
        payload = request.get("payload")
        if not operation.startswith("workspace_") or not isinstance(payload, dict):
            raise ValueError("operation and object payload are required")
        if not self.operations.supports(operation):
            raise ValueError(f"unsupported Workspace operation: {operation}")
        digest = hashlib.sha256(_canonical(payload)).hexdigest()
        if action == "authorize":
            grant = self.grants.mint(
                {
                    "customer_slug": self.customer_slug,
                    "operation": operation,
                    "payload_digest": digest,
                    "session_id": str(request.get("session_id") or ""),
                    "tool_call_id": str(request.get("tool_call_id") or ""),
                }
            )
            return {"ok": True, "grant": grant, "payload_digest": digest}
        if action == "execute":
            claims = self.grants.consume(
                str(request.get("grant") or ""),
                {
                    "customer_slug": self.customer_slug,
                    "operation": operation,
                    "payload_digest": digest,
                },
            )
            started = time.perf_counter()
            result = self.operations.dispatch(operation, payload)
            receipt = {
                "customer_slug": self.customer_slug,
                "operation": operation,
                "payload_digest": digest,
                "nonce": claims["nonce"],
                "executed_at": int(time.time()),
                "duration_ms": round((time.perf_counter() - started) * 1000, 3),
            }
            receipt["signature"] = self.grants.sign_receipt(receipt)
            journal = self.credential_path.parent / "execution-receipts.jsonl"
            with journal.open("ab") as handle:
                handle.write(_canonical(receipt) + b"\n")
            journal.chmod(0o600)
            return {"ok": True, "result": result, "receipt": receipt}
        raise ValueError("unsupported broker action")


class RequestHandler(socketserver.StreamRequestHandler):
    """One newline-delimited JSON request per connection."""

    def handle(self) -> None:
        peer_pid, _, _ = struct.unpack(
            "3i",
            self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12),
        )
        raw = self.rfile.readline(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            response = {"ok": False, "error": "request_too_large"}
        else:
            try:
                request = json.loads(raw)
                response = self.server.broker.handle(request, peer_pid)  # type: ignore[attr-defined]
            except Exception as exc:  # noqa: BLE001 - protocol returns bounded errors
                response = {
                    "ok": False,
                    "error": type(exc).__name__,
                    "message": str(exc),
                }
        self.wfile.write(_canonical(response) + b"\n")


class ThreadedUnixServer(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    broker = Broker()
    broker.socket_path.parent.mkdir(parents=True, exist_ok=True)
    broker.socket_path.unlink(missing_ok=True)
    with ThreadedUnixServer(str(broker.socket_path), RequestHandler) as server:
        server.broker = broker  # type: ignore[attr-defined]
        os.chmod(broker.socket_path, 0o660)
        server.serve_forever()


if __name__ == "__main__":
    main()
