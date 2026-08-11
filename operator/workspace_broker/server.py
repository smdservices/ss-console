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

from . import escalation_ledger
from .audit_ledger import LedgerWriter
from .corrections import PROPOSED_STATUS, build_correction_row
from .establishment import EstablishmentStore
from .google_auth import materialize_credential
from .job_ledger import LEASE_TTL_SECONDS, JobLedgerWriter, now_and_lease_cutoff
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

    # Class default so instances built via ``__new__`` (tests) and pre-WS5
    # images without SMD_AUDIT_DB_PATH have a defined, audit-disabled ledger.
    ledger: LedgerWriter | None = None
    # B1 job-control plane. Same default-disabled posture as ``ledger`` so
    # instances built via ``__new__`` (tests) and pre-B1 images have a defined,
    # job-disabled ledger.
    job_ledger: JobLedgerWriter | None = None
    # ADR 0021 Stream B: agent uid for the suppressed_wake_append heartbeat
    # verb. None (the ``__new__``/pre-heartbeat default) keeps the verb
    # fail-closed until __init__ resolves it from the gateway process.
    agent_uid: int | None = None
    # ADR 0085 establishment spool. Same default-disabled posture as the
    # ledgers: instances built via ``__new__`` (tests) and pre-0085 images have
    # a defined, establishment-disabled store. The class-level lock is shared
    # by design — one broker per process, and it only serializes the three
    # establish_* verbs (their sweep + read-modify-write of a staging set).
    establishment: EstablishmentStore | None = None
    _establish_lock = threading.Lock()

    def __init__(self) -> None:
        self.socket_path = Path(os.environ["SMD_WORKSPACE_BROKER_SOCKET"])
        self.customer_path = Path(os.environ["SMD_CUSTOMER_YAML"])
        self.credential_path = Path(os.environ["SMD_WORKSPACE_CREDENTIAL_PATH"])
        self.customer_slug = os.environ["CUSTOMER_SLUG"]
        self.gateway_pid = int(os.environ["SMD_GATEWAY_PID"])
        materialize_credential(self.credential_path)
        self.operations = WorkspaceOperations(self.credential_path, self.customer_path)
        self.grants = GrantStore()
        # OP-P1-4: this broker also holds the only RW handle on the per-customer
        # audit ledger when SMD_AUDIT_DB_PATH is set (the entrypoint owns the
        # file to this uid; the agent uid can read but not write it). When
        # unset, the audit ledger is direct-write (legacy / pre-WS5 image) and
        # this broker does not touch it.
        audit_db_path = os.environ.get("SMD_AUDIT_DB_PATH")
        self.ledger = LedgerWriter(audit_db_path) if audit_db_path else None
        # ADR 0021 Stream B: cron pre_run scripts run as subprocess CHILDREN of
        # the gateway (hermes cron/scheduler.py `subprocess.run`), so they share
        # the agent uid but never the gateway PID. The narrow heartbeat verb
        # below gates on uid instead — resolved lazily via _resolve_agent_uid()
        # because at BROKER start the gateway PID still belongs to the root
        # entrypoint (the exec-drop to the agent user happens after the broker
        # launches; live-caught on pilot-smokeball 2026-07-06).
        self.agent_uid = None
        # B1: the job ledger folds into the SAME broker-owned DB file (one
        # mount, one uid boundary). Mutable control state, distinct table set;
        # the audit_log append-only guarantee is untouched (no job verb writes
        # audit_log). Disabled when the audit DB is unconfigured (pre-B1 image).
        self.job_ledger = JobLedgerWriter(audit_db_path) if audit_db_path else None
        # WP-A escalation ledger: append-only JSONL of escalation telemetry
        # (fired/acked/handed_off/resolved), written ONLY by this broker so the
        # agent uid cannot forge an ack that silences a deadline alarm. It lives
        # beside the audit DB (same /run/smd-audit bind the broker already
        # writes; the agent reads the /opt/data/audit twin via audit-readers).
        # An explicit SMD_ESCALATION_LEDGER_PATH wins (the test seam).
        explicit_ledger = os.environ.get("SMD_ESCALATION_LEDGER_PATH")
        if explicit_ledger:
            self.escalation_ledger_path: str | None = explicit_ledger
        elif audit_db_path:
            self.escalation_ledger_path = str(
                Path(audit_db_path).parent / "escalation-ledger.jsonl"
            )
        else:
            self.escalation_ledger_path = None
        self._escalation_lock = threading.Lock()
        # ADR 0085 (ss#2161/#2162): the establishment spool, when the
        # entrypoint created it and exported its path. Requires the audit
        # ledger — an establishment that cannot be audited must not run, so an
        # audit-disabled broker keeps the verbs fail-closed.
        establish_spool = os.environ.get("SMD_ESTABLISH_SPOOL_DIR")
        if establish_spool and self.ledger is not None:
            self.establishment = EstablishmentStore(establish_spool, self.ledger)
        else:
            self.establishment = None

    def _resolve_agent_uid(self) -> int | None:
        """Resolve (and cache) the agent uid for the heartbeat verb.

        Precedence: explicit SMD_AGENT_UID from the entrypoint (which knows the
        agent user while still root), then a request-time stat of the gateway
        PID — by the time any pre_run fires, the entrypoint has exec-dropped
        into the agent user under the same PID. uid 0 is never accepted: the
        agent never runs as root, and a pre-exec-drop stat would read the root
        entrypoint. Unresolvable → None → the verb stays fail-closed.
        """
        if self.agent_uid is not None:
            return self.agent_uid
        env_uid = os.environ.get("SMD_AGENT_UID", "").strip()
        if env_uid.isdigit() and int(env_uid) != 0:
            self.agent_uid = int(env_uid)
            return self.agent_uid
        try:
            uid = os.stat(f"/proc/{self.gateway_pid}").st_uid
        except OSError:
            return None
        if uid == 0:
            return None
        self.agent_uid = uid
        return self.agent_uid

    def handle(
        self, request: dict[str, Any], peer_pid: int, peer_uid: int | None = None
    ) -> dict[str, Any]:
        action = request.get("action")
        # ADR 0021 Stream B heartbeat: the ONE verb reachable by cron pre_run
        # children (agent uid, non-gateway PID). Deliberately narrow — the row's
        # action_type is locked to SUPPRESSED_WAKE, so this cannot be used to
        # forge any other audit row; the generic audit_append verb below keeps
        # its strict gateway-PID gate. The append still flows through the
        # hash-chained LedgerWriter (broker stamps id/ts; chain intact).
        if action == "suppressed_wake_append":
            if self.ledger is None:
                raise ValueError("audit ledger not configured on this broker")
            agent_uid = self._resolve_agent_uid()
            if agent_uid is None or peer_uid != agent_uid:
                raise PermissionError(
                    "suppressed_wake_append requires a caller running as the agent uid"
                )
            row = request.get("row")
            if not isinstance(row, dict):
                raise ValueError("suppressed_wake_append requires a 'row' object")
            if row.get("action_type") != "SUPPRESSED_WAKE":
                raise ValueError(
                    "suppressed_wake_append only accepts action_type=SUPPRESSED_WAKE"
                )
            row_id = self.ledger.append(row)
            return {"ok": True, "id": row_id}
        # ss-console #2253: the WAKE half of the same gate. The four gated cron
        # skills wrote a row when they suppressed and nothing when they woke, so
        # the one tick that mattered was the one tick with no row — on
        # 2026-08-10 a fabricated escalation email was discoverable only by
        # reading the mailbox. Same caller shape as the heartbeat verb above (a
        # cron pre_run child: agent uid, non-gateway PID), and deliberately a
        # SEPARATE verb rather than a widened suppressed_wake_append, so each
        # verb still pins exactly one action_type and stays auditable alone.
        #
        # The caller swallows this verb's failures — a wake is never gated on
        # its own audit row — which is exactly why the gate lives here and not
        # in the caller: a best-effort caller cannot be trusted to validate.
        if action == "emitted_wake_append":
            if self.ledger is None:
                raise ValueError("audit ledger not configured on this broker")
            agent_uid = self._resolve_agent_uid()
            if agent_uid is None or peer_uid != agent_uid:
                raise PermissionError(
                    "emitted_wake_append requires a caller running as the agent uid"
                )
            row = request.get("row")
            if not isinstance(row, dict):
                raise ValueError("emitted_wake_append requires a 'row' object")
            if row.get("action_type") != "EMITTED_WAKE":
                raise ValueError(
                    "emitted_wake_append only accepts action_type=EMITTED_WAKE"
                )
            row_id = self.ledger.append(row)
            return {"ok": True, "id": row_id}
        # WP-A escalation ledger append. Same caller shape as the heartbeat
        # verbs above: a cron pre_run or the agent's execute_code turn (agent
        # uid, non-gateway PID). Gated on the agent uid, and the write is
        # VALIDATED (escalation_ledger.validate_append) so an ``acked`` that has
        # no prior ``fired``/``chased`` raise is rejected — the LLM turn can
        # append only through this seam, never the file directly, and it cannot
        # silence an alarm that never rang. ts/id are stamped server-side, so
        # the caller cannot backdate. Serialized by an instance lock (the server
        # is threaded) so the tail-read + append stays consistent.
        if action == "escalation_event_append":
            agent_uid = self._resolve_agent_uid()
            if agent_uid is None or peer_uid != agent_uid:
                raise PermissionError(
                    "escalation_event_append requires a caller running as the agent uid"
                )
            if not self.escalation_ledger_path:
                raise ValueError("escalation ledger path not configured on this broker")
            event = request.get("event")
            if not isinstance(event, dict):
                raise ValueError("escalation_event_append requires an 'event' object")
            with self._escalation_lock:
                existing = escalation_ledger.read_ledger(self.escalation_ledger_path)
                escalation_ledger.validate_append(existing, event)
                stamped = escalation_ledger.stamp_event(event)
                escalation_ledger.append_line(self.escalation_ledger_path, stamped)
            return {"ok": True, "id": stamped["id"]}
        # ss-console #2091 (ADR 0083 §4): the Operator CAPTURES a correction a
        # customer stated, and never applies one. Same caller shape as the
        # heartbeat verbs above (agent uid, non-gateway PID — an execute_code
        # turn), same one-pinned-action_type discipline, and the same reason:
        # this verb must not be able to forge any other row.
        #
        # THE ROW IS REBUILT, NOT FORWARDED. `build_correction_row` reads a
        # bounded field set off the request and constructs the row itself, so a
        # field the caller invents is dropped rather than stored, and `status`
        # is a broker-side constant that never appears on the wire. Validation
        # lives broker-side because the caller is the agent, and a schema the
        # agent enforces is a schema the agent can decline to enforce.
        #
        # NOTHING HERE REACHES A SPEC. This appends to the append-only audit
        # ledger the agent uid cannot open for write. Promotion into
        # `vaults/<slug>/output-classes.json` is portal-side, performed by a
        # Named Administrator, and the promoted bytes are the ones they submit.
        if action == "correction_propose":
            if self.ledger is None:
                raise ValueError("audit ledger not configured on this broker")
            agent_uid = self._resolve_agent_uid()
            if agent_uid is None or peer_uid != agent_uid:
                raise PermissionError(
                    "correction_propose requires a caller running as the agent uid"
                )
            row = build_correction_row(request.get("proposal"))
            row_id = self.ledger.append(row)
            return {"ok": True, "id": row_id, "status": PROPOSED_STATUS}
        # ADR 0085 (ss#2161/#2162): conversational establishment. Three narrow
        # verbs by which an admin-instructed voice/shape submission crosses the
        # agent -> broker trust boundary into the root intake's spool. Same
        # caller shape as correction_propose (agent uid, non-gateway PID — an
        # execute_code turn), same fail-closed uid gate, and the same
        # one-pinned-action_type discipline per writing verb (SUBMITTED on
        # submit, RESULT on status) so neither can forge any other row.
        #
        # EVERYTHING STORED IS REBUILT. establishment.py reads a bounded field
        # set off each request, computes every hash server-side, and refuses —
        # never sanitizes — a malformed field. The agent's uid has no access to
        # the spool at any level; these verbs are the only door, and the root
        # intake independently re-verifies uid and hashes on the other side.
        if action in (
            "establish_stage_document",
            "establish_submit",
            "establish_status",
        ):
            if self.ledger is None:
                raise ValueError("audit ledger not configured on this broker")
            if self.establishment is None:
                raise ValueError("establishment spool not configured on this broker")
            agent_uid = self._resolve_agent_uid()
            if agent_uid is None or peer_uid != agent_uid:
                raise PermissionError(
                    f"{action} requires a caller running as the agent uid"
                )
            with self._establish_lock:
                # Opportunistic TTL sweep on every establishment call: the
                # broker is the only principal that can expire staging sets
                # and unread results (the intake owns only run dirs).
                self.establishment.sweep()
                if action == "establish_stage_document":
                    return self.establishment.stage_document(request)
                if action == "establish_submit":
                    return self.establishment.submit(request)
                return self.establishment.status(request)
        # ss-console #1791: the webhook gate (overlay hermes-smd-webhook-gate)
        # records WEBHOOK_SUPPRESSED for an excluded delivery. It runs as the
        # agent uid on a NON-gateway PID — the same shape as the cron pre_run
        # children above — so the generic gateway-PID-gated audit_append refuses
        # it. This sibling verb gates on the agent uid and locks action_type to
        # WEBHOOK_SUPPRESSED, so it cannot forge any other row. Deliberately a
        # separate verb (not a widened suppressed_wake_append) so each verb pins
        # exactly one action_type and stays auditable in isolation.
        if action == "webhook_suppressed_append":
            if self.ledger is None:
                raise ValueError("audit ledger not configured on this broker")
            agent_uid = self._resolve_agent_uid()
            if agent_uid is None or peer_uid != agent_uid:
                raise PermissionError(
                    "webhook_suppressed_append requires a caller running as the agent uid"
                )
            row = request.get("row")
            if not isinstance(row, dict):
                raise ValueError("webhook_suppressed_append requires a 'row' object")
            if row.get("action_type") != "WEBHOOK_SUPPRESSED":
                raise ValueError(
                    "webhook_suppressed_append only accepts action_type=WEBHOOK_SUPPRESSED"
                )
            row_id = self.ledger.append(row)
            return {"ok": True, "id": row_id}
        if action == "health":
            return {
                "ok": True,
                "credential_ready": self.credential_path.is_file(),
                "customer_ready": self.customer_path.is_file(),
                "audit_ready": self.ledger is not None,
                "jobs_ready": self.job_ledger is not None,
                "supported_ops": self.operations.supported_operations(),
            }
        if peer_pid != self.gateway_pid:
            raise PermissionError("request did not originate from the gateway process")
        # OP-P1-4 append-only audit write. PID-gated (above): only the gateway
        # may write; execute_code/terminal children get a different peer PID and
        # are rejected. The broker stamps id/ts; there is no update/delete/drop
        # verb in this IPC surface — that absence is the append-only guarantee.
        if action == "audit_append":
            if self.ledger is None:
                raise ValueError("audit ledger not configured on this broker")
            row = request.get("row")
            if not isinstance(row, dict):
                raise ValueError("audit_append requires a 'row' object")
            row_id = self.ledger.append(row)
            return {"ok": True, "id": row_id}
        # B1 durable-job control plane. PID-gated (above): only the gateway
        # (which hosts the worker thread) reaches these; execute_code/terminal
        # children get a different peer PID and are rejected, so the agent
        # cannot claim leases, raise budgets, or flip job status directly.
        if isinstance(action, str) and action.startswith("job_"):
            if self.job_ledger is None:
                raise ValueError("job ledger not configured on this broker")
            return self._handle_job(action, request)
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

    def _handle_job(self, action: str, request: dict[str, Any]) -> dict[str, Any]:
        """Dispatch the B1 job-ledger verbs. Time is stamped server-side
        (``now_and_lease_cutoff``) — the broker is the single clock of record
        for lease timing, so callers never pass time over the wire."""
        jl = self.job_ledger
        assert jl is not None  # guarded by the caller
        if action == "job_create":
            row = request.get("row")
            if not isinstance(row, dict):
                raise ValueError("job_create requires a 'row' object")
            return {"ok": True, "id": jl.create(row)}
        if action == "job_list_claimable":
            now, cutoff = now_and_lease_cutoff(LEASE_TTL_SECONDS)
            return {"ok": True, "jobs": jl.list_claimable(now, cutoff)}
        if action == "job_list":
            # Observability read: every job row (terminal + live), newest first.
            # Powers the console's ``jobs`` runtime-read kind so the worker is
            # verifiable end-to-end over HTTPS. Read-only — no lease filter.
            return {"ok": True, "jobs": jl.list_all()}

        job_id = str(request.get("job_id") or "")
        if not job_id:
            raise ValueError(f"{action} requires job_id")
        if action == "job_read":
            return {"ok": True, "job": jl.read(job_id)}
        if action == "job_cancel":
            # ``ok`` == request processed; ``result`` == the verb's boolean
            # outcome. Keeping them separate lets a legitimately-false outcome
            # (e.g. a fenced-out record) return False instead of reading as a
            # transport refusal on the client.
            return {"ok": True, "result": jl.request_cancel(job_id)}
        if action == "job_claim":
            worker_id = str(request.get("worker_id") or "")
            if not worker_id:
                raise ValueError("job_claim requires worker_id")
            now, cutoff = now_and_lease_cutoff(LEASE_TTL_SECONDS)
            return {"ok": True, "lease_epoch": jl.claim(job_id, worker_id, now, cutoff)}

        # The remaining verbs are epoch-fenced: a stale worker's write is a
        # no-op (the ledger checks lease_epoch in the WHERE clause).
        epoch = request.get("lease_epoch")
        if not isinstance(epoch, int):
            raise ValueError(f"{action} requires an integer lease_epoch")
        if action == "job_heartbeat":
            now, _ = now_and_lease_cutoff(LEASE_TTL_SECONDS)
            return {"ok": True, "result": jl.heartbeat(job_id, epoch, now)}
        if action == "job_record":
            fields = request.get("fields")
            if not isinstance(fields, dict):
                raise ValueError("job_record requires a 'fields' object")
            return {"ok": True, "result": jl.record(job_id, epoch, fields)}
        step_key = str(request.get("step_key") or "")
        if not step_key:
            raise ValueError(f"{action} requires step_key")
        if action == "job_idem_begin":
            return {"ok": True, "decision": jl.idempotency_begin(job_id, step_key, epoch)}
        if action == "job_idem_complete":
            return {"ok": True, "result": jl.idempotency_complete(job_id, step_key, epoch)}
        raise ValueError(f"unsupported job action: {action}")


class RequestHandler(socketserver.StreamRequestHandler):
    """One newline-delimited JSON request per connection."""

    def handle(self) -> None:
        peer_pid, peer_uid, _ = struct.unpack(
            "3i",
            self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12),
        )
        raw = self.rfile.readline(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            response = {"ok": False, "error": "request_too_large"}
        else:
            try:
                request = json.loads(raw)
                response = self.server.broker.handle(request, peer_pid, peer_uid)  # type: ignore[attr-defined]
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
        os.chmod(broker.socket_path, 0o660)  # nosemgrep: python.lang.security.audit.insecure-file-permissions.insecure-file-permissions - Broker owner and connector group require socket access; all other users remain denied.
        server.serve_forever()


if __name__ == "__main__":
    main()
