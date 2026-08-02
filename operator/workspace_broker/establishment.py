"""Broker-side validation and spool marshalling for conversational establishment
(ADR 0085, ss-console #2161/#2162).

WHAT ESTABLISHMENT IS. An Operator admin instructs the Operator to review a
named set of firm documents and establish (or update) the firm's voice or an
output shape from them. The agent stages the corpus it read, submits a derived
spec, and a ROOT intake daemon (overlay ``establish_intake``) runs the
distillation compiler gates before anything is installed. The agent's uid never
touches the spool, R2, or the spec tree — this module is the validation seam the
submission must cross, and the broker uid is the only principal that writes it.

THE FOUR DISCIPLINES, inherited from ``corrections.py`` verbatim:

1. **One pinned action_type per verb.** ``establish_submit`` appends only
   ``ESTABLISHMENT_SUBMITTED``; ``establish_status`` appends only
   ``ESTABLISHMENT_RESULT``. Neither verb can forge a row of any other kind.
2. **Rows and files are REBUILT from a bounded field set, never forwarded.**
   Every stored payload below is constructed field by field from values this
   module read, checked, and (where derivable) computed itself. A field the
   caller invents has nowhere to land.
3. **Server-side constants.** Every content hash is computed broker-side from
   the bytes actually stored. A caller-supplied ``sha256`` on a staged document
   is never read; the manifest hashes at submit time are checked against the
   broker's own recomputation, not trusted from the wire.
4. **Refuse, never sanitize.** A malformed field is a named refusal, not a
   quiet rewrite. The one derived identifier — the staged document's ``name``,
   which the design pins as safe-slugged — is a broker-side DERIVATION like the
   sha256 (the raw name is validated, the slug is computed here, and the raw
   bytes are never stored), not a sanitized passthrough.

WHY THE CORPUS RIDES THE SPOOL. The corpus is not on the seat filesystem (the
publisher ships only customer.yaml; the documents live in the client's systems
and reach the agent through connector reads). The broker frame is one line of
at most 1 MiB, so a multi-document corpus cannot arrive as one payload:
staging is structurally forced, and it is also what hash-binds the submitted
spec to exactly the corpus the agent read.

WHAT THE AUDIT ROWS NEVER CARRY. Corpus text and spec bodies stay in the spool
(purged by the root intake after the run) and in the one-shot result payload.
Retained ledger rows carry document names, hashes, rule ids, and counts — never
the client's prose. That is ADR 0083's retention posture applied to this path.
"""

from __future__ import annotations

import json
import re
import secrets
import shutil
import time
from hashlib import sha256
from pathlib import Path
from typing import Any

# Pinned audit action types — exactly one per writing verb (discipline 1).
ESTABLISHMENT_SUBMITTED_ACTION_TYPE = "ESTABLISHMENT_SUBMITTED"
ESTABLISHMENT_RESULT_ACTION_TYPE = "ESTABLISHMENT_RESULT"

# The two spec properties an output class carries (ADR 0083 §2-3). Mirrors
# SPEC_PROPERTIES in corrections.py and src/lib/operator/output-class-specs.ts.
SPEC_PROPERTIES: frozenset[str] = frozenset({"voice", "format"})

# The two submission phases (design §3 steps 4-5): ``analyze`` runs the profile
# and fixed-strings compilers over the corpus; ``install`` carries the drafted
# spec through the write gates.
SUBMIT_PHASES: frozenset[str] = frozenset({"analyze", "install"})

# Output-class slug charset. Mirrors corrections.py and the console writer's
# CLASS_SLUG_PATTERN; refused rather than sanitized (discipline 4).
_CLASS_SLUG_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789_-")
_MAX_CLASS_SLUG = 64

# Staging ceilings (design §3 step 3). The per-document text ceiling matches
# the broker's whole-frame ceiling (server.py MAX_REQUEST_BYTES) — a larger
# document could never arrive anyway; stating it here makes the refusal named
# instead of a transport error.
MAX_DOC_TEXT_BYTES = 1_048_576
MAX_DOCS_PER_SET = 64
MAX_SET_BYTES = 16 * 1_048_576
STAGING_TTL_SECONDS = 30 * 60

