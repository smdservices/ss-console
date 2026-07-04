#!/usr/bin/env python3
"""Verify an audit-ledger hash chain (#1686).

Walks a full ledger and proves the chain: every chained row's ``row_hash``
recomputes from its content + its parent's hash, exactly one chain start
(GENESIS or the legacy anchor), no forks, no unreachable segments. A mutated,
deleted, or inserted row is reported with its id and reason. Tail truncation
is caught by comparing the reported ``head`` against an externally pinned
head (the evidence-packet flow records it at export time).

Two input modes:

  --sqlite PATH   read audit_log directly (local/test ledgers)
  --json PATH     verify an audit_export payload pulled over the runtime-read
                  seam ({"entries": [...]} or a bare row array) — the offline
                  compliance-verification path. '-' reads stdin.

Exit 0 with a summary line when intact; exit 1 with the break list otherwise.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "workspace_broker"))
from chain import CHAIN_COLUMNS, verify_chain  # noqa: E402


def rows_from_sqlite(path: str) -> list[dict]:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        cols = [*CHAIN_COLUMNS, "prev_hash", "row_hash"]
        cur = conn.execute(f"SELECT {', '.join(cols)} FROM audit_log ORDER BY rowid")
        return [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        conn.close()


def rows_from_json(path: str) -> list[dict]:
    raw = sys.stdin.read() if path == "-" else Path(path).read_text()
    data = json.loads(raw)
    entries = data.get("entries") if isinstance(data, dict) else data
    if not isinstance(entries, list):
        raise SystemExit("json input must be an audit_export payload or a row array")
    return entries


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--sqlite", help="path to a ledger sqlite file")
    src.add_argument("--json", help="audit_export JSON path, or '-' for stdin")
    args = ap.parse_args()

    rows = rows_from_sqlite(args.sqlite) if args.sqlite else rows_from_json(args.json)
    report = verify_chain(rows)

    print(
        f"chain {'INTACT' if report['ok'] else 'BROKEN'}: "
        f"{report['chained']} chained, {report['legacy']} legacy, head={report['head']}"
    )
    for b in report["breaks"]:
        print(f"  BREAK id={b['id']}: {b['reason']}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
