"""Append-only audit ledger writer for the capability broker (OP-P1-4).

The broker process (uid ``workspace-broker``) holds the ONLY read-write handle
on the per-customer audit ledger file. The agent uid can read the file (via the
``audit-readers`` group) but cannot open it for write, so the only path a row
reaches the ledger is an ``audit_append`` request to the broker. This module is
that writer.

Append-only is structural, not a SQL filter: this writer exposes ``append`` and
nothing else. There is no update/delete/drop method, and the broker's IPC
surface has no verb that reaches one. The broker stamps ``id``/``ts``
server-side so the agent cannot backdate or collide rows.

CONTRACT: the column set and CREATE below MUST stay in lockstep with the
overlay's ``shared/audit_contract.py`` (COLUMNS / CREATE_TABLE_SQL). The
overlay's ``BrokerAuditClient`` sends a ``row`` keyed by the agent-supplied
columns (COLUMNS minus id/ts). A mismatch surfaces immediately at the boot-time
probe-append + read-back gate (bootstrap.sh), not silently in production.
"""

from __future__ import annotations

import secrets
import sqlite3
import threading
import time
from datetime import UTC, datetime

# Agent-supplied columns: the overlay COLUMNS tuple minus the leading id/ts,
# which the broker stamps. Order here only governs the INSERT this module
# builds; the wire payload is a name-keyed dict, so column *ordering* cannot
# drift the two repos — only the column *set* is the contract.
_AGENT_COLUMNS: tuple[str, ...] = (
    "action_type",
    "actor",
    "actor_role",
    "skill_name",
    "matter_ref",
    "input_digest",
    "output_digest",
    "diff_digest",
    "trust_ceiling",
    "metadata",
)
_ALL_COLUMNS: tuple[str, ...] = ("id", "ts", *_AGENT_COLUMNS)

# Exact copy of overlay shared/audit_contract.py CREATE_TABLE_SQL. Immutability
# is enforced here structurally (no update/delete verb) rather than by triggers.
CREATE_TABLE_SQL = (
    "CREATE TABLE IF NOT EXISTS audit_log ("
    "id TEXT PRIMARY KEY, "
    "ts TEXT NOT NULL, "
    "action_type TEXT NOT NULL, "
    "actor TEXT NOT NULL, "
    "actor_role TEXT, "
    "skill_name TEXT, "
    "matter_ref TEXT, "
    "input_digest TEXT, "
    "output_digest TEXT, "
    "diff_digest TEXT, "
    "trust_ceiling TEXT, "
    "metadata TEXT"
    ")"
)
CREATE_INDEX_SQL: tuple[str, ...] = (
    "CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts)",
    "CREATE INDEX IF NOT EXISTS idx_audit_action_type ON audit_log(action_type, ts)",
    "CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor, ts)",
)

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _encode_crockford(value: int, length: int) -> str:
    out: list[str] = []
    for _ in range(length):
        value, rem = divmod(value, 32)
        out.append(_CROCKFORD[rem])
    return "".join(reversed(out))


def _ulid() -> str:
    """26-char Crockford ULID — matches overlay shared/ids.ulid()."""
    ts = int(time.time() * 1000)
    return _encode_crockford(ts, 10) + _encode_crockford(secrets.randbits(80), 16)


def _iso_utc() -> str:
    dt = datetime.now(UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


class LedgerWriter:
    """Single RW handle on the audit ledger, serialized behind a lock.

    Rollback-journal mode (``journal_mode=DELETE``) + ``busy_timeout`` — NOT
    WAL — so the agent-uid mode=ro readers never need the cross-uid ``-wal``/
    ``-shm`` shared-memory files. Appends are a single sub-millisecond INSERT,
    so a concurrent reader at most waits out the lock via its own busy_timeout.
    """

    def __init__(self, db_path: str) -> None:
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=DELETE")
        self._conn.execute("PRAGMA busy_timeout=5000")
        self.ensure_schema()

    def ensure_schema(self) -> None:
        with self._lock:
            self._conn.execute(CREATE_TABLE_SQL)
            for index_sql in CREATE_INDEX_SQL:
                self._conn.execute(index_sql)
            self._conn.commit()

    def append(self, row: dict) -> str:
        """Insert one audit row. Returns the broker-stamped ULID.

        Raises:
            ValueError: row carries an unknown column, or no action_type.
        """
        unknown = set(row) - set(_AGENT_COLUMNS)
        if unknown:
            raise ValueError(f"audit_append: unknown column(s) {sorted(unknown)}")
        action_type = row.get("action_type")
        if not isinstance(action_type, str) or not action_type.strip():
            raise ValueError("audit_append: a non-empty action_type is required")
        row_id = _ulid()
        values = [row_id, _iso_utc(), *(row.get(col) for col in _AGENT_COLUMNS)]
        sql = (
            "INSERT INTO audit_log (" + ", ".join(_ALL_COLUMNS) + ") "
            "VALUES (" + ", ".join("?" for _ in _ALL_COLUMNS) + ")"
        )
        with self._lock:
            self._conn.execute(sql, values)
            self._conn.commit()
        return row_id

    def count(self) -> int:
        with self._lock:
            cur = self._conn.execute("SELECT COUNT(*) FROM audit_log")
            return int(cur.fetchone()[0])
