"""Body-hash verification + cross-run invariants for the send reconcile.

The fourth phase of ``operator/bin/reconcile-sends.py`` (the 2026-08-24..31
outbound-quality review: format drift, unstable ACK codes, recipient flapping).
The first three passes ask "is every send ACCOUNTED for?"; this one asks, of the
accounted sends, "is each one the body the routine AUTHORED?".

TWO CHECKS, DIFFERENT STRENGTHS (cross-workstream contract, item 1):

* PRIMARY -- the deterministic hash join. The skill's pre_run stamps
  ``canonical_body_sha256`` of every rendered body onto its EMITTED_WAKE row
  (``body_sha256: [{body_sha256_full, body_sha256_skeleton}]``); the overlay
  stamps ``rendered_body_sha256`` + ``body_variant`` onto
  CONFIRM_SEND_DISPATCHED at transmit. Both stamps are written seat-side, so
  the comparison needs no body fetch and no normalization judgment. A dispatch
  hash matching neither wake hash is ``BODY_DIVERGED`` -- a finding. A skeleton
  match grades ``degraded``, never a finding: the fallback ladder fired as
  designed.

* SECONDARY -- the transient channel fetch. The message body is pulled from the
  mailbox (AgentMail ``text`` / msgraph ``body``), canon-hashed, and compared to
  the wake stamp. Channel transforms (HTML wrapping, quoting) are uncalibrated
  until the first live rehearsal, so a mismatch HERE is a HOLD, not a finding
  -- it reddens the run without accusing anyone. Promotion to a finding is a
  one-line change once rehearsal calibrates the transforms.

LEAK SAFETY IS STRUCTURAL, NOT DISCIPLINARY. Both repos are PUBLIC. A client
email body must never appear in CI logs, artifacts, committed files, or issue
bodies. So :class:`BodyVerdict` and :class:`InvariantFinding` carry hashes,
timestamps, and rule names ONLY -- no field exists that could hold body text,
and ``operator/bin/tests/test_send_verify.py`` pins that shape (a regression
that adds a ``body``/``text``/``content``/``html`` field fails there before it
ships). The fetched body lives in one local variable that flows into
``canonical_body_sha256`` and nowhere else.

HOLDS ARE THE DESIGNED INTERIM STATE. Until the render cluster (WS-RENDER)
deploys, no wake row carries a hash and no dispatch row carries
``rendered_body_sha256``, so this phase evaluates nothing and stays quiet. As
seats pick the stamps up, a templated send missing its counterpart stamp is a
HOLD line ("templated send with no wake hash") -- red, filed nowhere -- because
the stamp's absence is a deployment-skew fact, not an accusation.

CROSS-RUN INVARIANTS cover the ``compositional`` skills the hash join cannot:
the same routine must not flap recipients across runs, and the same item_key
must keep its ACK code. The committed expectation file
(``operator/bin/send-invariants.json``) stores sha256(routine|value) pairs --
hashed on purpose; the public baseline already exposes addresses and this file
must not widen that surface. Missing/corrupt file => empty expectations =>
first-seen values are REPORTED as proposals, never silently trusted.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

_OPERATOR_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SEND_RENDER_PATH = os.path.join(_OPERATOR_DIR, "contracts", "send-render.yaml")
CANON_VECTORS_PATH = os.path.join(_OPERATOR_DIR, "contracts", "fixtures", "body-canon-vectors.json")
DEFAULT_INVARIANTS_PATH = os.path.join(_OPERATOR_DIR, "bin", "send-invariants.json")

#: How long after a wake a dispatch may land and still be that wake's send.
#: The terminal-state contract's ``scheduled_outbound`` window
#: (operator/contracts/terminal-states.yaml routine_classes), consumed
#: one-to-one like the reconciler's ``_claim``.
VERIFY_WINDOW_S = 3600

#: Render modes whose bodies are hash-verifiable. ``compositional`` is covered
#: by the invariants instead.
_HASH_VERIFIED_MODES = ("templated", "slot-templated")

VERDICT_MATCH = "match"
VERDICT_DEGRADED = "degraded"  # skeleton fallback delivered; designed behavior
VERDICT_DIVERGED = "BODY_DIVERGED"  # finding
VERDICT_NO_WAKE_HASH = "no_wake_hash"  # hold
VERDICT_NO_DISPATCH_STAMP = "no_dispatch_stamp"  # hold
VERDICT_BODY_UNAVAILABLE = "body_unavailable"  # hold
VERDICT_CHANNEL_MISMATCH = "channel_mismatch_hold"  # hold until rehearsal calibrates

_HOLD_VERDICTS = (
    VERDICT_NO_WAKE_HASH,
    VERDICT_NO_DISPATCH_STAMP,
    VERDICT_BODY_UNAVAILABLE,
    VERDICT_CHANNEL_MISMATCH,
)


class SendRenderError(RuntimeError):
    """A malformed send-render contract. Refuse to evaluate; never guess."""


def canonical_body_sha256(text: str) -> str:
    """THE hash function -- identical at all three stamp sites.

    sha256 over utf-8 of (CRLF -> LF, per-line trailing whitespace stripped,
    trailing newlines stripped). The arbiter is the shared vector fixture
    (``operator/contracts/fixtures/body-canon-vectors.json``), loaded verbatim
    by this repo's tests and the overlay's; an implementation change that
    drifts from the vectors fails both suites, which is the whole point of one
    fixture instead of two prose descriptions.
    """
    normalized = text.replace("\r\n", "\n")
    lines = [line.rstrip() for line in normalized.split("\n")]
    return hashlib.sha256("\n".join(lines).rstrip("\n").encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class RenderDecl:
    skill: str
    render: str  # templated | slot-templated | compositional
    template: Optional[str] = None

    @property
    def hash_verified(self) -> bool:
        return self.render in _HASH_VERIFIED_MODES


def load_send_render(path: str = SEND_RENDER_PATH) -> dict[str, RenderDecl]:
    """Parse the contract. Parsed, never grepped; malformed RAISES.

    A missing contract file also raises: unlike the invariants file (where the
    safe failure is over-reporting), a verifier that silently ran with an empty
    declaration set would grade every templated send as unverifiable and call
    that clean.
    """
    import yaml  # deferred; reconcile-sends only needs it on this path

    with open(path, encoding="utf-8") as handle:
        parsed = yaml.safe_load(handle)
    if not isinstance(parsed, dict) or not isinstance(parsed.get("skills"), dict):
        raise SendRenderError(f"{path}: expected a mapping with a `skills` mapping")
    out: dict[str, RenderDecl] = {}
    for skill, entry in parsed["skills"].items():
        if not isinstance(entry, dict):
            raise SendRenderError(f"{path}: skills.{skill} must be a mapping")
        render = entry.get("render")
        if render not in ("templated", "slot-templated", "compositional"):
            raise SendRenderError(
                f"{path}: skills.{skill}.render must be templated | slot-templated | "
                f"compositional (got {render!r})"
            )
        template = entry.get("template")
        if render in _HASH_VERIFIED_MODES and not isinstance(template, str):
            raise SendRenderError(
                f"{path}: skills.{skill} declares render: {render} but names no template"
            )
        out[str(skill)] = RenderDecl(skill=str(skill), render=str(render), template=template)
    return out


# ---------------------------------------------------------------------------
# stamps read off the audit rows
# ---------------------------------------------------------------------------


@dataclass
class WakeStamp:
    """One EMITTED_WAKE row's body stamps. Hashes only, ever."""

    ts: datetime
    skill_name: str
    hashes_full: list[str] = field(default_factory=list)
    hashes_skeleton: list[str] = field(default_factory=list)
    items: list[dict] = field(default_factory=list)  # [{item_key, ack_code}]
    row_id: Optional[str] = None
    consumed: int = 0  # dispatch pairings consumed against this wake

    @property
    def dispatch_capacity(self) -> int:
        return max(len(self.hashes_full), 1)


