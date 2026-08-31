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
  4. Copies the export to R2 under
     ``audit/<slug>/<date>/<HHMMSS>Z-<head12>.json.gz`` and records the object
     key and its sha256 in the run summary. The key is unique per RUN, not per
     day: the ``audit/`` prefix is object-locked for seven years, so a key that
     repeats inside that window cannot be written twice. See ``archive_key``.
  5. Writes an ``audit_integrity`` row into ``cost_anomaly_alerts`` on any
     finding, so it lands on the same dashboard banner and the same alert-sink
     notifier as every other observability source.

WHICH SEATS. The authority for a seat existing is the console's ``fleet_status``
table (ADR 0043 B), not the presence of a ``customer.yaml``. Those two answers
differ: pilot-law has been authored and unprovisioned since 2026-06-05, and
enumerating from the filesystem made the first live run red forever on a
connection error to a machine that was never stood up. Seats are the
intersection, and BOTH differences are named in the report rather than filtered
away -- authored-but-not-provisioned as a SKIP so the denominator stays visible
(#2366), provisioned-but-not-authored as a HOLD, because that direction means a
live seat's ledger is outside this control's reach.

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
import re
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
#: The wrangler-backed D1 client moved verbatim to bin/lib/console_d1.py when
#: the cron-slot watchdog became its second consumer (same behavior, one
#: client). Re-exported here so tests and callers read unchanged.
from bin.lib.console_d1 import (  # noqa: E402
    ALERT_DRIVER_PREFIX,  # noqa: F401 — re-export
    DEFAULT_DB,
    ConsoleD1,
    Runner,  # noqa: F401 — re-export
    first_result_set,  # noqa: F401 — re-export (tests pin the envelope parse)
    sql_int,  # noqa: F401 — re-export (tests pin the literal forms)
    sql_text,  # noqa: F401 — re-export
    utc_date,  # noqa: F401 — re-export
    utc_now,
)
from bin.lib.seam_pull import seam_client_from_env  # noqa: E402
from chain import verify_chain  # noqa: E402

EXIT_CLEAN = 0
EXIT_FINDING = 1
EXIT_HOLD = 2

CLEAN = "clean"
FINDING = "finding"
HOLD = "hold"

#: Authored but never provisioned. Named in the report so the denominator stays
#: visible (#2366: a skipped seat must never be silent), and not a hold, because
#: a seat that does not exist has no audit record to be wrong about.
SKIP = "skip"

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


@dataclass
class SeatRoster:
    """Which authored seats actually exist, and both directions of the drift."""

    probed: list[str]
    skipped: list[str]
    orphaned: list[str]


def partition_seats(authored: Sequence[str], provisioned: Sequence[str]) -> SeatRoster:
    """Intersect the authored dirs with the seats the console knows are running.

    ``operator/customers/*/customer.yaml`` answers "what has someone written a
    config for", which is not the same question as "what seats exist". The
    pilot-law directory has sat authored and unprovisioned since 2026-06-05 with
    no Fly app behind it, so enumerating from the filesystem made the first live
    run red forever on a URLError for a machine that was never stood up -- an
    alarm that is always ringing is one nobody hears.

    ``fleet_status`` is the authority for a seat existing (ADR 0043 B); this job
    already reads the console for pins. Both directions of the difference are
    reported rather than filtered away: a seat authored but not provisioned is a
    SKIP with its name in the summary, and a seat in fleet_status with no
    authored config is a HOLD, because that drift means this control cannot see
    a live seat's ledger at all.
    """
    live = {s for s in provisioned if s}
    authored_set = {s for s in authored if s}
    return SeatRoster(
        probed=sorted(authored_set & live),
        skipped=sorted(authored_set - live),
        orphaned=sorted(live - authored_set),
    )




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


#: The slot the key carries when an export has no chained row to name a tip.
NO_HEAD = "nohead"


def archive_key(slug: str, head: Optional[str], *, now: Optional[datetime] = None) -> str:
    """``audit/<slug>/<YYYY-MM-DD>/<HHMMSS>Z-<head12>.json.gz`` -- unique per RUN.

    The key was ``audit/<slug>/<date>.json.gz`` until 2026-08-21, when the
    second run of a UTC day proved that shape unwritable. The ``audit-7y``
    bucket lock covers the ``audit/`` prefix for seven years, so the 08:00Z
    run's object could not be overwritten at 13:39Z: ``PutObject ...
    ObjectLockedByBucketPolicy``. Correct refusal, wrong key. Every re-run --
    including the workflow_dispatch a person reaches for precisely when they
    want a second look -- turned into a HOLD on every seat, and the hold
    replaced chain verdicts that were in fact clean. An immutable prefix and a
    key that repeats inside its retention window cannot both be right.

    The date is a path SEGMENT so a day's copies list together, and the first
    12 characters of the chain head ride in the name so a reader can see which
    tip a copy carries without downloading and un-gzipping it. An export with
    no chained rows has no tip to name and gets ``nohead``.
    """
    stamp = (now or utc_now()).strftime("%Y-%m-%d/%H%M%SZ")
    tip = (head or "")[:12] or NO_HEAD
    return f"audit/{slug}/{stamp}-{tip}.json.gz"


def archive_export(
    slug: str,
    rows: Sequence[dict],
    *,
    bucket: str,
    uploader: Uploader = _aws_upload,
    work_dir: Optional[Path] = None,
    head: Optional[str] = None,
    now: Optional[datetime] = None,
) -> ArchiveResult:
    """Write one gzipped export to the key ``archive_key`` builds.

    ``head`` is the chain tip the caller already verified; when it is not
    supplied it is recomputed here, so this function names the right tip no
    matter who calls it.

    The sha256 is taken over the GZIPPED BYTES that are uploaded, not over the
    JSON, so the recorded digest is one an auditor reproduces by hashing the
    downloaded object with no knowledge of our serialization. ``mtime=0`` so two
    identical exports produce identical bytes; a gzip header timestamp would
    make every archive's digest unique for no reason and defeat that.
    """
    tip = head if head is not None else verify_chain(rows)["head"]
    key = archive_key(slug, tip, now=now)
    tmp_dir = Path(work_dir) if work_dir else Path(tempfile.mkdtemp(prefix="audit-archive-"))
    tmp_dir.mkdir(parents=True, exist_ok=True)
    local = tmp_dir / f"{slug}.json.gz"

    payload = json.dumps({"slug": slug, "entries": list(rows)}, sort_keys=True).encode("utf-8")
    blob = gzip.compress(payload, mtime=0)
    local.write_bytes(blob)

    uploader(local, f"s3://{bucket}/{key}")
    return ArchiveResult(key=key, sha256=hashlib.sha256(blob).hexdigest(), bytes_written=len(blob))


#: Seven years, the retention the service agreement commits the record to.
LOCK_MIN_SECONDS = 2555 * 86400

#: The prefix every archived export is written under (see ``archive_export``).
ARCHIVE_PREFIX = "audit/"

#: Account ids are 32 hex characters and bucket names are lowercase DNS labels.
#: Nothing else is ever interpolated into an api.cloudflare.com URL.
_URL_SEGMENT = re.compile(r"\A[a-zA-Z0-9][a-zA-Z0-9-]{1,62}\Z")


def bucket_lock_url(account: str, bucket: str) -> str:
    """The bucket-lock endpoint, built only from values that pass the charset gate."""
    for label, value in (("CLOUDFLARE_ACCOUNT_ID", account), ("bucket name", bucket)):
        if not _URL_SEGMENT.match(value or ""):
            raise RuntimeError(f"refusing to build a Cloudflare API URL from an unsafe {label}")
    return f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/{bucket}/lock"


def _cf_get_lock(url: str) -> dict:
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not token:
        raise RuntimeError("CLOUDFLARE_API_TOKEN is unset, so the bucket lock cannot be read")
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}"}, method="GET"
    )
    # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected — bucket_lock_url is the only builder and it gates both interpolated segments on a fixed charset.
    with urllib.request.urlopen(req, timeout=20) as resp:  # noqa: S310 — https, charset-gated
        return json.loads(resp.read().decode("utf-8"))


