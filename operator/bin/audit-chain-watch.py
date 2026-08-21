#!/usr/bin/env python3
"""Daily off-box check on every seat's audit chain, plus the off-box copy (ss#2500).

WHAT WAS TRUE BEFORE THIS. The ledger was hash chained and nothing called the
verifier -- not a workflow, not the evidence packet, not the portal export. It
ran when a human ran it. The only copy of the ledger off the broker's file was
Fly's daily volume snapshot on 5-day retention, and the A&P ledger had already
lost its pre-2026-07-29 rows once when the seat was rebuilt on a new volume.

WHAT THIS DOES, per seat, once a day:

  1. Pulls the full ``audit_export`` over the ADR-0043 runtime-read seam.
  2. Runs ``verify_chain`` over it (internal consistency).
  3. Requires the newest head the console pinned from a heartbeat
     (``audit_head_history``, migration 0108) to still appear in that export.
     That is the only check that can see tail truncation; see
     ``bin/lib/chain_pin.py`` for why, with the falsification that proves it.
  4. Copies the export to R2 under ``audit/<slug>/<date>.json.gz`` and records
     the object key and its sha256 in the run summary.
  5. Writes an ``audit_integrity`` row into ``cost_anomaly_alerts`` on any
     finding, so it lands on the same dashboard banner and the same alert-sink
     notifier as every other observability source.

TRI-STATE, AND A HOLD IS LOUD (#2395, the control-probes contract):

  0  clean   -- every seat evaluated, every chain intact, every pin descended
  1  finding -- at least one seat's record does not hold up. Alert row written.
  2  hold    -- at least one seat could not be evaluated at all.

A hold files no alert row -- an instrument failure is not a finding about a
client's records -- and it still fails the run, because a control that reports
green after asking nothing is indistinguishable from a healthy one. That is how
the send reconciler sat inert for weeks with its secrets unset.

NO PIN IS A HOLD, NOT A PASS. Until the heartbeat carries ``audit_head``
(ss#2498) and a seat has beaten at least once since, there is nothing to compare
against, and this run proves only that the export is self-consistent -- which is
precisely the property already shown insufficient. Reporting that as clean would
re-tell the lie this issue exists to end.

WHAT IT STILL CANNOT PROVE. A pin protects rows OLDER than the pin. Rows written
after the last heartbeat are unpinned and root can still remove them unnoticed
until the next beat. And a forged row appended with a correct hash descends from
the pin like any real one. Both are stated on the client-facing pages rather
than papered over; per-row signing was considered and rejected (ADR 0074).
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional, Sequence

_HERE = Path(__file__).resolve()
_OPERATOR = _HERE.parents[1]
_REPO = _HERE.parents[2]
sys.path.insert(0, str(_OPERATOR))
sys.path.insert(0, str(_OPERATOR / "workspace_broker"))

from bin.lib.chain_pin import (  # noqa: E402
    PIN_ABSENT,
    PIN_MALFORMED,
    PIN_NOT_SUPPLIED,
    check_pinned_head,
)
from bin.lib.seam_pull import seam_client_from_env  # noqa: E402
from chain import verify_chain  # noqa: E402

EXIT_CLEAN = 0
EXIT_FINDING = 1
EXIT_HOLD = 2

CLEAN = "clean"
FINDING = "finding"
HOLD = "hold"

#: The alert row's driver. Per SEAT, not per entity: several seats can share one
#: entity and the alert PK is (entity_id, alert_date, driver), so a bare
#: 'audit_chain' would let one seat's finding overwrite another's on the same
#: day. It also cannot collide with the healthchecks writer, which uses ''.
ALERT_DRIVER_PREFIX = "audit_chain:"

DEFAULT_DB = "ss-console-db"
DEFAULT_BUCKET = "smd-audit-archive"


# ---------------------------------------------------------------------------
# Verdict (pure -- the part worth unit testing)
# ---------------------------------------------------------------------------


@dataclass
class SeatOutcome:
    slug: str
    state: str
    headline: str
    details: dict = field(default_factory=dict)

    @property
    def is_finding(self) -> bool:
        return self.state == FINDING


def evaluate_export(slug: str, rows: Sequence[dict], pin: Optional[dict]) -> SeatOutcome:
    """Turn one export plus one pin row into a verdict.

    ``pin`` is the newest ``audit_head_history`` row for this seat, or None.

    Order matters. A broken chain is reported before a missing pin, because a
    chain that does not verify is a finding no pin could rescue; and a malformed
    pin is a hold rather than a finding, because the fault is ours.
    """
    report = verify_chain(rows)
    pinned_head = (pin or {}).get("audit_head")
    pin_check = check_pinned_head(rows, pinned_head=pinned_head, current_head=report["head"])

    details: dict[str, Any] = {
        "slug": slug,
        "rows_in_export": len(rows),
        "chained": report["chained"],
        "legacy": report["legacy"],
        "head": report["head"],
        "pinned_head": pinned_head,
        "pin_verdict": pin_check["verdict"],
        "pin_first_seen": (pin or {}).get("first_seen_heartbeat_ts"),
        "pin_last_seen": (pin or {}).get("last_seen_heartbeat_ts"),
    }

    if not report["ok"]:
        details["breaks"] = report["breaks"][:20]
        return SeatOutcome(
            slug,
            FINDING,
            f"{slug}: the hash chain does not verify ({len(report['breaks'])} break(s)).",
            details,
        )

    if pin_check["verdict"] == PIN_NOT_SUPPLIED:
        return SeatOutcome(
            slug,
            HOLD,
            f"{slug}: no head has been pinned off the Machine yet, so the tail is unchecked.",
            details,
        )

    if pin_check["verdict"] == PIN_MALFORMED:
        return SeatOutcome(
            slug,
            HOLD,
            f"{slug}: the stored pin is not a sha256 hexdigest; that is a broken "
            "instrument, not a finding about the ledger.",
            details,
        )

    if pin_check["verdict"] == PIN_ABSENT:
        details["reason"] = pin_check["reason"]
        return SeatOutcome(
            slug,
            FINDING,
            f"{slug}: a head this console pinned is gone from the export. "
            "The ledger was truncated, rewritten, or rolled back.",
            details,
        )

    shrink = _row_count_shrink(pin, len(rows))
    if shrink is not None:
        details["reason"] = shrink
        return SeatOutcome(slug, FINDING, f"{slug}: {shrink}", details)

    return SeatOutcome(
        slug,
        CLEAN,
        f"{slug}: chain intact, {report['chained']} chained rows, pin {pin_check['verdict']}.",
        details,
    )


def _row_count_shrink(pin: Optional[dict], rows_now: int) -> Optional[str]:
    """A second, independent signal: the ledger got SMALLER than a pin recorded.

    Weaker than the head check and kept anyway, because it costs one comparison
    and it survives the one case the head check does not -- a rewrite that ends
    on a head which happens to have been pinned before. Absent counts are
    skipped rather than treated as zero; counting a NULL as zero is how a
    fill-rate audit passes an all-zero column.
    """
    pinned_rows = (pin or {}).get("audit_rows")
    if not isinstance(pinned_rows, int) or isinstance(pinned_rows, bool):
        return None
    if pinned_rows <= rows_now:
        return None
    return (
        f"the export holds {rows_now} rows but a pinned heartbeat recorded "
        f"{pinned_rows}; the ledger shrank by {pinned_rows - rows_now}."
    )


# ---------------------------------------------------------------------------
# Seat enumeration
# ---------------------------------------------------------------------------


def authored_seats(repo_root: Path) -> list[str]:
    """Every seat main authors a customer.yaml for. Template dirs are skipped."""
    base = repo_root / "operator" / "customers"
    if not base.is_dir():
        return []
    return sorted(
        d.name
        for d in base.iterdir()
        if d.is_dir() and not d.name.startswith("_") and (d / "customer.yaml").exists()
    )


# ---------------------------------------------------------------------------
# Console D1 (through wrangler, the pattern the other CI reconcilers use)
# ---------------------------------------------------------------------------

Runner = Callable[[Sequence[str]], "subprocess.CompletedProcess[str]"]


def _run(cmd: Sequence[str]) -> "subprocess.CompletedProcess[str]":
    return subprocess.run(list(cmd), capture_output=True, text=True, check=False)


def sql_text(value: Optional[str]) -> str:
    """A TEXT literal that cannot be escaped out of, whatever the value contains.

    `wrangler d1 execute` takes `--command` and `--file` and NOTHING ELSE --
    checked against the installed CLI's own `--help`, not assumed -- so there is
    no parameter binding on this path and every value has to be inlined. Quote
    doubling is the usual answer and it is the wrong one here: part of what gets
    inlined is break text lifted out of a seat's own export, which is exactly
    the untrusted input an injection needs, and a control that could be made to
    rewrite the alerts table by a compromised seat would be worse than no
    control.

    A blob literal has no escape sequences to get wrong: every byte is two hex
    characters and the literal terminates at a fixed length. Cast back to TEXT
    on the way in so the column holds a string, not a blob.
    """
    if value is None:
        return "NULL"
    return f"CAST(x'{value.encode('utf-8').hex()}' AS TEXT)"


def sql_int(value: int) -> str:
    """An INTEGER literal. Typed, so a non-int raises here rather than inlining."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"sql_int refuses a non-integer: {value!r}")
    return str(value)