@dataclass
class DispatchStamp:
    """One CONFIRM_SEND_DISPATCHED row's render stamp."""

    ts: datetime
    skill_name: str
    rendered_body_sha256: str
    body_variant: str  # full | skeleton | "" when unstamped
    row_id: Optional[str] = None


def _parse_ts(value) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)


def _metadata(row: dict) -> dict:
    raw = row.get("metadata")
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except ValueError:
            return {}
    return raw if isinstance(raw, dict) else {}


def _hash_entries(meta: dict) -> tuple[list[str], list[str]]:
    """The wake row's ``body_sha256`` list -> (full hashes, skeleton hashes).

    Tolerant of the entry being a bare hex string (a single-dispatch shorthand
    an emitter might reasonably write) but never of inventing one: anything not
    a string or a mapping contributes nothing.
    """
    full: list[str] = []
    skeleton: list[str] = []
    entries = meta.get("body_sha256")
    for entry in entries if isinstance(entries, list) else []:
        if isinstance(entry, str) and entry:
            full.append(entry)
        elif isinstance(entry, dict):
            if isinstance(entry.get("body_sha256_full"), str) and entry["body_sha256_full"]:
                full.append(entry["body_sha256_full"])
            if isinstance(entry.get("body_sha256_skeleton"), str) and entry["body_sha256_skeleton"]:
                skeleton.append(entry["body_sha256_skeleton"])
    return full, skeleton


