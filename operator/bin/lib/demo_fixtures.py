"""Demo-fixture loader (issue #890).

Loads the 8 synthetic PI matters from PR #832 (plus the generated
communications, calendar items, and synthetic voice samples drawn from
``operator/verticals/law-firm/addons/pi/fixtures/``) into a customer's Hermes Machine
substrate **as if** the rows were live operations. Tagged for clean
removal post-meeting.

Design rules
------------

* **Vertical-scoped, slug-routed.** The CLI accepts ``<customer-slug>
  <vertical>`` (``pi`` for v1). The structure is extensible: future
  verticals declare their own loader strategy by registering a vertical
  config in :data:`VERTICAL_REGISTRY`. The v1 ``pi`` strategy reads
  fixtures from ``operator/verticals/law-firm/addons/pi/fixtures/``.

* **Tagged for removal.** Every row written through this loader carries
  ``is_demo_fixture: true`` in its metadata payload (memory store +
  voice store). The ``--unload`` flow removes every row matching that
  tag and re-runs are no-ops once removal is complete.

* **Idempotent.** Re-running ``load`` on a customer that already has
  demo data refreshes the ingestion timestamps without inserting
  duplicate rows. Re-running ``unload`` after removal is also a no-op.

* **Hard refusal on real-customer pollution.** Before writing the
  first row, the loader scans the per-customer memory + voice stores
  for any row whose metadata does NOT carry ``is_demo_fixture: true``.
  If any such row exists, the loader exits with code 4 and no rows are
  touched. This prevents the demo loader from ever stepping on a real
  customer's data, even when the operator types the wrong slug.

* **No autonomous send paths.** Every "communication" loaded by this
  tool lands in the memory store as inert provenance. There is no
  outbound email path inside the loader. There is no SignWell call.
  There is no external connector invocation. Nothing leaves the workstation.

* **No real-customer pollution at the file-system level either.** The
  loader writes only to the per-customer working-state file under
  ``operator/customers/{slug}/.demo-fixtures-state.json`` and (when
  wired) the per-customer D1 + R2 substrate. Shared fixture
  directories are read-only.

* **Dashboard banner toggle is config only.** A new optional field
  ``demo.is_demo_substrate: bool`` on ``customer.yaml`` is the contract
  the dashboard reads to render "DEMO DATA" banner. The dashboard work
  is out of scope here; this loader documents the flag in the spec and
  surfaces ``customer.yaml.demo.is_demo_substrate`` in the loader's
  pre-flight report.
"""

from __future__ import annotations

import enum
import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional, Protocol

log = logging.getLogger("aie.bin.demo_fixtures")


# ---------------------------------------------------------------------------
# Public exceptions
# ---------------------------------------------------------------------------


class DemoFixturePreflightError(RuntimeError):
    """Raised before any row is written when inputs are obviously wrong.

    Mapped to exit code 2 by the CLI. Common causes: missing customer
    directory, template slug, customer.yaml absent, unknown vertical,
    fixtures root missing.
    """


class DemoFixtureSafetyRefusal(RuntimeError):
    """Raised when the target customer already holds real (non-demo) data.

    Mapped to exit code 4 by the CLI. The loader refuses rather than
    risk touching production data even with the right slug typed.
    """


# ---------------------------------------------------------------------------
# Slug rules (mirror demo_prep.py so the CLI surface is consistent)
# ---------------------------------------------------------------------------


_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
_TEMPLATE_PREFIX = "_"


def is_template_slug(slug: str) -> bool:
    """True when the slug is a reserved scaffold directory."""
    return bool(slug) and slug.startswith(_TEMPLATE_PREFIX)


def is_valid_slug(slug: str) -> bool:
    """Conforms to the schema's slug regex."""
    return bool(slug) and bool(_SLUG_RE.match(slug))


# ---------------------------------------------------------------------------
# Demo-fixture tag
# ---------------------------------------------------------------------------


# Every row this loader writes carries this key in its metadata payload.
# The unload path uses the same key to enumerate what to remove.
DEMO_FIXTURE_KEY = "is_demo_fixture"
DEMO_FIXTURE_TAG_VALUE = True

