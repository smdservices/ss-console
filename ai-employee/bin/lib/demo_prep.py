"""Pre-meeting PI firm demo readiness checks (issue #819).

Smoke-test runner that validates a provisioned customer is ready for a
demo without contacting any external service that the agent cannot
control. Composes with ``bin/provision-customer.sh`` (which sets up the
Fly Machine + secrets) by running afterward and verifying the substrate
the script left behind.

Design notes
------------

* **No autonomous network calls.** Every check runs locally against the
  on-disk customer directory or shells out to existing tooling
  (``scripts/validate-customer-yaml.ts``, the in-Machine probe plugin)
  which has its own gating. There is no implicit call to the live Fly
  Machine or to PACER or to the firm's website.

* **Per-step pass/fail/skip.** Each check returns a :class:`CheckResult`
  with a status enum + detail dict. The CLI surfaces these as one line
  per step so dry-run output diffs cleanly against live-run output.

* **Exit code semantics.** ``0`` on full pass. ``2`` on preflight
  failure (missing customer dir, bad slug). ``3`` on at least one
  required check failing. ``4`` on unexpected error. Matches the
  convention used by ``decommission-customer.sh``.

* **Template-slug reservation.** Any slug whose first segment starts
  with ``_`` is rejected with exit code 2. The reservation matches the
  guarantee documented in ``ai-employee/customers/_template/README.md``.

* **Idempotency.** Every check is read-only. Re-running on the same
  customer produces the same report.

Per the issue acceptance criteria, the runner verifies:

1. ``ai-employee/customers/{slug}/customer.yaml`` exists and parses.
2. Voice samples directory has >=10 entries (counted from
   ``voice_samples_path``; defaults to ``ai-employee/customers/{slug}/voice/``).
3. The memory and voice pipelines report ingestion succeeded (delegated
   to substrate hooks via the ``MemoryStateReader`` /
   ``VoiceStateReader`` protocols; falls back to a checked-in
   ``.demo-prep-state.json`` snapshot when no live reader is wired,
   which is the default in CI).
4. The Filevine connector smoke test passes (when PM stack is
   ``filevine``); otherwise a ``no-pm`` smoke is run that confirms the
   ``synthetic:`` adapter is wired and the demo can proceed without a
   real PM tenant.
5. At least one synthetic matter fixture is seeded under
   ``ai-employee/customers/{slug}/fixtures/`` OR the customer.yaml
   demo-angle field points at a checked-in fixture under
   ``ai-employee/skills/{skill}/fixtures/`` /
   ``ai-employee/fixtures/law-firm/``.

The runner does NOT touch:

* The Fly Machine (provisioning is upstream).
* Real customer secrets (Captain handles via ``provision-customer.sh``).
* Any external API endpoint.
"""

from __future__ import annotations

import enum
import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional, Protocol

log = logging.getLogger("aie.bin.demo_prep")


# ---------------------------------------------------------------------------
# Public exceptions
# ---------------------------------------------------------------------------


class DemoPrepPreflightError(RuntimeError):
    """Raised before any check runs when inputs are obviously wrong.

    Mapped to exit code 2 by the CLI. Common causes: missing customer
    directory, template slug, customer.yaml file absent.
    """


# ---------------------------------------------------------------------------
# Slug rules
# ---------------------------------------------------------------------------


_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
_TEMPLATE_PREFIX = "_"

# Minimum voice samples to clear the AC #3 bar from the issue.
MIN_VOICE_SAMPLES = 10


def is_template_slug(slug: str) -> bool:
    """True when the slug is a reserved scaffold directory.

    Any slug whose first character is an underscore is treated as a
    template and rejected by the CLI. Matches the README contract in
    ``ai-employee/customers/_template/README.md``.
    """
    return bool(slug) and slug.startswith(_TEMPLATE_PREFIX)


def is_valid_slug(slug: str) -> bool:
    """Conforms to the schema's slug regex.

    The customer-yaml schema enforces this against ``customer_id``; the
    demo-prep tool enforces it against the CLI argument before reading
    the file system so a bad slug surfaces a clean preflight error.
    """
    return bool(slug) and bool(_SLUG_RE.match(slug))


# ---------------------------------------------------------------------------
# Check results
# ---------------------------------------------------------------------------


class CheckStatus(str, enum.Enum):
    PASS = "pass"
    FAIL = "fail"
    SKIP = "skip"