def index_wakes(rows: list[dict]) -> list[WakeStamp]:
    """Every EMITTED_WAKE row, as a stamp. Rows with no hashes still index --
    the ``items`` half feeds ``ack_invariant`` whether or not the render
    cluster has landed body hashes on this seat yet."""
    out: list[WakeStamp] = []
    for row in rows:
        if row.get("action_type") != "EMITTED_WAKE" or not row.get("ts"):
            continue
        meta = _metadata(row)
        full, skeleton = _hash_entries(meta)
        raw_items = meta.get("items")
        items = [
            entry
            for entry in (raw_items if isinstance(raw_items, list) else [])
            if isinstance(entry, dict) and entry.get("item_key") and entry.get("ack_code")
        ]
        out.append(
            WakeStamp(
                ts=_parse_ts(row["ts"]),
                skill_name=str(row.get("skill_name") or ""),
                hashes_full=full,
                hashes_skeleton=skeleton,
                items=items,
                row_id=row.get("id"),
            )
        )
    return sorted(out, key=lambda stamp: stamp.ts)


def index_dispatches(rows: list[dict]) -> list[DispatchStamp]:
    """Every CONFIRM_SEND_DISPATCHED row that SENT (outcome == sent).

    ``refused`` / ``transport_error`` siblings delivered nothing, so there is
    no body to verify. A sent row with no ``rendered_body_sha256`` still
    indexes (variant ``""``): for a templated skill that absence is itself the
    hold this phase reports.
    """
    out: list[DispatchStamp] = []
    for row in rows:
        if row.get("action_type") != "CONFIRM_SEND_DISPATCHED" or not row.get("ts"):
            continue
        meta = _metadata(row)
        if meta.get("outcome") != "sent":
            continue
        rendered = meta.get("rendered_body_sha256")
        out.append(
            DispatchStamp(
                ts=_parse_ts(row["ts"]),
                skill_name=str(row.get("skill_name") or ""),
                rendered_body_sha256=rendered if isinstance(rendered, str) else "",
                body_variant=str(meta.get("body_variant") or ""),
                row_id=row.get("id"),
            )
        )
    return sorted(out, key=lambda stamp: stamp.ts)


# ---------------------------------------------------------------------------
# verdicts -- structurally body-free
# ---------------------------------------------------------------------------


@dataclass
class BodyVerdict:
    """One verified (or unverifiable) send. NO body field exists on purpose:
    the leak-safety is structural, and test_send_verify.py pins it."""

    skill_name: str
    verdict: str
    wake_ts: Optional[str] = None
    dispatch_ts: Optional[str] = None
    message_id: Optional[str] = None
    expected_sha256: Optional[str] = None
    actual_sha256: Optional[str] = None
    detail: Optional[str] = None

    @property
    def is_finding(self) -> bool:
        return self.verdict == VERDICT_DIVERGED

    @property
    def is_hold(self) -> bool:
        return self.verdict in _HOLD_VERDICTS