# The shared origin label is what the dashboard renders on the synthetic
# watermark. We never overload an existing source kind / source id, so
# decommission / retention sweeps that scan by ``source_kind`` see the
# demo rows as a separate logical source.
DEMO_SOURCE_KIND_MEMORY = "demo_fixtures"
DEMO_SOURCE_KIND_VOICE = "demo_fixtures"


# ---------------------------------------------------------------------------
# Outcome enums + result shapes
# ---------------------------------------------------------------------------


class LoadOutcome(str, enum.Enum):
    LOADED = "loaded"                # rows written; first run
    REFRESHED = "refreshed"          # rows already present; timestamps bumped
    NOOP = "noop"                    # no work to do (empty source)


class UnloadOutcome(str, enum.Enum):
    REMOVED = "removed"              # rows existed and were removed
    NOOP = "noop"                    # nothing tagged; nothing to remove


@dataclass
class LoadReport:
    """Per-section counts produced by one load run."""

    customer_slug: str
    vertical: str
    outcome: LoadOutcome
    matters_count: int = 0
    communications_count: int = 0
    calendar_count: int = 0
    voice_samples_count: int = 0
    started_at: str = ""
    finished_at: str = ""
    detail: dict = field(default_factory=dict)


@dataclass
class UnloadReport:
    """Per-section counts produced by one unload run."""

    customer_slug: str
    vertical: str
    outcome: UnloadOutcome
    memory_rows_removed: int = 0
    voice_rows_removed: int = 0
    started_at: str = ""
    finished_at: str = ""
    detail: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Substrate writer Protocols
#
# Production wires these to the per-customer D1 + R2 substrate. Tests use
# in-memory fakes. Default (CLI without --live-substrate) uses a file-
# backed implementation that writes to
# ``operator/customers/{slug}/.demo-fixtures-state.json``, mirroring
# the pattern demo_prep.py uses for its state snapshot.
# ---------------------------------------------------------------------------


class MemorySubstrateWriter(Protocol):
    """Writes / lists / removes memory rows for one customer.

    Each row's metadata MUST carry ``is_demo_fixture: true`` when this
    loader writes it. The store implementations enforce that contract.
    """

    def list_rows(self, customer_slug: str) -> list[dict]: ...

    def upsert_rows(
        self, customer_slug: str, rows: list[dict], *, now_iso: str
    ) -> int: ...

    def remove_demo_rows(self, customer_slug: str) -> int: ...


class VoiceSubstrateWriter(Protocol):
    """Sibling of :class:`MemorySubstrateWriter` for voice samples."""

    def list_rows(self, customer_slug: str) -> list[dict]: ...

    def upsert_rows(
        self, customer_slug: str, rows: list[dict], *, now_iso: str
    ) -> int: ...

    def remove_demo_rows(self, customer_slug: str) -> int: ...


# ---------------------------------------------------------------------------
# Default file-backed substrate writers
#
# These keep the loader useful on Captain's workstation without requiring
# live D1 / R2 bindings. The on-disk JSON is the same shape the dashboard
# reader (also file-backed in CI) consumes via FilesystemMemoryReader in
# demo_prep.py — different file name, parallel shape, so the two tools
# stay loosely coupled.
# ---------------------------------------------------------------------------


_STATE_FILE_NAME = ".demo-fixtures-state.json"
_MEMORY_KEY = "memory_rows"
_VOICE_KEY = "voice_rows"


