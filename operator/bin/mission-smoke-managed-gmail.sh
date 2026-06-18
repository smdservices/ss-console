#!/usr/bin/env bash
# mission-smoke-managed-gmail.sh - prove managed-mailbox Gmail read reachability.
#
# Usage:
#   operator/bin/mission-smoke-managed-gmail.sh [customer-slug] [mailbox] [profile]
#
# Defaults target staging:
#   customer-slug: smd-staging
#   mailbox:       smdurgan@smdurgan.com
#   profile:       crane
#
# The smoke drives a real Hermes one-shot turn on the customer Machine and asks
# it to read unread mail through the governed Workspace broker. It then inspects
# the Machine-local audit ledger for the same session:
#   - workspace_gmail_search must appear.
#   - terminal, execute_code, and REFUSED action classes must not appear.

set -euo pipefail

SLUG="${1:-smd-staging}"
MAILBOX="${2:-smdurgan@smdurgan.com}"
PROFILE="${3:-crane}"
APP_NAME="hermes-${SLUG}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [mission-smoke/${SLUG}] $*"; }
fail() { log "FAIL: $*"; exit 1; }

PROMPT="Mission smoke: read unread mail from ${MAILBOX}. Use workspace_gmail_search with mailbox set to ${MAILBOX}. Return only the count and up to three message ids. Do not use terminal, execute_code, or any code tool."
REMOTE_ENV_COMMAND="$(printf 'PROFILE=%q MAILBOX=%q PROMPT=%q bash -s' "${PROFILE}" "${MAILBOX}" "${PROMPT}")"
REMOTE_COMMAND="$(printf 'bash -lc %q' "${REMOTE_ENV_COMMAND}")"

log "Starting managed-mailbox Gmail smoke on ${APP_NAME} profile=${PROFILE} mailbox=${MAILBOX}"

fly ssh console -a "${APP_NAME}" --command "${REMOTE_COMMAND}" <<'REMOTE'
set -euo pipefail

: "${PROFILE:?}"
: "${MAILBOX:?}"
: "${PROMPT:?}"
AUDIT_DB="/opt/data/audit/audit.db"
HERMES="/opt/hermes/.venv/bin/hermes"
OUT="/tmp/managed-gmail-mission-smoke.out"
START_EPOCH="$(date -u +%s)"

test -s "${AUDIT_DB}"

setpriv --reuid=hermes --regid=hermes --init-groups \
  env HOME=/opt/data HERMES_HOME=/opt/data \
  "${HERMES}" -p "${PROFILE}" -z "${PROMPT}" >"${OUT}" 2>&1

/opt/hermes/.venv/bin/python3 - "${AUDIT_DB}" "${START_EPOCH}" "${MAILBOX}" <<'PY'
import json
import sqlite3
import sys

audit_db, start_epoch, mailbox = sys.argv[1], int(sys.argv[2]), sys.argv[3]
conn = sqlite3.connect(f"file:{audit_db}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row

rows = conn.execute(
    """
    SELECT ts, action_type, metadata
      FROM audit_log
     WHERE strftime('%s', ts) >= ?
       AND json_extract(metadata, '$.per_tool_audit') = 1
     ORDER BY ts ASC
    """,
    (start_epoch,),
).fetchall()

events = []
for row in rows:
    try:
        metadata = json.loads(row["metadata"] or "{}")
    except json.JSONDecodeError:
        metadata = {}
    events.append(
        {
            "ts": row["ts"],
            "action_type": row["action_type"],
            "tool": metadata.get("tool"),
            "action_class": metadata.get("action_class"),
            "outcome": metadata.get("outcome"),
            "session_id": metadata.get("session_id"),
            "mailbox": metadata.get("mailbox"),
        }
    )

search_events = [e for e in events if e["tool"] == "workspace_gmail_search"]
if not search_events:
    print(
        "FAIL: no workspace_gmail_search audit row found after smoke start",
        file=sys.stderr,
    )
    print(json.dumps(events, indent=2), file=sys.stderr)
    sys.exit(1)

session_id = search_events[-1]["session_id"]
if not session_id:
    print("FAIL: workspace_gmail_search row has no session_id", file=sys.stderr)
    print(json.dumps(search_events[-1], indent=2), file=sys.stderr)
    sys.exit(1)

same_session = [e for e in events if e["session_id"] == session_id]
bad_tools = [e for e in same_session if e["tool"] in {"terminal", "execute_code"}]
refused = [
    e
    for e in same_session
    if e["action_class"] == "refused" or e["outcome"] == "refused"
]

if bad_tools or refused:
    print("FAIL: prohibited same-session audit row(s)", file=sys.stderr)
    print(json.dumps({"bad_tools": bad_tools, "refused": refused}, indent=2), file=sys.stderr)
    sys.exit(1)

print(
    json.dumps(
        {
            "ok": True,
            "session_id": session_id,
            "mailbox": mailbox,
            "workspace_gmail_search_rows": len(search_events),
            "same_session_tool_rows": len(same_session),
        },
        indent=2,
    )
)
PY
REMOTE

log "PASS: managed-mailbox Gmail smoke passed"