@dataclass
class InvariantFinding:
    """One cross-run invariant violation. Hashed keys only -- the committed
    expectation file is public, and so is anything this renders."""

    rule: str  # recipient_set | ack_stability
    skill_name: str
    hashed_key: str
    expected: Optional[str] = None
    actual: Optional[str] = None
    detail: Optional[str] = None


def verify_hash_join(
    wakes: list[WakeStamp],
    dispatches: list[DispatchStamp],
    declares: dict[str, RenderDecl],
    *,
    window_s: int = VERIFY_WINDOW_S,
) -> list[BodyVerdict]:
    """The PRIMARY check: dispatch stamp vs wake stamp, per skill, consumed.

    Only skills declared ``templated`` / ``slot-templated`` are graded -- a
    compositional skill has no authored hash to diverge from. A wake stamp is
    consumed per dispatch entry it carried (``dispatch_capacity``), so one wake
    cannot launder an unbounded run of dispatches.
    """
    verdicts: list[BodyVerdict] = []
    for dispatch in dispatches:
        decl = declares.get(dispatch.skill_name)
        if decl is None or not decl.hash_verified:
            continue
        wake = _claim_wake(wakes, dispatch, window_s)
        if wake is None:
            verdicts.append(
                BodyVerdict(
                    skill_name=dispatch.skill_name,
                    verdict=VERDICT_NO_WAKE_HASH,
                    dispatch_ts=dispatch.ts.isoformat(),
                    actual_sha256=dispatch.rendered_body_sha256 or None,
                    detail="templated send with no wake hash in window",
                )
            )
            continue
        verdicts.append(_grade_pair(wake, dispatch))
    return verdicts


def _claim_wake(
    wakes: list[WakeStamp], dispatch: DispatchStamp, window_s: int
) -> Optional[WakeStamp]:
    for wake in wakes:
        if wake.skill_name != dispatch.skill_name or not wake.hashes_full:
            continue
        if not (wake.ts <= dispatch.ts <= wake.ts + timedelta(seconds=window_s)):
            continue
        if wake.consumed >= wake.dispatch_capacity:
            continue
        wake.consumed += 1
        return wake
    return None


def _grade_pair(wake: WakeStamp, dispatch: DispatchStamp) -> BodyVerdict:
    common = {
        "skill_name": dispatch.skill_name,
        "wake_ts": wake.ts.isoformat(),
        "dispatch_ts": dispatch.ts.isoformat(),
        "actual_sha256": dispatch.rendered_body_sha256 or None,
    }
    if not dispatch.rendered_body_sha256:
        return BodyVerdict(
            verdict=VERDICT_NO_DISPATCH_STAMP,
            expected_sha256=wake.hashes_full[0],
            detail="dispatch row carries no rendered_body_sha256",
            **common,
        )
    if dispatch.rendered_body_sha256 in wake.hashes_full:
        return BodyVerdict(verdict=VERDICT_MATCH, **common)
    if dispatch.rendered_body_sha256 in wake.hashes_skeleton:
        # The authored fallback ladder delivered the identifier-free skeleton.
        # Designed behavior under a render fault -- reported, never a finding.
        return BodyVerdict(
            verdict=VERDICT_DEGRADED, detail="skeleton fallback delivered", **common
        )
    return BodyVerdict(
        verdict=VERDICT_DIVERGED,
        expected_sha256=wake.hashes_full[0],
        detail="dispatch hash matches neither full nor skeleton wake hash",
        **common,
    )