class ConsoleD1:
    """Read pins and write alert rows through ``npx wrangler d1 execute``.

    Same access path as ci-reconcile-customer-configs.sh, deliberately: one
    credential shape (CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID) for every
    console-side CI job, and no second D1 client to keep in step with the first.
    """

    def __init__(self, db: str = DEFAULT_DB, runner: Runner = _run) -> None:
        self._db = db
        self._run = runner

    def execute(self, sql: str) -> list[dict]:
        proc = self._run(
            ["npx", "wrangler", "d1", "execute", self._db, "--remote", "--json", "--command", sql]
        )
        if proc.returncode != 0:
            raise RuntimeError(f"d1 execute failed: {proc.stderr.strip() or proc.stdout.strip()}")
        return first_result_set(proc.stdout)

    def newest_pin(self, slug: str) -> Optional[dict]:
        sql = (
            "SELECT audit_head, audit_rows, first_seen_heartbeat_ts, last_seen_heartbeat_ts "
            f"FROM audit_head_history WHERE customer_slug = {sql_text(slug)} "
            "ORDER BY id DESC LIMIT 1"
        )
        # See sql_text for why an inlined literal is the safe form here.
        # nosemgrep: python.lang.security.audit.formatted-sql-query.formatted-sql-query,python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query
        rows = self.execute(sql)
        return rows[0] if rows else None

    def entity_id(self, slug: str) -> Optional[str]:
        # nosemgrep: python.lang.security.audit.formatted-sql-query.formatted-sql-query — see sql_text: no parameter binding exists on this CLI path; the interpolated text is a hex blob literal.
        # nosemgrep: python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query — not SQLAlchemy; the only interpolation is sql_text's fixed-alphabet hex literal.
        sql = f"SELECT entity_id FROM customer_configs WHERE customer_slug = {sql_text(slug)}"
        # See sql_text: wrangler d1 execute has no parameter binding (checked
        # against the installed CLI's own --help), and sql_text emits a hex blob
        # literal, which carries no escape sequence to break out of.
        # nosemgrep: python.lang.security.audit.formatted-sql-query.formatted-sql-query,python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query
        rows = self.execute(sql)
        return rows[0].get("entity_id") if rows else None

    def write_alert(self, *, entity_id: str, slug: str, summary: str, details: dict) -> None:
        """One ``audit_integrity`` row on the shared alert sink.

        Existing snooze / acknowledged columns are left alone: this control
        never undoes a Captain action on a row it wrote yesterday.
        """
        values = ", ".join(
            [
                sql_text(entity_id),
                sql_text(slug),
                sql_text(utc_date()),
                sql_text(f"{ALERT_DRIVER_PREFIX}{slug}"),
                "'audit_integrity'",
                sql_int(0),
                sql_int(0),
                sql_int(0),
                sql_int(0),
                sql_text(summary),
                sql_text(json.dumps(details, sort_keys=True)),
                "datetime('now')",
            ]
        )
        # Every interpolated value came through sql_text / sql_int above, so the
        # only thing reaching the statement is a hex blob literal or a bare
        # integer. That matters here more than anywhere else in this file: part
        # of `details` is break text lifted out of a seat's own export, which is
        # precisely the untrusted input an injection needs.
        # nosemgrep: python.lang.security.audit.formatted-sql-query.formatted-sql-query,python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query
        self.execute(
            "INSERT INTO cost_anomaly_alerts ("
            "entity_id, customer_slug, alert_date, driver, source, "
            "daily_cents, rolling_avg_cents, ratio_bps, threshold_bps, "
            "summary, details_json, detected_at"
            f") VALUES ({values}) "
            "ON CONFLICT(entity_id, alert_date, driver) DO UPDATE SET "
            "summary = excluded.summary, details_json = excluded.details_json, "
            "detected_at = excluded.detected_at"
        )