# Results are one-shot reads; the TTL sweep is the backstop for a result the
# agent never came back for.
RESULT_TTL_SECONDS = 30 * 60

# Spec-body ceiling — applier parity (spec_applier holds a 256 KiB body
# ceiling; a body the applier would refuse must be refused here, not queued).
MAX_SPEC_BODY_BYTES = 262_144

# Assertions ride to the selftest compiler, which owns their schema and refuses
# malformed rules (exit 1). The broker's job is shape and bound, not schema.
_MAX_ASSERTIONS = 100
_MAX_ASSERTIONS_BYTES = 65_536

_MAX_SHORT_TEXT = 200
_MAX_NAME_INPUT = 200
_MAX_NAME_SLUG = 64

# Broker-minted identifiers (token_urlsafe) and the charset a caller-echoed one
# must match. Excludes ``/`` and ``.`` so an identifier can never traverse.
_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,64}$")

_NAME_SLUG_KEEP = set("abcdefghijklmnopqrstuvwxyz0123456789._-")


class EstablishmentValidationError(ValueError):
    """An establishment request was malformed. Raised before anything is written."""


def _require_text(value: Any, field: str, limit: int) -> str:
    if not isinstance(value, str):
        raise EstablishmentValidationError(f"{field} must be a string")
    text = value.strip()
    if not text:
        raise EstablishmentValidationError(f"{field} must not be empty")
    if len(text) > limit:
        raise EstablishmentValidationError(
            f"{field} is {len(text)} characters; the ceiling is {limit}"
        )
    return text


def _optional_text(value: Any, field: str, limit: int) -> str | None:
    if value is None:
        return None
    return _require_text(value, field, limit)


def _require_class_slug(value: Any) -> str:
    slug = _require_text(value, "output_class", _MAX_CLASS_SLUG)
    if not set(slug) <= _CLASS_SLUG_CHARS:
        raise EstablishmentValidationError(
            "output_class must match [a-z0-9_-]; refusing to rewrite it"
        )
    return slug


def _require_property(value: Any) -> str:
    prop = _require_text(value, "property", _MAX_SHORT_TEXT)
    if prop not in SPEC_PROPERTIES:
        raise EstablishmentValidationError(
            f"property must be one of {sorted(SPEC_PROPERTIES)}; got {prop!r}"
        )
    return prop


def _require_id(value: Any, field: str) -> str:
    ident = _require_text(value, field, 64)
    if not _ID_PATTERN.match(ident):
        raise EstablishmentValidationError(
            f"{field} must match [A-Za-z0-9_-]{{8,64}}; refusing to rewrite it"
        )
    return ident


def safe_slug(name: Any) -> str:
    """Derive the stored document name from the caller's raw name.

    A broker-side derivation (discipline 3), like the sha256: the raw name is
    validated for type and bound, the slug is computed here, and the raw bytes
    are never stored — so a hostile filename from a client system cannot ride
    into the spool, the audit ledger, or a later reply. A name that derives to
    nothing is refused (discipline 4), never invented.
    """
    raw = _require_text(name, "name", _MAX_NAME_INPUT)
    out: list[str] = []
    for ch in raw.lower():
        if ch in _NAME_SLUG_KEEP and ch != "-":
            out.append(ch)
        elif out and out[-1] != "-":
            out.append("-")
    slug = "".join(out).strip("-._")[:_MAX_NAME_SLUG]
    if not slug:
        raise EstablishmentValidationError(
            "name derives to an empty slug; provide a name with [a-z0-9._-] content"
        )
    return slug


def normalize_lf(text: str) -> str:
    """Collapse CRLF and lone CR to LF.

    The portal writer's precedent (src/lib/operator/output-class-specs.ts):
    the stored bytes are LF-only, so the byte ceiling, the hash, and the
    installed file agree — and agree on LF.
    """
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _hash_text(text: str) -> str:
    return sha256(text.encode("utf-8")).hexdigest()


def _bounded_str(value: Any, limit: int = _MAX_SHORT_TEXT) -> str | None:
    """Bounded coercion for fields read off a ROOT-authored result file.

    Truncation (not refusal) is correct here and only here: the writer is the
    root intake, not the agent, and the bound is belt-and-braces against an
    intake bug — a refusal would strand a result the admin is owed.
    """
    if not isinstance(value, str) or not value:
        return None
    return value[:limit]