def verify_channel_bodies(
    sent: list[dict],
    wakes: list[WakeStamp],
    declares: dict[str, RenderDecl],
    fetch_body: Callable[[dict], Optional[str]],
    *,
    window_s: int = VERIFY_WINDOW_S,
) -> list[BodyVerdict]:
    """The SECONDARY check: what the mailbox actually holds, canon-hashed.

    For each wake stamp of a hash-verified skill, mailbox messages inside the
    window are claimed one-to-one (oldest first) and their fetched bodies
    canon-compared to the wake's full/skeleton hashes. A mismatch is a HOLD,
    not a finding, until the first live rehearsal calibrates channel
    transforms (msgraph HTML-wraps; AgentMail's ``text`` may differ from
    submitted bytes) -- promoting it is a one-line change here. The body
    itself exists only inside this function.
    """
    verdicts: list[BodyVerdict] = []
    claimed: set[int] = set()
    ordered = sorted(sent, key=lambda m: str(m.get("timestamp") or ""))
    for wake in wakes:
        decl = declares.get(wake.skill_name)
        if decl is None or not decl.hash_verified or not wake.hashes_full:
            continue
        for capacity_used, (index, message) in enumerate(_messages_in_window(ordered, wake, window_s, claimed)):
            if capacity_used >= wake.dispatch_capacity:
                break
            claimed.add(index)
            verdicts.append(_grade_channel_body(wake, message, fetch_body))
    return verdicts


def _messages_in_window(ordered, wake, window_s, claimed):
    for index, message in enumerate(ordered):
        if index in claimed or not message.get("timestamp"):
            continue
        stamp = _parse_ts(message["timestamp"])
        if wake.ts <= stamp <= wake.ts + timedelta(seconds=window_s):
            yield index, message


def _grade_channel_body(wake, message, fetch_body) -> BodyVerdict:
    common = {
        "skill_name": wake.skill_name,
        "wake_ts": wake.ts.isoformat(),
        "message_id": str(message.get("message_id") or "") or None,
        "expected_sha256": wake.hashes_full[0],
    }
    try:
        body = fetch_body(message)
    except Exception as exc:  # noqa: BLE001 -- transport discipline: any failure HOLDS
        return BodyVerdict(
            verdict=VERDICT_BODY_UNAVAILABLE, detail=f"body fetch failed: {exc}", **common
        )
    if not isinstance(body, str) or not body:
        return BodyVerdict(
            verdict=VERDICT_BODY_UNAVAILABLE, detail="channel returned no text body", **common
        )
    digest = canonical_body_sha256(body)
    if digest in wake.hashes_full:
        return BodyVerdict(verdict=VERDICT_MATCH, actual_sha256=digest, **common)
    if digest in wake.hashes_skeleton:
        return BodyVerdict(
            verdict=VERDICT_DEGRADED,
            actual_sha256=digest,
            detail="channel body matches the skeleton fallback",
            **common,
        )
    return BodyVerdict(
        verdict=VERDICT_CHANNEL_MISMATCH,
        actual_sha256=digest,
        detail="channel body hash differs from wake stamp (channel transforms uncalibrated; hold, not finding)",
        **common,
    )


# ---------------------------------------------------------------------------
# cross-run invariants (compositional skills)
# ---------------------------------------------------------------------------


def load_invariants(path: str = DEFAULT_INVARIANTS_PATH) -> dict:
    """Committed expectations. Missing/corrupt => EMPTY, on purpose: this
    file's only failure mode must be over-reporting (proposals for everything),
    never a silently satisfied invariant -- the load_baseline discipline."""
    try:
        with open(path, encoding="utf-8") as handle:
            parsed = json.load(handle)
    except (OSError, ValueError):
        return {"recipients": {}, "ack_codes": {}}
    if not isinstance(parsed, dict):
        return {"recipients": {}, "ack_codes": {}}
    recipients = parsed.get("recipients")
    ack_codes = parsed.get("ack_codes")
    return {
        "recipients": recipients if isinstance(recipients, dict) else {},
        "ack_codes": ack_codes if isinstance(ack_codes, dict) else {},
    }


def _recipient_hash(routine: str, recipient: str) -> str:
    return hashlib.sha256(f"{routine}|{recipient.lower()}".encode("utf-8")).hexdigest()


def _item_hash(routine: str, item_key: str) -> str:
    return hashlib.sha256(f"{routine}|{item_key}".encode("utf-8")).hexdigest()


#: Metadata keys a dispatch row may carry its recipient(s) under. Probed
#: against the render cluster's transmit-metadata additions as they land; a
#: row carrying none of these is SKIPPED (counted, not graded) rather than
#: guessed at -- vendor/emitter shapes are probed, never assumed.
_RECIPIENT_KEYS = ("recipient", "recipients", "to", "routing_leg_recipient")