def first_result_set(stdout: str) -> list[dict]:
    """Pull the rows out of wrangler's --json envelope.

    Parsed, never assumed: wrangler prints a list of result objects for a
    multi-statement command and has also printed a bare object, so both are
    handled and anything else RAISES. Returning [] on an unrecognized envelope
    would read as "no pin recorded", which is the one wrong answer that turns
    into a HOLD nobody investigates.
    """
    payload = json.loads(stdout)
    if isinstance(payload, list):
        payload = payload[0] if payload else {}
    if not isinstance(payload, dict):
        raise RuntimeError("d1 execute returned an unrecognized envelope")
    results = payload.get("results")
    if results is None:
        return []
    if not isinstance(results, list):
        raise RuntimeError("d1 execute returned a non-list results field")
    return [r for r in results if isinstance(r, dict)]


def utc_date() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# R2 archive
# ---------------------------------------------------------------------------


def r2_credentials() -> tuple[str, str, str]:
    """Derive the S3 credentials exactly as ci-reconcile-r2-customer-configs.sh does.

    Derive, never mint, and never print: the values reach the aws CLI through
    its environment, never through a command line or a log line.
    """
    key_id = os.environ.get("R2_ACCESS_KEY_ID")
    secret = os.environ.get("R2_SECRET_ACCESS_KEY")
    if not key_id or not secret:
        token = os.environ.get("CLOUDFLARE_API_TOKEN")
        if not token:
            raise RuntimeError("no R2 credentials and no CLOUDFLARE_API_TOKEN to derive them from")
        key_id = cloudflare_token_id(token)
        secret = hashlib.sha256(token.encode("utf-8")).hexdigest()
    endpoint = os.environ.get("R2_ENDPOINT_URL")
    if not endpoint:
        account = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
        if not account:
            raise RuntimeError("R2_ENDPOINT_URL unset and CLOUDFLARE_ACCOUNT_ID not available")
        endpoint = f"https://{account}.r2.cloudflarestorage.com"
    return key_id, secret, endpoint


