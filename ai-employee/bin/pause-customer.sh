#!/usr/bin/env bash
# pause-customer.sh — admin kill-switch for a running customer instance.
#
# Writes /opt/data/.paused inside the customer's Fly machine. bootstrap.sh
# checks for this sentinel on start and halts the agent loop while keeping
# the machine warm (so `fly ssh console` still works for diagnosis).
#
# Usage:
#   ai-employee/bin/pause-customer.sh <slug> --reason "<text>"
#   ai-employee/bin/pause-customer.sh <slug> --resume

set -euo pipefail

SLUG="${1:-}"
[ -n "${SLUG}" ] || { echo "Usage: $0 <slug> [--reason \"text\" | --resume]" >&2; exit 1; }

APP_NAME="hermes-${SLUG}"
ACTION="${2:---reason}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [pause/${SLUG}] $*"; }

case "${ACTION}" in
  --resume)
    log "Resuming ${APP_NAME}..."
    fly ssh console -a "${APP_NAME}" --command "rm -f /opt/data/.paused"
    fly machine restart -a "${APP_NAME}" --select
    log "${APP_NAME} resumed (machine restarted; bootstrap will run safety substrate and start agent)"
    ;;
  --reason)
    REASON="${3:-}"
    [ -n "${REASON}" ] || { echo "Usage: $0 ${SLUG} --reason \"text\"" >&2; exit 1; }
    log "Pausing ${APP_NAME} (reason: ${REASON})..."
    fly ssh console -a "${APP_NAME}" --command "echo '${REASON}' > /opt/data/.paused"
    # Trigger a restart so the agent loop dies and bootstrap re-checks the sentinel.
    fly machine restart -a "${APP_NAME}" --select
    log "${APP_NAME} paused. Machine stays warm; bootstrap.sh holds the agent loop."
    ;;
  *)
    echo "Unknown action ${ACTION}. Use --reason \"text\" or --resume" >&2
    exit 1
    ;;
esac
