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

PROPOSE / READ BACK / CONFIRM (ss-console#2529, ADR 0085 §4 as amended
2026-08-21). A firm also establishes by talking: an admin writes one sentence
about how a kind of output should read, and any person writes one about their
own work. That sentence has no corpus, so it cannot cross the staged-document
path above, and the compilers that gate that path all refuse an empty corpus.
What replaces them is a readback the person answers:

    establish_propose   the sentence is stored PENDING, and the broker returns
                        the canonical block the seat must send verbatim
    establish_pending   what this sender may still confirm
    establish_submit    scope firm_adjust (or person) with the proposal id

THE ROW IS THE AUTHORITY ON WHAT WAS AGREED. At submit, the committed text and
subject come out of the pending row, never off the wire. A request carrying a
different text is refused rather than quietly overwritten, because the person
said yes to a specific sentence and the only way that yes means anything is if
the committed bytes are the bytes they were shown. Consumption is a conditional
UPDATE, so a proposal commits exactly once.

WHAT THIS MODULE STILL CANNOT SEE. Whether the sender is an Operator admin.
``instructed_by`` remains provenance, never authorization, on every verb here
(the corrections ``stated_by`` posture); the admin gate is seat-side, against
the authored allow list in customer.yaml, which this uid cannot read.
"""

from __future__ import annotations

import json
import re
import secrets
import shutil
import sqlite3
import time
from hashlib import sha256
from pathlib import Path
from typing import Any

from .audit_ledger import _iso_utc

# Pinned audit action types — exactly one per writing verb (discipline 1).
ESTABLISHMENT_SUBMITTED_ACTION_TYPE = "ESTABLISHMENT_SUBMITTED"
ESTABLISHMENT_RESULT_ACTION_TYPE = "ESTABLISHMENT_RESULT"
RULE_PROPOSED_ACTION_TYPE = "RULE_PROPOSED"

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

# Identifier charset — mirrors the intake's ``_SAFE_SEGMENT`` exactly
# (overlay establish_intake/intake.py): lowercase first char, [a-z0-9_-]
# after, ≤64. The broker mints ids as lowercase hex (token_hex) so they
# always match; a caller-echoed id outside the charset is refused. Excludes
# ``/`` and ``.`` so an identifier can never traverse.
_ID_PATTERN = re.compile(r"\A[a-z0-9][a-z0-9_-]{7,63}\Z")

_NAME_SLUG_KEEP = set("abcdefghijklmnopqrstuvwxyz0123456789._-")

# --- proposed rules (ss-console#2529) --------------------------------------

# The two scopes a spoken rule can carry. ``firm_adjust`` is one sentence about
# how a kind of firm output reads; ``person`` is one about the speaker's own
# work. There is deliberately no third: a rule about somebody ELSE's work is a
# firm rule, and it should be said as one.
PROPOSAL_SCOPES: frozenset[str] = frozenset({"person", "firm_adjust"})

# A proposal id is eight lowercase hex characters: short enough for a person to
# quote back in an email, long enough that a second live proposal is not going
# to collide with it. It becomes the adjustment's id, and the applier pins the
# same shape (overlay spec_applier/applier.py).
PROPOSAL_ID_HEX_BYTES = 4
_PROPOSAL_ID_PATTERN = re.compile(r"\A[0-9a-f]{8}\Z")

# A day. Long enough that a rule stated on Friday afternoon can be confirmed on
# Monday morning; short enough that a stale "yes" on a forgotten thread commits
# nothing. Past it the Operator asks the person to state the rule again, which
# costs one sentence and re-establishes that they still mean it.
PROPOSAL_TTL_SECONDS = 86_400

# How long a consumed row is kept after it commits. It is kept at all so a
# retry of the same confirmation gets "that rule was already committed" rather
# than "unknown proposal", which reads to the firm like the rule was lost.
CONSUMED_RETENTION_SECONDS = 86_400

# Ceiling on a spoken rule. It is a sentence, not a document; the applier holds
# the identical bound, so a rule this accepts is one the seat can render.
MAX_RULE_TEXT_BYTES = 2000

CREATE_PENDING_RULES_SQL = (
    "CREATE TABLE IF NOT EXISTS pending_rules ("
    "proposal_id TEXT PRIMARY KEY, "
    "scope TEXT NOT NULL, "
    "subject_json TEXT NOT NULL, "
    "text TEXT NOT NULL, "
    "text_sha256 TEXT NOT NULL, "
    "instructed_by TEXT NOT NULL, "
    "for_admin INTEGER NOT NULL DEFAULT 0, "
    "created_at REAL NOT NULL, "
    "expires_at REAL NOT NULL, "
    "consumed_at REAL, "
    "consumed_run_id TEXT"
    ")"
)
CREATE_PENDING_RULES_INDEX_SQL = (
    "CREATE INDEX IF NOT EXISTS idx_pending_rules_open "
    "ON pending_rules(instructed_by, expires_at) WHERE consumed_at IS NULL"
)


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
            f"{field} must match [a-z0-9][a-z0-9_-]{{7,63}}; refusing to rewrite it"
        )
    return ident


def _require_proposal_id(value: Any, field: str = "proposal_id") -> str:
    ident = _require_text(value, field, 64)
    if not _PROPOSAL_ID_PATTERN.match(ident):
        raise EstablishmentValidationError(
            f"{field} must be eight lowercase hex characters; refusing to rewrite it"
        )
    return ident


def require_address(value: Any, field: str) -> str:
    """One person's email address, lowercased. Refused, never repaired.

    Lifted verbatim out of ``_submit_person`` so the propose path, the pending
    lookup, and the submit path all decide "is this the same person" the same
    way. Two different normalizations here would mean a rule a person can
    propose and then cannot confirm.
    """
    raw = _require_text(value, field, _MAX_SHORT_TEXT)
    address = raw.strip().lower()
    local, sep, domain = address.partition("@")
    if not local or sep != "@" or "@" in domain or "." not in domain:
        raise EstablishmentValidationError(
            f"{field} must be a single person email address (local@domain)"
        )
    return address


def normalize_rule_text(value: Any) -> str:
    """The spoken rule, reduced to the one line a person can be shown.

    CRLF and lone CR fold to LF (the portal writer's precedent), and every
    remaining line break folds to a single space. The second step is not
    cosmetic: the readback is one quoted line, the rendered adjustment is one
    bullet, and a rule that renders differently from the sentence the person
    confirmed defeats the entire point of asking them. Normalizing here — before
    the hash, before the readback, before anything is stored — is what makes
    "what you confirmed is what was committed" true byte for byte.
    """
    if not isinstance(value, str):
        raise EstablishmentValidationError("text must be a string")
    text = re.sub(r"\s*\n\s*", " ", normalize_lf(value)).strip()
    if not text:
        raise EstablishmentValidationError("text must not be empty")
    encoded = text.encode("utf-8")
    if len(encoded) > MAX_RULE_TEXT_BYTES:
        raise EstablishmentValidationError(
            f"text is {len(encoded)} bytes; the ceiling is {MAX_RULE_TEXT_BYTES}. "
            "A standing rule is a sentence; establish a longer one from documents"
        )
    return text


def readback_for(proposal_id: str, text: str) -> str:
    """The canonical block the seat must send verbatim, rendered broker-side.

    Rendered HERE rather than composed by the model, and returned from
    ``establish_propose``, so the sentence the person is shown is the sentence
    in the row. The seat's containment gate refuses any send-shaped tool on a
    proposing turn unless this appears in the outgoing body (overlay PR 2), and
    that is what makes "you confirmed exactly this" checkable rather than
    asserted.
    """
    return f"[rule {proposal_id}] {text}"


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
    which is deleted after this row is appended. Demotion entries arrive as
    ``{rule_id, documents, detail}`` (the intake's selftest gate); ``detail``
    is deliberately NOT retained — it is compiler prose that may quote, and
    retained records carry names, ids, and counts only.
    """
    demotions: list[dict[str, Any]] = []
    raw_demotions = result.get("demotions")
    if isinstance(raw_demotions, list):
        for entry in raw_demotions[:50]:
            if not isinstance(entry, dict):
                continue
            rule_id = _bounded_str(entry.get("rule_id"))
            raw_docs = entry.get("documents")
            documents = []
            if isinstance(raw_docs, list):
                documents = [
                    d[:_MAX_SHORT_TEXT] for d in raw_docs[:MAX_DOCS_PER_SET] if isinstance(d, str)
                ]
            demotions.append({"rule_id": rule_id, "documents": documents})

    metadata = {
        "run_id": run_id,
        "verdict": _bounded_str(result.get("status")),
        "phase": _bounded_str(result.get("phase")),
        "scope": _bounded_str(result.get("scope")),
        "person": _bounded_str(result.get("person")),
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


class PendingRuleStore:
    """Rules stated but not yet confirmed, in the broker-owned audit DB.

    WHY A TABLE AND NOT THE SPOOL. Every inbound email is its own Hermes
    session (the webhook chat id is ``route:delivery_id``), so nothing
    session-keyed survives from the turn that proposes a rule to the turn that
    confirms it. The spool is transient by design and swept on a 30-minute TTL,
    which is shorter than a partner's lunch. This needs to outlive both, and the
    audit DB is already the one file on this Machine the broker uid owns
    read-write and the agent uid can only read — the same reasoning that put the
    job ledger there (``job_ledger.py``): one mount, one uid boundary.

    THE AUDIT LOG IS UNTOUCHED. No verb here writes ``audit_log``; its
    append-only guarantee is the absence of any update or delete verb over that
    table, and these touch only ``pending_rules``.

    BROKER CLOCK ONLY. Every timestamp is read from this process, never off the
    wire. A caller that could supply ``now`` could hold a proposal open forever,
    or expire someone else's.
    """

    def __init__(self, db_path: str | Path) -> None:
        self._db_path = str(db_path)
        self.ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        # Connection discipline copied from JobLedgerWriter deliberately: a
        # fresh connection per operation, journal_mode=DELETE (keeps the
        # agent-uid mode=ro read seam off the cross-uid -wal/-shm surface), and
        # a busy timeout to serialize concurrent writers.
        conn = sqlite3.connect(self._db_path, timeout=5.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=DELETE")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def ensure_schema(self) -> None:
        conn = self._connect()
        try:
            conn.execute(CREATE_PENDING_RULES_SQL)
            conn.execute(CREATE_PENDING_RULES_INDEX_SQL)
            conn.commit()
        finally:
            conn.close()

    def sweep(self, now: float | None = None) -> int:
        """Drop expired proposals and long-committed ones. Returns rows removed.

        Called on every establishment verb, so the table stays bounded without a
        timer. An expired row is removed rather than kept as a tombstone: after
        a day the honest answer to a late "yes" is "state it again", and that is
        also the answer an absent row produces.
        """
        now = time.time() if now is None else now
        conn = self._connect()
        try:
            cursor = conn.execute(
                "DELETE FROM pending_rules WHERE "
                "(consumed_at IS NULL AND expires_at < ?) OR "
                "(consumed_at IS NOT NULL AND consumed_at < ?)",
                (now, now - CONSUMED_RETENTION_SECONDS),
            )
            conn.commit()
            return cursor.rowcount or 0
        finally:
            conn.close()

    def create(
        self,
        *,
        scope: str,
        subject: dict[str, Any],
        text: str,
        instructed_by: str,
        for_admin: bool,
    ) -> dict[str, Any]:
        """Store one proposal and return it. The id and both times are minted
        here; the digest is computed here over the stored text."""
        now = time.time()
        digest = _hash_text(text)
        conn = self._connect()
        try:
            for _attempt in range(8):
                proposal_id = secrets.token_hex(PROPOSAL_ID_HEX_BYTES)
                try:
                    conn.execute(
                        "INSERT INTO pending_rules ("
                        "proposal_id, scope, subject_json, text, text_sha256, "
                        "instructed_by, for_admin, created_at, expires_at"
                        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            proposal_id,
                            scope,
                            json.dumps(subject, sort_keys=True, separators=(",", ":")),
                            text,
                            digest,
                            instructed_by,
                            1 if for_admin else 0,
                            now,
                            now + PROPOSAL_TTL_SECONDS,
                        ),
                    )
                    conn.commit()
                    break
                except sqlite3.IntegrityError:
                    # A live proposal already holds that id. Mint another
                    # rather than reuse it: two rules answering to one tag is
                    # exactly the ambiguity the tag exists to remove.
                    continue
            else:
                raise EstablishmentValidationError(
                    "could not mint a free proposal id; try again"
                )
        finally:
            conn.close()
        return {
            "proposal_id": proposal_id,
            "scope": scope,
            "subject": subject,
            "text": text,
            "text_sha256": digest,
            "instructed_by": instructed_by,
            "for_admin": for_admin,
            "created_at": now,
            "expires_at": now + PROPOSAL_TTL_SECONDS,
        }

    def get(self, proposal_id: str) -> dict[str, Any] | None:
        """One row in ANY state — open, expired, or consumed.

        Deliberately not filtered: the submit path needs to tell "expired" from
        "already committed" from "never existed", and those are three different
        sentences to a person waiting on an answer.
        """
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM pending_rules WHERE proposal_id=?", (proposal_id,)
            ).fetchone()
        finally:
            conn.close()
        return self._hydrate(row) if row is not None else None

    def open_for(
        self, sender: str, include_for_admin: bool, now: float | None = None
    ) -> list[dict[str, Any]]:
        """Unconsumed, unexpired rules this sender may confirm.

        Their OWN pending rules always; every rule awaiting an admin only when
        the caller says so. The seat passes ``include_for_admin`` for an admin
        sender and not otherwise — the admin decision is one this uid cannot
        make, so it is taken as an argument rather than guessed at.
        """
        now = time.time() if now is None else now
        sql = (
            "SELECT * FROM pending_rules WHERE consumed_at IS NULL AND expires_at >= ? "
            "AND (instructed_by = ?"
        )
        params: list[Any] = [now, sender]
        if include_for_admin:
            sql += " OR for_admin = 1"
        sql += ") ORDER BY created_at ASC"
        conn = self._connect()
        try:
            rows = conn.execute(sql, params).fetchall()
        finally:
            conn.close()
        return [self._hydrate(row) for row in rows]

    def consume(self, proposal_id: str, run_id: str) -> bool:
        """Mark one proposal committed. True iff THIS call consumed it.

        A conditional UPDATE, so consume-once is enforced by the database rather
        than by a read-then-write the caller could interleave. A second
        confirmation of the same rule loses the race and is told the rule is
        already in effect, which is both true and the only safe answer: the
        alternative is the firm's sentence rendered twice.
        """
        now = time.time()
        conn = self._connect()
        try:
            cursor = conn.execute(
                "UPDATE pending_rules SET consumed_at=?, consumed_run_id=? "
                "WHERE proposal_id=? AND consumed_at IS NULL",
                (now, run_id, proposal_id),
            )
            conn.commit()
            return bool(cursor.rowcount)
        finally:
            conn.close()

    @staticmethod
    def _hydrate(row: sqlite3.Row) -> dict[str, Any]:
        try:
            subject = json.loads(row["subject_json"])
        except ValueError:
            subject = {}
        return {
            "proposal_id": row["proposal_id"],
            "scope": row["scope"],
            "subject": subject if isinstance(subject, dict) else {},
            "text": row["text"],
            "text_sha256": row["text_sha256"],
            "instructed_by": row["instructed_by"],
            "for_admin": bool(row["for_admin"]),
            "created_at": row["created_at"],
            "expires_at": row["expires_at"],
            "consumed_at": row["consumed_at"],
            "consumed_run_id": row["consumed_run_id"],
        }


class EstablishmentStore:
    """The broker's half of the establishment spool.

    Layout (created and moded by the entrypoint, never here — the spool root is
    root-owned and the broker uid cannot create it):

        <root>/staging/<staging_id>/meta.json      broker-written
        <root>/staging/<staging_id>/docs/<id>.json broker-written (holds text)
        <root>/staging/<staging_id>/analysis/      ROOT-written (intake), 0700
        <root>/runs/<run_id>/submission.json       broker-written
        <root>/runs/<run_id>/docs/<id>.json        broker-moved from staging
        <root>/results/<run_id>.json               ROOT-written 0640, one-shot

    Runs are assembled complete (INCLUDING submission.json) in a dot-prefixed
    temp dir and atomically renamed into place; the intake skips dot-prefixed
    entries and run dirs without a submission.json, so it never observes a
    half-written submission (overlay establish_intake/intake.py, the other
    half of this contract).

    Lifecycle split with the root intake: the intake purges each RUN dir after
    writing its result, purges the whole staging set after an install run, and
    backstop-sweeps staging at its own longer TTL — because the broker cannot
    remove the root-owned ``analysis/`` subdir the analyze phase leaves in a
    staging set. The broker's sweep therefore only removes staging sets it
    fully owns, and enforces expiry on the rest by refusal.
    """

    def __init__(
        self, spool_root: str | Path, ledger: Any, pending_db_path: str | Path | None = None
    ) -> None:
        self.root = Path(spool_root)
        self.staging_dir = self.root / "staging"
        self.runs_dir = self.root / "runs"
        self.results_dir = self.root / "results"
        self._ledger = ledger
        # ss-console#2529. Absent on a broker with no audit DB configured, in
        # which case the propose/confirm verbs refuse by name rather than
        # half-working: a rule the firm cannot be shown back is a rule it cannot
        # confirm, and committing one without the readback is the thing this
        # whole path exists to avoid.
        self.pending = PendingRuleStore(pending_db_path) if pending_db_path else None

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
                if (entry / "analysis").is_dir():
                    # Root-owned analyze artifacts the broker cannot remove.
                    # Don't try — a partial rmtree leaves a zombie set. The
                    # intake's backstop sweep purges these as root; expiry is
                    # still ENFORCED broker-side by _require_staging's age
                    # check, so the lingering dir grants nothing.
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
        if self.pending is not None:
            try:
                self.pending.sweep(now)
            except sqlite3.Error:
                # Best-effort, same as the rest of this sweep: a table that
                # cannot be swept must not refuse the verb that triggered it.
                # Expiry is still ENFORCED at read and at submit, so a lingering
                # row grants nothing.
                pass

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
            # Lowercase hex so the id always matches the intake's _SAFE_SEGMENT.
            staging_id = secrets.token_hex(12)
            staging_path = self.staging_dir / staging_id
            (staging_path / "docs").mkdir(parents=True)
            (staging_path / "meta.json").write_text(
                json.dumps({"created_at": time.time()}), "utf-8"
            )
        else:
            staging_id, staging_path = self._require_staging(staging_id_raw)

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
            doc_id = f"doc-{secrets.token_hex(4)}"
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
        # Expiry is enforced here by refusal, not only by the sweep: a set the
        # broker cannot remove (root-owned analysis/ inside) lingers until the
        # intake's backstop purge, and lingering must not extend its life.
        if time.time() - self._staging_created_at(staging_path) > STAGING_TTL_SECONDS:
            raise EstablishmentValidationError(
                "staging set expired "
                f"({STAGING_TTL_SECONDS // 60}-minute TTL); stage the documents again"
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
    # establish_propose  (ss-console#2529)
    # ------------------------------------------------------------------

    def _require_pending(self) -> PendingRuleStore:
        if self.pending is None:
            raise EstablishmentValidationError(
                "this broker has no rule store configured; nothing was recorded"
            )
        return self.pending

    def propose(self, request: dict[str, Any]) -> dict[str, Any]:
        """Record one spoken rule as PENDING and return the readback to send.

        Nothing is installed here and nothing is in effect. What the caller gets
        back is the exact block to put in front of the person, plus the id they
        will quote when they answer. The seat may not claim effect off the back
        of this call — that claim belongs after a submit whose result says
        ``installed`` (the honest-status rule the intake's converge-wait exists
        to support).
        """
        pending = self._require_pending()
        scope = request.get("scope")
        if scope not in PROPOSAL_SCOPES:
            raise EstablishmentValidationError(
                f"scope must be one of {sorted(PROPOSAL_SCOPES)}; got {scope!r}"
            )
        instructed_by = require_address(request.get("instructed_by"), "instructed_by")
        source_ref = _require_text(request.get("source_ref"), "source_ref", _MAX_SHORT_TEXT)

        for_admin_raw = request.get("for_admin", False)
        if not isinstance(for_admin_raw, bool):
            raise EstablishmentValidationError("for_admin must be a boolean")
        for_admin = for_admin_raw

        subject_raw = request.get("subject")
        if not isinstance(subject_raw, dict):
            raise EstablishmentValidationError(
                "subject must be an object: {person} for a personal rule, "
                "{output_class, property} for a firm rule"
            )
        if scope == "person":
            if for_admin:
                raise EstablishmentValidationError(
                    "for_admin must be false on a personal rule; a person's own "
                    "preference is theirs to set and needs nobody to apply it"
                )
            person = require_address(subject_raw.get("person"), "subject.person")
            if person != instructed_by:
                # The seat gate says the same thing, and says it first. Repeated
                # here because a broker that would install one person's
                # preferences on another's say-so is a broker whose only defence
                # is a hook it cannot see.
                raise EstablishmentValidationError(
                    "a personal rule's subject must be the person stating it; "
                    "a rule about someone else's work is a firm rule"
                )
            subject: dict[str, Any] = {"person": person}
        else:
            subject = {
                "output_class": _require_class_slug(subject_raw.get("output_class")),
                "property": _require_property(subject_raw.get("property")),
            }

        text = normalize_rule_text(request.get("text"))
        row = pending.create(
            scope=scope,
            subject=subject,
            text=text,
            instructed_by=instructed_by,
            for_admin=for_admin,
        )

        metadata = {
            "proposal_id": row["proposal_id"],
            "scope": scope,
            "for_admin": for_admin,
            "instructed_by": instructed_by,
            "source_ref": source_ref,
            # The rule's TEXT is not here and must never be. A proposal is a
            # sentence a person typed in an email, retained rows carry ids,
            # names, and counts (ADR 0083's posture), and the digest is what
            # makes the committed text checkable against the proposed one
            # without keeping a second copy of it in the ledger.
            "text_sha256": row["text_sha256"],
        }
        metadata.update(subject)
        self._ledger.append(
            {
                "action_type": RULE_PROPOSED_ACTION_TYPE,
                "actor": "operator",
                "actor_role": "agent",
                "metadata": json.dumps(metadata, sort_keys=True, separators=(",", ":")),
            }
        )
        return {
            "ok": True,
            "proposal_id": row["proposal_id"],
            "scope": scope,
            "subject": subject,
            "for_admin": for_admin,
            "expires_at": row["expires_at"],
            "readback": readback_for(row["proposal_id"], text),
        }

    # ------------------------------------------------------------------
    # establish_pending  (ss-console#2529)
    # ------------------------------------------------------------------

    def pending_rules(self, request: dict[str, Any]) -> dict[str, Any]:
        """What this sender can still confirm. Read-only, so no audit row.

        Two shapes. By ``sender``: their own open proposals, plus every proposal
        awaiting an admin when ``include_for_admin`` is set. By ``proposal_id``:
        that one row if it is still open, an empty list otherwise — a lookup, not
        an assertion that it can be confirmed.
        """
        pending = self._require_pending()
        proposal_id_raw = request.get("proposal_id")
        if proposal_id_raw is not None:
            proposal_id = _require_proposal_id(proposal_id_raw)
            row = pending.get(proposal_id)
            open_rows = (
                [row]
                if row is not None
                and row["consumed_at"] is None
                and row["expires_at"] >= time.time()
                else []
            )
            return {"ok": True, "pending": [self._pending_view(r) for r in open_rows]}
        sender = require_address(request.get("sender"), "sender")
        include_raw = request.get("include_for_admin", False)
        if not isinstance(include_raw, bool):
            raise EstablishmentValidationError("include_for_admin must be a boolean")
        rows = pending.open_for(sender, include_raw)
        return {"ok": True, "pending": [self._pending_view(r) for r in rows]}

    @staticmethod
    def _pending_view(row: dict[str, Any]) -> dict[str, Any]:
        """One row as the seat sees it, readback included.

        The readback is re-rendered from the stored text rather than stored
        alongside it, so a row can never carry a readback that disagrees with the
        sentence it holds.
        """
        return {
            "proposal_id": row["proposal_id"],
            "scope": row["scope"],
            "subject": row["subject"],
            "text": row["text"],
            "readback": readback_for(row["proposal_id"], row["text"]),
            "instructed_by": row["instructed_by"],
            "for_admin": row["for_admin"],
            "created_at": row["created_at"],
            "expires_at": row["expires_at"],
        }

    def _claim_proposal(self, request: dict[str, Any], scope: str) -> dict[str, Any]:
        """Load the pending row a submit names, and refuse it by NAME if it
        cannot be committed.

        Four refusals, deliberately distinguishable: never existed, expired,
        already committed, and stated for a different kind of rule. Collapsing
        them into one message would leave a person who confirmed a rule on
        Monday unable to tell "you already have it" from "it is gone".
        """
        pending = self._require_pending()
        proposal_id = _require_proposal_id(request.get("proposal_id"))
        row = pending.get(proposal_id)
        if row is None:
            raise EstablishmentValidationError(
                f"no rule was proposed under {proposal_id}; state the rule again"
            )
        if row["consumed_at"] is not None:
            raise EstablishmentValidationError(
                f"rule {proposal_id} was already committed; it is in effect"
            )
        if row["expires_at"] < time.time():
            raise EstablishmentValidationError(
                f"rule {proposal_id} expired; state it again"
            )
        if row["scope"] != scope:
            raise EstablishmentValidationError(
                f"rule {proposal_id} was proposed as {row['scope']!r}, "
                f"not {scope!r}; refusing to change what it applies to"
            )
        return row

    @staticmethod
    def _refuse_restated(
        request: dict[str, Any], row: dict[str, Any], fields: dict[str, Any]
    ) -> None:
        """A submit may ECHO the proposal's fields; it may not change them.

        THE POINT OF THE WHOLE MECHANISM, stated as code: the person answered
        "yes" to one specific sentence about one specific kind of output, and
        that yes means nothing unless the committed bytes are the bytes they saw.
        So a differing value is a REFUSAL, never a silent substitution — the
        substitution is precisely the attack, and it would leave the firm holding
        a rule it never agreed to with a ledger row saying it confirmed one.
        """
        for field, expected in fields.items():
            supplied = request.get(field)
            if supplied is None:
                continue
            if isinstance(supplied, str) and isinstance(expected, str):
                if field in ("text", "spec_body"):
                    supplied = normalize_rule_text(supplied)
                if supplied == expected:
                    continue
            elif supplied == expected:
                continue
            raise EstablishmentValidationError(
                f"{field} does not match rule {row['proposal_id']} as it was proposed "
                "and confirmed; the committed rule comes from the proposal, "
                "not from this request"
            )

    # ------------------------------------------------------------------
    # establish_submit
    # ------------------------------------------------------------------

    def submit(self, request: dict[str, Any]) -> dict[str, Any]:
        """Validate a submission, append its audit row, and materialize the run.

        The audit row is appended BEFORE the run dir is renamed into place: a
        run the root intake can see without a ledger row would be an unaudited
        install path, which is the worse failure than a row for a run that
        never materialized.

        Three scopes (ADR 0085 §2/§4/§6). ``firm`` (the default) is the staged-
        corpus path below — Operator admins only, gated seat-side. ``person``
        records the SPEAKER's own preferences: no staging, no corpus, no
        compiler gates; the seat-side predicate pins the subject to the
        attributed sender, and the intake re-validates shape + roster.
        ``firm_adjust`` commits one confirmed sentence against an output class,
        and REQUIRES a proposal id — there is no route by which a firm-wide rule
        installs without a person having been shown it and having said yes.
        """
        scope = request.get("scope") or "firm"
        if scope not in ("firm", "person", "firm_adjust"):
            raise EstablishmentValidationError(
                f"scope must be 'firm', 'person', or 'firm_adjust'; got {scope!r}"
            )
        if scope == "firm_adjust":
            return self._submit_firm_adjust(request, secrets.token_hex(16))
        if scope == "person":
            return self._submit_person(request, secrets.token_hex(16))
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

        # Lowercase hex so the id always matches the intake's _SAFE_SEGMENT.
        run_id = secrets.token_hex(16)
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
        # The intake's submission contract (its module docstring): run_id,
        # staging_id, phase, created_at. The doc files in docs/ carry the rest.
        submission = {
            "phase": "analyze",
            "scope": "firm",
            "run_id": run_id,
            "staging_id": staging_id,
            "created_at": time.time(),
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
        # The intake's submission contract (its module docstring). The manifest
        # is REBUILT from the broker-verified selection — the intake re-checks
        # that it maps 1:1 onto the run's docs with matching hashes.
        submission = {
            "phase": "install",
            "scope": "firm",
            "run_id": run_id,
            "staging_id": staging_id,
            "output_class": output_class,
            "property": prop,
            "spec_body": body,
            "spec_sha256": spec_digest,
            "assertions": assertions,
            "corpus_manifest": [
                {"doc_id": d["doc_id"], "sha256": d["sha256"]} for d in selected
            ],
            # Provenance for the audit trail, never authorization — the broker
            # cannot verify a claimed instructor (same posture as corrections
            # ``stated_by``); the authorization gate is the admin hook seat-side.
            "instructed_by": instructed_by,
            "source_ref": source_ref,
            "created_at": time.time(),
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
                    "assertion_count": len((assertions or {}).get("rules") or []),
                    "instructed_by": instructed_by,
                    "source_ref": source_ref,
                },
                sort_keys=True,
                separators=(",", ":"),
            ),
        }
        self._ledger.append(row)
        # Install MOVES the manifest docs into the run. The staging set itself
        # is deliberately NOT removed here: the intake's leak check reads the
        # root-owned analysis/approved_strings.json out of it DURING the run,
        # and the intake purges the whole set (analysis included, as root)
        # after the run completes — pass or fail.
        self._materialize_run(run_id, submission, selected, move=True)
        return {"ok": True, "run_id": run_id, "phase": "install", "status": "queued"}

    def _submit_firm_adjust(self, request: dict[str, Any], run_id: str) -> dict[str, Any]:
        """Commit one confirmed sentence as a standing adjustment.

        A PROPOSAL ID IS NOT OPTIONAL HERE. The whole control on this path is
        that a person was shown the rule and answered; a submit that carried its
        own text would be the agent writing a firm-wide rule off its own reading
        of an email, which is the witness-never-author line ADR 0085 §4 moved
        only as far as "an admin's confirmed sentence".

        WHO IS RECORDED AS WHAT. ``instructed_by`` on the ROW is whoever stated
        the rule — often a paralegal whose firm-level remark waits for an admin.
        ``applied_by`` is the sender confirming this submit. Both ride onto the
        installed adjustment and both render in the spec file, so the firm can
        read who asked for a rule and who put it in force.
        """
        row = self._claim_proposal(request, "firm_adjust")
        subject = row["subject"]
        output_class = _require_class_slug(subject.get("output_class"))
        prop = _require_property(subject.get("property"))
        self._refuse_restated(
            request,
            row,
            {
                "output_class": output_class,
                "property": prop,
                "text": row["text"],
                "spec_body": row["text"],
            },
        )
        applied_by = require_address(request.get("instructed_by"), "instructed_by")
        source_ref = _require_text(request.get("source_ref"), "source_ref", _MAX_SHORT_TEXT)

        if not self._require_pending().consume(row["proposal_id"], run_id):
            # Lost the race to a concurrent confirmation. Refuse rather than
            # install twice: the firm's sentence rendering twice in its own spec
            # file is a worse outcome than one redundant refusal.
            raise EstablishmentValidationError(
                f"rule {row['proposal_id']} was already committed; it is in effect"
            )

        adjustment = {
            "id": row["proposal_id"],
            "text": row["text"],
            "sha256": row["text_sha256"],
            "instructed_by": row["instructed_by"],
            "applied_by": applied_by,
            "at": _iso_utc(),
        }
        submission = {
            "phase": "install",
            "scope": "firm_adjust",
            "run_id": run_id,
            "output_class": output_class,
            "property": prop,
            "adjustment": adjustment,
            "instructed_by": applied_by,
            "source_ref": source_ref,
            "created_at": time.time(),
        }
        self._ledger.append(
            {
                "action_type": ESTABLISHMENT_SUBMITTED_ACTION_TYPE,
                "actor": "operator",
                "actor_role": "agent",
                "metadata": json.dumps(
                    {
                        "phase": "install",
                        "scope": "firm_adjust",
                        "run_id": run_id,
                        "proposal_id": row["proposal_id"],
                        "output_class": output_class,
                        "property": prop,
                        # Digest, never the sentence (ADR 0083's retention
                        # posture). It is also what lets a later reader prove
                        # the committed rule is the proposed one, since the
                        # RULE_PROPOSED row carries the same digest.
                        "spec_sha256": row["text_sha256"],
                        "instructed_by": row["instructed_by"],
                        "applied_by": applied_by,
                        "for_admin": row["for_admin"],
                        "source_ref": source_ref,
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                ),
            }
        )
        self._materialize_run(run_id, submission, [], move=False)
        return {
            "ok": True,
            "run_id": run_id,
            "phase": "install",
            "scope": "firm_adjust",
            "proposal_id": row["proposal_id"],
            "status": "queued",
        }

    def _submit_person(self, request: dict[str, Any], run_id: str) -> dict[str, Any]:
        """A person-scoped install: the speaker's own preferences, docs-less.

        Refuses every firm-path field a person submit must not carry —
        "present" means NON-NULL (the overlay sends ``staging_id: null``, key
        present). The subject was already pinned to the attributed sender by
        the seat-side predicate; the broker re-validates SHAPE only, and the
        intake re-validates shape + roster (defense in depth, same split as
        the firm path).

        WITH A ``proposal_id`` (ss-console#2529) the person and the body come
        out of the pending row rather than off the wire — the same readback
        discipline the firm path requires, offered here because a person who is
        asked "shall I remember that?" and says yes has told the Operator
        something an unconfirmed guess at their words has not. Without one the
        original direct path stands unchanged.

        ``append`` adds to the existing preference instead of replacing it.
        """
        for forbidden in ("staging_id", "corpus_manifest", "output_class", "property"):
            if request.get(forbidden) is not None:
                raise EstablishmentValidationError(
                    f"{forbidden} must not be supplied on a person-scoped submit"
                )
        append_raw = request.get("append", False)
        if not isinstance(append_raw, bool):
            raise EstablishmentValidationError("append must be a boolean")

        proposal_id: str | None = None
        if request.get("proposal_id") is not None:
            claimed = self._claim_proposal(request, "person")
            person = require_address(claimed["subject"].get("person"), "subject.person")
            self._refuse_restated(
                request,
                claimed,
                {"person": person, "spec_body": claimed["text"], "text": claimed["text"]},
            )
            confirmer = require_address(request.get("instructed_by"), "instructed_by")
            if confirmer != person:
                raise EstablishmentValidationError(
                    "a personal rule is confirmed by the person it belongs to; "
                    f"{confirmer} cannot confirm a preference for {person}"
                )
            if not self._require_pending().consume(claimed["proposal_id"], run_id):
                raise EstablishmentValidationError(
                    f"rule {claimed['proposal_id']} was already committed; it is in effect"
                )
            proposal_id = claimed["proposal_id"]
            body = claimed["text"]
            spec_digest = claimed["text_sha256"]
            instructed_by = confirmer
        else:
            person = require_address(request.get("person"), "person")
            body_raw = request.get("spec_body")
            if not isinstance(body_raw, str):
                raise EstablishmentValidationError("spec_body must be a string")
            body = normalize_lf(body_raw).strip()
            if not body:
                raise EstablishmentValidationError("spec_body must not be empty")
            body_bytes = body.encode("utf-8")
            if len(body_bytes) > MAX_SPEC_BODY_BYTES:
                raise EstablishmentValidationError(
                    f"spec_body is {len(body_bytes)} bytes after LF normalization; the ceiling is {MAX_SPEC_BODY_BYTES}"
                )
            spec_digest = sha256(body_bytes).hexdigest()
            instructed_by = _require_text(
                request.get("instructed_by"), "instructed_by", _MAX_SHORT_TEXT
            )

        assertions = self._validate_assertions(request.get("assertions"))
        source_ref = _require_text(request.get("source_ref"), "source_ref", _MAX_SHORT_TEXT)

        submission = {
            "phase": "install",
            "scope": "person",
            "run_id": run_id,
            "person": person,
            "spec_body": body,
            "spec_sha256": spec_digest,
            "assertions": assertions,
            "append": append_raw,
            # Provenance for the audit trail, never authorization (firm-path
            # posture; the authorization gate is the seat-side predicate).
            "instructed_by": instructed_by,
            "source_ref": source_ref,
            "created_at": time.time(),
        }
        metadata: dict[str, Any] = {
            "phase": "install",
            "scope": "person",
            "run_id": run_id,
            "person": person,
            "spec_sha256": spec_digest,
            "assertion_count": len((assertions or {}).get("rules") or []),
            "append": append_raw,
            "instructed_by": instructed_by,
            "source_ref": source_ref,
        }
        if proposal_id is not None:
            metadata["proposal_id"] = proposal_id
        row = {
            "action_type": ESTABLISHMENT_SUBMITTED_ACTION_TYPE,
            "actor": "operator",
            "actor_role": "agent",
            "metadata": json.dumps(metadata, sort_keys=True, separators=(",", ":")),
        }
        self._ledger.append(row)
        self._materialize_run(run_id, submission, [], move=False)
        result = {"ok": True, "run_id": run_id, "phase": "install", "status": "queued"}
        if proposal_id is not None:
            result["proposal_id"] = proposal_id
        return result

    def _validate_assertions(self, value: Any) -> dict[str, Any] | None:
        """Shape-and-bound check for assertions.

        The wire shape is an OBJECT carrying a ``rules`` list (the intake reads
        ``assertions.get("rules")`` and forwards the rules to the selftest
        compiler). Full rule-schema validation is deliberately NOT here: the
        selftest owns the rule schema and refuses malformed rules (exit 1,
        design §5). The broker guarantees the payload is a bounded JSON object
        whose rules are objects, and nothing else.
        """
        if value is None:
            return None
        if not isinstance(value, dict):
            raise EstablishmentValidationError(
                "assertions must be an object (with an optional 'rules' list)"
            )
        rules = value.get("rules")
        if rules is not None:
            if not isinstance(rules, list):
                raise EstablishmentValidationError("assertions.rules must be a list")
            if len(rules) > _MAX_ASSERTIONS:
                raise EstablishmentValidationError(
                    f"assertions.rules holds {len(rules)} rules; the ceiling is {_MAX_ASSERTIONS}"
                )
            for index, entry in enumerate(rules):
                if not isinstance(entry, dict):
                    raise EstablishmentValidationError(
                        f"assertions.rules[{index}] must be an object"
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
            # One-shot delete. The results dir is 0770 root:workspace-broker
            # (entrypoint-authored; the intake re-hardens to the same, its
            # overlay#221 fix), so this unlink succeeds in production. The
            # guard is resilience only: against a mis-hardened dir the read
            # must still succeed (the agent is owed the result it was
            # promised) and the intake's 30-min TTL sweep becomes the remover.
            try:
                result_path.unlink(missing_ok=True)
            except OSError:
                pass
            return {"ok": True, "run_id": run_id, "status": "complete", "result": result}
        if (self.runs_dir / run_id).is_dir():
            return {"ok": True, "run_id": run_id, "status": "pending"}
        raise EstablishmentValidationError(
            "unknown run_id; results are one-shot reads and expire after "
            f"{RESULT_TTL_SECONDS // 60} minutes"
        )


__all__ = [
    "CONSUMED_RETENTION_SECONDS",
    "ESTABLISHMENT_RESULT_ACTION_TYPE",
    "ESTABLISHMENT_SUBMITTED_ACTION_TYPE",
    "MAX_DOCS_PER_SET",
    "MAX_DOC_TEXT_BYTES",
    "MAX_RULE_TEXT_BYTES",
    "MAX_SET_BYTES",
    "MAX_SPEC_BODY_BYTES",
    "PROPOSAL_SCOPES",
    "PROPOSAL_TTL_SECONDS",
    "RESULT_TTL_SECONDS",
    "RULE_PROPOSED_ACTION_TYPE",
    "SPEC_PROPERTIES",
    "STAGING_TTL_SECONDS",
    "SUBMIT_PHASES",
    "EstablishmentStore",
    "EstablishmentValidationError",
    "PendingRuleStore",
    "build_result_row",
    "normalize_lf",
    "normalize_rule_text",
    "readback_for",
    "require_address",
    "safe_slug",
]
