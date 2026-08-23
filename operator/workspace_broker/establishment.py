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

AN OPERATIONS REQUEST IS THE THIRD THING THIS TABLE HOLDS (ss-console#2546,
ADR 0085 as amended 2026-08-23). A routine, a schedule, a channel, a memory
setting, an autonomy level, an on/off — those are SMD's to change, not the
firm's, so the firm cannot confirm one and there is nothing here to commit.
What the row is for is the OTHER half of the loop: somebody asked, SMD was
emailed, and the person who asked has to hear the answer. So an ``ops_request``
row is recorded (``ops_propose``), tagged ``[ops XXXX]`` for SMD to quote back,
and ended by ``ops_resolve`` with one of three words — done, declined,
withdrawn. It is NEVER confirmable: ``establish_submit`` and
``establish_decline`` refuse the kind by name, ``consume`` refuses it in SQL,
and ``open_for`` (the list of what a sender may still confirm) does not return
it at all. Three independent refusals rather than one, because "the firm
accidentally installed a routine change by saying yes" is the failure worth
three.

WHAT THIS MODULE STILL CANNOT SEE. Whether the sender is an Operator admin.
``instructed_by`` remains provenance, never authorization, on every verb here
(the corrections ``stated_by`` posture); the admin gate is seat-side, against
the authored allow list in customer.yaml, which this uid cannot read.
"""

from __future__ import annotations

import json
import logging
import re
import secrets
import shutil
import sqlite3
import time
from hashlib import sha256
from pathlib import Path
from typing import Any

from .audit_ledger import _iso_utc

logger = logging.getLogger(__name__)

# Pinned audit action types — exactly one per writing verb (discipline 1).
ESTABLISHMENT_SUBMITTED_ACTION_TYPE = "ESTABLISHMENT_SUBMITTED"
ESTABLISHMENT_RESULT_ACTION_TYPE = "ESTABLISHMENT_RESULT"
RULE_PROPOSED_ACTION_TYPE = "RULE_PROPOSED"
# ss-console#2546. The two ways a proposal ends without being committed, each
# pinned to exactly one writing verb so neither can forge the other:
# establish_decline writes RULE_DECLINED, establish_lapse_notified writes
# RULE_LAPSED.
RULE_DECLINED_ACTION_TYPE = "RULE_DECLINED"
RULE_LAPSED_ACTION_TYPE = "RULE_LAPSED"
# ss-console#2536. The same propose-read-back-confirm channel, carrying a TOOL
# CALL instead of a sentence. One pinned type per verb, exactly as above:
# ``act_propose`` appends only ACT_PROPOSED, ``act_commit`` only ACT_COMMITTED.
ACT_PROPOSED_ACTION_TYPE = "ACT_PROPOSED"
ACT_COMMITTED_ACTION_TYPE = "ACT_COMMITTED"
# ss-console#2546 (the operations half). Three types, one per writing verb, and
# they are DELIBERATELY not the RULE_* ones: a rule is a sentence the firm may
# apply itself, an operations request is a change only SMD makes, and a ledger
# that called them by the same name would make the audit answer to "who decided
# this" unreadable. ops_propose appends only OPS_REQUEST_RECORDED, ops_resolve
# only OPS_REQUEST_RESOLVED, and the lapse report only OPS_REQUEST_LAPSED.
OPS_REQUEST_RECORDED_ACTION_TYPE = "OPS_REQUEST_RECORDED"
OPS_REQUEST_RESOLVED_ACTION_TYPE = "OPS_REQUEST_RESOLVED"
OPS_REQUEST_LAPSED_ACTION_TYPE = "OPS_REQUEST_LAPSED"

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

#: The one result status that means the firm's rule is actually in force.
#: Mirrors ``establish_intake.intake.STATUS_INSTALLED``; the two are one
#: string across a root/broker boundary, so it is named on both sides rather
#: than spelled inline.
STATUS_INSTALLED = "installed"

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
PROPOSAL_SCOPES: frozenset[str] = frozenset({"person", "firm_adjust", "act", "ops"})

# ``ops`` is the fourth, and like ``act`` it is not a rule: it is one change to
# how the seat OPERATES (a routine, a schedule, a channel, a memory setting, an
# autonomy level, an on/off), which ADR 0085's 2026-08-22 amendment places with
# SMD rather than with the firm. It shares this table for the reason ``act``
# does — what has to survive from the asking turn to the answering one is a tag,
# a sentence, and a bounded memory — and it shares no path with either rule
# scope: ``establish_submit`` compares against ``person`` / ``firm_adjust`` and
# ``act_commit`` against ``act``, so a submit naming an ops row is refused by
# name in every direction.

# ``act`` is the third, and it is not a rule at all: it is one tool call the
# firm is shown before it happens. It shares this table because the thing that
# has to survive from the proposing turn to the confirming one is identical (a
# tag, a sentence, a 24-hour memory, a consume-once commit), and a second store
# would be a second set of the same bugs. It never shares the SUBMIT path: an
# act row's scope is ``act``, and every establish_submit scope check compares
# against ``person`` / ``firm_adjust``, so a submit naming an act proposal is
# refused by name rather than by luck.

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

# A week, for a RULE only (ss-console#2546). The 24 h bound above was written
# for a rule an admin states about their own firm and answers in the same
# conversation. It is the wrong bound for the loop this issue closes: a
# paralegal's rule is emailed to a named administrator, who may be in trial, and
# a request that dies overnight is a request the firm never had. Seven days is
# long enough to cross a week, short enough that a rule nobody answered lapses
# while the person who asked still remembers asking.
#
# ACTS KEEP 24 HOURS. An act is one tool call the Operator is holding, and the
# Captain's authorization for the confirm ceiling was given under that bound;
# widening it here would widen a commitment nobody widened. Which TTL applies is
# read from the row's ``kind``, never from the caller (``ttl_for_kind``).
RULE_TTL_SECONDS = 7 * 86_400

# How long a row is kept after it reaches a TERMINAL state — committed,
# declined, or lapsed. It is kept at all so a late answer gets the true sentence
# ("that rule was already committed", "an administrator declined it") rather
# than "unknown proposal", which reads to the firm like the rule was lost.
# Matched to RULE_TTL_SECONDS so the tombstone outlives the window in which a
# person could still be quoting the tag.
TERMINAL_RETENTION_SECONDS = 7 * 86_400

# ss-console#2546. HOW LONG ONE PROCESS MAY HOLD THE RIGHT TO SEND A ROW'S
# OUTCOME LETTER before another may take it. The claim exists because the seat
# runs the establishment plugin in TWO processes -- `hermes -p operator gateway
# run` (pid 658) and its child `hermes-smd-webhook-gate` (pid 1115), observed on
# pilot-smokeball 2026-08-23 (vfy_01M0QK1927KP54R7J13J2TH3WZ) -- each with its
# own sweeper thread. An in-process claim is therefore two claims, and on
# fc8f88c1 the requester was mailed the same outcome letter twice, 12 s apart.
# The broker is the one process both share, so the claim lives here.
#
# It EXPIRES rather than persisting, because a process that claimed a row and
# then died must not freeze that row's letter forever: unsent is the worse
# failure of the two, and it is the failure this whole issue exists to end. The
# window is wide enough to cover a mail send and narrow enough that a crashed
# sender costs one sweep interval.
NOTIFY_CLAIM_STALE_SECONDS = 120.0

# Ceiling on a spoken rule. It is a sentence, not a document; the applier holds
# the identical bound, so a rule this accepts is one the seat can render.
MAX_RULE_TEXT_BYTES = 2000

# --- proposed ACTS (ss-console#2536) ---------------------------------------

# The row kinds this table holds. ``rule`` is a sentence about how the firm's
# work reads; ``tool_call`` is one act the Operator is asking to perform. The
# default is ``rule`` so a table written before this change reads back as what
# it holds.
PROPOSAL_KINDS: frozenset[str] = frozenset({"rule", "tool_call", "ops_request"})

#: The kind an operations request carries, named once so the three refusals that
#: key on it (submit, decline, consume) cannot drift apart by a typo.
OPS_REQUEST_KIND = "ops_request"

#: The three ways an operations request ends, and there is deliberately no
#: fourth. ``done`` is SMD having made the change; ``declined`` is SMD saying no,
#: with the reason they wrote; ``withdrawn`` is the seat itself giving the row
#: back because it could not get the request out of the building — the one
#: outcome that sends the requester nothing, because nothing was ever asked.
OPS_OUTCOMES: frozenset[str] = frozenset({"done", "declined", "withdrawn"})

#: Ceiling on the quoted reason an outcome carries. It is one line of somebody
#: else's prose riding into an email the Operator sends under its own name, so
#: it is bounded, folded to one line, and stripped of links before it is stored.
MAX_OUTCOME_REASON = 300

# THE CLOSED VOCABULARY OF ACTS. A tool absent from this map cannot be
# proposed, whatever the caller says, and each entry pins the EXACT field set
# its payload carries. There is deliberately no wildcard and no "extra fields
# are fine" branch: the readback the firm reads is rendered from these fields,
# so a field the readback does not render is a field the firm did not agree to.
ACT_TOOLS: dict[str, tuple[str, ...]] = {
    "mcp_smokeball_create_matter": (
        "description",
        "matter_type_id",
        "client_contact_id",
        "number",
    ),
}

# The two display names the read-back shows the administrator, authored beside
# the identifiers in the same block so the sentence a person says yes to and the
# bytes the act carries come from one file. The overlay hook sends the block
# whole (identifiers and names together, hermes-smd-overlay#303/#305); the tool
# itself takes only ACT_TOOLS' fields. Names are accepted in the payload, at the
# request top level (``contact_name`` / ``matter_type_name``), or from the
# authored block, in that order of precedence, and must agree with the block
# when both are present.
ACT_NAME_KEYS: dict[str, tuple[str, ...]] = {
    "mcp_smokeball_create_matter": ("client_contact_name", "matter_type_name"),
}

# Where the authored act payload is read from on a live seat. The broker holds
# its own handle on this file (``SMD_CUSTOMER_YAML``, server.py) and re-reads it
# per proposal rather than caching: the file is root-owned and can be re-applied
# under a running broker, and a cached copy would let a config the firm has
# already changed keep authorizing acts.
ACT_CONFIG_KEYS: tuple[str, ...] = (
    "self_initiation",
    "document_library",
    "operator_matter",
)

# A display name resolved by the seat and rendered into the readback. Bounded,
# and refused rather than sanitized when it carries a bracket or a line break:
# the tag ``[act 1234abcd]`` is what binds a person's "yes" to one row, so a
# name that could contain a second tag could bind it to another row.
_MAX_ACT_DISPLAY_NAME = 120

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
    "consumed_run_id TEXT, "
    "kind TEXT NOT NULL DEFAULT 'rule', "
    "payload_json TEXT, "
    # ss-console#2546: the two non-committing ends of a proposal, and the mark
    # that the person who asked has been told about one of them.
    "declined_at REAL, "
    "declined_by TEXT, "
    "lapsed_at REAL, "
    "lapse_notified_at REAL, "
    # ss-console#2546 follow-up: the moment a COMMITTED rule was observed
    # installed. Its own column rather than an inference from consumed_at,
    # because committed and installed are hours apart in the failure case and
    # only one of them entitles anybody to say "in effect".
    "installed_at REAL, "
    # ss-console#2546 (the operations half). WHO at SMD answered an operations
    # request, and WHAT THEY WROTE when the answer was no. ``resolved_by`` is
    # separate from ``declined_by`` on purpose: that column means "an
    # administrator of the FIRM refused a rule", this one means "SMD answered a
    # request about the seat", and collapsing them would make the ledger's
    # answer to "who decided this" depend on which verb happened to run.
    "resolved_by TEXT, "
    "outcome_reason TEXT, "
    # The mark that SMD has already been asked, once, to answer in the two words
    # the parser reads. Without it an unparseable reply would be re-asked on
    # every turn that touched the row.
    "ask_sent_at REAL, "
    # ss-console#2546 (the duplicate-letter fix). WHICH observer currently holds
    # the right to send this row's outcome letter, and WHEN it took that right.
    # ``lapse_notified_at`` is the durable mark and is unchanged; this is the
    # short-lived claim that stops two processes both reading the row as
    # unreported, both sending, and only then racing to mark it.
    "notify_claimed_at REAL, "
    "notify_claimed_by TEXT"
    ")"
)
# Additive upgrade for a table created by ss-console#2529, applied at
# ensure_schema and each tolerated when the column already exists (the
# audit_ledger CHAIN_COLUMN_ALTERS shape). A seat that proposed a rule last
# week keeps that row, and reads it back as kind ``rule``.
PENDING_RULES_COLUMN_ALTERS: tuple[str, ...] = (
    "ALTER TABLE pending_rules ADD COLUMN kind TEXT NOT NULL DEFAULT 'rule'",
    "ALTER TABLE pending_rules ADD COLUMN payload_json TEXT",
    # ss-console#2546, same additive idiom: a seat carrying rows proposed under
    # #2529 or #2536 keeps them, and each reads back as open (all four are NULL
    # on an existing row, which is what an unanswered proposal is).
    "ALTER TABLE pending_rules ADD COLUMN declined_at REAL",
    "ALTER TABLE pending_rules ADD COLUMN declined_by TEXT",
    "ALTER TABLE pending_rules ADD COLUMN lapsed_at REAL",
    "ALTER TABLE pending_rules ADD COLUMN lapse_notified_at REAL",
    # ss-console#2546 follow-up. Absent reads as NULL, which is "committed but
    # nobody has observed it install" -- the conservative answer.
    "ALTER TABLE pending_rules ADD COLUMN installed_at REAL",
    # ss-console#2546 (the operations half), same additive idiom. A seat holding
    # rules and acts proposed last week keeps every one of them; all three read
    # back as NULL, which on a rule or an act is exactly right (no SMD answered
    # them, because they were never SMD's to answer).
    "ALTER TABLE pending_rules ADD COLUMN resolved_by TEXT",
    "ALTER TABLE pending_rules ADD COLUMN outcome_reason TEXT",
    "ALTER TABLE pending_rules ADD COLUMN ask_sent_at REAL",
    # ss-console#2546 (the duplicate-letter fix), same additive idiom. Absent
    # reads as NULL, which is "unclaimed" -- exactly right for every row that
    # existed before the claim did.
    "ALTER TABLE pending_rules ADD COLUMN notify_claimed_at REAL",
    "ALTER TABLE pending_rules ADD COLUMN notify_claimed_by TEXT",
)
CREATE_PENDING_RULES_INDEX_SQL = (
    "CREATE INDEX IF NOT EXISTS idx_pending_rules_open "
    "ON pending_rules(instructed_by, expires_at) WHERE consumed_at IS NULL"
)


def ttl_for_kind(kind: str) -> int:
    """How long a row of this kind stays answerable.

    Read from the STORED kind, never from the caller, so no request can widen
    the window its own proposal lives in. A rule gets a week (a named
    administrator may be in trial); an act keeps the day it has always had.

    An OPERATIONS REQUEST gets the rule's week, and for the same reason rather
    than by analogy: it is emailed to a person at SMD who may be with a client
    all day, and a request that dies overnight is a request the firm never had.
    """
    return (
        RULE_TTL_SECONDS
        if kind in ("rule", OPS_REQUEST_KIND)
        else PROPOSAL_TTL_SECONDS
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


#: Anything that looks like a link in a quoted reason. Deliberately broad: this
#: is not a URL parser, it is a refusal to relay a clickable target.
_URL_PATTERN = re.compile(r"(?i)\b(?:https?://|www\.)\S+")


def normalize_outcome_reason(value: Any) -> str | None:
    """The reason SMD wrote for declining, reduced to one quotable line.

    Three transformations, and each is a rewrite rather than a refusal — which
    is the one place in this module that is the right call, for the same reason
    ``_bounded_str`` truncates a root-authored result instead of refusing it.
    This text is not an identifier and nothing binds to it: it is prose a person
    typed, which the seat quotes back to the person who asked. Refusing a
    300-character reason would leave the request unanswered and the requester in
    the silence this whole issue exists to end, which is strictly worse than
    quoting the first 300 characters of it.

    1. Every line break folds to a space (``normalize_rule_text``'s rule), so a
       reason renders as one quoted line rather than as somebody else's layout.
    2. Anything link-shaped is replaced with ``[link removed]``. The reason
       rides an email the OPERATOR sends under its own name to a person at the
       firm, and the answering address is trusted only by the ``[ops XXXX]``
       tag it quoted; a live link would make a spoofed answer into a phish
       carried by the firm's own assistant. The marker is left visible on
       purpose — a silently deleted link changes what the sentence says.
    3. Truncated to :data:`MAX_OUTCOME_REASON`.

    ``None`` in, ``None`` out: no reason is a normal answer to "done".
    """
    if value is None:
        return None
    if not isinstance(value, str):
        raise EstablishmentValidationError("reason must be a string when present")
    folded = re.sub(r"\s+", " ", normalize_lf(value)).strip()
    folded = _URL_PATTERN.sub("[link removed]", folded)
    folded = re.sub(r"\s+", " ", folded).strip()
    if not folded:
        return None
    return folded[:MAX_OUTCOME_REASON]


def readback_for(proposal_id: str, text: str, kind: str = "rule") -> str:
    """The canonical block the seat must send verbatim, rendered broker-side.

    Rendered HERE rather than composed by the model, and returned from
    ``establish_propose``, so the sentence the person is shown is the sentence
    in the row. The seat's containment gate refuses any send-shaped tool on a
    proposing turn unless this appears in the outgoing body (overlay PR 2), and
    that is what makes "you confirmed exactly this" checkable rather than
    asserted.

    Three tags, one shape. ``[rule XXXX]`` marks a sentence about how the firm's
    work reads; ``[act XXXX]`` marks one act the Operator is asking to perform;
    ``[ops XXXX]`` marks a change to how the seat runs, which only SMD makes.
    They are distinct words because the person answering them is agreeing to
    three different things, and the confirming matcher binds the tag to the row
    it came from. The ops tag is also the CAPABILITY on that row: quoting it is
    how an answer from SMD is bound to the request it answers, so a name or a
    reason that could contain a second tag is refused everywhere it is read.
    """
    if kind == "tool_call":
        tag = "act"
    elif kind == OPS_REQUEST_KIND:
        tag = "ops"
    else:
        tag = "rule"
    return f"[{tag} {proposal_id}] {text}"


def _require_display_name(value: Any, field: str) -> str:
    """One resolved NAME the readback renders, refused rather than repaired.

    The seat resolves the client contact and the matter type to names before
    proposing, because the admin reading the sentence cannot judge a UUID and
    an agreement to a UUID is not an agreement. The identity in the row is
    still the authored id; this is the human-legible half of the same fact, so
    it is bounded, single-line, and bracket-free (a name carrying ``[`` could
    render a second tag into the readback and bind a "yes" to the wrong row).
    """
    name = _require_text(value, field, _MAX_ACT_DISPLAY_NAME)
    if "\n" in name or "\r" in name:
        raise EstablishmentValidationError(f"{field} must be a single line")
    if "[" in name or "]" in name:
        raise EstablishmentValidationError(
            f"{field} must not contain a square bracket; the readback tag is what "
            "binds a confirmation to one proposal"
        )
    return name


def act_readback_text(
    tool: str, payload: dict[str, Any], *, contact_name: str, matter_type_name: str
) -> str:
    """The act, as one sentence a person can answer, rendered broker-side.

    Rendered from the STORED payload and the resolved names, never from caller
    prose: what the firm reads is what the row holds. Every value the act will
    carry appears in it, which is the whole test of a readback worth asking
    somebody to say yes to.
    """
    if tool != "mcp_smokeball_create_matter":
        raise EstablishmentValidationError(f"no readback is defined for {tool!r}")
    return (
        f'Create Smokeball matter "{payload["description"]}" '
        f'(number {payload["number"]}; client: {contact_name}; type: {matter_type_name}). '
        'Reply "yes, create it" to proceed.'
    )


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


def _column(row: sqlite3.Row, name: str) -> Any:
    """One column, or None when the table predates it (ss-console#2546).

    The additive-ALTER idiom leaves a window in which a table created by an
    older build is read by a newer one, and a KeyError there would take out the
    whole establishment path rather than one field.
    """
    return row[name] if name in row.keys() else None


def proposal_state(row: dict[str, Any]) -> str:
    """One word for where a proposal stands, for the seat to branch on.

    Ordered by precedence rather than by recency, because the states are
    mutually exclusive by construction (every writer's WHERE clause requires the
    other two to be NULL) and an order makes a corrupted row read as the most
    conservative answer instead of as open.
    """
    if row.get("consumed_at") is not None:
        # An OPERATIONS row reaches this arm through ``ops_resolve`` with
        # outcome ``done``: nothing was committed by the firm, SMD made the
        # change. The word is shared because the seat branches on kind before it
        # branches on state, and inventing a fourth state here would be a fourth
        # thing every reader of this view has to know.
        return "committed"
    if row.get("declined_at") is not None:
        return "declined"
    if row.get("lapsed_at") is not None:
        return "lapsed"
    return "open"


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
            # ss-console#2536: a table created by #2529 predates the two act
            # columns. Add them, tolerate the ones already there, and leave the
            # rows alone; ``kind`` defaults to 'rule', which is what those rows
            # are.
            for alter_sql in PENDING_RULES_COLUMN_ALTERS:
                try:
                    conn.execute(alter_sql)
                except sqlite3.OperationalError as err:
                    if "duplicate column" not in str(err):
                        raise
            conn.execute(CREATE_PENDING_RULES_INDEX_SQL)
            conn.commit()
        finally:
            conn.close()

    def sweep(self, now: float | None = None) -> int:
        """Mark expired proposals LAPSED, then delete long-terminal rows.

        Returns rows deleted. Called on every establishment verb, so the table
        stays bounded without a timer.

        THE CHANGE ss-console#2546 MAKES, and why it is the whole point of the
        issue: an expired row used to be deleted here, and deletion is why a
        lapse was silent. The person who asked for the rule got nothing — the
        row that would have let anyone tell them was gone, and "nobody ever
        proposed that" is what the table then said. So expiry now writes
        ``lapsed_at`` and leaves the row, which gives the seat something true to
        report and gives this sweep a second, later job: delete the row once
        every terminal state is older than TERMINAL_RETENTION_SECONDS.

        Ordering matters and is deliberate: mark first, then delete. A row that
        expired long ago is marked on the pass that also becomes eligible to
        delete it, so it is never deleted without first having existed as a
        lapse the seat could have read.
        """
        now = time.time() if now is None else now
        cutoff = now - TERMINAL_RETENTION_SECONDS
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE pending_rules SET lapsed_at=? WHERE "
                "consumed_at IS NULL AND declined_at IS NULL AND lapsed_at IS NULL "
                "AND expires_at < ?",
                (now, now),
            )
            cursor = conn.execute(
                "DELETE FROM pending_rules WHERE "
                "(consumed_at IS NOT NULL AND consumed_at < ?) OR "
                "(declined_at IS NOT NULL AND declined_at < ?) OR "
                "(lapsed_at IS NOT NULL AND lapsed_at < ?)",
                (cutoff, cutoff, cutoff),
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
        kind: str = "rule",
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Store one proposal and return it. The id and both times are minted
        here; the digest is computed here over the stored text.

        ``kind`` and ``payload`` carry an ACT (ss-console#2536): the payload is
        the exact field set the confirmed tool call will be made with, stored so
        the commit replays the row rather than the wire.
        """
        now = time.time()
        ttl = ttl_for_kind(kind)
        digest = _hash_text(text)
        payload_json = (
            None
            if payload is None
            else json.dumps(payload, sort_keys=True, separators=(",", ":"))
        )
        conn = self._connect()
        try:
            for _attempt in range(8):
                proposal_id = secrets.token_hex(PROPOSAL_ID_HEX_BYTES)
                try:
                    conn.execute(
                        "INSERT INTO pending_rules ("
                        "proposal_id, scope, subject_json, text, text_sha256, "
                        "instructed_by, for_admin, created_at, expires_at, "
                        "kind, payload_json"
                        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            proposal_id,
                            scope,
                            json.dumps(subject, sort_keys=True, separators=(",", ":")),
                            text,
                            digest,
                            instructed_by,
                            1 if for_admin else 0,
                            now,
                            now + ttl,
                            kind,
                            payload_json,
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
            "expires_at": now + ttl,
            "kind": kind,
            "payload": payload,
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
        # ss-console#2546: declined and lapsed join consumed as reasons a row is
        # no longer confirmable. Without the declined_at clause an administrator's
        # "no" would leave the rule sitting in this list, and the Operator would
        # go on offering the firm a rule that has already been refused.
        # ss-console#2546 (the operations half): and an OPERATIONS request is
        # excluded outright, in SQL, because it is not a thing anybody at the
        # firm can confirm. It is for_admin, so without this clause every
        # administrator on the seat would be handed a routine change in the list
        # of things a "yes" applies to. The seat also skips the kind, and
        # ``consume`` refuses it, and ``establish_submit`` names it -- three
        # refusals for the one failure worth three.
        sql = (
            "SELECT * FROM pending_rules WHERE consumed_at IS NULL "
            "AND declined_at IS NULL AND lapsed_at IS NULL AND expires_at >= ? "
            "AND kind != 'ops_request' "
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

    def unreported_outcomes_for(
        self, sender: str | None, now: float | None = None
    ) -> list[dict[str, Any]]:
        """Rows that ENDED and whose author has not been told: declined by an
        administrator, lapsed unanswered, or observed installed.

        With a ``sender``, only rows THAT PERSON stated (``instructed_by``). A
        decline is news for the person who asked, not for the administrator who
        gave it, and an administrator shown every lapse in the firm is being
        shown other people's business.

        With ``sender=None``, every unreported outcome on the seat. That is not
        a widening of who may be told anything: each row still names its own
        author, and the only caller is the seat's own lapse sweeper, which sends
        each note to that author and nobody else. It exists because a lapse has
        no person in front of it by definition. Waiting for the requester's next
        message would make the report depend on the person continuing to talk to
        an Operator that has just gone silent on them, and enumerating the
        firm's authored people instead would miss anyone the roster covers by
        domain rather than by name (the paralegal this whole issue is about).

        THE SENDERLESS SHAPE ALSO HIDES A ROW ANOTHER OBSERVER IS CURRENTLY
        SENDING (ss-console#2546, the duplicate-letter fix), for
        ``NOTIFY_CLAIM_STALE_SECONDS`` and no longer. This is the cheap half of
        the once-guard, not the guard: two sweepers can still list the same row
        in the same instant, and what stops the second letter is
        :meth:`claim_notify`. What this buys is that the ordinary case does not
        even reach the claim, and that a row whose claimant died comes back into
        the list rather than going quiet forever.

        The SENDER-scoped shape is deliberately left alone. It answers "what
        does this person still need to hear", which is a true answer whether or
        not a sweeper is mid-send; the send itself is gated by the claim.
        """
        now = time.time() if now is None else now
        sql = (
            "SELECT * FROM pending_rules WHERE lapse_notified_at IS NULL AND ("
            # The two non-committing ends.
            "(consumed_at IS NULL AND (declined_at IS NOT NULL OR lapsed_at IS NOT NULL))"
            # ss-console#2546 follow-up: and the committing one. A rule an
            # administrator APPLIED is an outcome the person who asked is owed,
            # and it was the one outcome this view could not express -- its
            # every arm required consumed_at IS NULL, so a rule that went into
            # force fell out of the list that exists to report outcomes.
            #
            # THE ARM IS installed_at, NOT consumed_at, and that is the whole
            # honesty of it. Committed means the submission reached the intake
            # spool; installed means somebody read the run's result and saw the
            # word. Between them sits a converge window and a failure mode, and
            # a sweeper firing on consumed_at would mail "your rule is in
            # effect" about a rule that never installed.
            " OR (installed_at IS NOT NULL AND for_admin = 1)"
            ")"
        )
        params: tuple[Any, ...] = ()
        if sender is not None:
            sql += " AND instructed_by = ?"
            params = (sender,)
        else:
            sql += " AND (notify_claimed_at IS NULL OR notify_claimed_at < ?)"
            params = (now - NOTIFY_CLAIM_STALE_SECONDS,)
        sql += " ORDER BY created_at ASC"
        conn = self._connect()
        try:
            rows = conn.execute(sql, params).fetchall()
        finally:
            conn.close()
        return [self._hydrate(row) for row in rows]

    def claim_notify(
        self, proposal_id: str, claimed_by: str, now: float | None = None
    ) -> bool:
        """Take the right to send ONE row's outcome letter. True iff THIS call
        took it.

        The conditional UPDATE is the whole control, for the reason ``consume``
        and ``decline`` are conditional: claim-once has to be enforced by the
        database, because the two processes racing for it are two processes and
        no amount of in-memory bookkeeping in either one can see the other.
        overlay#315 put this claim in memory and the letter still went twice.

        Every condition is in the WHERE clause:
          - unclaimed, OR claimed longer ago than ``NOTIFY_CLAIM_STALE_SECONDS``
            (a claimant that died hands the row back by falling silent, because
            an un-sent letter is worse than a late one);
          - not already reported -- ``lapse_notified_at`` is the durable mark and
            it outranks any claim;
          - actually terminal. A row with no outcome has no letter to send, so a
            claim on one is refused rather than parked.

        A refusal is a ``False``, never an exception: losing this race is the
        system working, and the caller's correct response is to send nothing.
        """
        now = time.time() if now is None else now
        conn = self._connect()
        try:
            cursor = conn.execute(
                "UPDATE pending_rules SET notify_claimed_at=?, notify_claimed_by=? "
                "WHERE proposal_id=? "
                "AND (notify_claimed_at IS NULL OR notify_claimed_at < ?) "
                "AND lapse_notified_at IS NULL "
                "AND (declined_at IS NOT NULL OR lapsed_at IS NOT NULL "
                "OR installed_at IS NOT NULL)",
                (now, claimed_by, proposal_id, now - NOTIFY_CLAIM_STALE_SECONDS),
            )
            conn.commit()
            return bool(cursor.rowcount)
        finally:
            conn.close()

    def release_notify(self, proposal_id: str) -> bool:
        """Hand a claimed row back, unsent. True iff THIS call released it.

        The path is a send that FAILED: the claimant knows the letter did not go,
        and the honest thing is to give the row back immediately rather than
        leave the next observer waiting out the stale window.

        ``lapse_notified_at IS NULL`` is the guard, and it is the same one
        ``claim_notify`` carries: once a letter is recorded as sent, nothing may
        reopen the row for a second one. A release on a reported row is a
        ``False``, not a clearing.
        """
        conn = self._connect()
        try:
            cursor = conn.execute(
                "UPDATE pending_rules SET notify_claimed_at=NULL, notify_claimed_by=NULL "
                "WHERE proposal_id=? AND notify_claimed_at IS NOT NULL "
                "AND lapse_notified_at IS NULL",
                (proposal_id,),
            )
            conn.commit()
            return bool(cursor.rowcount)
        finally:
            conn.close()

    def find_open_duplicate(
        self, *, instructed_by: str, scope: str, text: str, now: float | None = None
    ) -> dict[str, Any] | None:
        """An OPEN row this same person already stated, word for word.

        Matched on the normalized text's digest rather than the text, so
        "same rule" means here what it means everywhere else in this module.

        Why it exists (ss-console#2546): a rule now emails an administrator. A
        person who re-sends the same sentence, or whose mail client retries,
        would otherwise page that administrator twice for one request, and the
        second page would carry a different tag - so answering one would leave
        the other open. Returning the row the caller already has is both the
        cheaper and the truer answer.
        """
        now = time.time() if now is None else now
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM pending_rules WHERE instructed_by = ? AND scope = ? "
                "AND text_sha256 = ? AND consumed_at IS NULL AND declined_at IS NULL "
                "AND lapsed_at IS NULL AND expires_at >= ? ORDER BY created_at ASC LIMIT 1",
                (instructed_by, scope, _hash_text(text), now),
            ).fetchone()
        finally:
            conn.close()
        return self._hydrate(row) if row is not None else None

    def decline(self, proposal_id: str, declined_by: str) -> bool:
        """Refuse one proposal on an administrator's word. True iff THIS call
        declined it.

        A conditional UPDATE for the same reason ``consume`` is one: decline-once
        is enforced by the database, not by a read-then-write the caller could
        interleave. The WHERE clause carries every condition rather than trusting
        a check performed above it - open, not already answered, not expired,
        and ``for_admin`` (a rule somebody stated about their own work is not an
        administrator's to refuse; they simply do not confirm it).
        """
        now = time.time()
        conn = self._connect()
        try:
            cursor = conn.execute(
                "UPDATE pending_rules SET declined_at=?, declined_by=? "
                "WHERE proposal_id=? AND consumed_at IS NULL AND declined_at IS NULL "
                "AND lapsed_at IS NULL AND for_admin = 1 AND expires_at >= ?",
                (now, declined_by, proposal_id, now),
            )
            conn.commit()
            return bool(cursor.rowcount)
        finally:
            conn.close()

    def mark_outcome_reported(self, proposal_id: str) -> bool:
        """Record that the person who asked has been told how their rule ended.
        True iff THIS call marked it.

        Conditional again, and the condition is what stops a second note: a row
        can only be marked once, and only once it actually HAS an outcome. A
        seat that retries the send loses the race and sends nothing. That is
        also what makes this the cross-path lock for ss-console#2546's install
        notice: three observers can reach it and exactly one wins the UPDATE.

        ``installed_at`` joins the two non-committing ends as an outcome, so an
        applied rule can be marked reported at all. Without it the seat could
        send the note and never record having sent it, and every later observer
        would send it again.
        """
        now = time.time()
        conn = self._connect()
        try:
            cursor = conn.execute(
                "UPDATE pending_rules SET lapse_notified_at=? WHERE proposal_id=? "
                "AND lapse_notified_at IS NULL "
                "AND (declined_at IS NOT NULL OR lapsed_at IS NOT NULL "
                "OR installed_at IS NOT NULL)",
                (now, proposal_id),
            )
            conn.commit()
            return bool(cursor.rowcount)
        finally:
            conn.close()

    def mark_installed(self, run_id: str, now: float | None = None) -> str:
        """Record that the run that committed a rule was observed INSTALLED.

        Returns the proposal id this stamped, or ``""`` when it stamped nothing
        (no committed row carries that run, or one already does).

        THE ONLY WRITER IS :meth:`EstablishmentStore.status`, on the path where
        the broker has just read a root-authored result whose status is
        ``installed``. Nothing the agent says reaches this: the word comes off a
        file the intake wrote as root, and the run id comes off the row the
        broker itself stamped at commit. That is what lets the seat's sweeper
        treat the column as grounds to tell somebody their rule is in force.

        Conditional, like every other mark here, so two reads of one result
        stamp once.
        """
        now = time.time() if now is None else now
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT proposal_id FROM pending_rules WHERE consumed_run_id=? "
                "AND consumed_at IS NOT NULL AND installed_at IS NULL",
                (run_id,),
            ).fetchone()
            if row is None:
                return ""
            cursor = conn.execute(
                "UPDATE pending_rules SET installed_at=? WHERE consumed_run_id=? "
                "AND consumed_at IS NOT NULL AND installed_at IS NULL",
                (now, run_id),
            )
            conn.commit()
            return str(row["proposal_id"]) if cursor.rowcount else ""
        finally:
            conn.close()

    def resolve_ops(
        self,
        proposal_id: str,
        outcome: str,
        resolved_by: str,
        reason: str | None,
        now: float | None = None,
    ) -> bool:
        """End one operations request on SMD's word. True iff THIS call ended it.

        Conditional for the same reason every other terminal write here is: a
        second answer to the same request loses the race and changes nothing,
        so the person who asked is told once and told one thing. The WHERE
        clause carries every condition, including the kind -- a rule and an act
        end through their own verbs, and this one must not be able to end either.

        WHICH COLUMNS EACH OUTCOME WRITES, and why they are the existing ones
        rather than a new state machine:

        ``done``       ``consumed_at`` and ``installed_at``. The seat's sweeper
                       reports an outcome off ``unreported_outcomes_for``, whose
                       committing arm is ``installed_at IS NOT NULL AND
                       for_admin = 1``; an ops row is for_admin, so stamping
                       both is what makes "SMD set this up" reach the requester
                       through the path that already exists. There is no run and
                       no spool: SMD made the change, and ``consumed_run_id``
                       stays NULL, which is what ``mark_installed`` needs to not
                       match it.
        ``declined``   ``declined_at`` and ``declined_by``. Same arm the firm's
                       own declines use, so the same sweeper tells the requester.
        ``withdrawn``  ``lapsed_at`` AND ``lapse_notified_at`` together, in one
                       statement. That pair is the row's way of saying "ended,
                       and nobody is owed a note" -- which is exactly right when
                       the seat could not get the request out of the building:
                       the requester was already told, in the refusal they got
                       in the same turn, that nothing was sent.
        """
        now = time.time() if now is None else now
        stamps: tuple[Any, ...]
        if outcome == "done":
            assignment = "consumed_at=?, installed_at=?"
            stamps = (now, now)
        elif outcome == "declined":
            assignment = "declined_at=?, declined_by=?"
            stamps = (now, resolved_by)
        elif outcome == "withdrawn":
            assignment = "lapsed_at=?, lapse_notified_at=?"
            stamps = (now, now)
        else:  # pragma: no cover - ops_resolve validates before calling
            raise EstablishmentValidationError(f"unknown outcome {outcome!r}")
        conn = self._connect()
        try:
            cursor = conn.execute(
                f"UPDATE pending_rules SET {assignment}, resolved_by=?, outcome_reason=? "
                "WHERE proposal_id=? AND kind='ops_request' AND consumed_at IS NULL "
                "AND declined_at IS NULL AND lapsed_at IS NULL",
                (*stamps, resolved_by, reason, proposal_id),
            )
            conn.commit()
            return bool(cursor.rowcount)
        finally:
            conn.close()

    def mark_ask_sent(self, proposal_id: str, now: float | None = None) -> bool:
        """Record that SMD has been asked, once, for an answer this parser reads.

        True iff THIS call marked it. Conditional and kind-gated like every other
        mark here, and it requires the row to still be OPEN: an ask about a
        request that has already ended is noise to the person who ended it.

        Why the column exists at all (the critique's item 4): a reply from SMD
        that says neither "done" nor "no" leaves the row open, and leaving it
        there silently is the same silence in a new place. So the seat asks for
        the two words -- and asks once, because a per-turn re-ask is how a
        helpful nudge becomes a mail loop.
        """
        now = time.time() if now is None else now
        conn = self._connect()
        try:
            cursor = conn.execute(
                "UPDATE pending_rules SET ask_sent_at=? WHERE proposal_id=? "
                "AND kind='ops_request' AND ask_sent_at IS NULL AND consumed_at IS NULL "
                "AND declined_at IS NULL AND lapsed_at IS NULL",
                (now, proposal_id),
            )
            conn.commit()
            return bool(cursor.rowcount)
        finally:
            conn.close()

    def consume(self, proposal_id: str, run_id: str) -> bool:
        """Mark one proposal committed. True iff THIS call consumed it.

        A conditional UPDATE, so consume-once is enforced by the database rather
        than by a read-then-write the caller could interleave. A second
        confirmation of the same rule loses the race and is told the rule is
        already in effect, which is both true and the only safe answer: the
        alternative is the firm's sentence rendered twice.

        AN OPERATIONS ROW IS REFUSED HERE (ss-console#2546), in the WHERE clause
        rather than above it. ``_claim_proposal`` already names the kind and
        gives the reader a sentence; this is the structural half, so a future
        caller that reaches ``consume`` by some other route still cannot turn a
        routine change into something the firm committed. ``ops_resolve`` is the
        only writer that ends one of those rows.
        """
        now = time.time()
        conn = self._connect()
        try:
            cursor = conn.execute(
                "UPDATE pending_rules SET consumed_at=?, consumed_run_id=? "
                "WHERE proposal_id=? AND consumed_at IS NULL "
                "AND kind != 'ops_request'",
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
        payload: dict[str, Any] | None = None
        raw_payload = row["payload_json"] if "payload_json" in row.keys() else None
        if raw_payload:
            try:
                decoded = json.loads(raw_payload)
            except ValueError:
                decoded = None
            payload = decoded if isinstance(decoded, dict) else None
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
            # A row written before #2536 has neither column; it is a rule, and
            # reading it as one is the migration working rather than failing.
            "kind": (row["kind"] if "kind" in row.keys() else None) or "rule",
            "payload": payload,
            # ss-console#2546. Same tolerance for a row written before the four
            # columns existed: absent reads as NULL, which is "open".
            "declined_at": _column(row, "declined_at"),
            "declined_by": _column(row, "declined_by"),
            "lapsed_at": _column(row, "lapsed_at"),
            "lapse_notified_at": _column(row, "lapse_notified_at"),
            "installed_at": _column(row, "installed_at"),
            # ss-console#2546 (the operations half); same tolerance again.
            "resolved_by": _column(row, "resolved_by"),
            "outcome_reason": _column(row, "outcome_reason"),
            "ask_sent_at": _column(row, "ask_sent_at"),
            # ss-console#2546 (the duplicate-letter fix); same tolerance again.
            "notify_claimed_at": _column(row, "notify_claimed_at"),
            "notify_claimed_by": _column(row, "notify_claimed_by"),
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
        self,
        spool_root: str | Path,
        ledger: Any,
        pending_db_path: str | Path | None = None,
        customer_path: str | Path | None = None,
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
        # ss-console#2536. The seat's own authored config, read by THIS uid and
        # never taken off the wire: an act may only be proposed with the values
        # the firm authored, so the broker has to be able to read them itself.
        # Absent (a broker built with no config handle) means no act can be
        # proposed, which is the fail-closed direction.
        self.customer_path = Path(customer_path) if customer_path else None

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
        if scope not in PROPOSAL_SCOPES or scope == "act":
            raise EstablishmentValidationError(
                "scope must be one of ['firm_adjust', 'person']; "
                f"got {scope!r} (an act is proposed with act_propose)"
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
        # ss-console#2546: the same person, the same sentence, already waiting.
        # Hand back the row they already have and write NOTHING - no second row,
        # no second RULE_PROPOSED, and (the reason this matters now) no second
        # email to an administrator carrying a different tag, only one of which
        # answering would close.
        existing = pending.find_open_duplicate(
            instructed_by=instructed_by, scope=scope, text=text
        )
        if existing is not None:
            return {
                "ok": True,
                "duplicate_of": existing["proposal_id"],
                "proposal_id": existing["proposal_id"],
                "scope": existing["scope"],
                "subject": existing["subject"],
                "for_admin": existing["for_admin"],
                "expires_at": existing["expires_at"],
                "readback": readback_for(existing["proposal_id"], existing["text"]),
            }
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
            # Always present, so a caller reads one field rather than testing
            # for a key's absence to decide whether it just created something.
            "duplicate_of": None,
            "proposal_id": row["proposal_id"],
            "scope": scope,
            "subject": subject,
            "for_admin": for_admin,
            "expires_at": row["expires_at"],
            "readback": readback_for(row["proposal_id"], text),
        }

    # ------------------------------------------------------------------
    # establish_decline / establish_lapse_notified  (ss-console#2546)
    # ------------------------------------------------------------------

    def decline(self, request: dict[str, Any]) -> dict[str, Any]:
        """Refuse one rule on an administrator's word.

        The other half of "apply that". Before this verb an administrator's "no"
        did nothing at all: the rule sat open until it expired, the person who
        asked heard nothing, and the only record of the decision was whatever
        the model happened to say in a reply. So a decline is now a row and a
        state, and the person who asked can be told.

        Four conditions, and every one of them is in the UPDATE's WHERE clause
        rather than checked above it, so two administrators answering at once
        cannot both win:
          - the row is open (not committed, not already declined, not lapsed);
          - it is ``for_admin`` - a rule somebody stated about their OWN work is
            not an administrator's to refuse, they simply do not confirm it;
          - it has not expired;
          - the decliner is not the person who stated it (that is a withdrawal,
            a different act, and letting it through here would let one address
            both raise and refuse a rule with no second person involved).

        The SEAT is what establishes that the decliner is an administrator, from
        the authored allow list this uid cannot read. What this verb enforces is
        everything that can be enforced from the row.
        """
        pending = self._require_pending()
        proposal_id = _require_proposal_id(request.get("proposal_id"))
        declined_by = require_address(request.get("declined_by"), "declined_by")
        source_ref = _require_text(request.get("source_ref"), "source_ref", _MAX_SHORT_TEXT)

        row = pending.get(proposal_id)
        if row is None:
            raise EstablishmentValidationError(
                f"no rule was proposed under {proposal_id}; nothing to decline"
            )
        self._refuse_undeclinable(row, proposal_id, declined_by)
        if not pending.decline(proposal_id, declined_by):
            # Lost the race to another decline or to the commit. Whichever won,
            # the answer is the state now on the row, never this call's.
            raise EstablishmentValidationError(
                f"rule {proposal_id} was already answered; nothing was changed"
            )

        metadata = {
            "proposal_id": proposal_id,
            "scope": row["scope"],
            "instructed_by": row["instructed_by"],
            "declined_by": declined_by,
            "source_ref": source_ref,
            # The digest, never the sentence - same posture as RULE_PROPOSED.
            # The two rows join on it, so the ledger shows WHICH rule was
            # refused without holding a second copy of the firm's words.
            "text_sha256": row["text_sha256"],
        }
        metadata.update(row["subject"])
        self._ledger.append(
            {
                "action_type": RULE_DECLINED_ACTION_TYPE,
                "actor": "operator",
                "actor_role": "agent",
                "metadata": json.dumps(metadata, sort_keys=True, separators=(",", ":")),
            }
        )
        return {
            "ok": True,
            "proposal_id": proposal_id,
            "state": "declined",
            "scope": row["scope"],
            "subject": row["subject"],
            # Who to tell, and what they asked for. The seat composes the note to
            # the requester from these rather than from anything on the wire.
            "instructed_by": row["instructed_by"],
            "declined_by": declined_by,
            "text": row["text"],
            "readback": readback_for(proposal_id, row["text"], row["kind"]),
        }

    @staticmethod
    def _refuse_undeclinable(
        row: dict[str, Any], proposal_id: str, declined_by: str
    ) -> None:
        """Name the reason a decline cannot land, before the UPDATE tries it.

        The UPDATE is the enforcement; this exists so the refusal a person reads
        says which of five different things happened.
        """
        # ss-console#2546 (the operations half): an administrator of the FIRM
        # does not decline an operations request, because it was never theirs to
        # answer -- it went to SMD. ``ops_resolve`` is the verb for that, and
        # keeping this one unable to touch the kind is what stops a decline
        # landing on a row whose requester is then told the firm refused it.
        if row["kind"] == OPS_REQUEST_KIND:
            raise EstablishmentValidationError(
                f"{proposal_id} is an operations request; it is answered by SMD "
                "with ops_resolve, not declined here"
            )
        if row["consumed_at"] is not None:
            raise EstablishmentValidationError(
                f"rule {proposal_id} was already committed; it is in effect"
            )
        if row["declined_at"] is not None:
            raise EstablishmentValidationError(
                f"rule {proposal_id} was already declined; nothing was changed"
            )
        if row["lapsed_at"] is not None or row["expires_at"] < time.time():
            raise EstablishmentValidationError(
                f"rule {proposal_id} lapsed unanswered; ask for it to be stated again"
            )
        if not row["for_admin"]:
            raise EstablishmentValidationError(
                f"rule {proposal_id} was not waiting on an administrator; "
                "there is nothing to decline"
            )
        if row["instructed_by"] == declined_by:
            raise EstablishmentValidationError(
                "the person who stated a rule cannot decline it; "
                "leaving it unconfirmed is how they withdraw it"
            )

    def lapse_notified(self, request: dict[str, Any]) -> dict[str, Any]:
        """Record that the person who asked has been told how their rule ended.

        Called by the seat AFTER the note is away, so a send that failed leaves
        the row unmarked and the next attributed turn tries again. Marking first
        would trade a duplicate note for a silence, and silence is the failure
        this whole issue exists to end.

        ONE ACTION TYPE, and it is RULE_LAPSED. A lapse has no other row
        anywhere, so this is the only record that a rule died unanswered. A
        DECLINE already wrote RULE_DECLINED at the moment the administrator
        answered, so telling the requester about it writes nothing further -
        this verb cannot emit a second type, which is the property that keeps
        it unable to forge one. An INSTALL (ss-console#2546 follow-up) is the
        third thing this can now mark, and it writes nothing either: the run
        already left its ESTABLISHMENT_RESULT row.
        """
        pending = self._require_pending()
        proposal_id = _require_proposal_id(request.get("proposal_id"))
        row = pending.get(proposal_id)
        if row is None:
            raise EstablishmentValidationError(
                f"no rule was proposed under {proposal_id}; nothing to report"
            )
        # ss-console#2546 (the operations half): the same verb reports both, so
        # the noun follows the row rather than the code path. A person told
        # "rule 1a2b has no outcome" about a request for a Monday digest is
        # being told about something they never asked for.
        noun = "operations request" if row["kind"] == OPS_REQUEST_KIND else "rule"
        if (
            row["declined_at"] is None
            and row["lapsed_at"] is None
            and row.get("installed_at") is None
        ):
            raise EstablishmentValidationError(
                f"{noun} {proposal_id} has no outcome to report; it is still open"
                if row["consumed_at"] is None
                # ss-console#2546 follow-up. Committed is not an outcome a
                # person can be told about yet, and saying so by name is what
                # stops a seat mailing "your rule is in effect" about a run
                # still inside its converge window.
                else f"{noun} {proposal_id} was committed but has not been observed "
                "installed; there is nothing to report yet"
            )
        if not pending.mark_outcome_reported(proposal_id):
            raise EstablishmentValidationError(
                f"the outcome of {noun} {proposal_id} was already reported; "
                "nothing was changed"
            )
        state = proposal_state(pending.get(proposal_id) or row)
        if state == "lapsed":
            # ss-console#2546 (the operations half). A lapsed OPERATIONS request
            # is not a lapsed rule, and the ledger must not say it was: nobody at
            # the firm failed to answer it, SMD did. One pinned type per kind,
            # chosen from the STORED kind so no caller can pick which row it
            # writes.
            lapsed_type = (
                OPS_REQUEST_LAPSED_ACTION_TYPE
                if row["kind"] == OPS_REQUEST_KIND
                else RULE_LAPSED_ACTION_TYPE
            )
            self._ledger.append(
                {
                    "action_type": lapsed_type,
                    "actor": "operator",
                    "actor_role": "agent",
                    "metadata": json.dumps(
                        {
                            "proposal_id": proposal_id,
                            "scope": row["scope"],
                            "instructed_by": row["instructed_by"],
                            "for_admin": row["for_admin"],
                            "text_sha256": row["text_sha256"],
                        },
                        sort_keys=True,
                        separators=(",", ":"),
                    ),
                }
            )
        return {"ok": True, "proposal_id": proposal_id, "state": state}

    # ------------------------------------------------------------------
    # establish_notify_claim / establish_notify_release  (ss-console#2546)
    #
    # THE DUPLICATE-LETTER FIX. ``lapse_notified`` is written AFTER the letter is
    # away, on purpose -- marking first would trade a duplicate for a silence.
    # That ordering is safe against a retry inside one process and is not safe
    # against two processes, and the seat runs two: the gateway (pid 658) and its
    # webhook-gate child (pid 1115), each with its own sweeper thread. Observed
    # on pilot-smokeball 2026-08-23, overlay fc8f88c1: both read the row as
    # unreported, both sent, and the requester got the same letter 12 s apart
    # (vfy_01M0QK1927KP54R7J13J2TH3WZ). overlay#315 answered it with an
    # in-process lock, which on this seat is two locks.
    #
    # So the window between "decided to send" and "recorded as sent" gets a
    # holder, and it lives in the ONE process both observers share. Two verbs,
    # both non-writing (no audit row): claiming the right to send is not a
    # decision about the firm's work, it is bookkeeping about which of our own
    # processes is speaking.
    # ------------------------------------------------------------------

    def notify_claim(self, request: dict[str, Any]) -> dict[str, Any]:
        """Take the right to send one row's outcome letter.

        ``claimed: False`` is the ordinary answer for a caller that lost, and it
        is NOT an error: another observer holds the row, or the row was already
        reported, or it has no outcome yet. The caller's correct response to all
        three is identical -- send nothing, mark nothing.

        An UNKNOWN proposal id still raises, because that is a caller bug rather
        than a lost race, and answering it with ``claimed: False`` would let a
        typo look like ordinary contention forever.
        """
        pending = self._require_pending()
        proposal_id = _require_proposal_id(request.get("proposal_id"))
        # A process label ("gateway", "webhook-gate", a pid) rather than an
        # address: this names which of OUR processes holds the row, and it is
        # stored so a live duplicate can be traced to the two senders rather
        # than guessed at.
        claimed_by = _require_text(
            request.get("claimed_by"), "claimed_by", _MAX_SHORT_TEXT
        )

        row = pending.get(proposal_id)
        if row is None:
            raise EstablishmentValidationError(
                f"no proposal was recorded under {proposal_id}; "
                "there is no outcome to claim"
            )
        claimed = pending.claim_notify(proposal_id, claimed_by)
        return {
            "ok": True,
            "claimed": claimed,
            "proposal_id": proposal_id,
            # Why the claim was refused, for the caller's log. Read off the row
            # AFTER the attempt, so it describes the state that actually beat
            # this caller rather than one read before the race.
            "reason": (
                None if claimed else self._claim_refusal(pending.get(proposal_id) or row)
            ),
        }

    @staticmethod
    def _claim_refusal(row: dict[str, Any]) -> str:
        """Name which of the three refusals happened. Diagnostic only -- the
        UPDATE is the enforcement, and none of these strings is load-bearing."""
        if row.get("lapse_notified_at") is not None:
            return "the outcome of this proposal has already been reported"
        if (
            row.get("declined_at") is None
            and row.get("lapsed_at") is None
            and row.get("installed_at") is None
        ):
            return "this proposal has no outcome to report yet"
        holder = row.get("notify_claimed_by") or "unnamed"
        return f"another observer is sending this outcome ({holder})"

    def notify_release(self, request: dict[str, Any]) -> dict[str, Any]:
        """Hand a claimed row back because the letter did NOT go.

        The failure path of a claim, and the reason a claim is not simply the
        mark: a send that raised must leave the row sendable, immediately, by
        somebody. ``released: False`` means there was nothing to give back --
        already reported, or never claimed -- and is not an error either.
        """
        pending = self._require_pending()
        proposal_id = _require_proposal_id(request.get("proposal_id"))
        row = pending.get(proposal_id)
        if row is None:
            raise EstablishmentValidationError(
                f"no proposal was recorded under {proposal_id}; "
                "there is no claim to release"
            )
        return {
            "ok": True,
            "released": pending.release_notify(proposal_id),
            "proposal_id": proposal_id,
        }

    # ------------------------------------------------------------------
    # ops_propose / ops_resolve / ops_ask_sent  (ss-console#2546)
    # ------------------------------------------------------------------

    def ops_propose(self, request: dict[str, Any]) -> dict[str, Any]:
        """Record one OPERATIONS request and return the tag SMD will quote back.

        Nothing is changed by this and nothing is promised. ADR 0085's
        2026-08-22 amendment puts routines, schedules, channels, memory,
        autonomy and on/off with SMD rather than with the firm, so the Operator's
        honest answer to "send me a digest every Monday" is that SMD makes those
        changes. What this verb adds is the half that was missing: the request
        becomes a row with an id, so the answer can find its way back to the
        person who asked instead of ending in a polite sentence.

        THE TAG IS THE CAPABILITY, stated plainly because it is the accepted
        risk on this path. ``[ops XXXX]`` is eight hex characters minted here,
        and quoting it from an address the firm authored on
        ``scope.ops_reply_from`` is what lets an answer resolve this row. No seat
        gets an SPF or DKIM verdict, so that is the same spoof class for every
        address on that list; what bounds it is that the whole effect of a forged
        answer is one templated notice to the person who asked.
        """
        pending = self._require_pending()
        instructed_by = require_address(request.get("instructed_by"), "instructed_by")
        source_ref = _require_text(request.get("source_ref"), "source_ref", _MAX_SHORT_TEXT)
        text = normalize_rule_text(request.get("text"))

        # The same person, the same request, already waiting. Hand back the row
        # they have and write nothing: no second row, no second
        # OPS_REQUEST_RECORDED, and no second email to SMD carrying a different
        # tag, only one of which answering would close.
        existing = pending.find_open_duplicate(
            instructed_by=instructed_by, scope="ops", text=text
        )
        if existing is not None:
            return {
                "ok": True,
                "duplicate_of": existing["proposal_id"],
                "proposal_id": existing["proposal_id"],
                "kind": OPS_REQUEST_KIND,
                "instructed_by": existing["instructed_by"],
                "expires_at": existing["expires_at"],
                "readback": readback_for(
                    existing["proposal_id"], existing["text"], OPS_REQUEST_KIND
                ),
            }

        row = pending.create(
            scope="ops",
            # No subject. A rule is about an output class or a person; an
            # operations request is about the seat, and there is nothing here
            # that a subject would name.
            subject={},
            text=text,
            instructed_by=instructed_by,
            # for_admin, and it is load-bearing rather than decorative: the
            # sweeper's committing arm requires it, so this is what lets a
            # ``done`` reach the requester through the path that already exists.
            for_admin=True,
            kind=OPS_REQUEST_KIND,
        )
        self._ledger.append(
            {
                "action_type": OPS_REQUEST_RECORDED_ACTION_TYPE,
                "actor": "operator",
                "actor_role": "agent",
                "metadata": json.dumps(
                    {
                        "proposal_id": row["proposal_id"],
                        "instructed_by": instructed_by,
                        "source_ref": source_ref,
                        # Ids and a digest, never the sentence -- ADR 0083's
                        # retention posture, identical to RULE_PROPOSED.
                        "text_sha256": row["text_sha256"],
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                ),
            }
        )
        return {
            "ok": True,
            "duplicate_of": None,
            "proposal_id": row["proposal_id"],
            "kind": OPS_REQUEST_KIND,
            "instructed_by": instructed_by,
            "expires_at": row["expires_at"],
            "readback": readback_for(row["proposal_id"], text, OPS_REQUEST_KIND),
        }

    def ops_resolve(self, request: dict[str, Any]) -> dict[str, Any]:
        """End one operations request on SMD's answer, exactly once.

        Three outcomes and no fourth (:data:`OPS_OUTCOMES`):

        ``done``       SMD made the change. The requester is told.
        ``declined``   SMD said no, with the reason they wrote. The requester is
                       told, and the reason is quoted rather than paraphrased --
                       an Operator that composed its own explanation of somebody
                       else's refusal would be inventing client-facing content.
        ``withdrawn``  the seat could not get the request out of the building, so
                       it gives the row back. Nothing is sent, because nothing
                       was ever asked, and the requester already heard that in
                       the refusal they got in the same turn.

        WHAT THIS VERB CANNOT DO, and each is enforced rather than documented:
        it cannot touch a rule or an act (the UPDATE requires the kind), it
        cannot answer a request twice (the UPDATE requires the row open), and it
        cannot decide who at SMD is entitled to answer. That last one is the
        SEAT's, from ``scope.ops_reply_from`` in a config this uid cannot read --
        the same posture ``establish_decline`` takes toward the admin list.
        """
        pending = self._require_pending()
        proposal_id = _require_proposal_id(request.get("proposal_id"))
        outcome = _require_text(request.get("outcome"), "outcome", _MAX_SHORT_TEXT)
        if outcome not in OPS_OUTCOMES:
            raise EstablishmentValidationError(
                f"outcome must be one of {sorted(OPS_OUTCOMES)}; got {outcome!r}"
            )
        resolved_by = require_address(request.get("resolved_by"), "resolved_by")
        source_ref = _require_text(request.get("source_ref"), "source_ref", _MAX_SHORT_TEXT)
        reason = normalize_outcome_reason(request.get("reason"))

        row = pending.get(proposal_id)
        if row is None:
            raise EstablishmentValidationError(
                f"no operations request was recorded under {proposal_id}; nothing to answer"
            )
        self._refuse_unresolvable(row, proposal_id)
        if not pending.resolve_ops(proposal_id, outcome, resolved_by, reason):
            # Lost the race to another answer. Whichever won, the answer is the
            # state now on the row, never this call's.
            raise EstablishmentValidationError(
                f"operations request {proposal_id} was already answered; nothing was changed"
            )

        self._ledger.append(
            {
                "action_type": OPS_REQUEST_RESOLVED_ACTION_TYPE,
                "actor": "operator",
                "actor_role": "agent",
                "metadata": json.dumps(
                    {
                        "proposal_id": proposal_id,
                        "outcome": outcome,
                        "instructed_by": row["instructed_by"],
                        "resolved_by": resolved_by,
                        "source_ref": source_ref,
                        "text_sha256": row["text_sha256"],
                        # WHETHER a reason was given, never the reason. It is a
                        # person's prose about a business decision, and retained
                        # rows carry ids, names, and counts.
                        "has_reason": reason is not None,
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                ),
            }
        )
        state = proposal_state(pending.get(proposal_id) or row)
        return {
            "ok": True,
            "proposal_id": proposal_id,
            "outcome": outcome,
            "state": state,
            # Who to tell and what they asked for. The seat composes the notice
            # from these, never from anything on the wire.
            "instructed_by": row["instructed_by"],
            "resolved_by": resolved_by,
            "reason": reason,
            "text": row["text"],
            "readback": readback_for(proposal_id, row["text"], OPS_REQUEST_KIND),
        }

    @staticmethod
    def _refuse_unresolvable(row: dict[str, Any], proposal_id: str) -> None:
        """Name the reason an answer cannot land, before the UPDATE tries it.

        The UPDATE is the enforcement; this exists so the refusal says which of
        four things happened rather than "nothing was changed".
        """
        if row["kind"] != OPS_REQUEST_KIND:
            raise EstablishmentValidationError(
                f"{proposal_id} is not an operations request; a rule is answered by "
                "an administrator of the firm, not by SMD"
            )
        if row["consumed_at"] is not None:
            raise EstablishmentValidationError(
                f"operations request {proposal_id} was already answered; SMD made that change"
            )
        if row["declined_at"] is not None:
            raise EstablishmentValidationError(
                f"operations request {proposal_id} was already declined; nothing was changed"
            )
        if row["lapsed_at"] is not None or row["expires_at"] < time.time():
            raise EstablishmentValidationError(
                f"operations request {proposal_id} lapsed unanswered; ask for it again"
            )

    def ops_ask_sent(self, request: dict[str, Any]) -> dict[str, Any]:
        """Record that SMD has been asked, once, to answer in words this parses.

        Called AFTER the ask is away, so a send that failed leaves the row
        unmarked and the next observer tries again -- the ordering
        ``lapse_notified`` uses, for the same reason. A second call is a named
        refusal rather than a silent no-op, so a seat that has lost track of the
        mark learns it here instead of mailing SMD on every turn.
        """
        pending = self._require_pending()
        proposal_id = _require_proposal_id(request.get("proposal_id"))
        row = pending.get(proposal_id)
        if row is None:
            raise EstablishmentValidationError(
                f"no operations request was recorded under {proposal_id}; nothing to ask about"
            )
        if row["kind"] != OPS_REQUEST_KIND:
            raise EstablishmentValidationError(
                f"{proposal_id} is not an operations request; there is nothing to ask SMD"
            )
        if not pending.mark_ask_sent(proposal_id):
            raise EstablishmentValidationError(
                f"operations request {proposal_id} has already been asked once, or is "
                "no longer open; nothing was changed"
            )
        return {"ok": True, "proposal_id": proposal_id, "ask_sent": True}

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
        outcomes_raw = request.get("include_outcomes", False)
        if not isinstance(outcomes_raw, bool):
            raise EstablishmentValidationError("include_outcomes must be a boolean")
        proposal_id_raw = request.get("proposal_id")
        if proposal_id_raw is not None:
            proposal_id = _require_proposal_id(proposal_id_raw)
            row = pending.get(proposal_id)
            # ss-console#2546 follow-up. Under ``include_outcomes`` this lookup
            # answers "what became of this rule", so it returns the row in ANY
            # state and lets ``state`` say which. Without the flag it answers
            # the older question, "can this still be confirmed", and a committed
            # or expired row is correctly absent -- the same opt-in that keeps a
            # seat running the old plugin seeing exactly what it saw before.
            #
            # THIS IS THE LOOKUP THAT SILENTLY BROKE THE INSTALL NOTICE. The
            # seat fetched the row right after committing it, to learn whether
            # the rule was for_admin and who had asked for it, and got an empty
            # list every time -- because committing is precisely what took the
            # row out of this branch's answer.
            visible = row is not None and (
                outcomes_raw
                or (row["consumed_at"] is None and row["expires_at"] >= time.time())
            )
            open_rows = [row] if visible else []
            return {"ok": True, "pending": [self._pending_view(r) for r in open_rows]}
        if request.get("sender") is None and outcomes_raw:
            # THE SWEEPER'S QUERY, and the only shape with no sender. A lapse
            # has nobody in front of it by definition, so the seat's sweeper
            # asks what ended unreported and tells each row's own author. It
            # returns terminal rows only: nothing here can be confirmed, so it
            # cannot become a second way to release a rule.
            return {
                "ok": True,
                "pending": [
                    self._pending_view(r) for r in pending.unreported_outcomes_for(None)
                ],
            }
        sender = require_address(request.get("sender"), "sender")
        include_raw = request.get("include_for_admin", False)
        if not isinstance(include_raw, bool):
            raise EstablishmentValidationError("include_for_admin must be a boolean")
        rows = pending.open_for(sender, include_raw)
        # ss-console#2546. OPT-IN, and the reason is version skew, not taste.
        # This module ships in the seat image; the plugin that reads it ships at
        # the pinned OVERLAY_REF, and the two move in separate PRs. A seat
        # running the new broker under the old plugin would be handed declined
        # and lapsed rows in a list whose every previous member was confirmable,
        # and would offer the firm a rule that has already been refused. Default
        # off means the old caller sees exactly what it saw before.
        if outcomes_raw:
            rows = rows + pending.unreported_outcomes_for(sender)
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
            "kind": row["kind"],
            "subject": row["subject"],
            "text": row["text"],
            "readback": readback_for(row["proposal_id"], row["text"], row["kind"]),
            "payload": row["payload"],
            # The tool an act row names, at the top level, because that is where
            # the seat reads it (hermes-smd-establishment._act_confirmation_note:
            # ``row.get("tool")``). It also lives inside ``subject``; read live on
            # pilot-smokeball 2026-08-22, a confirmed act came back "no longer
            # held" because this view left the top-level key out and the seat
            # took the empty string as "names no tool".
            "tool": (row["subject"] or {}).get("tool") if row["kind"] == "tool_call" else None,
            "instructed_by": row["instructed_by"],
            "for_admin": row["for_admin"],
            "created_at": row["created_at"],
            "expires_at": row["expires_at"],
            # ss-console#2546. A row is no longer only "here to be confirmed":
            # it can be one the seat must REPORT, and the seat has to be able to
            # tell those apart without inferring it from timestamps.
            "state": proposal_state(row),
            "declined_by": row.get("declined_by"),
            "lapse_notified": row.get("lapse_notified_at") is not None,
            # ss-console#2546 (the operations half). Who at SMD answered, what
            # they wrote, and whether they have already been asked once for an
            # answer in the two words the parser reads. The seat needs all three
            # to compose the notice and to avoid re-asking; none of them means
            # anything on a rule or an act row, where they read back as
            # None/None/False.
            "resolved_by": row.get("resolved_by"),
            "outcome_reason": row.get("outcome_reason"),
            "ask_sent": row.get("ask_sent_at") is not None,
            # ss-console#2546 follow-up. "committed" and "in force" are not the
            # same fact, so the view carries both: ``state`` says the firm's
            # administrator applied it, this says somebody read the run result
            # and saw it land. Only the second entitles a note.
            "installed": row.get("installed_at") is not None,
            # ss-console#2546 (the duplicate-letter fix). Whether SOME observer
            # currently holds the right to send this row's outcome letter. It is
            # the raw column, not a freshness judgement: a claim older than
            # NOTIFY_CLAIM_STALE_SECONDS still reads True here and is still
            # takeable by claim_notify. Nothing may decide whether to send from
            # this field -- that is what the claim verb is for; it is here so a
            # seat can SAY why it is sending nothing.
            "notify_claimed": row.get("notify_claimed_at") is not None,
            "notify_claimed_by": row.get("notify_claimed_by"),
        }

    # ------------------------------------------------------------------
    # act_propose / act_commit  (ss-console#2536)
    # ------------------------------------------------------------------

    def _seat_config(self) -> dict[str, Any]:
        """The seat's own customer.yaml, re-read per call.

        Never cached: the file is root-owned and can be re-applied under a
        running broker, and a cached copy would let a config the firm has
        already changed keep authorizing acts.
        """
        if self.customer_path is None:
            raise EstablishmentValidationError(
                "this broker has no customer.yaml handle; no act can be proposed"
            )
        try:
            import yaml

            data = yaml.safe_load(self.customer_path.read_text(encoding="utf-8")) or {}
        except OSError as exc:
            raise EstablishmentValidationError(
                f"the seat config is not readable ({exc.__class__.__name__}); "
                "no act can be proposed"
            ) from exc
        except Exception as exc:  # noqa: BLE001 - an unparseable config authorizes nothing
            raise EstablishmentValidationError(
                f"the seat config is not parseable ({exc.__class__.__name__}); "
                "no act can be proposed"
            ) from exc
        return data if isinstance(data, dict) else {}

    @staticmethod
    def _require_act_exposure(data: dict[str, Any], tool: str) -> None:
        """Refuse unless SOME persona on this seat authors ``commitment: confirm``.

        WHAT THIS IS AND IS NOT. The persona-aware gate is the seat's
        enforcement hook, which knows which persona is running this turn and
        clamps the act against that persona's authored exposure. This check
        cannot: the broker is not told the persona. What it CAN say is whether
        the seat authorizes confirmable acts at all, and a seat that authorizes
        none must not be able to write an act row through any path, including a
        hook with a bug in it. So it is deliberately the weaker of the two
        checks and it fails in the safe direction: a seat with no
        ``commitment: confirm`` anywhere proposes nothing.
        """
        personas = data.get("personas")
        if not isinstance(personas, list):
            personas = []
        for persona in personas:
            if not isinstance(persona, dict):
                continue
            entitlements = persona.get("entitlements")
            if not isinstance(entitlements, dict):
                continue
            exposure = entitlements.get("exposure")
            if isinstance(exposure, dict) and exposure.get("commitment") == "confirm":
                return
        raise EstablishmentValidationError(
            f"this seat authors no persona with exposure.commitment set to 'confirm', so "
            f"{tool} cannot be proposed to anybody. Authoring it is a config change the "
            "firm agrees to, not something this turn can do"
        )

    def _authored_act_payload(self, tool: str) -> dict[str, Any]:
        """The one payload this seat may propose for this tool, from its own
        authored config. Refused by name when there is none.

        THE MODEL'S ONLY ROLE IN AN ACT IS TO ASK FOR IT. Every value the act
        carries is read here, out of the file the firm authored and a PR
        changed, so "the Operator created a different matter than the one we
        agreed" has no route into the system: a payload that is not byte-equal
        to this is refused, and a seat with nothing authored can propose
        nothing at all.
        """
        if tool != "mcp_smokeball_create_matter":
            raise EstablishmentValidationError(
                f"no authored act payload is defined for {tool!r}"
            )
        data = self._seat_config()
        self._require_act_exposure(data, tool)
        block: Any = data
        for key in ACT_CONFIG_KEYS:
            block = block.get(key) if isinstance(block, dict) else None
        if not isinstance(block, dict):
            raise EstablishmentValidationError(
                "this seat has no authored "
                + ".".join(ACT_CONFIG_KEYS)
                + " block; the firm authors the matter to create, and until it "
                "does there is nothing to propose"
            )
        fields = ACT_TOOLS[tool]
        missing = [f for f in fields if not isinstance(block.get(f), str) or not block[f].strip()]
        if missing:
            raise EstablishmentValidationError(
                "the authored "
                + ".".join(ACT_CONFIG_KEYS)
                + f" block is missing {sorted(missing)}; every field the readback "
                "names has to be authored before the act can be proposed"
            )
        names = ACT_NAME_KEYS.get(tool, ())
        extra = sorted(set(block) - set(fields) - set(names))
        if extra:
            raise EstablishmentValidationError(
                "the authored "
                + ".".join(ACT_CONFIG_KEYS)
                + f" block carries unknown keys {extra}; the act carries exactly "
                f"{sorted(fields)} plus the display names {sorted(names)} and nothing else"
            )
        return {f: block[f].strip() for f in fields}

    def _authored_act_names(self, tool: str) -> dict[str, str]:
        """The authored display names beside the act payload, if the block
        carries them. Empty when it does not; the caller then needs them from
        the request, and refuses by name when nobody supplied them."""
        data = self._seat_config()
        block: Any = data
        for key in ACT_CONFIG_KEYS:
            block = block.get(key) if isinstance(block, dict) else None
        if not isinstance(block, dict):
            return {}
        out: dict[str, str] = {}
        for key in ACT_NAME_KEYS.get(tool, ()):
            value = block.get(key)
            if isinstance(value, str) and value.strip():
                out[key] = value.strip()
        return out

    @staticmethod
    def _require_act_tool(value: Any) -> str:
        tool = _require_text(value, "tool", _MAX_SHORT_TEXT)
        if tool not in ACT_TOOLS:
            raise EstablishmentValidationError(
                f"{tool!r} is not an act this broker can propose; "
                f"the closed vocabulary is {sorted(ACT_TOOLS)}"
            )
        return tool

    @staticmethod
    def _require_act_payload(value: Any, tool: str) -> dict[str, Any]:
        """The caller's payload, shape-checked before it is compared.

        Shape first, then equality, so an oversize or wrong-typed field is a
        named refusal rather than a mismatch that reads like a config problem.
        """
        if not isinstance(value, dict):
            raise EstablishmentValidationError("payload must be an object")
        fields = ACT_TOOLS[tool]
        names = ACT_NAME_KEYS.get(tool, ())
        unknown = sorted(set(value) - set(fields) - set(names))
        if unknown:
            raise EstablishmentValidationError(
                f"payload carries fields {unknown} that {tool} does not take; "
                f"it takes exactly {sorted(fields)} (plus the display names {sorted(names)})"
            )
        return {f: _require_text(value.get(f), f"payload.{f}", _MAX_SHORT_TEXT) for f in fields}

    @staticmethod
    def _payload_names(value: Any, tool: str) -> dict[str, str]:
        """The display names riding in a payload, if any (the hook sends the
        authored block whole). Shape-checked like every other caller string."""
        if not isinstance(value, dict):
            return {}
        out: dict[str, str] = {}
        for key in ACT_NAME_KEYS.get(tool, ()):
            if value.get(key) is not None:
                out[key] = _require_text(value.get(key), f"payload.{key}", _MAX_SHORT_TEXT)
        return out

    def act_propose(self, request: dict[str, Any]) -> dict[str, Any]:
        """Record one TOOL CALL as pending and return the line to send.

        Nothing is created here. What comes back is the exact sentence to put in
        front of an administrator, naming every value the act will carry, and
        the tag they quote when they answer. The act happens on the confirming
        turn, through the tool, under the overlay's own gate.

        NOT A TOOL. This verb is reachable only from the seat's enforcement hook
        (overlay PR 2); no agent-callable tool maps to it. The model can ask for
        the authored matter and cannot compose one.
        """
        pending = self._require_pending()
        tool = self._require_act_tool(request.get("tool"))
        payload = self._require_act_payload(request.get("payload"), tool)
        instructed_by = require_address(request.get("instructed_by"), "instructed_by")
        source_ref = _require_text(request.get("source_ref"), "source_ref", _MAX_SHORT_TEXT)
        authored = self._authored_act_payload(tool)
        authored_names = self._authored_act_names(tool)
        payload_names = self._payload_names(request.get("payload"), tool)
        # Names in the payload must be the authored names: the read-back the
        # administrator says yes to is rendered from them, so a caller-composed
        # name is the one fabrication this verb exists to refuse.
        for key, value in payload_names.items():
            if key in authored_names and value != authored_names[key]:
                raise EstablishmentValidationError(
                    f"the proposed payload's {key} does not match the authored "
                    + ".".join(ACT_CONFIG_KEYS)
                    + " block; the read-back carries the authored name"
                )
        contact_name = _require_display_name(
            request.get("contact_name")
            or payload_names.get("client_contact_name")
            or authored_names.get("client_contact_name"),
            "contact_name (or an authored client_contact_name)",
        )
        matter_type_name = _require_display_name(
            request.get("matter_type_name")
            or payload_names.get("matter_type_name")
            or authored_names.get("matter_type_name"),
            "matter_type_name (or an authored matter_type_name)",
        )
        if payload != authored:
            # The refusal names the FIELDS, never the two values: a refusal that
            # printed both sides would put a caller-supplied string into the
            # ledger and the reply, which is the one thing this comparison
            # exists to keep out.
            differing = sorted(f for f in authored if payload.get(f) != authored[f])
            raise EstablishmentValidationError(
                f"the proposed {tool} payload does not match this seat's authored "
                + ".".join(ACT_CONFIG_KEYS)
                + f" block on {differing}; the act carries the authored values, "
                "and changing them is a config change the firm makes"
            )
        # The hook may pass the block it read as well. It has to agree with the
        # copy THIS uid read, or the two are looking at different files.
        supplied_authored = request.get("authored")
        if supplied_authored is not None:
            if not isinstance(supplied_authored, dict) or {
                k: v for k, v in supplied_authored.items()
            } != authored:
                raise EstablishmentValidationError(
                    "the authored block supplied with this proposal disagrees with the "
                    "one the broker read from the seat config; refusing to choose "
                    "between two configs"
                )

        text = normalize_rule_text(
            act_readback_text(
                tool, authored, contact_name=contact_name, matter_type_name=matter_type_name
            )
        )
        payload_sha256 = _hash_text(
            json.dumps(authored, sort_keys=True, separators=(",", ":"))
        )
        row = pending.create(
            scope="act",
            subject={"tool": tool, "payload_sha256": payload_sha256},
            text=text,
            instructed_by=instructed_by,
            # ALWAYS for an admin. An act is the firm's own record changing;
            # the person who may bless it is a Named Administrator, and the
            # seat-side gate decides who that is.
            for_admin=True,
            kind="tool_call",
            payload=authored,
        )
        self._ledger.append(
            {
                "action_type": ACT_PROPOSED_ACTION_TYPE,
                "actor": "operator",
                "actor_role": "agent",
                "metadata": json.dumps(
                    {
                        "proposal_id": row["proposal_id"],
                        "kind": "tool_call",
                        "tool": tool,
                        "instructed_by": instructed_by,
                        "source_ref": source_ref,
                        # The payload's DIGEST, not the payload. The commit row
                        # carries the same digest, so the two together prove the
                        # act performed is the act proposed without either row
                        # holding a second copy of the firm's values.
                        "payload_sha256": payload_sha256,
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                ),
            }
        )
        return {
            "ok": True,
            "proposal_id": row["proposal_id"],
            "kind": "tool_call",
            "tool": tool,
            "payload": authored,
            "payload_sha256": payload_sha256,
            "for_admin": True,
            "expires_at": row["expires_at"],
            "readback": readback_for(row["proposal_id"], text, "tool_call"),
        }

    def act_commit(self, request: dict[str, Any]) -> dict[str, Any]:
        """Record that a proposed act was performed. Consumes the row exactly once.

        Called AFTER the tool succeeded, by the seat's post-tool hook. A failed
        tool call does not reach here: the row stays open for its TTL so the
        person's "yes" survives one transport failure rather than being spent by
        it.
        """
        pending = self._require_pending()
        row = self._claim_proposal(request, "act")
        tool = self._require_act_tool(request.get("tool"))
        stored_tool = row["subject"].get("tool")
        if tool != stored_tool:
            raise EstablishmentValidationError(
                f"act {row['proposal_id']} was proposed for {stored_tool!r}, not {tool!r}; "
                "refusing to commit a different act under a confirmation for this one"
            )
        stored_payload = row["payload"]
        if not isinstance(stored_payload, dict):
            raise EstablishmentValidationError(
                f"act {row['proposal_id']} holds no payload; nothing can be committed under it"
            )
        supplied = request.get("payload")
        if supplied is not None:
            if self._require_act_payload(supplied, tool) != stored_payload:
                raise EstablishmentValidationError(
                    f"payload does not match act {row['proposal_id']} as it was proposed "
                    "and confirmed; the act carries the proposal's values, not this "
                    "request's"
                )
        confirmed_by = require_address(request.get("confirmed_by"), "confirmed_by")
        confirmed_message_id = _require_text(
            request.get("confirmed_message_id"), "confirmed_message_id", _MAX_SHORT_TEXT
        )
        outcome_raw = request.get("outcome")
        if outcome_raw is not None and not isinstance(outcome_raw, dict):
            raise EstablishmentValidationError("outcome must be an object when present")
        outcome = outcome_raw or {}

        run_id = secrets.token_hex(16)
        if not pending.consume(row["proposal_id"], run_id):
            raise EstablishmentValidationError(
                f"act {row['proposal_id']} was already committed; it has been done"
            )

        payload_sha256 = _hash_text(
            json.dumps(stored_payload, sort_keys=True, separators=(",", ":"))
        )
        metadata = {
            "proposal_id": row["proposal_id"],
            "run_id": run_id,
            "kind": "tool_call",
            "tool": tool,
            "instructed_by": row["instructed_by"],
            # WHO said yes and IN WHICH MESSAGE. The pair is what makes the
            # confirmation joinable to the inbound row that carried it
            # (ss#2497), so "an admin approved this" is checkable rather than
            # asserted.
            "confirmed_by": confirmed_by,
            "confirmed_message_id": confirmed_message_id,
            "payload_sha256": payload_sha256,
            # A bounded rebuild of the tool's own result. Three fields, each
            # read for its type: what the vendor returned is not forwarded.
            "created": bool(outcome.get("created")),
            "pending": bool(outcome.get("pending")),
            "matter_id": _bounded_str(outcome.get("matter_id")),
        }
        self._ledger.append(
            {
                "action_type": ACT_COMMITTED_ACTION_TYPE,
                "actor": "operator",
                "actor_role": "agent",
                "metadata": json.dumps(metadata, sort_keys=True, separators=(",", ":")),
            }
        )
        return {
            "ok": True,
            "proposal_id": row["proposal_id"],
            "run_id": run_id,
            "tool": tool,
            "payload_sha256": payload_sha256,
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
        # The noun follows the SCOPE BEING CLAIMED, not the row: a person who
        # said yes to an act should not be told their rule expired, and the
        # refusals below are read by that person through the reply.
        noun = "act" if scope == "act" else "rule"
        restate = "ask again" if scope == "act" else "state it again"
        unknown_tail = "ask again" if scope == "act" else "state the rule again"
        row = pending.get(proposal_id)
        if row is None:
            raise EstablishmentValidationError(
                f"no {noun} was proposed under {proposal_id}; {unknown_tail}"
            )
        # ss-console#2546 (the operations half). Named FIRST, and by kind rather
        # than by the scope mismatch that would catch it two checks later,
        # because the two refusals read completely differently to the person who
        # gets them: "that was proposed as 'ops', not 'firm_adjust'" sounds like
        # a bug, and this says the true thing -- nobody at the firm confirms a
        # change to how the seat runs, so there is nothing here for a yes to do.
        if row["kind"] == OPS_REQUEST_KIND:
            raise EstablishmentValidationError(
                f"{proposal_id} is an operations request, not a {noun}; SMD makes "
                "those changes and answers them, so there is nothing to confirm"
            )
        if row["consumed_at"] is not None:
            raise EstablishmentValidationError(
                f"{noun} {proposal_id} was already committed; "
                + ("it has been done" if scope == "act" else "it is in effect")
            )
        # ss-console#2546. Two more distinguishable ends. A declined rule must
        # never commit on a later "yes" from anyone, and the person deserves to
        # hear WHICH thing happened: "an administrator declined it" and "nobody
        # answered in time" call for different next sentences from them.
        if row["declined_at"] is not None:
            raise EstablishmentValidationError(
                f"{noun} {proposal_id} was declined by an administrator; "
                f"it is not in effect"
            )
        if row["lapsed_at"] is not None:
            # "Lapsed" is the right word for a rule, which somebody was waiting
            # on an answer to. An act was one call the Operator was holding, and
            # nobody was owed a report about it, so it keeps the sentence it has
            # always had.
            ended = "expired" if scope == "act" else "lapsed unanswered"
            raise EstablishmentValidationError(
                f"{noun} {proposal_id} {ended}; {restate}"
            )
        if row["expires_at"] < time.time():
            raise EstablishmentValidationError(
                f"{noun} {proposal_id} expired; {restate}"
            )
        if row["scope"] != scope:
            raise EstablishmentValidationError(
                f"{noun} {proposal_id} was proposed as {row['scope']!r}, "
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

    def _stamp_installed(self, run_id: str, result: dict[str, Any]) -> None:
        """Record ``installed`` durably, because the read that carries it is
        one-shot (ss-console#2546 follow-up).

        The result file is deleted after the first successful read, so the fact
        that a rule went into force lives for exactly one call and then only in
        an audit row nobody queries. That is why the requester was never told:
        every path that wanted to say "your rule is in effect" had to be the
        one call that read the result, and none of them reliably was.

        A column on the proposal instead. It is written from the root-authored
        result and from the broker's own commit record, never from a request
        field, and it is what the seat's outcome view keys on.

        Best-effort: a stamping fault must not cost the caller the result they
        asked for, which is the same rule the ledger append one line up follows.
        """
        if self.pending is None or result.get("status") != STATUS_INSTALLED:
            return
        try:
            proposal_id = self.pending.mark_installed(run_id)
        except sqlite3.Error:
            logger.warning("run %s installed but the proposal could not be stamped", run_id)
            return
        if proposal_id:
            logger.info("rule %s observed installed on run %s", proposal_id, run_id)

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
            self._stamp_installed(run_id, result)
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
    "ACT_COMMITTED_ACTION_TYPE",
    "ACT_CONFIG_KEYS",
    "ACT_PROPOSED_ACTION_TYPE",
    "ACT_TOOLS",
    "ESTABLISHMENT_RESULT_ACTION_TYPE",
    "ESTABLISHMENT_SUBMITTED_ACTION_TYPE",
    "MAX_DOCS_PER_SET",
    "MAX_DOC_TEXT_BYTES",
    "MAX_RULE_TEXT_BYTES",
    "MAX_SET_BYTES",
    "MAX_SPEC_BODY_BYTES",
    "PENDING_RULES_COLUMN_ALTERS",
    "PROPOSAL_KINDS",
    "PROPOSAL_SCOPES",
    "PROPOSAL_TTL_SECONDS",
    "RESULT_TTL_SECONDS",
    "RULE_DECLINED_ACTION_TYPE",
    "RULE_LAPSED_ACTION_TYPE",
    "RULE_PROPOSED_ACTION_TYPE",
    "RULE_TTL_SECONDS",
    "SPEC_PROPERTIES",
    "STAGING_TTL_SECONDS",
    "SUBMIT_PHASES",
    "TERMINAL_RETENTION_SECONDS",
    "EstablishmentStore",
    "EstablishmentValidationError",
    "PendingRuleStore",
    "act_readback_text",
    "build_result_row",
    "normalize_lf",
    "normalize_rule_text",
    "proposal_state",
    "readback_for",
    "require_address",
    "safe_slug",
    "ttl_for_kind",
]