def build_result_row(run_id: str, result: dict[str, Any]) -> dict[str, Any]:
    """Build the ESTABLISHMENT_RESULT audit row from a bounded field set.

    The retained record carries the verdict, the demoted rules with the
    documents that violated them (names, never text), and the recovery key.
    The corpus and any leak excerpts stay in the one-shot result payload,
    which is deleted after this row is appended.
    """
    demotions: list[dict[str, Any]] = []
    raw_demotions = result.get("demotions")
    if isinstance(raw_demotions, list):
        for entry in raw_demotions[:50]:
            if not isinstance(entry, dict):
                continue
            rule = _bounded_str(entry.get("rule"))
            raw_docs = entry.get("documents")
            documents = []
            if isinstance(raw_docs, list):
                documents = [
                    d[:_MAX_SHORT_TEXT] for d in raw_docs[:MAX_DOCS_PER_SET] if isinstance(d, str)
                ]
            demotions.append({"rule": rule, "documents": documents})

    metadata = {
        "run_id": run_id,
        "verdict": _bounded_str(result.get("status")),
        "phase": _bounded_str(result.get("phase")),
        "output_class": _bounded_str(result.get("output_class")),
        "property": _bounded_str(result.get("property")),
        "demotions": demotions,
        "previous_key": _bounded_str(result.get("previous_key")),
    }
    return {
        "action_type": ESTABLISHMENT_RESULT_ACTION_TYPE,
        "actor": "operator",
        "actor_role": "agent",
        "metadata": json.dumps(metadata, sort_keys=True, separators=(",", ":")),
    }