def _row_recipients(meta: dict) -> list[str]:
    for key in _RECIPIENT_KEYS:
        value = meta.get(key)
        if isinstance(value, str) and value:
            return [value]
        if isinstance(value, list):
            found = [v for v in value if isinstance(v, str) and v]
            if found:
                return found
    return []


def recipient_invariant(
    rows: list[dict], declares: dict[str, RenderDecl], expectations: dict
) -> list[InvariantFinding]:
    """A compositional routine sending to an address outside its committed
    recipient set is the recipient-flapping defect. Hashes compare; addresses
    never leave the process."""
    committed = expectations.get("recipients") or {}
    findings: list[InvariantFinding] = []
    seen: set[str] = set()
    for row in rows:
        if row.get("action_type") != "CONFIRM_SEND_DISPATCHED":
            continue
        skill = str(row.get("skill_name") or "")
        decl = declares.get(skill)
        if decl is None or decl.hash_verified:
            continue
        meta = _metadata(row)
        if meta.get("outcome") != "sent":
            continue
        allowed = {str(v) for v in (committed.get(skill) or [])}
        for recipient in _row_recipients(meta):
            hashed = _recipient_hash(skill, recipient)
            if hashed in allowed or hashed in seen:
                continue
            seen.add(hashed)
            findings.append(
                InvariantFinding(
                    rule="recipient_set",
                    skill_name=skill,
                    hashed_key=hashed,
                    detail="dispatch recipient hash not in committed set "
                    "(operator/bin/send-invariants.json)",
                )
            )
    return findings


def ack_invariant(
    wakes: list[WakeStamp], declares: dict[str, RenderDecl], expectations: dict
) -> list[InvariantFinding]:
    """The same item_key must map to the same ack_code -- across the runs in
    this window AND against the committed history. An ACK code that moves under
    a reader is the unstable-ACK defect from the review week."""
    committed = expectations.get("ack_codes") or {}
    findings: list[InvariantFinding] = []
    observed: dict[str, str] = {}
    for wake in wakes:
        if declares.get(wake.skill_name) is None:
            continue
        for item in wake.items:
            key = _item_hash(wake.skill_name, str(item["item_key"]))
            code = str(item["ack_code"])
            expected = committed.get(key) or observed.get(key)
            if expected is None:
                observed[key] = code
                continue
            if expected != code:
                findings.append(
                    InvariantFinding(
                        rule="ack_stability",
                        skill_name=wake.skill_name,
                        hashed_key=key,
                        expected=expected,
                        actual=code,
                        detail="item_key maps to a different ack_code than committed/prior",
                    )
                )
    return findings


# ---------------------------------------------------------------------------
# the verifier the reconciler calls (one object, so the caller stays small)
# ---------------------------------------------------------------------------


class SendVerifier:
    """Constructed once in reconcile-sends' main(); applied per inbox."""

    def __init__(self, declares: dict[str, RenderDecl], invariants: dict) -> None:
        self._declares = declares
        self._invariants = invariants

    def verify_inbox(
        self,
        sent: list[dict],
        rows: list[dict],
        fetch_body: Optional[Callable[[dict], Optional[str]]] = None,
    ) -> tuple[list[BodyVerdict], list[InvariantFinding]]:
        wakes = index_wakes(rows)
        dispatches = index_dispatches(rows)
        verdicts = verify_hash_join(wakes, dispatches, self._declares)
        if fetch_body is not None:
            verdicts += verify_channel_bodies(sent, wakes, self._declares, fetch_body)
        invariants = recipient_invariant(rows, self._declares, self._invariants)
        invariants += ack_invariant(wakes, self._declares, self._invariants)
        return verdicts, invariants


def verifier_from_contract(
    render_path: str = SEND_RENDER_PATH, invariants_path: str = DEFAULT_INVARIANTS_PATH
) -> SendVerifier:
    return SendVerifier(load_send_render(render_path), load_invariants(invariants_path))


# ---------------------------------------------------------------------------
# report integration helpers (hashes and rule names only; never a body)
# ---------------------------------------------------------------------------


