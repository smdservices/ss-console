#!/usr/bin/env bash
# ingest-samples.sh — Captain-runnable voice-sample ingestion to R2 + D1.
#
# Closes the "owned dependency" gap from the test plan v2: voice-gate live
# mode requires customer voice samples in R2 and indexed in the per-customer
# D1 ``voice_samples`` table. This CLI is the first-customer path; the
# admin-portal voice-sample UI lands when customer self-service justifies it
# (out of scope per the plan).
#
# Usage:
#
#   ai-employee/voice-gate/bin/ingest-samples.sh \
#     --customer-slug smith-pi-firm \
#     --sample-file /path/to/sample.json \
#     --source customer_upload \
#     --uploaded-by person_smith_partner_01 \
#     [--cohort-id cohort_client] \
#     [--notes "Captain-curated representative sample"] \
#     [--sanitized] \
#     [--r2-bucket vault-smith-pi-firm] \
#     [--d1-binding customer-smith-pi-firm-db] \
#     [--dry-run]
#
# Sample JSON shape (validated by the Python module):
#
#   {
#     "body": "draft body text here ...",
#     "cohort": "client",
#     "authorship": "customer",
#     "subject": "optional subject line",
#     "scenario": "optional short tag"
#   }
#
# Exit codes:
#   0 — success (or dry-run completed)
#   2 — sample file missing
#   3 — validation error (bad shape / bad arg / unknown cohort)
#   4 — wrangler subprocess failure (R2 or D1)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "${SCRIPT_DIR}/ingest_samples.py" "$@"