class EstablishmentStore:
    """The broker's half of the establishment spool.

    Layout (created and moded by the entrypoint, never here — the spool root is
    root-owned and the broker uid cannot create it):

        <root>/staging/<staging_id>/meta.json      broker-written
        <root>/staging/<staging_id>/docs/<id>.json broker-written (holds text)
        <root>/runs/<run_id>/submission.json       broker-written
        <root>/runs/<run_id>/docs/<id>.json        broker-moved from staging
        <root>/results/<run_id>.json               ROOT-written, one-shot read

    Runs are assembled in a dot-prefixed temp dir and atomically renamed into
    place, so the root intake never observes a half-written submission. The
    intake ignores dot-prefixed entries by contract (design §2).
    """

    def __init__(self, spool_root: str | Path, ledger: Any) -> None:
        self.root = Path(spool_root)
        self.staging_dir = self.root / "staging"
        self.runs_dir = self.root / "runs"
        self.results_dir = self.root / "results"
        self._ledger = ledger

    # ------------------------------------------------------------------
    # TTL sweep
    # ------------------------------------------------------------------

    def sweep(self, now: float | None = None) -> None:
        """Remove expired staging sets and unread results.

        Best-effort by design: a sweep failure must not refuse the verb that
        triggered it. Run dirs are NOT swept here — their lifecycle belongs to
        the root intake, which purges each run after writing its result.
        """
        now = time.time() if now is None else now
        if self.staging_dir.is_dir():
            for entry in self.staging_dir.iterdir():
                if not entry.is_dir():
                    continue
                created = self._staging_created_at(entry)
                if now - created > STAGING_TTL_SECONDS:
                    shutil.rmtree(entry, ignore_errors=True)
        if self.results_dir.is_dir():
            for entry in self.results_dir.iterdir():
                if not entry.is_file():
                    continue
                try:
                    if now - entry.stat().st_mtime > RESULT_TTL_SECONDS:
                        entry.unlink(missing_ok=True)
                except OSError:
                    continue

    def _staging_created_at(self, staging_path: Path) -> float:
        meta_path = staging_path / "meta.json"
        try:
            meta = json.loads(meta_path.read_text("utf-8"))
            created = meta.get("created_at")
            if isinstance(created, (int, float)):
                return float(created)
        except (OSError, ValueError):
            pass
        try:
            return staging_path.stat().st_mtime
        except OSError:
            return 0.0

    # ------------------------------------------------------------------
    # establish_stage_document
    # ------------------------------------------------------------------

    def stage_document(self, request: dict[str, Any]) -> dict[str, Any]:
        """Validate one corpus document and write it into a staging set.

        The stored file is rebuilt from the bounded field set below; the
        sha256 is computed here from the bytes being stored (a wire-supplied
        hash is never read).
        """
        name = safe_slug(request.get("name"))

        text = request.get("text")
        if not isinstance(text, str):
            raise EstablishmentValidationError("text must be a string")
        if not text.strip():
            raise EstablishmentValidationError("text must not be empty")
        text_bytes = text.encode("utf-8")
        if len(text_bytes) > MAX_DOC_TEXT_BYTES:
            raise EstablishmentValidationError(
                f"text is {len(text_bytes)} bytes; the ceiling is {MAX_DOC_TEXT_BYTES}"
            )

        source_raw = request.get("source")
        if not isinstance(source_raw, dict):
            raise EstablishmentValidationError(
                "source must be an object with connector and document_id"
            )
        source = {
            "connector": _require_text(
                source_raw.get("connector"), "source.connector", _MAX_SHORT_TEXT
            ),
            "document_id": _require_text(
                source_raw.get("document_id"), "source.document_id", _MAX_SHORT_TEXT
            ),
            "matter_id": _optional_text(
                source_raw.get("matter_id"), "source.matter_id", _MAX_SHORT_TEXT
            ),
        }

        staging_id_raw = request.get("staging_id")
        if staging_id_raw is None:
            staging_id = secrets.token_urlsafe(16)
            staging_path = self.staging_dir / staging_id
            (staging_path / "docs").mkdir(parents=True)
            (staging_path / "meta.json").write_text(
                json.dumps({"created_at": time.time()}), "utf-8"
            )
        else:
            staging_id = _require_id(staging_id_raw, "staging_id")
            staging_path = self.staging_dir / staging_id
            if not staging_path.is_dir():
                raise EstablishmentValidationError(
                    "unknown or expired staging_id; stage the documents again"
                )

        existing = self._load_staged_docs(staging_path)
        if len(existing) + 1 > MAX_DOCS_PER_SET:
            raise EstablishmentValidationError(
                f"staging set already holds {len(existing)} documents; the ceiling is {MAX_DOCS_PER_SET}"
            )
        set_bytes = sum(int(doc.get("size_bytes", 0)) for doc in existing)
        if set_bytes + len(text_bytes) > MAX_SET_BYTES:
            raise EstablishmentValidationError(
                f"staging set would grow to {set_bytes + len(text_bytes)} bytes; the ceiling is {MAX_SET_BYTES}"
            )

        doc_id = f"doc-{len(existing) + 1:03d}"
        while (staging_path / "docs" / f"{doc_id}.json").exists():
            doc_id = f"doc-{secrets.token_urlsafe(6)}"
        digest = _hash_text(text)
        record = {
            "doc_id": doc_id,
            "name": name,
            "sha256": digest,
            "size_bytes": len(text_bytes),
            "source": source,
            "staged_at": time.time(),
            "text": text,
        }
        (staging_path / "docs" / f"{doc_id}.json").write_text(
            json.dumps(record, sort_keys=True), "utf-8"
        )
        return {
            "ok": True,
            "staging_id": staging_id,
            "doc_id": doc_id,
            "name": name,
            "sha256": digest,
            "doc_count": len(existing) + 1,
            "set_bytes": set_bytes + len(text_bytes),
        }

    def _require_staging(self, value: Any) -> tuple[str, Path]:
        staging_id = _require_id(value, "staging_id")
        staging_path = self.staging_dir / staging_id
        if not staging_path.is_dir():
            raise EstablishmentValidationError(
                "unknown or expired staging_id; stage the documents again"
            )
        return staging_id, staging_path

    def _load_staged_docs(self, staging_path: Path) -> list[dict[str, Any]]:
        docs_dir = staging_path / "docs"
        docs: list[dict[str, Any]] = []
        if not docs_dir.is_dir():
            return docs
        for entry in sorted(docs_dir.glob("*.json")):
            try:
                record = json.loads(entry.read_text("utf-8"))
            except (OSError, ValueError) as exc:
                raise EstablishmentValidationError(
                    f"staged document {entry.name} is unreadable; stage the documents again"
                ) from exc
            record["_path"] = entry
            docs.append(record)
        return docs

    # ------------------------------------------------------------------
    # establish_submit
    # ------------------------------------------------------------------

    def submit(self, request: dict[str, Any]) -> dict[str, Any]:
        """Validate a submission, append its audit row, and materialize the run.

        The audit row is appended BEFORE the run dir is renamed into place: a
        run the root intake can see without a ledger row would be an unaudited
        install path, which is the worse failure than a row for a run that
        never materialized.
        """
        staging_id, staging_path = self._require_staging(request.get("staging_id"))
        phase = _require_text(request.get("phase"), "phase", _MAX_SHORT_TEXT)
        if phase not in SUBMIT_PHASES:
            raise EstablishmentValidationError(
                f"phase must be one of {sorted(SUBMIT_PHASES)}; got {phase!r}"
            )

        staged = self._load_staged_docs(staging_path)
        if not staged:
            raise EstablishmentValidationError(
                "staging set holds no documents; stage the corpus first"
            )
        # Integrity re-check of the broker's own files (defense in depth — the
        # intake re-verifies too): every staged text must still hash to the
        # digest recorded when it was staged.
        for doc in staged:
            if _hash_text(doc.get("text", "")) != doc.get("sha256"):
                raise EstablishmentValidationError(
                    f"staged document {doc.get('doc_id')} failed its integrity re-hash; stage the documents again"
                )

        run_id = secrets.token_urlsafe(16)
        if phase == "analyze":
            return self._submit_analyze(staging_id, staging_path, staged, run_id)
        return self._submit_install(request, staging_id, staging_path, staged, run_id)

    def _submit_analyze(
        self,
        staging_id: str,
        staging_path: Path,
        staged: list[dict[str, Any]],
        run_id: str,
    ) -> dict[str, Any]:
        doc_summaries = [{"name": d["name"], "sha256": d["sha256"]} for d in staged]
        submission = {
            "phase": "analyze",
            "run_id": run_id,
            "staging_id": staging_id,
            "docs": [
                {
                    "doc_id": d["doc_id"],
                    "name": d["name"],
                    "sha256": d["sha256"],
                    "size_bytes": d["size_bytes"],
                }
                for d in staged
            ],
            "submitted_at": time.time(),
        }
        row = {
            "action_type": ESTABLISHMENT_SUBMITTED_ACTION_TYPE,
            "actor": "operator",
            "actor_role": "agent",
            "metadata": json.dumps(
                {
                    "phase": "analyze",
                    "run_id": run_id,
                    "staging_id": staging_id,
                    "docs": doc_summaries,
                    "doc_count": len(staged),
                },
                sort_keys=True,
                separators=(",", ":"),
            ),
        }
        self._ledger.append(row)
        # Analyze COPIES the corpus into the run: the staging set must survive
        # so the later install submission can hash-bind against it.
        self._materialize_run(run_id, submission, staged, move=False)
        return {"ok": True, "run_id": run_id, "phase": "analyze", "status": "queued"}

    def _submit_install(
        self,
        request: dict[str, Any],
        staging_id: str,
        staging_path: Path,
        staged: list[dict[str, Any]],
        run_id: str,
    ) -> dict[str, Any]:
        output_class = _require_class_slug(request.get("output_class"))
        prop = _require_property(request.get("property"))

        body_raw = request.get("spec_body")
        if not isinstance(body_raw, str):
            raise EstablishmentValidationError("spec_body must be a string")
        # LF-normalize BEFORE the ceiling and the hash (portal precedent): the
        # byte count, the digest, and the installed file must agree, on LF.
        body = normalize_lf(body_raw).strip()
        if not body:
            raise EstablishmentValidationError("spec_body must not be empty")
        body_bytes = body.encode("utf-8")
        if len(body_bytes) > MAX_SPEC_BODY_BYTES:
            raise EstablishmentValidationError(
                f"spec_body is {len(body_bytes)} bytes after LF normalization; the ceiling is {MAX_SPEC_BODY_BYTES}"
            )
        spec_digest = sha256(body_bytes).hexdigest()

        assertions = self._validate_assertions(request.get("assertions"))

        manifest_raw = request.get("corpus_manifest")
        if not isinstance(manifest_raw, list) or not manifest_raw:
            raise EstablishmentValidationError(
                "corpus_manifest must be a non-empty list of {doc_id, sha256}"
            )
        if len(manifest_raw) > MAX_DOCS_PER_SET:
            raise EstablishmentValidationError(
                f"corpus_manifest holds {len(manifest_raw)} entries; the ceiling is {MAX_DOCS_PER_SET}"
            )
        staged_by_id = {d["doc_id"]: d for d in staged}
        seen: set[str] = set()
        selected: list[dict[str, Any]] = []
        for index, entry in enumerate(manifest_raw):
            if not isinstance(entry, dict):
                raise EstablishmentValidationError(
                    f"corpus_manifest[{index}] must be an object with doc_id and sha256"
                )
            doc_id = _require_text(entry.get("doc_id"), f"corpus_manifest[{index}].doc_id", 64)
            claimed = _require_text(entry.get("sha256"), f"corpus_manifest[{index}].sha256", 64)
            if doc_id in seen:
                raise EstablishmentValidationError(
                    f"corpus_manifest names {doc_id} twice; refusing an ambiguous corpus"
                )
            seen.add(doc_id)
            doc = staged_by_id.get(doc_id)
            if doc is None:
                raise EstablishmentValidationError(
                    f"corpus_manifest names {doc_id}, which is not in this staging set"
                )
            # The claim must match the broker's OWN hash of the staged bytes —
            # the spec is bound to exactly the corpus the agent staged, and a
            # manifest that disagrees is a refusal, never a repair.
            if claimed != doc["sha256"]:
                raise EstablishmentValidationError(
                    f"corpus_manifest hash for {doc_id} does not match the staged document"
                )
            selected.append(doc)

        instructed_by = _require_text(
            request.get("instructed_by"), "instructed_by", _MAX_SHORT_TEXT
        )
        source_ref = _require_text(request.get("source_ref"), "source_ref", _MAX_SHORT_TEXT)

        doc_summaries = [{"name": d["name"], "sha256": d["sha256"]} for d in selected]
        submission = {
            "phase": "install",
            "run_id": run_id,
            "staging_id": staging_id,
            "output_class": output_class,
            "property": prop,
            "spec_body": body,
            "spec_sha256": spec_digest,
            "assertions": assertions,
            "docs": [
                {
                    "doc_id": d["doc_id"],
                    "name": d["name"],
                    "sha256": d["sha256"],
                    "size_bytes": d["size_bytes"],
                }
                for d in selected
            ],
            # Provenance for the audit trail, never authorization — the broker
            # cannot verify a claimed instructor (same posture as corrections
            # ``stated_by``); the authorization gate is the admin hook seat-side.
            "instructed_by": instructed_by,
            "source_ref": source_ref,
            "submitted_at": time.time(),
        }
        row = {
            "action_type": ESTABLISHMENT_SUBMITTED_ACTION_TYPE,
            "actor": "operator",
            "actor_role": "agent",
            "metadata": json.dumps(
                {
                    "phase": "install",
                    "run_id": run_id,
                    "staging_id": staging_id,
                    "output_class": output_class,
                    "property": prop,
                    "spec_sha256": spec_digest,
                    "docs": doc_summaries,
                    "doc_count": len(selected),
                    "assertion_count": len(assertions) if assertions else 0,
                    "instructed_by": instructed_by,
                    "source_ref": source_ref,
                },
                sort_keys=True,
                separators=(",", ":"),
            ),
        }
        self._ledger.append(row)
        # Install MOVES the corpus into the run and consumes the staging set —
        # the submission is final; a re-establishment starts with a fresh stage.
        self._materialize_run(run_id, submission, selected, move=True)
        shutil.rmtree(staging_path, ignore_errors=True)
        return {"ok": True, "run_id": run_id, "phase": "install", "status": "queued"}

    def _validate_assertions(self, value: Any) -> list[dict[str, Any]] | None:
        """Shape-and-bound check for assertions.

        Full rule-schema validation is deliberately NOT here: the selftest
        compiler owns the rule schema and refuses malformed rules (exit 1,
        design §5). The broker guarantees the payload is a bounded list of
        JSON objects and nothing else.
        """
        if value is None:
            return None
        if not isinstance(value, list):
            raise EstablishmentValidationError("assertions must be a list of rule objects")
        if len(value) > _MAX_ASSERTIONS:
            raise EstablishmentValidationError(
                f"assertions holds {len(value)} rules; the ceiling is {_MAX_ASSERTIONS}"
            )
        for index, entry in enumerate(value):
            if not isinstance(entry, dict):
                raise EstablishmentValidationError(
                    f"assertions[{index}] must be an object"
                )
        serialized = json.dumps(value, sort_keys=True, separators=(",", ":"))
        if len(serialized.encode("utf-8")) > _MAX_ASSERTIONS_BYTES:
            raise EstablishmentValidationError(
                f"assertions serialize to {len(serialized)} bytes; the ceiling is {_MAX_ASSERTIONS_BYTES}"
            )
        return json.loads(serialized)

    def _materialize_run(
        self,
        run_id: str,
        submission: dict[str, Any],
        docs: list[dict[str, Any]],
        move: bool,
    ) -> None:
        """Assemble the run in a dot-prefixed temp dir, then atomically rename.

        The root intake polls the runs dir and ignores dot-prefixed entries, so
        it can never observe a half-written submission (same-filesystem rename
        is atomic).
        """
        tmp_dir = self.runs_dir / f".tmp-{run_id}"
        try:
            (tmp_dir / "docs").mkdir(parents=True)
            for doc in docs:
                source_path: Path = doc["_path"]
                target = tmp_dir / "docs" / source_path.name
                if move:
                    source_path.rename(target)
                else:
                    shutil.copyfile(source_path, target)
            (tmp_dir / "submission.json").write_text(
                json.dumps(submission, sort_keys=True), "utf-8"
            )
            tmp_dir.rename(self.runs_dir / run_id)
        except OSError:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise

    # ------------------------------------------------------------------
    # establish_status
    # ------------------------------------------------------------------

    def status(self, request: dict[str, Any]) -> dict[str, Any]:
        """Read a run's result. One-shot: the result file is deleted after the
        first successful read, and its retained trace is the bounded
        ESTABLISHMENT_RESULT audit row (appended before the delete, so a failed
        append leaves the result readable and retryable)."""
        run_id = _require_id(request.get("run_id"), "run_id")
        result_path = self.results_dir / f"{run_id}.json"
        if result_path.is_file():
            try:
                result = json.loads(result_path.read_text("utf-8"))
            except (OSError, ValueError) as exc:
                raise ValueError(
                    f"result for run {run_id} is unreadable; the TTL sweep will clear it"
                ) from exc
            if not isinstance(result, dict):
                raise ValueError(
                    f"result for run {run_id} is not an object; the TTL sweep will clear it"
                )
            self._ledger.append(build_result_row(run_id, result))
            result_path.unlink(missing_ok=True)
            return {"ok": True, "run_id": run_id, "status": "complete", "result": result}
        if (self.runs_dir / run_id).is_dir():
            return {"ok": True, "run_id": run_id, "status": "pending"}
        raise EstablishmentValidationError(
            "unknown run_id; results are one-shot reads and expire after "
            f"{RESULT_TTL_SECONDS // 60} minutes"
        )


__all__ = [
    "ESTABLISHMENT_RESULT_ACTION_TYPE",
    "ESTABLISHMENT_SUBMITTED_ACTION_TYPE",
    "MAX_DOCS_PER_SET",
    "MAX_DOC_TEXT_BYTES",
    "MAX_SET_BYTES",
    "MAX_SPEC_BODY_BYTES",
    "RESULT_TTL_SECONDS",
    "SPEC_PROPERTIES",
    "STAGING_TTL_SECONDS",
    "SUBMIT_PHASES",
    "EstablishmentStore",
    "EstablishmentValidationError",
    "build_result_row",
    "normalize_lf",
    "safe_slug",
]