def _now_iso() -> str:
    dt = datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _digest(payload: dict) -> str:
    """Stable digest used as the row-uniqueness key.

    The (source_kind, external_id) pair would suffice for memory rows,
    but the digest is what lets us key voice rows where there is no
    natural external id. Computing it the same way for both keeps the
    upsert math uniform.
    """
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class _FilesystemStoreBase:
    """Shared file-backed store. Subclasses pick the key under the root."""

    _key: str = ""

    def __init__(self, customer_dir: Path) -> None:
        self._customer_dir = customer_dir

    def _state_path(self) -> Path:
        return self._customer_dir / _STATE_FILE_NAME

    def _read(self) -> dict:
        path = self._state_path()
        if not path.exists():
            return {}
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.warning(
                "demo-fixtures state file %s is not valid JSON; treating as empty",
                path,
            )
            return {}
        return raw if isinstance(raw, dict) else {}

    def _write(self, state: dict) -> None:
        path = self._state_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(state, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )

    def list_rows(self, customer_slug: str) -> list[dict]:
        state = self._read()
        rows = state.get(self._key)
        return list(rows) if isinstance(rows, list) else []

    def upsert_rows(
        self, customer_slug: str, rows: list[dict], *, now_iso: str
    ) -> int:
        """Insert new rows; refresh ingested_at on existing rows.

        Uniqueness is by (source_kind, external_id) for memory rows and
        by ``content_digest`` for voice rows. Both shapes carry both
        fields so the writer logic is identical.
        """
        state = self._read()
        existing = list(state.get(self._key) or [])

        # Index existing rows for fast upsert.
        index: dict[tuple[str, str], int] = {}
        for i, row in enumerate(existing):
            key = (row.get("source_kind", ""), row.get("external_id", ""))
            index[key] = i

        written = 0
        for row in rows:
            row = dict(row)
            row.setdefault("metadata", {})
            row["metadata"][DEMO_FIXTURE_KEY] = DEMO_FIXTURE_TAG_VALUE
            row["ingested_at"] = now_iso
            key = (row.get("source_kind", ""), row.get("external_id", ""))
            if key in index:
                existing[index[key]] = row
            else:
                index[key] = len(existing)
                existing.append(row)
                written += 1

        state[self._key] = existing
        self._write(state)
        return written

    def remove_demo_rows(self, customer_slug: str) -> int:
        state = self._read()
        existing = list(state.get(self._key) or [])
        kept: list[dict] = []
        removed = 0
        for row in existing:
            meta = row.get("metadata") or {}
            if meta.get(DEMO_FIXTURE_KEY) is True:
                removed += 1
                continue
            kept.append(row)
        state[self._key] = kept
        self._write(state)
        return removed


class FilesystemMemoryStore(_FilesystemStoreBase):
    """Default memory writer: writes to
    ``operator/customers/{slug}/.demo-fixtures-state.json``."""

    _key = _MEMORY_KEY


class FilesystemVoiceStore(_FilesystemStoreBase):
    """Default voice writer: writes to the same state file under a
    distinct key."""

    _key = _VOICE_KEY


# ---------------------------------------------------------------------------
# Vertical-loader strategies
#
# Each vertical knows how to read its corpus and translate it into the
# vendor-neutral row shapes. v1 supports ``pi`` (personal-injury).
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class VerticalConfig:
    """Per-vertical corpus layout."""

    name: str
    corpus_subpath: str
    matters_subdir: str
    communications_subdir: str
    intake_subdir: str
    billing_subdir: str
    matter_glob: str = "*.md"

    @property
    def fixtures_root_segments(self) -> tuple[str, ...]:
        return tuple(self.corpus_subpath.split("/"))


VERTICAL_REGISTRY: dict[str, VerticalConfig] = {
    "pi": VerticalConfig(
        name="pi",
        corpus_subpath="law-firm/pi",
        matters_subdir="matters",
        communications_subdir="client-communication",
        intake_subdir="intake-transcripts",
        billing_subdir="billing-entries",
    ),
}


# ---------------------------------------------------------------------------
# PI matter parser
#
# Extracts the structured header from the 8 PI matter markdown files
# checked in by PR #832. We only need the small "envelope" fields here:
# slug, case number, phase, status, assigned attorney, watermark. The
# full body is preserved on the memory row as the ``content_excerpt``
# so the dashboard's matter-detail tab has something to render.
# ---------------------------------------------------------------------------


SYNTHETIC_WATERMARK = "[SYNTHETIC FIXTURE — NOT A REAL MATTER]"