def cloudflare_token_id(token: str) -> str:
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/user/tokens/verify",
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected — constant https URL, no interpolation.
    with urllib.request.urlopen(req, timeout=20) as resp:  # noqa: S310 — constant https URL
        payload = json.loads(resp.read().decode("utf-8"))
    token_id = (payload.get("result") or {}).get("id")
    if not payload.get("success") or not token_id:
        raise RuntimeError("/user/tokens/verify did not return a token id")
    return str(token_id)


@dataclass
class ArchiveResult:
    key: str
    sha256: str
    bytes_written: int


def _aws_upload(local: Path, destination: str) -> None:
    key_id, secret, endpoint = r2_credentials()
    proc = subprocess.run(
        [
            "aws", "s3", "cp", str(local), destination,
            "--endpoint-url", endpoint, "--only-show-errors",
        ],
        capture_output=True,
        text=True,
        check=False,
        env=dict(os.environ, AWS_ACCESS_KEY_ID=key_id, AWS_SECRET_ACCESS_KEY=secret),
    )
    if proc.returncode != 0:
        raise RuntimeError(f"R2 upload failed for {destination}: {proc.stderr.strip()}")


Uploader = Callable[[Path, str], None]


def archive_export(
    slug: str,
    rows: Sequence[dict],
    *,
    bucket: str,
    uploader: Uploader = _aws_upload,
    work_dir: Optional[Path] = None,
) -> ArchiveResult:
    """Write one gzipped export to ``audit/<slug>/<date>.json.gz``.

    The sha256 is taken over the GZIPPED BYTES that are uploaded, not over the
    JSON, so the recorded digest is one an auditor reproduces by hashing the
    downloaded object with no knowledge of our serialization. ``mtime=0`` so two
    identical exports produce identical bytes; a gzip header timestamp would
    make every archive's digest unique for no reason and defeat that.
    """
    key = f"audit/{slug}/{utc_date()}.json.gz"
    tmp_dir = Path(work_dir) if work_dir else Path(tempfile.mkdtemp(prefix="audit-archive-"))
    tmp_dir.mkdir(parents=True, exist_ok=True)
    local = tmp_dir / f"{slug}.json.gz"

    payload = json.dumps({"slug": slug, "entries": list(rows)}, sort_keys=True).encode("utf-8")
    blob = gzip.compress(payload, mtime=0)
    local.write_bytes(blob)

    uploader(local, f"s3://{bucket}/{key}")
    return ArchiveResult(key=key, sha256=hashlib.sha256(blob).hexdigest(), bytes_written=len(blob))