LockFetcher = Callable[[str], dict]


def probe_bucket_lock(bucket: str, *, fetch: LockFetcher = _cf_get_lock) -> tuple[bool, str]:
    """Is the archive prefix actually immutable?

    An off-box copy on a bucket anyone can delete from is a backup, not a
    compliance record, and calling this control done without asking would be the
    built-but-not-wired shape exactly. So it is asked every run, and an
    unconfirmed lock is a HOLD.

    ASKED OF THE RIGHT API. The first live run asked S3
    ``get-object-lock-configuration`` and got
    ``ObjectLockConfigurationNotFoundError`` even with derived credentials and
    the R2 endpoint: R2's bucket-lock feature is NOT surfaced through the S3
    object-lock API. It is its own Cloudflare API resource, and this is the
    shape it answered with on 2026-08-21::

        {"success": true, "result": {"rules": [
          {"id": "audit-7y", "enabled": true, "prefix": "audit/",
           "condition": {"type": "Age", "maxAgeSeconds": 220752000}}]}}

    Confirmed means at least one rule that is enabled, whose prefix COVERS the
    archive prefix (``audit/`` starts with it, so a narrower per-seat rule does
    not count), and whose condition holds the record for at least seven years.
    ``Age`` is the observed condition shape; ``Indefinite`` carries no fields;
    ``Date``'s field name is documented nowhere we could reach, so an
    unrecognized ``Date`` payload fails CLOSED with the raw condition in the
    message rather than being read charitably.
    """
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    try:
        payload = fetch(bucket_lock_url(account, bucket))
    except Exception as exc:  # noqa: BLE001 -- any transport or auth failure is a hold
        return False, _lock_unproven(bucket, f"{type(exc).__name__}: {exc}")
    return evaluate_lock_payload(bucket, payload)


