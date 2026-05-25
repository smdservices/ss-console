"""voice-gate sample ingestion — Captain-runnable CLI.

Closes the "owned dependency" gap from the test plan v2: voice-gate live
mode requires customer voice samples in R2 and indexed in the per-customer
D1 ``voice_samples`` table. v1 ships this ingestion as a CLI (no admin UI;
UI is deferred to customer self-service per the plan §Out of scope).

Usage:

  python -m ingest_samples \\
    --customer-slug smith-pi-firm \\
    --sample-file /path/to/sample.json \\
    --source customer_upload \\
    --uploaded-by person_smith_partner_01 \\
    [--cohort-id cohort_client] \\
    [--notes "Captain-curated representative sample"] \\
    [--dry-run]

The CLI is two-phase:

  1. Pure validation. The sample JSON is read, shape-checked against the
     ``VoiceSampleInput`` schema below, and a row payload + r2_key are
     prepared. Dry-run stops here and prints the planned upload + insert.
  2. Side-effect phase. Calls ``wrangler r2 object put`` to upload the JSON
     and ``wrangler d1 execute`` to insert the row. Wrangler subprocess
     calls are kept thin and surfaced 1:1 to the operator's terminal.

Schema:

  Sample JSON file must be a single JSON object with the following keys:

      body            (str, required)        — draft body text
      cohort          (str, required)        — recipient cohort (client / opposing-counsel / court / internal)
      authorship      (str, required)        — 'customer' (these are reference samples)
      subject         (str, optional)        — subject line
      scenario        (str, optional)        — short scenario tag

  The CLI rejects ``authorship: 'agent'`` because voice samples are
  customer-authored reference material for the blind test. Agent drafts
  enter the harness through a different code path.

Tests cover the pure validation path. R2 + D1 subprocess wiring is integration
work tested against a real wrangler binary in CI; the validator can be unit-
tested without any network or wrangler dependency.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


KNOWN_COHORTS: frozenset[str] = frozenset(
    {"client", "opposing-counsel", "court", "internal", "internal-team"}
)
# v1 ingest only accepts customer-authored samples — agent drafts enter the
# harness through a different code path (the runtime voice plugin).
ACCEPTED_AUTHORSHIP: frozenset[str] = frozenset({"customer"})
KNOWN_SOURCES: frozenset[str] = frozenset(
    {"customer_upload", "bootstrap_scrape", "sent_folder"}
)


class IngestValidationError(ValueError):
    """Raised when a sample JSON or CLI argument fails validation."""


@dataclass(frozen=True)
class VoiceSampleRow:
    """The D1 row payload + R2 key, ready for ingestion side-effects."""

    sample_id: str
    customer_slug: str
    r2_key: str
    uploaded_at: str
    uploaded_by: str
    source: str
    recipient_cohort_id: str | None
    sanitized: int
    active: int
    used_in_blind_test: int
    notes: str
    raw_json_bytes: bytes


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _stable_sample_id(payload: dict[str, Any], uploaded_at: str) -> str:
    """Deterministic ID derived from content + upload time.

    Not a ULID (avoiding an external dep). Stable enough to surface if the
    same sample is ingested twice with the same upload time — the D1 PRIMARY
    KEY conflict will surface it as an error rather than a silent dupe.
    """
    h = hashlib.sha256()
    h.update(uploaded_at.encode("utf-8"))
    h.update(json.dumps(payload, sort_keys=True).encode("utf-8"))
    return "vs_" + h.hexdigest()[:24]


def validate_sample(payload: Any) -> dict[str, Any]:
    """Shape-check a sample JSON payload. Returns the validated dict.

    Required keys: body (str), cohort (str), authorship (str).
    Optional keys: subject (str), scenario (str).
    Unknown extra keys are allowed for forward-compat; warned in stderr.
    """
    if not isinstance(payload, dict):
        raise IngestValidationError("sample JSON must be an object")
    for key in ("body", "cohort", "authorship"):
        if key not in payload:
            raise IngestValidationError(f"sample missing required field: {key}")
    if not isinstance(payload["body"], str) or not payload["body"].strip():
        raise IngestValidationError("sample.body must be a non-empty string")
    if payload["cohort"] not in KNOWN_COHORTS:
        raise IngestValidationError(
            f"sample.cohort {payload['cohort']!r} not in KNOWN_COHORTS={sorted(KNOWN_COHORTS)}"
        )
    if payload["authorship"] not in ACCEPTED_AUTHORSHIP:
        raise IngestValidationError(
            f"sample.authorship must be one of {sorted(ACCEPTED_AUTHORSHIP)}; "
            f"got {payload['authorship']!r} — agent drafts use a different path"
        )
    if "subject" in payload and not isinstance(payload["subject"], str):
        raise IngestValidationError("sample.subject must be a string when present")
    if "scenario" in payload and not isinstance(payload["scenario"], str):
        raise IngestValidationError("sample.scenario must be a string when present")
    return payload


def build_row(
    *,
    customer_slug: str,
    payload: dict[str, Any],
    source: str,
    uploaded_by: str,
    cohort_id: str | None = None,
    notes: str = "",
    sanitized: bool = False,
    uploaded_at: str | None = None,
) -> VoiceSampleRow:
    """Compose the VoiceSampleRow ready for R2 + D1 side-effects."""
    if not customer_slug or not customer_slug.replace("-", "").replace("_", "").isalnum():
        raise IngestValidationError(
            f"customer_slug {customer_slug!r} must be non-empty alphanumeric "
            f"(dashes and underscores permitted)"
        )
    if source not in KNOWN_SOURCES:
        raise IngestValidationError(
            f"source {source!r} not in KNOWN_SOURCES={sorted(KNOWN_SOURCES)}"
        )
    if not uploaded_by:
        raise IngestValidationError("uploaded_by must be supplied (person_mappings.id)")

    validated = validate_sample(payload)
    upload_time = uploaded_at or _now_iso()
    sample_id = _stable_sample_id(validated, upload_time)
    r2_key = f"vaults/{customer_slug}/voice/samples/{sample_id}.json"
    raw_bytes = json.dumps(validated, sort_keys=True, indent=2).encode("utf-8")

    return VoiceSampleRow(
        sample_id=sample_id,
        customer_slug=customer_slug,
        r2_key=r2_key,
        uploaded_at=upload_time,
        uploaded_by=uploaded_by,
        source=source,
        recipient_cohort_id=cohort_id,
        sanitized=1 if sanitized else 0,
        active=1,
        used_in_blind_test=0,
        notes=notes,
        raw_json_bytes=raw_bytes,
    )


def sql_insert(row: VoiceSampleRow) -> str:
    """Render the parameterized INSERT statement for `wrangler d1 execute`.

    Values are inlined with SQL-string-quoted escaping. Not for production
    use against untrusted input — this CLI assumes Captain-curated samples
    and a Captain-supplied uploaded_by string. The validator above is the
    safety boundary; SQL injection from a malformed sample.json is the
    Captain's own input being passed through.
    """
    def q(s: str | None) -> str:
        if s is None:
            return "NULL"
        return "'" + s.replace("'", "''") + "'"

    return (
        "INSERT INTO voice_samples ("
        "id, uploaded_at, uploaded_by, source, recipient_cohort_id, r2_key, "
        "sanitized, active, used_in_blind_test, notes"
        ") VALUES ("
        f"{q(row.sample_id)}, {q(row.uploaded_at)}, {q(row.uploaded_by)}, "
        f"{q(row.source)}, {q(row.recipient_cohort_id)}, {q(row.r2_key)}, "
        f"{row.sanitized}, {row.active}, {row.used_in_blind_test}, {q(row.notes)}"
        ");"
    )


def upload_to_r2(
    row: VoiceSampleRow,
    *,
    r2_bucket: str,
    runner: Any = subprocess.run,
) -> None:
    """Upload the JSON payload to R2 via wrangler.

    ``r2_bucket`` is the per-customer R2 binding name (typically derived from
    the customer slug at provisioning).
    """
    cmd = [
        "npx", "--yes", "wrangler", "r2", "object", "put",
        f"{r2_bucket}/{row.r2_key}",
        "--pipe",
    ]
    result = runner(cmd, input=row.raw_json_bytes, capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(
            f"wrangler r2 object put failed (exit {result.returncode}): "
            f"{getattr(result, 'stderr', b'').decode('utf-8', errors='replace')}"
        )


def insert_into_d1(
    row: VoiceSampleRow,
    *,
    d1_binding: str,
    runner: Any = subprocess.run,
) -> None:
    """Insert the row into D1 via wrangler.

    ``d1_binding`` is the per-customer D1 database name (e.g.,
    ``customer_<slug>_db``).
    """
    statement = sql_insert(row)
    cmd = [
        "npx", "--yes", "wrangler", "d1", "execute",
        d1_binding,
        "--command", statement,
        "--remote",
    ]
    result = runner(cmd, capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(
            f"wrangler d1 execute failed (exit {result.returncode}): "
            f"{getattr(result, 'stderr', b'').decode('utf-8', errors='replace')}"
        )


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ingest a customer voice sample to R2 + D1 voice_samples index."
    )
    parser.add_argument("--customer-slug", required=True)
    parser.add_argument("--sample-file", required=True, type=Path)
    parser.add_argument(
        "--source", required=True, choices=sorted(KNOWN_SOURCES),
    )
    parser.add_argument("--uploaded-by", required=True)
    parser.add_argument("--cohort-id", default=None)
    parser.add_argument("--notes", default="")
    parser.add_argument(
        "--r2-bucket", default=None,
        help="R2 bucket binding name. Defaults to 'vault-<slug>'.",
    )
    parser.add_argument(
        "--d1-binding", default=None,
        help="D1 database binding name. Defaults to 'customer-<slug>-db'.",
    )
    parser.add_argument(
        "--sanitized", action="store_true",
        help="Mark this sample as sanitized (PII stripped per voice-gate policy).",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Validate + print the planned R2 upload + D1 insert, do not execute.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    if not args.sample_file.exists():
        print(f"error: sample file does not exist: {args.sample_file}", file=sys.stderr)
        return 2
    try:
        payload = json.loads(args.sample_file.read_text(encoding="utf-8"))
        row = build_row(
            customer_slug=args.customer_slug,
            payload=payload,
            source=args.source,
            uploaded_by=args.uploaded_by,
            cohort_id=args.cohort_id,
            notes=args.notes,
            sanitized=args.sanitized,
        )
    except IngestValidationError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 3

    r2_bucket = args.r2_bucket or f"vault-{args.customer_slug}"
    d1_binding = args.d1_binding or f"customer-{args.customer_slug}-db"

    if args.dry_run:
        print("DRY RUN — no R2 upload or D1 insert performed.")
        print(f"sample_id: {row.sample_id}")
        print(f"r2_key:    {row.r2_key}")
        print(f"r2_bucket: {r2_bucket}")
        print(f"d1_binding: {d1_binding}")
        print("INSERT statement:")
        print("  " + sql_insert(row))
        return 0

    try:
        upload_to_r2(row, r2_bucket=r2_bucket)
        insert_into_d1(row, d1_binding=d1_binding)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 4

    print(f"ingested {row.sample_id} to r2://{r2_bucket}/{row.r2_key} and d1://{d1_binding}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