@dataclass(frozen=True)
class PIMatterEnvelope:
    """Parsed header of one PI matter markdown file."""

    slug: str
    case_number: str
    phase: str
    assigned_attorney: str
    status: str
    matter_title: str
    body: str
    source_path: Path


def parse_pi_matter(path: Path) -> PIMatterEnvelope:
    """Parse one PI matter markdown file into its envelope.

    The matter format is established by ``operator/fixtures/law-
    firm/pi/matters/README.md``. The parser is intentionally tolerant
    about ordering of bold-label rows; it does not require any specific
    section be present after the header.
    """
    text = path.read_text(encoding="utf-8")
    if SYNTHETIC_WATERMARK not in text.splitlines()[0]:
        raise DemoFixturePreflightError(
            f"matter file {path} is missing the synthetic watermark on line 1; "
            "refusing to load potentially non-synthetic content"
        )

    title_match = re.search(r"^#\s+Matter:\s*(.+?)\s*$", text, flags=re.MULTILINE)
    matter_title = title_match.group(1).strip() if title_match else path.stem

    def _label(pattern: str) -> str:
        m = re.search(pattern, text, flags=re.MULTILINE)
        if m:
            return m.group(1).strip().strip("`").strip()
        return ""

    slug = _label(r"^\*\*Slug:\*\*\s*(.+?)\s*$")
    case_number = _label(r"^\*\*Case number \(internal\):\*\*\s*(.+?)\s*$")
    phase = _label(r"^\*\*Phase:\*\*\s*(.+?)\s*$")
    assigned_attorney = _label(r"^\*\*Assigned attorney:\*\*\s*(.+?)\s*$")
    status = _label(r"^\*\*Status:\*\*\s*(.+?)\s*$")

    if not slug:
        # Fall back to the filename when the header is missing. We do
        # not fail the load on this; the fixture author may have used a
        # different label format. The path stem is unique by directory.
        slug = path.stem

    return PIMatterEnvelope(
        slug=slug,
        case_number=case_number,
        phase=phase,
        assigned_attorney=assigned_attorney,
        status=status,
        matter_title=matter_title,
        body=text,
        source_path=path,
    )


# ---------------------------------------------------------------------------
# Row builders
# ---------------------------------------------------------------------------


def _memory_row(
    *,
    external_id: str,
    item_type: str,
    payload: dict,
    body_excerpt: str = "",
) -> dict:
    """Build one vendor-neutral memory row.

    The shape mirrors :class:`adapter.memory.state.IngestedItemRecord`'s
    public surface while staying decoupled from the production D1
    insertion path (which is owned by the live ingestion runner). The
    fields the dashboard reads are present; the dashboard does not need
    R2 keys or vectorize chunks for synthetic content.
    """
    return {
        "source_kind": DEMO_SOURCE_KIND_MEMORY,
        "source_id": "synthetic-pi-corpus",
        "external_id": external_id,
        "item_type": item_type,
        "access_scope": "firm-wide",
        "content_digest": _digest(payload),
        "metadata": {
            "watermark": SYNTHETIC_WATERMARK,
            "demo_payload": payload,
            "body_excerpt": body_excerpt[:2000],
        },
    }


def _voice_row(
    *,
    cohort: str,
    payload: dict,
) -> dict:
    """Build one vendor-neutral voice row.

    Same indirection as :func:`_memory_row`; the production voice
    pipeline inserts via :class:`adapter.voice.state.VoiceSourceStateStore`
    and writes R2 objects keyed by ULID. For the demo loader the row is
    the structural-diff JSON itself, kept inline as the demo lifetime
    is short (a single meeting).
    """
    digest = _digest(payload)
    return {
        "source_kind": DEMO_SOURCE_KIND_VOICE,
        "source_id": "synthetic-voice-cohort",
        # external_id is the digest for voice rows; there is no upstream
        # message-id to key against.
        "external_id": digest,
        "recipient_cohort_id": cohort,
        "partner_authored": True,
        "structural_diff_digest": digest,
        "metadata": {
            "watermark": SYNTHETIC_WATERMARK,
            "demo_payload": payload,
        },
    }


# ---------------------------------------------------------------------------
# Vertical loader: PI
# ---------------------------------------------------------------------------