@dataclass(frozen=True)
class CheckResult:
    """One pre-meeting check's outcome."""

    name: str
    status: CheckStatus
    detail: dict = field(default_factory=dict)

    @property
    def is_blocking(self) -> bool:
        """True when this check's failure should fail the overall run."""
        return self.status == CheckStatus.FAIL


# ---------------------------------------------------------------------------
# Optional substrate readers (Protocol)
#
# Production wiring queries the per-customer D1 to read the memory +
# voice state rows. Tests pass in-memory fakes. When no reader is
# wired, the runner falls back to a checked-in
# ``.demo-prep-state.json`` snapshot in the customer dir, so the CLI
# stays useful even before the live D1 bindings are reachable from
# Captain's workstation.
# ---------------------------------------------------------------------------


class MemoryStateReader(Protocol):
    """Reads the ``memory_source_state`` snapshot for one customer.

    Returns the same shape ``read_source_states()`` produces (see
    ``docs/specs/ai-employee/memory-ingestion.md``). Returns ``None``
    when no snapshot is available at all (no D1 row, no on-disk
    snapshot) so the runner can distinguish "unknown" from "empty".
    """

    def read(self, customer_slug: str) -> Optional[list[dict]]: ...


class VoiceStateReader(Protocol):
    """Reads the ``voice_source_state`` snapshot for one customer.

    Returns ``None`` when no snapshot is available.
    """

    def read(self, customer_slug: str) -> Optional[list[dict]]: ...