def probe_bucket_lock(bucket: str, *, runner: Runner = _run) -> tuple[bool, str]:
    """Is the archive prefix actually immutable?

    An off-box copy on a bucket anyone can delete from is a backup, not a
    compliance record, and calling this control done without asking would be the
    built-but-not-wired shape exactly. So it is asked every run, and an
    unconfirmed lock is a HOLD.

    THE R2 SHAPE HERE IS UNVERIFIED and deliberately not guessed. There is no R2
    access from a build session, and Cloudflare's bucket-lock feature is not
    necessarily reachable through the S3 object-lock API this probes for. The
    probe reports what it got rather than assuming what it should get: whichever
    way the first live run answers is the shape, and the message says so.
    """
    proc = runner(["aws", "s3api", "get-object-lock-configuration", "--bucket", bucket])
    if proc.returncode == 0 and "ObjectLockEnabled" in (proc.stdout or ""):
        return True, f"Object lock is configured on s3://{bucket}."
    detail = (proc.stderr or proc.stdout or "").strip().splitlines()
    tail = detail[-1] if detail else "no output"
    return False, (
        f"Could not confirm object lock on s3://{bucket} ({tail}). The copy is being written to "
        "a prefix whose immutability is unproven, which makes it a backup and not a compliance "
        "record. Either configure a lock rule covering the audit/ prefix, or record here what "
        "the R2 API actually answers so this probe can ask the right question."
    )


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def _hold(slug: str, message: str) -> SeatOutcome:
    return SeatOutcome(slug, HOLD, f"{slug}: {message}", {"slug": slug})


def process_seat(slug: str, console: ConsoleD1, *, bucket: str, archive: bool) -> SeatOutcome:
    client = seam_client_from_env(slug)
    if client is None:
        return _hold(slug, "the runtime-read seam is not configured (no secret or no URL).")
    try:
        rows = client.read_all("audit_export")
    except Exception as exc:  # noqa: BLE001 -- any transport failure is a hold
        return _hold(slug, f"the audit export could not be pulled ({type(exc).__name__}: {exc}).")

    try:
        pin = console.newest_pin(slug)
    except Exception as exc:  # noqa: BLE001
        return _hold(slug, f"the pinned head could not be read from D1 ({exc}).")

    outcome = evaluate_export(slug, rows, pin)
    if not archive:
        return outcome

    try:
        result = archive_export(slug, rows, bucket=bucket)
    except Exception as exc:  # noqa: BLE001
        # The copy is half the issue, so failing to write it is a hold on its
        # own. It must not DOWNGRADE a finding that was already found, though:
        # a truncated ledger stays the headline and carries the note.
        outcome.details["archive_error"] = str(exc)
        if outcome.state == CLEAN:
            return _hold(slug, f"the off-box copy could not be written ({exc}).")
        return outcome

    outcome.details["archive_key"] = result.key
    outcome.details["archive_sha256"] = result.sha256
    outcome.details["archive_bytes"] = result.bytes_written
    return outcome