def _read_json_files(directory: Path) -> list[dict]:
    """Read every .json file in ``directory``; skip hidden + non-json."""
    if not directory.is_dir():
        return []
    out: list[dict] = []
    for path in sorted(directory.glob("*.json")):
        if path.name.startswith("."):
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.warning("skipping non-JSON fixture file %s", path)
            continue
        if isinstance(payload, dict):
            payload["__source_path"] = str(path)
            out.append(payload)
    return out


def _synthesize_calendar_items(matters: list[PIMatterEnvelope]) -> list[dict]:
    """Derive calendar items from each matter's phase / status.

    The PI corpus does not ship a calendar fixture set, so we synthesize
    one deterministically from the matter envelope. The synthetic
    calendar entries are explicitly demo-tagged and removable via
    ``--unload`` like any other demo row. The synthesis lives in the
    loader (not the fixtures dir) because it is policy not content.
    """
    items: list[dict] = []
    for matter in matters:
        items.append(
            {
                "matter_slug": matter.slug,
                "matter_case_number": matter.case_number,
                "title": f"Status check: {matter.matter_title}",
                "phase": matter.phase,
                "kind": "status_check",
            }
        )
        if matter.phase.lower().startswith(("pre-suit", "active discovery")):
            items.append(
                {
                    "matter_slug": matter.slug,
                    "matter_case_number": matter.case_number,
                    "title": f"Partner review: {matter.matter_title}",
                    "phase": matter.phase,
                    "kind": "partner_review",
                }
            )
    return items


def _synthesize_voice_samples(communications: list[dict]) -> list[dict]:
    """Derive synthetic voice samples from client communications.

    Mirrors the shape :mod:`adapter.voice.diff` produces (structural
    diff with no PII body retained). For the demo we just package the
    communication tone label + matter ref so the dashboard renders the
    voice histogram with non-empty cohort counts.
    """
    samples: list[dict] = []
    for comm in communications:
        content = comm.get("content") or {}
        meta = comm.get("metadata") or {}
        cohort = content.get("tone_label") or "unassigned"
        samples.append(
            {
                "cohort": cohort,
                "payload": {
                    "matter_ref": content.get("matter_display_number"),
                    "case_type": meta.get("case_type"),
                    "tone": cohort,
                    "fixture_id": meta.get("fixture_id"),
                },
            }
        )
    return samples


@dataclass
class PILoaderInputs:
    matters: list[PIMatterEnvelope]
    intake_transcripts: list[dict]
    billing_entries: list[dict]
    client_communications: list[dict]
    calendar_items: list[dict]
    voice_samples: list[dict]


def load_pi_inputs(fixtures_root: Path) -> PILoaderInputs:
    """Read the PI corpus from the shared fixtures tree.

    ``fixtures_root`` is ``operator/fixtures/`` resolved by the CLI.
    All sub-paths under the corpus directory are read-only here; this
    function never writes back to the fixtures tree.
    """
    vertical = VERTICAL_REGISTRY["pi"]
    corpus = fixtures_root.joinpath(*vertical.fixtures_root_segments)
    if not corpus.is_dir():
        raise DemoFixturePreflightError(
            f"PI corpus not found at {corpus}; expected the matters dir from PR #832"
        )

    matters_dir = corpus / vertical.matters_subdir
    matter_files = sorted(
        p for p in matters_dir.glob(vertical.matter_glob) if p.is_file() and p.name != "README.md"
    )
    if not matter_files:
        raise DemoFixturePreflightError(
            f"no PI matter files found under {matters_dir}; "
            "expected the 8 matters from PR #832"
        )

    matters = [parse_pi_matter(p) for p in matter_files]
    intake = _read_json_files(corpus / vertical.intake_subdir)
    billing = _read_json_files(corpus / vertical.billing_subdir)
    comms = _read_json_files(corpus / vertical.communications_subdir)
    calendar = _synthesize_calendar_items(matters)
    voice = _synthesize_voice_samples(comms)

    return PILoaderInputs(
        matters=matters,
        intake_transcripts=intake,
        billing_entries=billing,
        client_communications=comms,
        calendar_items=calendar,
        voice_samples=voice,
    )