def evaluate_lock_payload(bucket: str, payload: Any) -> tuple[bool, str]:
    """Turn one bucket-lock API body into a verdict. Pure -- this is what tests drive."""
    if not isinstance(payload, dict):
        return False, _lock_unproven(bucket, "the API returned something that is not a JSON object")
    if payload.get("success") is not True:
        errors = json.dumps(payload.get("errors"), sort_keys=True)
        return False, _lock_unproven(bucket, f"the API answered success=false, errors={errors}")

    rules = (payload.get("result") or {}).get("rules")
    if rules is None:
        rules = []
    if not isinstance(rules, list):
        return False, _lock_unproven(bucket, "the API returned a non-list rules field")
    if not rules:
        return False, _lock_unproven(bucket, "the bucket has no lock rules at all")

    rejected: list[str] = []
    for rule in rules:
        covers, why = _rule_covers_archive(rule)
        if covers:
            rule_id = rule.get("id") if isinstance(rule, dict) else None
            return True, (
                f"Bucket lock rule {rule_id!r} covers {ARCHIVE_PREFIX} on {bucket}: {why}."
            )
        rejected.append(why)
    return False, _lock_unproven(bucket, "; ".join(rejected))


def _rule_covers_archive(rule: Any) -> tuple[bool, str]:
    """Does this one rule hold every archived object for the full retention?"""
    if not isinstance(rule, dict):
        return False, "a rule that is not an object"
    rule_id = rule.get("id")
    if rule.get("enabled") is not True:
        return False, f"rule {rule_id!r} is not enabled"

    prefix = rule.get("prefix") or ""
    if not isinstance(prefix, str) or not ARCHIVE_PREFIX.startswith(prefix):
        return False, f"rule {rule_id!r} covers {prefix!r}, which does not cover {ARCHIVE_PREFIX!r}"

    condition = rule.get("condition")
    if not isinstance(condition, dict):
        return False, f"rule {rule_id!r} has no condition object"
    kind = condition.get("type")

    if kind == "Indefinite":
        return True, "retained indefinitely"

    if kind == "Age":
        seconds = condition.get("maxAgeSeconds")
        if isinstance(seconds, bool) or not isinstance(seconds, int):
            return False, f"rule {rule_id!r} has a non-integer maxAgeSeconds"
        if seconds < LOCK_MIN_SECONDS:
            return False, (
                f"rule {rule_id!r} retains for {seconds}s, short of the "
                f"{LOCK_MIN_SECONDS}s the record is committed to"
            )
        return True, f"retained for {seconds}s"

    if kind == "Date":
        raw = condition.get("date")
        parsed = _parse_lock_date(raw)
        if parsed is None:
            return False, (
                f"rule {rule_id!r} has a Date condition this probe cannot read "
                f"({json.dumps(condition, sort_keys=True, default=str)})"
            )
        if parsed <= datetime.now(timezone.utc):
            return False, f"rule {rule_id!r} retains only until {raw}, which has passed"
        return True, f"retained until {raw}"

    return False, f"rule {rule_id!r} has an unrecognized condition type {kind!r}"