def has_findings(verdicts: list[BodyVerdict], invariants: list[InvariantFinding]) -> bool:
    return any(v.is_finding for v in verdicts) or bool(invariants)


def has_holds(verdicts: list[BodyVerdict]) -> bool:
    return any(v.is_hold for v in verdicts)


def render_lines(
    inbox: str, verdicts: list[BodyVerdict], invariants: list[InvariantFinding]
) -> list[str]:
    """Report lines for one inbox. HOLD lines start in column 0 with `HOLD`
    (the workflow greps ``^HOLD`` and reddens the run on them); finding lines
    are indented under the inbox like the reconciler's own."""
    lines: list[str] = []
    for verdict in verdicts:
        if verdict.is_finding:
            lines.append(
                f"        BODY_DIVERGED {verdict.skill_name} "
                f"dispatch={verdict.dispatch_ts or '-'} "
                f"expected={verdict.expected_sha256 or '-'} actual={verdict.actual_sha256 or '-'}"
            )
        elif verdict.verdict == VERDICT_DEGRADED:
            lines.append(
                f"        degraded {verdict.skill_name} "
                f"dispatch={verdict.dispatch_ts or '-'} (skeleton fallback delivered)"
            )
    for finding in invariants:
        lines.append(
            f"        INVARIANT {finding.rule} {finding.skill_name} key={finding.hashed_key} "
            f"expected={finding.expected or '-'} actual={finding.actual or '-'}"
        )
    holds: dict[str, int] = {}
    for verdict in verdicts:
        if verdict.is_hold:
            holds[f"{verdict.verdict} [{verdict.skill_name}]"] = (
                holds.get(f"{verdict.verdict} [{verdict.skill_name}]", 0) + 1
            )
    for reason, count in sorted(holds.items()):
        lines.append(f"HOLD  {inbox}: body-verify {count} send(s) {reason}")
    return lines


def digest_keys(
    inbox: str, verdicts: list[BodyVerdict], invariants: list[InvariantFinding]
) -> list[str]:
    """Stable keys for the reconciler's finding fingerprint, so the existing
    issue-dedupe machinery covers the new classes with zero workflow changes."""
    keys = [
        f"{inbox}|body:{v.skill_name}|{v.dispatch_ts or v.wake_ts}|{v.actual_sha256}"
        for v in verdicts
        if v.is_finding
    ]
    keys += [f"{inbox}|inv:{f.rule}|{f.hashed_key}|{f.actual or ''}" for f in invariants]
    return keys


#: The COMPLETE emission surfaces for --json. Fixed key allowlists on purpose
#: (never dataclasses.asdict of something that might grow a field): what is
#: listed here is ALL that can ever leave the process, so a regressed verdict
#: that grew a body field still emits nothing new.
_VERDICT_EMIT_KEYS = (
    "skill_name",
    "verdict",
    "wake_ts",
    "dispatch_ts",
    "message_id",
    "expected_sha256",
    "actual_sha256",
    "detail",
)
_INVARIANT_EMIT_KEYS = ("rule", "skill_name", "hashed_key", "expected", "actual", "detail")


def as_dicts(
    verdicts: list[BodyVerdict], invariants: list[InvariantFinding]
) -> tuple[list[dict], list[dict]]:
    """--json emission through the fixed allowlists above."""
    return (
        [{key: getattr(v, key) for key in _VERDICT_EMIT_KEYS} for v in verdicts],
        [{key: getattr(f, key) for key in _INVARIANT_EMIT_KEYS} for f in invariants],
    )


__all__ = [
    "BodyVerdict",
    "DispatchStamp",
    "InvariantFinding",
    "RenderDecl",
    "SendRenderError",
    "SendVerifier",
    "WakeStamp",
    "ack_invariant",
    "as_dicts",
    "canonical_body_sha256",
    "digest_keys",
    "has_findings",
    "has_holds",
    "index_dispatches",
    "index_wakes",
    "load_invariants",
    "load_send_render",
    "recipient_invariant",
    "render_lines",
    "verifier_from_contract",
    "verify_channel_bodies",
    "verify_hash_join",
]