def build_memory_rows(inputs: PILoaderInputs) -> list[dict]:
    """Translate PI inputs into memory-store rows."""
    rows: list[dict] = []

    for matter in inputs.matters:
        rows.append(
            _memory_row(
                external_id=f"matter:{matter.slug}",
                item_type="matter",
                payload={
                    "slug": matter.slug,
                    "case_number": matter.case_number,
                    "phase": matter.phase,
                    "assigned_attorney": matter.assigned_attorney,
                    "status": matter.status,
                    "matter_title": matter.matter_title,
                    "source_path": str(matter.source_path),
                },
                body_excerpt=matter.body,
            )
        )

    for intake in inputs.intake_transcripts:
        meta = intake.get("metadata") or {}
        fixture_id = meta.get("fixture_id") or "intake-unknown"
        rows.append(
            _memory_row(
                external_id=f"document:intake:{fixture_id}",
                item_type="document",
                payload=intake,
            )
        )

    for billing in inputs.billing_entries:
        meta = billing.get("metadata") or {}
        fixture_id = meta.get("fixture_id") or "billing-unknown"
        rows.append(
            _memory_row(
                external_id=f"document:billing:{fixture_id}",
                item_type="document",
                payload=billing,
            )
        )

    for comm in inputs.client_communications:
        meta = comm.get("metadata") or {}
        fixture_id = meta.get("fixture_id") or "comm-unknown"
        rows.append(
            _memory_row(
                external_id=f"document:client-communication:{fixture_id}",
                item_type="document",
                payload=comm,
            )
        )

    for i, cal in enumerate(inputs.calendar_items):
        rows.append(
            _memory_row(
                external_id=f"document:calendar:{cal['matter_slug']}:{cal['kind']}:{i}",
                item_type="document",
                payload=cal,
            )
        )

    return rows


def build_voice_rows(inputs: PILoaderInputs) -> list[dict]:
    """Translate PI inputs into voice-store rows."""
    return [
        _voice_row(cohort=s["cohort"], payload=s["payload"])
        for s in inputs.voice_samples
    ]


# ---------------------------------------------------------------------------
# customer.yaml parsing (lazy, mirrors demo_prep.py)
# ---------------------------------------------------------------------------


def _load_yaml(path: Path) -> dict:
    try:
        import yaml
    except ImportError as exc:
        raise DemoFixturePreflightError(
            "pyyaml is required to parse customer.yaml; "
            "run via `uv run --with pyyaml python3 -m bin.lib.demo_fixtures_cli ...`"
        ) from exc
    try:
        loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise DemoFixturePreflightError(
            f"customer.yaml is not valid YAML: {exc}"
        ) from exc
    if not isinstance(loaded, dict):
        raise DemoFixturePreflightError(
            f"customer.yaml must parse to a mapping; got {type(loaded).__name__}"
        )
    return loaded


# ---------------------------------------------------------------------------
# Real-customer pollution guard
# ---------------------------------------------------------------------------


def _row_is_demo(row: dict) -> bool:
    meta = row.get("metadata") or {}
    return meta.get(DEMO_FIXTURE_KEY) is True


def assert_safe_to_touch(
    customer_slug: str,
    memory_store: MemorySubstrateWriter,
    voice_store: VoiceSubstrateWriter,
) -> None:
    """Refuse if any non-demo row exists in either store.

    Mapped to exit code 4 by the CLI. The guarantee is symmetric: even
    one foreign row in either store aborts the operation. This is the
    "loader must never touch real data" invariant called out in the
    issue.
    """
    memory_rows = memory_store.list_rows(customer_slug)
    voice_rows = voice_store.list_rows(customer_slug)

    foreign_memory = [r for r in memory_rows if not _row_is_demo(r)]
    foreign_voice = [r for r in voice_rows if not _row_is_demo(r)]

    if foreign_memory or foreign_voice:
        raise DemoFixtureSafetyRefusal(
            f"refusing to operate on customer {customer_slug!r}: "
            f"found {len(foreign_memory)} non-demo memory row(s) and "
            f"{len(foreign_voice)} non-demo voice row(s). "
            "Demo loader must never touch real customer data. "
            "Use a clean per-customer substrate or pick a different slug."
        )


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