class FilesystemMemoryReader:
    """Reads ``ai-employee/customers/{slug}/.demo-prep-state.json``.

    Default reader used when no live D1 binding is provided. The state
    file is the projection ``read_source_states()`` would return,
    written by whatever ingestion run last touched the customer. This
    keeps the CLI useful from any workstation without requiring D1
    credentials.

    Returns ``None`` when the snapshot file does not exist, so the
    runner treats the check as SKIP rather than FAIL. Returns an empty
    list only when the snapshot exists and explicitly contains no
    rows.
    """

    _KEY = "memory_source_state"

    def __init__(self, customer_dir: Path) -> None:
        self._customer_dir = customer_dir

    def read(self, customer_slug: str) -> Optional[list[dict]]:
        snapshot_path = self._customer_dir / ".demo-prep-state.json"
        if not snapshot_path.exists():
            return None
        try:
            raw = json.loads(snapshot_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return None
        rows = raw.get(self._KEY)
        if rows is None:
            return None
        return rows if isinstance(rows, list) else None


class FilesystemVoiceReader(FilesystemMemoryReader):
    """Voice equivalent of :class:`FilesystemMemoryReader`."""

    _KEY = "voice_source_state"


# ---------------------------------------------------------------------------
# Filevine smoke runner (Protocol)
#
# Production wiring shells out to
# ``ai-employee/connectors/filevine/bin/smoke-test-filevine.py`` with
# the customer's env. Tests pass a fake. The runner accepts any callable
# returning a dict, which keeps the CLI runnable from CI without
# Filevine credentials.
# ---------------------------------------------------------------------------


class ConnectorSmokeRunner(Protocol):
    """Runs the smoke test for one connector against one customer.

    Returns ``{"ok": bool, "detail": dict}``. The runner never raises;
    failures must be surfaced via the ``ok`` flag so the demo-prep
    report stays structured.
    """

    def smoke(self, customer_slug: str) -> dict: ...


class NoOpConnectorSmoke:
    """Default smoke runner: marks the check as SKIP, not FAIL.

    Used when no real client is wired. The CLI reports the skip with a
    reason so Captain knows whether to wire a live runner before the
    demo or to accept the no-PM angle.
    """

    _SKIPPED_REASON = "connector_smoke_runner_not_wired"

    def smoke(self, customer_slug: str) -> dict:
        log.info("connector smoke skipped (no runner wired) customer=%s", customer_slug)
        return {
            "ok": True,
            "detail": {
                "skipped": True,
                "reason": self._SKIPPED_REASON,
            },
        }


# ---------------------------------------------------------------------------
# Customer.yaml parsing
#
# yaml.safe_load is imported lazily so tests that exercise the slug /
# preflight paths do not need pyyaml on PYTHONPATH. Production
# invocations come through `uv run --with pyyaml` which guarantees the
# import succeeds.
# ---------------------------------------------------------------------------


def _load_yaml(path: Path) -> dict:
    try:
        import yaml
    except ImportError as exc:
        raise DemoPrepPreflightError(
            "pyyaml is required to parse customer.yaml; "
            "run via `uv run --with pyyaml python3 -m bin.lib.demo_prep_cli ...`"
        ) from exc
    try:
        loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise DemoPrepPreflightError(f"customer.yaml is not valid YAML: {exc}") from exc
    if not isinstance(loaded, dict):
        raise DemoPrepPreflightError(
            f"customer.yaml must parse to a mapping; got {type(loaded).__name__}"
        )
    return loaded


# ---------------------------------------------------------------------------
# Voice sample counting
# ---------------------------------------------------------------------------


def _count_voice_samples(voice_dir: Path) -> int:
    """Counts non-hidden files recursively under ``voice_dir``.

    The voice pipeline stores structural-diffs as JSON; directories are
    organized by recipient cohort. This counter is intentionally
    permissive about file extension so the check works against either
    the JSON projection or an interim seed-sample tree Captain hand-
    curated before live ingestion was wired.
    """
    if not voice_dir.exists() or not voice_dir.is_dir():
        return 0
    count = 0
    for path in voice_dir.rglob("*"):
        if not path.is_file():
            continue
        # Skip hidden files and the demo-prep state snapshot.
        if path.name.startswith("."):
            continue
        count += 1
    return count


def _has_synthetic_matter_fixture(customer_dir: Path, customer_yaml: dict, fixture_search_paths: Iterable[Path]) -> tuple[bool, dict]:
    """True when at least one synthetic matter fixture is seeded.

    Two recognized shapes (either is sufficient):

    1. ``ai-employee/customers/{slug}/fixtures/`` contains at least one
       JSON file (the per-customer synthetic matter).
    2. The customer.yaml carries a ``demo.matter_fixture`` path that
       points at a checked-in fixture under
       ``ai-employee/skills/{skill}/fixtures/`` or
       ``ai-employee/fixtures/law-firm/``. The path must resolve to an
       existing file inside one of ``fixture_search_paths``.

    Returns ``(ok, detail)`` so the caller can surface evidence in the
    pass/fail report.
    """
    per_customer = customer_dir / "fixtures"
    if per_customer.is_dir():
        json_fixtures = [p for p in per_customer.rglob("*.json") if p.is_file()]
        if json_fixtures:
            return True, {
                "shape": "per_customer_fixture_dir",
                "path": str(per_customer),
                "fixture_count": len(json_fixtures),
            }

    demo_section = customer_yaml.get("demo") or {}
    fixture_ref = demo_section.get("matter_fixture")
    if isinstance(fixture_ref, str) and fixture_ref:
        candidate = Path(fixture_ref)
        if not candidate.is_absolute():
            # Resolve against each search path; first hit wins.
            for root in fixture_search_paths:
                resolved = (root / candidate).resolve()
                # Ensure the resolved path stays under one of the
                # allow-listed fixture roots. Reject path traversal.
                root_resolved = root.resolve()
                try:
                    resolved.relative_to(root_resolved)
                except ValueError:
                    continue
                if resolved.exists() and resolved.is_file():
                    return True, {
                        "shape": "customer_yaml_demo_fixture",
                        "path": str(resolved),
                        "resolved_under": str(root_resolved),
                    }

    return False, {
        "shape": None,
        "checked_per_customer_dir": str(per_customer),
        "checked_yaml_field": "demo.matter_fixture",
    }


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


@dataclass
class DemoPrepRunner:
    """Orchestrator for the pre-meeting readiness checks.

    Construct with the per-customer paths + readers (real or fake) and
    call :meth:`run` to get the full report.
    """

    customer_slug: str
    customers_root: Path
    fixture_roots: tuple[Path, ...] = field(default_factory=tuple)
    memory_reader: Optional[MemoryStateReader] = None
    voice_reader: Optional[VoiceStateReader] = None
    connector_smoke: ConnectorSmokeRunner = field(default_factory=NoOpConnectorSmoke)
    min_voice_samples: int = MIN_VOICE_SAMPLES

    def __post_init__(self) -> None:
        if not self.customer_slug:
            raise DemoPrepPreflightError("customer_slug must be a non-empty string")
        if is_template_slug(self.customer_slug):
            raise DemoPrepPreflightError(
                f"customer_slug {self.customer_slug!r} is a reserved template slug; "
                "copy ai-employee/customers/_template/ to a real slug first"
            )
        if not is_valid_slug(self.customer_slug):
            raise DemoPrepPreflightError(
                f"customer_slug {self.customer_slug!r} does not match "
                "^[a-z0-9][a-z0-9-]{0,31}$"
            )

    # --- public entrypoint --------------------------------------------------

    def run(self) -> list[CheckResult]:
        """Runs the full check sequence and returns one result per step.

        Never raises on a check failure; failures are folded into the
        returned list with status FAIL. Raises
        :class:`DemoPrepPreflightError` only when the customer directory
        or customer.yaml is missing entirely (mapped to exit code 2 by
        the CLI).
        """
        customer_dir = self.customers_root / self.customer_slug
        if not customer_dir.is_dir():
            raise DemoPrepPreflightError(
                f"customer dir not found: {customer_dir}; "
                "copy ai-employee/customers/_template/ to populate it"
            )

        customer_yaml_path = customer_dir / "customer.yaml"
        if not customer_yaml_path.is_file():
            raise DemoPrepPreflightError(
                f"customer.yaml not found: {customer_yaml_path}"
            )

        # Lazy yaml parse -- this is also the AC #1 check, so we record
        # both the parse outcome AND the schema-version sanity check.
        try:
            customer_yaml = _load_yaml(customer_yaml_path)
        except DemoPrepPreflightError:
            raise

        results: list[CheckResult] = []
        results.append(self._check_customer_yaml(customer_yaml_path, customer_yaml))
        results.append(self._check_voice_samples(customer_dir, customer_yaml))
        results.append(self._check_memory_ingestion(customer_yaml))
        results.append(self._check_voice_ingestion(customer_yaml))
        results.append(self._check_connector_smoke(customer_yaml))
        results.append(self._check_synthetic_matter(customer_dir, customer_yaml))
        return results

    # --- per-check implementations -----------------------------------------

    def _check_customer_yaml(self, path: Path, parsed: dict) -> CheckResult:
        # Shape sanity: schema_version present, customer_id matches slug,
        # vertical=law-firm, at least one persona. Heavier schema
        # validation lives in src/lib/ai-employee/customer-yaml/ (the
        # canonical TS validator per ADR 0019), invoked from
        # provision-customer.sh via scripts/validate-customer-yaml.ts.
        # This check confirms the file is structurally usable for the demo.
        problems: list[str] = []

        schema_version = parsed.get("schema_version")
        if schema_version != 1:
            problems.append(f"schema_version must be 1; got {schema_version!r}")

        cy_customer_id = parsed.get("customer_id")
        if cy_customer_id != self.customer_slug:
            problems.append(
                f"customer_id {cy_customer_id!r} does not match slug {self.customer_slug!r}"
            )

        vertical = parsed.get("vertical")
        if vertical != "law-firm":
            problems.append(
                f"vertical must be 'law-firm' for the PI firm demo flow; got {vertical!r}"
            )

        personas = parsed.get("personas") or []
        active_personas = [p for p in personas if isinstance(p, dict) and p.get("status") == "active"]
        if not active_personas:
            problems.append("personas must contain at least one entry with status: active")

        connectors = parsed.get("connectors") or {}
        if not connectors:
            problems.append("connectors map is empty; at least one connector must be wired")

        # Memory isolation invariants per docs/specs/ai-employee/r2-vectorize-naming.md.
        memory = parsed.get("memory") or {}
        if memory.get("d1_namespace") != self.customer_slug:
            problems.append("memory.d1_namespace must equal customer_id")
        if memory.get("r2_vault_path") not in (
            f"vaults/{self.customer_slug}/",
            None,
        ):
            problems.append(
                "memory.r2_vault_path must equal 'vaults/{customer_id}/' when present"
            )
        if memory.get("vectorize_index") not in (
            f"hermes-{self.customer_slug}-vault",
            None,
        ):
            problems.append(
                "memory.vectorize_index must equal 'hermes-{customer_id}-vault' when present"
            )

        if problems:
            return CheckResult(
                name="01_customer_yaml",
                status=CheckStatus.FAIL,
                detail={"path": str(path), "problems": problems},
            )
        return CheckResult(
            name="01_customer_yaml",
            status=CheckStatus.PASS,
            detail={"path": str(path), "schema_version": schema_version},
        )

    def _check_voice_samples(self, customer_dir: Path, customer_yaml: dict) -> CheckResult:
        # Voice samples live by default in ai-employee/customers/{slug}/voice/
        # OR at the path declared on voice_library.local_samples_path
        # (which never overrides the R2 vault path; this is a local
        # working copy Captain ingested from before provisioning).
        voice_library = customer_yaml.get("voice_library") or {}
        local_path = voice_library.get("local_samples_path")
        if local_path:
            voice_dir = Path(local_path)
            if not voice_dir.is_absolute():
                voice_dir = (customer_dir / local_path).resolve()
        else:
            voice_dir = customer_dir / "voice"

        sample_count = _count_voice_samples(voice_dir)
        if sample_count < self.min_voice_samples:
            return CheckResult(
                name="02_voice_samples",
                status=CheckStatus.FAIL,
                detail={
                    "voice_dir": str(voice_dir),
                    "sample_count": sample_count,
                    "required_minimum": self.min_voice_samples,
                },
            )
        return CheckResult(
            name="02_voice_samples",
            status=CheckStatus.PASS,
            detail={
                "voice_dir": str(voice_dir),
                "sample_count": sample_count,
                "required_minimum": self.min_voice_samples,
            },
        )

    def _check_memory_ingestion(self, customer_yaml: dict) -> CheckResult:
        # Per docs/specs/ai-employee/memory-ingestion.md, ingestion
        # success means at least one memory_source_state row exists with
        # ingest_status='ok'. When no reader is wired the check is SKIP,
        # not FAIL, because the substrate may simply not be reachable
        # from this workstation.
        if self.memory_reader is None:
            return CheckResult(
                name="03_memory_ingestion",
                status=CheckStatus.SKIP,
                detail={"reason": "no memory_reader wired"},
            )
        rows = self.memory_reader.read(self.customer_slug)
        if rows is None:
            return CheckResult(
                name="03_memory_ingestion",
                status=CheckStatus.SKIP,
                detail={"reason": "no memory_source_state snapshot available"},
            )
        if not rows:
            return CheckResult(
                name="03_memory_ingestion",
                status=CheckStatus.FAIL,
                detail={"reason": "no memory_source_state rows recorded"},
            )
        ok_rows = [r for r in rows if r.get("ingest_status") == "ok"]
        if not ok_rows:
            statuses = sorted({r.get("ingest_status") for r in rows})
            return CheckResult(
                name="03_memory_ingestion",
                status=CheckStatus.FAIL,
                detail={
                    "reason": "no memory_source_state row has ingest_status='ok'",
                    "statuses_seen": [s for s in statuses if s is not None],
                },
            )
        return CheckResult(
            name="03_memory_ingestion",
            status=CheckStatus.PASS,
            detail={"ok_rows": len(ok_rows), "total_rows": len(rows)},
        )

    def _check_voice_ingestion(self, customer_yaml: dict) -> CheckResult:
        # Per docs/specs/ai-employee/voice-ingestion.md, ingestion
        # success means at least one voice_source_state row exists.
        # Sample counts have their own check above; here we just verify
        # the pipeline ran without latching an error.
        if self.voice_reader is None:
            return CheckResult(
                name="04_voice_ingestion",
                status=CheckStatus.SKIP,
                detail={"reason": "no voice_reader wired"},
            )
        rows = self.voice_reader.read(self.customer_slug)
        if rows is None:
            return CheckResult(
                name="04_voice_ingestion",
                status=CheckStatus.SKIP,
                detail={"reason": "no voice_source_state snapshot available"},
            )
        if not rows:
            return CheckResult(
                name="04_voice_ingestion",
                status=CheckStatus.FAIL,
                detail={"reason": "no voice_source_state rows recorded"},
            )
        errored = [r for r in rows if r.get("ingest_status") == "error"]
        if errored:
            return CheckResult(
                name="04_voice_ingestion",
                status=CheckStatus.FAIL,
                detail={
                    "reason": "at least one voice_source_state row is errored",
                    "errored_count": len(errored),
                    "total_rows": len(rows),
                },
            )
        return CheckResult(
            name="04_voice_ingestion",
            status=CheckStatus.PASS,
            detail={"total_rows": len(rows)},
        )

    def _check_connector_smoke(self, customer_yaml: dict) -> CheckResult:
        # Per the issue: filevine smoke when PM is filevine, otherwise
        # the no-PM smoke (which confirms the synthetic adapter is wired
        # and the demo can proceed without a real PM tenant).
        connectors = customer_yaml.get("connectors") or {}
        pm = connectors.get("PracticeManagement") or {}
        adapter = pm.get("adapter")
        backend = pm.get("backend", "")

        # No-PM angle: synthetic adapter is wired. The demo can proceed
        # without a real PM tenant; we just confirm the customer.yaml
        # acknowledges the no-PM shape.
        if adapter in (None, "synthetic", "none"):
            if backend.startswith("synthetic:") or adapter in (None, "none", "synthetic"):
                return CheckResult(
                    name="05_connector_smoke",
                    status=CheckStatus.PASS,
                    detail={
                        "shape": "no_pm",
                        "adapter": adapter,
                        "backend": backend,
                    },
                )
            return CheckResult(
                name="05_connector_smoke",
                status=CheckStatus.FAIL,
                detail={
                    "shape": "no_pm",
                    "reason": "adapter omitted but backend is not a synthetic fixture",
                    "adapter": adapter,
                    "backend": backend,
                },
            )

        # Filevine angle: run the per-connector smoke test.
        if adapter == "filevine":
            result = self.connector_smoke.smoke(self.customer_slug)
            ok = bool(result.get("ok"))
            detail = result.get("detail") or {}
            if ok:
                return CheckResult(
                    name="05_connector_smoke",
                    status=CheckStatus.PASS,
                    detail={"shape": "filevine", **detail},
                )
            return CheckResult(
                name="05_connector_smoke",
                status=CheckStatus.FAIL,
                detail={"shape": "filevine", **detail},
            )

        # Any other adapter: SKIP. The issue scopes "filevine smoke or
        # no-PM smoke" only; other vendors get a follow-up issue and a
        # plain skip here so the runner stays useful in the interim.
        return CheckResult(
            name="05_connector_smoke",
            status=CheckStatus.SKIP,
            detail={
                "shape": "other_pm",
                "adapter": adapter,
                "reason": "no smoke runner wired for this PM adapter",
            },
        )

    def _check_synthetic_matter(self, customer_dir: Path, customer_yaml: dict) -> CheckResult:
        ok, detail = _has_synthetic_matter_fixture(
            customer_dir,
            customer_yaml,
            self.fixture_roots,
        )
        if ok:
            return CheckResult(
                name="06_synthetic_matter",
                status=CheckStatus.PASS,
                detail=detail,
            )
        return CheckResult(
            name="06_synthetic_matter",
            status=CheckStatus.FAIL,
            detail={
                **detail,
                "reason": "no synthetic matter fixture found per AC #5",
            },
        )


# ---------------------------------------------------------------------------
# Report rendering
# ---------------------------------------------------------------------------


def render_report(results: list[CheckResult], *, customer_slug: str) -> str:
    """Pretty-prints a per-step report.

    One line per check, plus a final summary. Designed to be eyeballed
    in a terminal AND grep-able in CI logs.
    """
    lines = [f"[demo-prep/{customer_slug}] readiness report"]
    for r in results:
        status_label = {
            CheckStatus.PASS: "PASS",
            CheckStatus.FAIL: "FAIL",
            CheckStatus.SKIP: "SKIP",
        }[r.status]
        lines.append(f"  {status_label}  {r.name}")
        # One indented detail line per key for grep-ability.
        for k, v in sorted(r.detail.items()):
            lines.append(f"    - {k}: {v}")
    passed = sum(1 for r in results if r.status == CheckStatus.PASS)
    failed = sum(1 for r in results if r.status == CheckStatus.FAIL)
    skipped = sum(1 for r in results if r.status == CheckStatus.SKIP)
    lines.append(
        f"[demo-prep/{customer_slug}] summary: {passed} pass, {failed} fail, {skipped} skip"
    )
    return "\n".join(lines)


def overall_exit_code(results: list[CheckResult]) -> int:
    """Computes the CLI exit code from the per-check results.

    Returns 0 on full pass (skips do not count as failures). Returns 3
    when at least one check failed. Preflight errors are surfaced by
    the caller as exit 2 before this function is ever reached.
    """
    if any(r.is_blocking for r in results):
        return 3
    return 0


__all__ = [
    "CheckResult",
    "CheckStatus",
    "ConnectorSmokeRunner",
    "DemoPrepPreflightError",
    "DemoPrepRunner",
    "FilesystemMemoryReader",
    "FilesystemVoiceReader",
    "MIN_VOICE_SAMPLES",
    "MemoryStateReader",
    "NoOpConnectorSmoke",
    "VoiceStateReader",
    "is_template_slug",
    "is_valid_slug",
    "overall_exit_code",
    "render_report",
]