def _parse_lock_date(raw: Any) -> Optional[datetime]:
    if not isinstance(raw, str) or not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _lock_unproven(bucket: str, detail: str) -> str:
    return (
        f"Could not confirm a bucket lock covering {ARCHIVE_PREFIX} on {bucket} ({detail}). "
        "The copy is being written to a prefix whose immutability is unproven, which makes it "
        "a backup and not a compliance record."
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
        result = archive_export(slug, rows, bucket=bucket, head=outcome.details.get("head"))
    except Exception as exc:  # noqa: BLE001
        # The copy is half the issue, so failing to write it is a hold on its
        # own. It must not DOWNGRADE a finding that was already found, though:
        # a truncated ledger stays the headline and carries the note.
        #
        # And it must never HIDE the verdict. Verify first, archive second is
        # already the order here, but on 2026-08-21 the hold REPLACED the
        # outcome, so a run that had just proven ashton-price's chain intact
        # over 1,585 rows said only that an upload failed. The verdict is
        # carried on the hold and reported ahead of it.
        outcome.details["archive_error"] = str(exc)
        if outcome.state == CLEAN:
            held = _hold(slug, f"the off-box copy could not be written ({exc}).")
            held.details = dict(outcome.details)
            held.details["chain_verdict"] = {
                "state": outcome.state,
                "headline": outcome.headline,
            }
            return held
        return outcome

    outcome.details["archive_key"] = result.key
    outcome.details["archive_sha256"] = result.sha256
    outcome.details["archive_bytes"] = result.bytes_written
    return outcome


def roster_notices(roster: SeatRoster) -> list[SeatOutcome]:
    """One reported line per seat the probe did NOT pull, in either direction."""
    notices = [
        SeatOutcome(
            slug,
            SKIP,
            f"{slug}: authored but never provisioned (no fleet_status row).",
            {"slug": slug},
        )
        for slug in roster.skipped
    ]
    notices += [
        SeatOutcome(
            slug,
            HOLD,
            f"{slug}: a fleet_status row exists but no customer.yaml is authored for it, "
            "so this control cannot reach that seat's ledger.",
            {"slug": slug},
        )
        for slug in roster.orphaned
    ]
    return notices


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
        # The verdict first, then whatever happened to the copy. A ledger this
        # run verified gets said out loud even when the archive failed.
        verdict = o.details.get("chain_verdict")
        if verdict:
            lines.append(f"{str(verdict['state']).upper():>7}  {verdict['headline']}")
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
        verdict = o.details.get("chain_verdict")
        state = f"{o.state} (chain {verdict['state']})" if verdict else o.state
        lines.append(
            f"| {o.slug} | {state} | {o.details.get('archive_key', '-')} | "
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

    console = ConsoleD1(db=args.db)

    if args.seat:
        # An explicit --seat is a person naming what to look at; honour it
        # exactly, including a seat the console has no row for.
        roster = SeatRoster(probed=sorted(set(args.seat)), skipped=[], orphaned=[])
    else:
        authored = authored_seats(_REPO)
        if not authored:
            print("HOLD: no authored seats found; this run measured nothing.")
            return EXIT_HOLD
        try:
            provisioned = console.provisioned_slugs()
        except Exception as exc:  # noqa: BLE001
            print(f"HOLD: the seat roster could not be read from D1 ({exc}).")
            return EXIT_HOLD
        roster = partition_seats(authored, provisioned)

    if not roster.probed and not roster.orphaned:
        print("HOLD: no provisioned seat matched an authored config; this run measured nothing.")
        return EXIT_HOLD

    archive = not args.no_archive
    if archive:
        lock_ok, lock_note = probe_bucket_lock(args.bucket)
    else:
        lock_ok, lock_note = True, "Off-box copy skipped (--no-archive); no lock probe was run."

    outcomes = [
        process_seat(s, console, bucket=args.bucket, archive=archive) for s in roster.probed
    ]
    outcomes += roster_notices(roster)

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