def emit_alert(console: ConsoleD1, outcome: SeatOutcome) -> Optional[str]:
    """Write the finding to the shared sink. Returns a hold message on failure."""
    try:
        entity = console.entity_id(outcome.slug)
        if not entity:
            return f"{outcome.slug}: no customer_configs row, so no alert row could be written."
        console.write_alert(
            entity_id=entity,
            slug=outcome.slug,
            summary=outcome.headline,
            details=outcome.details,
        )
    except Exception as exc:  # noqa: BLE001
        return f"{outcome.slug}: the alert row could not be written ({exc})."
    return None


def summary_lines(outcomes: Sequence[SeatOutcome], lock_note: str) -> list[str]:
    lines = ["", "-- audit chain watch summary --"]
    for o in outcomes:
        lines.append(f"{o.state.upper():>7}  {o.headline}")
        key = o.details.get("archive_key")
        if key:
            lines.append(f"         archive {key} sha256 {o.details['archive_sha256']}")
    lines += ["", lock_note]
    return lines


def write_step_summary(outcomes: Sequence[SeatOutcome], lock_note: str) -> None:
    """The object key and sha256 the issue asks to be recorded in the run summary."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    lines = [
        "### Audit chain watch",
        "",
        "| seat | state | archive key | sha256 |",
        "|---|---|---|---|",
    ]
    for o in outcomes:
        lines.append(
            f"| {o.slug} | {o.state} | {o.details.get('archive_key', '-')} | "
            f"{o.details.get('archive_sha256', '-')} |"
        )
    lines += ["", lock_note, ""]
    with open(path, "a", encoding="utf-8") as fp:
        fp.write("\n".join(lines) + "\n")


def resolve_exit(
    outcomes: Sequence[SeatOutcome], alert_holds: Sequence[str], lock_ok: bool
) -> int:
    """A finding outranks a hold; either outranks clean.

    A finding outranks because it is the louder fact and it is already written
    to the alert sink. A hold still fails the run through the workflow's final
    step, which fires on any non-zero exit, so nothing is swallowed.
    """
    if any(o.is_finding for o in outcomes):
        return EXIT_FINDING
    if alert_holds or not lock_ok or any(o.state == HOLD for o in outcomes):
        return EXIT_HOLD
    return EXIT_CLEAN


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seat", action="append", help="Limit to one seat (repeatable)")
    ap.add_argument("--db", default=os.environ.get("D1_DATABASE", DEFAULT_DB))
    ap.add_argument("--bucket", default=os.environ.get("R2_BUCKET_AUDIT", DEFAULT_BUCKET))
    ap.add_argument(
        "--no-archive",
        action="store_true",
        help="Verify only; do not write the off-box copy. For a manual re-check.",
    )
    args = ap.parse_args(argv)

    seats = args.seat or authored_seats(_REPO)
    if not seats:
        print("HOLD: no authored seats found; this run measured nothing.")
        return EXIT_HOLD

    console = ConsoleD1(db=args.db)
    archive = not args.no_archive
    if archive:
        lock_ok, lock_note = probe_bucket_lock(args.bucket)
    else:
        lock_ok, lock_note = True, "Off-box copy skipped (--no-archive); no lock probe was run."

    outcomes = [process_seat(s, console, bucket=args.bucket, archive=archive) for s in seats]

    alert_holds: list[str] = []
    for outcome in outcomes:
        if outcome.is_finding:
            problem = emit_alert(console, outcome)
            if problem:
                alert_holds.append(problem)

    for line in summary_lines(outcomes, lock_note):
        print(line)
    for line in alert_holds:
        print(f"HOLD  {line}")

    write_step_summary(outcomes, lock_note)
    return resolve_exit(outcomes, alert_holds, lock_ok)


if __name__ == "__main__":
    raise SystemExit(main())