@dataclass
class DemoFixtureLoader:
    """Orchestrates load / unload against one customer."""

    customer_slug: str
    vertical: str
    customers_root: Path
    fixtures_root: Path
    memory_store: MemorySubstrateWriter
    voice_store: VoiceSubstrateWriter

    def __post_init__(self) -> None:
        if not self.customer_slug:
            raise DemoFixturePreflightError(
                "customer_slug must be a non-empty string"
            )
        if is_template_slug(self.customer_slug):
            raise DemoFixturePreflightError(
                f"customer_slug {self.customer_slug!r} is a reserved template slug; "
                "copy operator/customers/_template/ to a real slug first"
            )
        if not is_valid_slug(self.customer_slug):
            raise DemoFixturePreflightError(
                f"customer_slug {self.customer_slug!r} does not match "
                "^[a-z0-9][a-z0-9-]{0,31}$"
            )
        if self.vertical not in VERTICAL_REGISTRY:
            raise DemoFixturePreflightError(
                f"vertical {self.vertical!r} not in {sorted(VERTICAL_REGISTRY)}"
            )

    def _customer_dir(self) -> Path:
        return self.customers_root / self.customer_slug

    def _preflight_customer_dir(self) -> Path:
        customer_dir = self._customer_dir()
        if not customer_dir.is_dir():
            raise DemoFixturePreflightError(
                f"customer dir not found: {customer_dir}; "
                "copy operator/customers/_template/ to populate it first"
            )
        customer_yaml = customer_dir / "customer.yaml"
        if not customer_yaml.is_file():
            raise DemoFixturePreflightError(
                f"customer.yaml not found: {customer_yaml}"
            )
        # We parse customer.yaml so that bad YAML surfaces before any
        # write. The parsed value is not consumed by the loader today,
        # but the spec's demo.is_demo_substrate flag is read here in a
        # later phase.
        _load_yaml(customer_yaml)
        return customer_dir

    # --- public entrypoints -------------------------------------------------

    def load(self) -> LoadReport:
        """Insert / refresh demo rows for the customer.

        Idempotent: re-running on a customer with existing demo data
        refreshes the ingestion timestamps without duplicating rows.
        Refuses if the substrate contains non-demo rows.
        """
        started_at = _now_iso()
        self._preflight_customer_dir()

        assert_safe_to_touch(self.customer_slug, self.memory_store, self.voice_store)

        if self.vertical == "pi":
            inputs = load_pi_inputs(self.fixtures_root)
        else:
            # Guarded by __post_init__ but defensive belt-and-braces.
            raise DemoFixturePreflightError(
                f"vertical {self.vertical!r} has no loader strategy registered"
            )

        memory_rows = build_memory_rows(inputs)
        voice_rows = build_voice_rows(inputs)

        prior_memory_count = len(self.memory_store.list_rows(self.customer_slug))
        prior_voice_count = len(self.voice_store.list_rows(self.customer_slug))

        now = _now_iso()
        memory_written = self.memory_store.upsert_rows(
            self.customer_slug, memory_rows, now_iso=now
        )
        voice_written = self.voice_store.upsert_rows(
            self.customer_slug, voice_rows, now_iso=now
        )

        finished_at = _now_iso()

        if not memory_rows and not voice_rows:
            outcome = LoadOutcome.NOOP
        elif memory_written == 0 and voice_written == 0:
            # Every row was already present; only timestamps moved.
            outcome = LoadOutcome.REFRESHED
        elif prior_memory_count == 0 and prior_voice_count == 0:
            outcome = LoadOutcome.LOADED
        else:
            outcome = LoadOutcome.LOADED

        return LoadReport(
            customer_slug=self.customer_slug,
            vertical=self.vertical,
            outcome=outcome,
            matters_count=len(inputs.matters),
            communications_count=len(inputs.client_communications),
            calendar_count=len(inputs.calendar_items),
            voice_samples_count=len(inputs.voice_samples),
            started_at=started_at,
            finished_at=finished_at,
            detail={
                "memory_rows_total": len(memory_rows),
                "memory_rows_newly_written": memory_written,
                "voice_rows_total": len(voice_rows),
                "voice_rows_newly_written": voice_written,
                "intake_transcripts_count": len(inputs.intake_transcripts),
                "billing_entries_count": len(inputs.billing_entries),
            },
        )

    def unload(self) -> UnloadReport:
        """Remove every demo row this loader has written.

        Idempotent: re-running after removal returns ``NOOP``. Refuses
        if the substrate contains non-demo rows (the same safety
        invariant; the unload path must never delete real customer
        data even by mistake).
        """
        started_at = _now_iso()
        self._preflight_customer_dir()

        assert_safe_to_touch(self.customer_slug, self.memory_store, self.voice_store)

        memory_removed = self.memory_store.remove_demo_rows(self.customer_slug)
        voice_removed = self.voice_store.remove_demo_rows(self.customer_slug)

        finished_at = _now_iso()

        outcome = (
            UnloadOutcome.REMOVED
            if (memory_removed + voice_removed) > 0
            else UnloadOutcome.NOOP
        )

        return UnloadReport(
            customer_slug=self.customer_slug,
            vertical=self.vertical,
            outcome=outcome,
            memory_rows_removed=memory_removed,
            voice_rows_removed=voice_removed,
            started_at=started_at,
            finished_at=finished_at,
            detail={},
        )


