"""Per-customer namespace isolation enforcement (issue #861, ADR 0009).

ADR 0009 prohibits cross-Machine queries against the per-customer D1,
R2, and Vectorize bindings. The substrate's existing answer is structural:
each customer's Hermes Machine is bound to its own D1 database, its own
R2 bucket prefix, and its own Vectorize index, so the binding *is* the
scope (see `audit_log.py` docstring + `r2-vectorize-naming.md`).

That structural answer is correct but verbal-only. A misrouted binding,
a copy/paste of a sibling customer's index name, or a buggy code path
that constructs an R2 key from the wrong slug variable would all
silently leak data across customers without code-layer detection.

This module is the safety-floor enforcement. Every non-trivial caller
that touches D1, R2, or Vectorize wraps the raw client in one of the
three executors below, constructed against the customer slug that the
binding was *intended* to serve. The wrapper rejects any call whose
target keyspace does not match that slug, regardless of how the call
came to be constructed.

Three pieces, mirroring the `D1Executor` pattern documented in the audit
immutability module (ported to
`hermes-smd-overlay/plugins/hermes-smd-audit/immutability.py`; #1130):

1. `NamespacedD1Executor` — wraps an existing `Executor` (the protocol
   declared in `audit_log.py`). The D1 binding is already per-customer,
   so this wrapper's job is narrower than the R2 and Vectorize wrappers:
   it inspects SQL for foreign `hermes-{other-slug}-*` tokens and for
   `vaults/{other-slug}/` literals embedded in parameterized queries.
   Statements that mention no slug-shaped token are passed through
   unchanged (the binding scopes them).

2. `NamespacedR2Client` — wraps any object surface with `put_object` /
   `get_object` / `delete_object` and rejects keys not under either
   `vaults/{slug}/` or `{slug}/vault/`. Both conventions coexist in the
   codebase (see `r2-vectorize-naming.md` + `connectors/no_pm/store.py`
   for the two prefix shapes).

3. `NamespacedVectorizeClient` — wraps any vector surface with
   `upsert_vectors` / `query_vectors` / `delete_vectors` and rejects
   index names that don't match `hermes-{slug}-vault` or
   `hermes-{slug}-corrections` (the only two per-customer indices per
   `decommission.py`).

Every refusal is loud:

* A structured `NamespaceAssertionError` is raised with a uniform
  shape `(violation_kind, expected_slug, attempted_target)`. Callers
  MUST NOT swallow this — the contract is identical to
  `AuditLogImmutabilityError`: an attempted cross-customer access is
  a safety-substrate alarm.

* An `INVARIANT_VIOLATION` row is written to the per-customer
  audit_log via the injected `AuditLogWriter`. The audit emit is best
  effort *for the refusal* — if the audit write itself fails, we log
  loudly but still raise the namespace error (the violation must not
  fall through silently because of an unrelated audit transport
  failure).

Design notes
------------

* The wrappers are constructed against a single `expected_slug`. A
  shared instance across customers is a category error — instantiate
  one wrapper per Machine boot.

* Slug validation matches `slug_regex` used at provisioning time:
  lowercase letters, digits, dashes, 2-40 chars, not starting or
  ending with a dash. This is enforced in the constructor so a
  misconfigured slug fails fast rather than silently quoting the
  literal into refusals.

* SQL inspection is deliberately conservative. The D1 wrapper looks
  for the two cross-customer signatures it can detect statically:
  `hermes-{slug}-` (binding/index name leaks into a query) and
  `vaults/{slug}/` (R2 key string embedded in SQL). It does NOT try
  to parse general SQL — if the statement mentions no slug-shaped
  token, the binding alone is the scope, exactly as ADR 0009 says.

* R2 key inspection strips a leading `/` (consumers sometimes pass
  rooted paths). It refuses empty keys, traversal sequences (`..`),
  and any key whose first segment after normalization is not the
  expected slug under either convention.

* Vectorize index inspection is exact-match against the two allowed
  names. Wildcards, prefix matches, or unknown indices are refused.

Out of scope (this PR)
----------------------

* Replacing the raw clients in production wiring. The wrappers are
  additive: callers import and construct them at the call site. A
  separate PR can refactor `bootstrap.sh` to enforce wrapper-only
  construction once every caller has migrated.

* Hardening against time-of-check / time-of-use. The wrappers check
  the slug at call time; a caller that already obtained a raw client
  reference can still bypass. The follow-on hardening is to delete
  the raw constructors from the adapter `__init__.py` once every
  in-tree call site is migrated.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any, Optional, Protocol

from .audit_log import (
    ACCEPTED_ACTION_TYPES,
    AuditEvent,
    AuditLogWriter,
    AuditWriteError,
)

log = logging.getLogger("aie.namespace_assertion")


# ---------------------------------------------------------------------------
# Slug validation
#
# CANONICAL. Lowercase alphanumerics + dashes, 2-40 chars, no leading or
# trailing dash. The adapter does not own provisioning, but it owns the
# contract for what qualifies as a customer scope at runtime — a malformed slug
# here is a bootstrap-time invariant failure, so every write-side guard is held
# to THIS pattern rather than the other way round (#2285). Through 2026-08-11
# the write-side guards were looser than this one, which meant a slug like
# `acme-` could provision, publish to R2, and project to D1, and only then die
# here at boot. The four guards that must not drift from this line:
#   bin/provision-customer.sh                (input gate)
#   scripts/ci-publish-customer-configs.sh   (slug gate + R2 key gate)
#   scripts/ci-sync-customer-configs.sh      (D1 projection gate)
# tests/customer-slug-pattern.test.ts runs one candidate table through all of
# them, including this file, and fails the moment two verdicts disagree.
# ---------------------------------------------------------------------------


_SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$")


def _validate_slug(slug: str) -> str:
    if not isinstance(slug, str) or not _SLUG_PATTERN.match(slug):
        raise ValueError(
            f"namespace slug {slug!r} does not match required pattern "
            "(lowercase alphanumerics + dashes, 2-40 chars, no leading/trailing dash); "
            "this is a bootstrap-time invariant failure — see bin/provision-customer.sh"
        )
    return slug


# ---------------------------------------------------------------------------
# Refusal exception
# ---------------------------------------------------------------------------


class NamespaceAssertionError(RuntimeError):
    """Raised when a wrapped client is asked to touch a foreign customer.

    Same contract as `AuditLogImmutabilityError`: the caller MUST NOT
    swallow this. An attempted cross-customer access is a safety-substrate
    alarm and the action that triggered it must abort.

    Attributes mirror the audit row written alongside the raise:

    * `violation_kind` — one of `d1_sql`, `r2_key`, `vectorize_index`
    * `expected_slug` — the slug the wrapper was bound to at construction
    * `attempted_target` — the foreign string the caller passed
    """

    def __init__(
        self,
        *,
        violation_kind: str,
        expected_slug: str,
        attempted_target: str,
        detail: str,
    ) -> None:
        super().__init__(
            f"namespace assertion failed [{violation_kind}]: "
            f"expected slug={expected_slug!r}, attempted target={attempted_target!r}; "
            f"{detail}"
        )
        self.violation_kind = violation_kind
        self.expected_slug = expected_slug
        self.attempted_target = attempted_target
        self.detail = detail


# ---------------------------------------------------------------------------
# Audit emission
#
# Every refusal writes one INVARIANT_VIOLATION row. The audit write is
# attempted before the raise so the operator dashboard shows the
# violation even if the calling skill catches the exception (it must
# not, but defense-in-depth). If the audit write fails we log loudly
# and still raise — a transport failure on the audit channel must not
# mask a real cross-customer access attempt.
# ---------------------------------------------------------------------------


_INVARIANT_VIOLATION = "INVARIANT_VIOLATION"

# Sanity check at import time: the action_type we emit must be on the
# accepted set. If it ever drifts out, this module will fail to import
# rather than silently emitting a `ValueError` at refusal time.
assert _INVARIANT_VIOLATION in ACCEPTED_ACTION_TYPES, (
    f"namespace_assertion expects {_INVARIANT_VIOLATION!r} in ACCEPTED_ACTION_TYPES "
    "(see operator/adapter/audit_log.py)"
)


async def _emit_violation_audit(
    audit_writer: Optional[AuditLogWriter],
    *,
    violation_kind: str,
    expected_slug: str,
    attempted_target: str,
    actor: str = "agent",
) -> None:
    """Write one INVARIANT_VIOLATION audit row for a namespace refusal.

    The audit writer is optional so tests can exercise the wrapper
    without standing up a full audit substrate, but production wiring
    MUST inject one — the AC for #861 explicitly requires the audit row.
    """
    if audit_writer is None:
        log.warning(
            "namespace assertion fired without audit writer; "
            "violation_kind=%s expected_slug=%s attempted_target=%s",
            violation_kind,
            expected_slug,
            attempted_target,
        )
        return
    try:
        await audit_writer.write(
            AuditEvent(
                action_type=_INVARIANT_VIOLATION,
                actor=actor,
                metadata={
                    "invariant": "namespace_isolation",
                    "violation_kind": violation_kind,
                    "expected_slug": expected_slug,
                    "attempted_target": attempted_target,
                    "source": "operator/adapter/namespace_assertion.py",
                },
            )
        )
    except AuditWriteError:
        # Loud, but we still raise — transport failure on the audit
        # channel must not mask the cross-customer attempt.
        log.exception(
            "audit emission failed for namespace violation; "
            "violation_kind=%s expected_slug=%s attempted_target=%s",
            violation_kind,
            expected_slug,
            attempted_target,
        )


# ---------------------------------------------------------------------------
# D1 — namespaced executor
# ---------------------------------------------------------------------------


class _Executor(Protocol):
    async def execute(self, sql: str, params: list) -> None: ...


# Foreign-customer tokens we look for inside SQL text. The patterns
# capture a slug; the wrapper compares against its bound slug.
#
# `hermes-{slug}-` covers Vectorize-index and binding-name leaks
# (e.g. someone constructs `f"hermes-{wrong_slug}-vault"` and passes it
# into a SQL string for a maintenance script).
#
# `vaults/{slug}/` covers R2 key strings being interpolated into SQL.
_HERMES_BINDING_TOKEN = re.compile(r"\bhermes-([a-z0-9-]{2,40})-(?:vault|corrections)\b")
_VAULTS_PATH_TOKEN = re.compile(r"\bvaults/([a-z0-9-]{2,40})/")


class NamespacedD1Executor:
    """Wraps a raw `Executor` and refuses queries that target a foreign customer.

    The per-customer D1 binding is the primary scope (ADR 0008/0009).
    This wrapper is the defense-in-depth backstop: it scans every SQL
    statement for foreign `hermes-{slug}-{vault,corrections}` index
    names or `vaults/{slug}/` key strings and refuses when the captured
    slug does not match the bound `expected_slug`.

    SQL that mentions no slug-shaped token at all is passed through
    unchanged — that is the steady-state path and the binding alone
    scopes it, exactly as ADR 0009 prescribes.

    Construction takes the customer slug, the raw executor, and an
    optional `AuditLogWriter`. Production wiring MUST inject the
    writer; tests may omit it.
    """

    def __init__(
        self,
        *,
        expected_slug: str,
        inner: _Executor,
        audit_writer: Optional[AuditLogWriter] = None,
    ) -> None:
        self._slug = _validate_slug(expected_slug)
        self._inner = inner
        self._audit = audit_writer

    async def execute(self, sql: str, params: list) -> None:
        # Scan for any foreign slug embedded in the SQL text. Parameter
        # values are not inspected — they may legitimately reference
        # cross-customer identifiers (e.g. a Captain-side report query
        # that joins on customer_id from a control-plane table). The
        # SQL string itself is the surface that names the binding.
        for match in _HERMES_BINDING_TOKEN.finditer(sql):
            found_slug = match.group(1)
            if found_slug != self._slug:
                await _emit_violation_audit(
                    self._audit,
                    violation_kind="d1_sql",
                    expected_slug=self._slug,
                    attempted_target=match.group(0),
                )
                raise NamespaceAssertionError(
                    violation_kind="d1_sql",
                    expected_slug=self._slug,
                    attempted_target=match.group(0),
                    detail=(
                        "SQL mentions a Vectorize-index or binding name bound "
                        f"to a different customer (found slug={found_slug!r}); "
                        "per-customer D1 queries must not name foreign indices"
                    ),
                )
        for match in _VAULTS_PATH_TOKEN.finditer(sql):
            found_slug = match.group(1)
            if found_slug != self._slug:
                await _emit_violation_audit(
                    self._audit,
                    violation_kind="d1_sql",
                    expected_slug=self._slug,
                    attempted_target=match.group(0),
                )
                raise NamespaceAssertionError(
                    violation_kind="d1_sql",
                    expected_slug=self._slug,
                    attempted_target=match.group(0),
                    detail=(
                        "SQL embeds an R2 vault path bound to a different "
                        f"customer (found slug={found_slug!r}); per-customer "
                        "D1 queries must not interpolate foreign R2 keys"
                    ),
                )
        await self._inner.execute(sql, params)


# ---------------------------------------------------------------------------
# R2 — namespaced object client
#
# The per-customer R2 binding scopes the bucket; this wrapper enforces
# the per-customer *key prefix* on top of that. Two prefix conventions
# coexist in the codebase:
#
# * `vaults/{slug}/...` — the no_pm connector and the spec document
# * `{slug}/vault/...`   — the memory pipeline (`pipeline.py:296`)
#
# Both are accepted. Any key outside both shapes is refused.
# ---------------------------------------------------------------------------


class _R2Client(Protocol):
    async def put_object(self, key: str, body: bytes, *, content_type: str) -> None: ...
    async def get_object(self, key: str) -> bytes: ...
    async def delete_object(self, key: str) -> None: ...


@dataclass(frozen=True)
class _R2KeyDecision:
    ok: bool
    found_slug: Optional[str]
    reason: str


def _classify_r2_key(key: str, expected_slug: str) -> _R2KeyDecision:
    """Decide whether an R2 key belongs to `expected_slug`.

    Accepted shapes (both conventions live in the codebase):

    * `vaults/{slug}/...` — used by the no_pm connector + the original
      spec doc convention; slug is always the second segment.
    * `{slug}/...` — used by the memory pipeline (`{slug}/vault/...`)
      and the voice pipeline (`{slug}/voice/cohort/...`); slug is the
      first segment and any second segment is allowed under it.

    Refusals:

    * empty / non-string keys
    * traversal sequences (`..`)
    * multiple leading slashes
    * single-segment keys (no place for a slug)
    * keys whose extracted slug does not match `expected_slug`
    * keys whose first segment is neither `vaults` nor a valid slug

    Returns the matched slug when one is captured so the caller can
    record it on the refusal.
    """
    if not isinstance(key, str) or not key:
        return _R2KeyDecision(ok=False, found_slug=None, reason="empty key")
    if ".." in key.split("/"):
        return _R2KeyDecision(ok=False, found_slug=None, reason="path traversal in key")
    # Strip exactly one leading slash so rooted paths normalize, but
    # multiple leading slashes are suspicious and refused outright.
    if key.startswith("//"):
        return _R2KeyDecision(
            ok=False, found_slug=None, reason="multiple leading slashes"
        )
    normalized = key[1:] if key.startswith("/") else key

    parts = normalized.split("/", 2)
    if len(parts) < 2:
        return _R2KeyDecision(
            ok=False, found_slug=None, reason="key has fewer than two segments"
        )

    first, second = parts[0], parts[1]

    # Convention 1: vaults/{slug}/...
    if first == "vaults":
        if not _SLUG_PATTERN.match(second):
            return _R2KeyDecision(
                ok=False,
                found_slug=None,
                reason=f"slug segment {second!r} does not match slug pattern",
            )
        if second != expected_slug:
            return _R2KeyDecision(
                ok=False,
                found_slug=second,
                reason=f"key bound to foreign customer slug {second!r}",
            )
        return _R2KeyDecision(ok=True, found_slug=second, reason="ok")

    # Convention 2: {slug}/<anything>/... — slug-first, any keyspace.
    # Covers `{slug}/vault/...` (memory pipeline) and `{slug}/voice/...`
    # (voice pipeline). The wrapper does not constrain the second
    # segment because new per-customer keyspaces can land without a
    # wrapper update.
    if _SLUG_PATTERN.match(first):
        if first != expected_slug:
            return _R2KeyDecision(
                ok=False,
                found_slug=first,
                reason=f"key bound to foreign customer slug {first!r}",
            )
        return _R2KeyDecision(ok=True, found_slug=first, reason="ok")

    return _R2KeyDecision(
        ok=False,
        found_slug=None,
        reason=(
            "key does not match either prefix convention "
            "(vaults/{slug}/... or {slug}/...)"
        ),
    )


class NamespacedR2Client:
    """Wraps a raw R2 client and refuses keys outside the bound customer's vault.

    Keys must match one of:

    * `vaults/{expected_slug}/...`
    * `{expected_slug}/vault/...`

    Anything else — including keys with foreign slugs, malformed slugs,
    path traversal sequences, or shapes that don't fit either
    convention — is refused with `NamespaceAssertionError`.

    The wrapper exposes `put_object`, `get_object`, and `delete_object`.
    Callers that need a method this wrapper doesn't expose should add
    it here rather than reaching past the wrapper to the raw client.
    """

    def __init__(
        self,
        *,
        expected_slug: str,
        inner: _R2Client,
        audit_writer: Optional[AuditLogWriter] = None,
    ) -> None:
        self._slug = _validate_slug(expected_slug)
        self._inner = inner
        self._audit = audit_writer

    async def _assert_key(self, key: str) -> None:
        decision = _classify_r2_key(key, self._slug)
        if decision.ok:
            return
        attempted = key
        await _emit_violation_audit(
            self._audit,
            violation_kind="r2_key",
            expected_slug=self._slug,
            attempted_target=attempted,
        )
        raise NamespaceAssertionError(
            violation_kind="r2_key",
            expected_slug=self._slug,
            attempted_target=attempted,
            detail=decision.reason,
        )

    async def put_object(self, key: str, body: bytes, *, content_type: str) -> None:
        await self._assert_key(key)
        await self._inner.put_object(key, body, content_type=content_type)

    async def get_object(self, key: str) -> bytes:
        await self._assert_key(key)
        return await self._inner.get_object(key)

    async def delete_object(self, key: str) -> None:
        await self._assert_key(key)
        await self._inner.delete_object(key)


# ---------------------------------------------------------------------------
# Vectorize — namespaced vector client
#
# Per-customer Vectorize indices follow `hermes-{slug}-vault` and
# `hermes-{slug}-corrections` (see `bin/lib/decommission.py:242` and
# `r2-vectorize-naming.md`). Anything else is refused.
# ---------------------------------------------------------------------------


_ALLOWED_INDEX_SUFFIXES = ("vault", "corrections")


class _VectorizeClient(Protocol):
    async def upsert_vectors(self, index_name: str, vectors: list[dict]) -> None: ...
    async def query_vectors(
        self, index_name: str, vector: list[float], *, top_k: int
    ) -> Any: ...
    async def delete_vectors(self, index_name: str, ids: list[str]) -> None: ...


@dataclass(frozen=True)
class _IndexDecision:
    ok: bool
    found_slug: Optional[str]
    reason: str


def _classify_index_name(index_name: str, expected_slug: str) -> _IndexDecision:
    if not isinstance(index_name, str) or not index_name:
        return _IndexDecision(ok=False, found_slug=None, reason="empty index name")
    match = re.match(
        r"^hermes-([a-z0-9][a-z0-9-]{0,38}[a-z0-9])-([a-z]+)$", index_name
    )
    if not match:
        return _IndexDecision(
            ok=False,
            found_slug=None,
            reason=(
                f"index name {index_name!r} does not match "
                "hermes-{slug}-{vault|corrections}"
            ),
        )
    found_slug, suffix = match.group(1), match.group(2)
    if suffix not in _ALLOWED_INDEX_SUFFIXES:
        return _IndexDecision(
            ok=False,
            found_slug=found_slug,
            reason=(
                f"index suffix {suffix!r} is not in the allowed set "
                f"{_ALLOWED_INDEX_SUFFIXES}"
            ),
        )
    if found_slug != expected_slug:
        return _IndexDecision(
            ok=False,
            found_slug=found_slug,
            reason=f"index bound to foreign customer slug {found_slug!r}",
        )
    return _IndexDecision(ok=True, found_slug=found_slug, reason="ok")


class NamespacedVectorizeClient:
    """Wraps a raw Vectorize client and refuses foreign index names.

    Allowed: `hermes-{expected_slug}-vault` and
    `hermes-{expected_slug}-corrections`.

    Refused: any other index name — including foreign-customer indices,
    malformed names, or unknown suffixes.
    """

    def __init__(
        self,
        *,
        expected_slug: str,
        inner: _VectorizeClient,
        audit_writer: Optional[AuditLogWriter] = None,
    ) -> None:
        self._slug = _validate_slug(expected_slug)
        self._inner = inner
        self._audit = audit_writer

    async def _assert_index(self, index_name: str) -> None:
        decision = _classify_index_name(index_name, self._slug)
        if decision.ok:
            return
        await _emit_violation_audit(
            self._audit,
            violation_kind="vectorize_index",
            expected_slug=self._slug,
            attempted_target=index_name,
        )
        raise NamespaceAssertionError(
            violation_kind="vectorize_index",
            expected_slug=self._slug,
            attempted_target=index_name,
            detail=decision.reason,
        )

    async def upsert_vectors(self, index_name: str, vectors: list[dict]) -> None:
        await self._assert_index(index_name)
        await self._inner.upsert_vectors(index_name, vectors)

    async def query_vectors(
        self, index_name: str, vector: list[float], *, top_k: int
    ) -> Any:
        await self._assert_index(index_name)
        return await self._inner.query_vectors(index_name, vector, top_k=top_k)

    async def delete_vectors(self, index_name: str, ids: list[str]) -> None:
        await self._assert_index(index_name)
        await self._inner.delete_vectors(index_name, ids)


__all__ = [
    "NamespaceAssertionError",
    "NamespacedD1Executor",
    "NamespacedR2Client",
    "NamespacedVectorizeClient",
]
