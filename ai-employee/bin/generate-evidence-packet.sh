#!/usr/bin/env bash
# generate-evidence-packet.sh: compose a compliance evidence packet
# (issue #894) for one customer + period. Output is a signed tar.gz
# containing a PDF, JSON manifest, and per-spec evidence files.
#
# Usage:
#   ai-employee/bin/generate-evidence-packet.sh \
#     --customer <slug> \
#     --matter <id-or-all> \
#     --from <ISO> \
#     --to <ISO> \
#     --output <path> \
#     --actor <name> \
#     [--actor-role captain|compliance]
#
# Captain CLI integration (when bin/smd-cli lands):
#   smd-cli evidence <slug> --matter <m> --from <a> --to <b>
# delegates to this script with --actor=$USER and --actor-role=captain.
#
# Exit codes (forwarded from bin/lib/evidence.py):
#   0  packet generated
#   2  preflight failed (missing customer.yaml, bad arg)
#   3  build halted (EvidencePacketError; e.g. secret leak, role gate fail)
#   4  unexpected error

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AIE_ROOT="${REPO_ROOT}/ai-employee"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [evidence] $*"; }

if [ "$#" -lt 1 ]; then
  cat >&2 <<'USAGE'
Usage: generate-evidence-packet.sh --customer <slug> --matter <id|all> \
                                   --from <ISO> --to <ISO> \
                                   --output <path> --actor <name> \
                                   [--actor-role captain|compliance]
USAGE
  exit 2
fi

log "starting"

# Run from inside ai-employee/ so `bin.lib.evidence` resolves as a
# package; this matches the layout other adapter scripts use.
cd "${AIE_ROOT}"

# uv + pyyaml match the toolchain pause / provision / rollback /
# decommission use, so Captain does not need a separate venv.
set +e
uv run --quiet --with pyyaml python3 -m bin.lib.evidence "$@"
EXIT_CODE=$?
set -e

case "${EXIT_CODE}" in
  0) log "packet generated" ;;
  2) log "preflight failed (exit 2): see stderr" ;;
  3) log "build halted (exit 3): see stderr" ;;
  4) log "unexpected error (exit 4): see stderr" ;;
  130) log "interrupted (exit 130)" ;;
  *) log "unknown exit ${EXIT_CODE}" ;;
esac

exit "${EXIT_CODE}"