# ---------------------------------------------------------------------------
# Report rendering
# ---------------------------------------------------------------------------


def render_load_report(report: LoadReport) -> str:
    lines = [
        f"[demo-fixtures/{report.customer_slug}/{report.vertical}] {report.outcome.value}",
        f"  matters loaded:        {report.matters_count}",
        f"  communications loaded: {report.communications_count}",
        f"  calendar items:        {report.calendar_count}",
        f"  voice samples:         {report.voice_samples_count}",
    ]
    for k in sorted(report.detail):
        lines.append(f"  {k}: {report.detail[k]}")
    return "\n".join(lines)


def render_unload_report(report: UnloadReport) -> str:
    return "\n".join(
        [
            f"[demo-fixtures/{report.customer_slug}/{report.vertical}] {report.outcome.value}",
            f"  memory rows removed: {report.memory_rows_removed}",
            f"  voice rows removed:  {report.voice_rows_removed}",
        ]
    )


# ---------------------------------------------------------------------------
# CLI exit-code helper
# ---------------------------------------------------------------------------


def exit_code_for_load(report: LoadReport) -> int:
    """``0`` on success of any outcome (load / refresh / noop)."""
    return 0


def exit_code_for_unload(report: UnloadReport) -> int:
    """``0`` on success of any outcome."""
    return 0


__all__ = [
    "DEMO_FIXTURE_KEY",
    "DEMO_FIXTURE_TAG_VALUE",
    "DEMO_SOURCE_KIND_MEMORY",
    "DEMO_SOURCE_KIND_VOICE",
    "DemoFixtureLoader",
    "DemoFixturePreflightError",
    "DemoFixtureSafetyRefusal",
    "FilesystemMemoryStore",
    "FilesystemVoiceStore",
    "LoadOutcome",
    "LoadReport",
    "MemorySubstrateWriter",
    "PILoaderInputs",
    "PIMatterEnvelope",
    "SYNTHETIC_WATERMARK",
    "UnloadOutcome",
    "UnloadReport",
    "VERTICAL_REGISTRY",
    "VerticalConfig",
    "VoiceSubstrateWriter",
    "assert_safe_to_touch",
    "build_memory_rows",
    "build_voice_rows",
    "exit_code_for_load",
    "exit_code_for_unload",
    "is_template_slug",
    "is_valid_slug",
    "load_pi_inputs",
    "parse_pi_matter",
    "render_load_report",
    "render_unload_report",
]
