"""Machine-boot verification checks (ADR 0018, future ADR boot gates).

This module hosts boot-time verifications the SMD overlay runs at every
Machine start. The pattern: a pure-Python check function returns None on
success and raises a typed exception on failure; the caller (bootstrap.sh
→ Machine boot path) does not catch — boot fails closed.

The first inhabitant is `verify_gepa_disabled()` per [ADR 0018](../../docs/adr/0018-gepa-disposition.md).
Other ADR-mandated boot checks living elsewhere today (the Honcho
interceptor verify in `honcho_interceptor.verify_honcho_intercepted()`,
the Curator interceptor verify in `curator_interceptor.verify_curator_intercepted()`)
may relocate here in a future refactor; for v1 they stay with their
interceptors.

Why a module for GEPA when Honcho and Curator's verifies live with their
interceptors
------------------------------------------------------------------------

GEPA's disposition is "disable, don't constrain" ([ADR 0018](../../docs/adr/0018-gepa-disposition.md) §3 — no
`prompt_arch_observations` table, no `prompt_arch_drafts` table, no
interceptor class). There is nothing for the check to attach to. It is
genuinely a free-standing boot gate, not a part of any subsystem we own.
This module is where free-standing boot gates live.

What `verify_gepa_disabled` checks (ADR 0018 §1)
-------------------------------------------------

The ADR enumerates three GEPA subsystems the overlay must confirm
inactive at boot:

  1. GEPA's trace-analysis loop is not started.
  2. GEPA's constraint-gate checking is not active.
  3. GEPA's PR-generation path is blocked at the function-call level.

The runtime implementation of those three is not visible from the
adapter — upstream Hermes owns the actual entrypoints. What this module
can defensibly verify is structural: no module with a known GEPA name
has been imported into the process. If upstream ever wires GEPA to a new
entrypoint, the quarterly Hermes-rebase agenda item ([ADR 0018](../../docs/adr/0018-gepa-disposition.md) §_Verification_
guards) is the maintenance hook for adding the new name to
`_FORBIDDEN_GEPA_MODULES`.

The check is necessarily heuristic. False positives are loud (boot
halts, Captain investigates). False negatives silently violate the
safety floor, so the policy is "add it the moment we see it, never
remove without a superseding ADR."

What this module deliberately does NOT do
------------------------------------------

* Run an interceptor. GEPA has no observer-mode equivalent ([ADR 0018](../../docs/adr/0018-gepa-disposition.md) §3
  rules out `prompt_arch_observations`).
* Build a review surface. Cross-customer prompt-architecture changes,
  if ever needed, are met by a platform-level analytical tool outside
  customer Machines ([ADR 0018](../../docs/adr/0018-gepa-disposition.md) §5).
* Enforce the "no `prompt_arch_observations` migration" rule ([ADR 0018](../../docs/adr/0018-gepa-disposition.md)
  §_Verification_ point 2). That is a grep-level CI assertion on the
  migration directory, not a runtime function. Tracked as a follow-on.

Test isolation
--------------

`verify_gepa_disabled` takes its forbidden-module list and audit writer
by parameter so tests can substitute both. The default forbidden list is
`_FORBIDDEN_GEPA_MODULES`. Tests are in `tests/test_boot_checks.py`.
"""

from __future__ import annotations

import logging
from typing import Optional

from .audit_log import (
    ActorRole,
    AuditEvent,
    AuditLogWriter,
)

log = logging.getLogger("aie.boot_checks")


# ---------------------------------------------------------------------------
# Exception types
# ---------------------------------------------------------------------------


class GepaEnabledError(RuntimeError):
    """Raised when boot-time verification detects an active GEPA surface.

    Per ADR 0018 §1, GEPA is disabled in the SMD overlay; customer
    Machines do not run prompt-architecture evolution. Detection of any
    GEPA-shaped subsystem on the import path halts Machine boot — there
    is no allowlist, no observer mode, no review surface.

    The detection is necessarily heuristic — we cannot enumerate every
    future upstream GEPA surface. The current check covers the named
    modules visible at the time of writing. Quarterly Hermes rebase
    agenda item re-verifies this list per ADR 0018 §_Verification_
    guards.
    """


# ---------------------------------------------------------------------------
# Boot-time disable verification (ADR 0018 §_Verification_ point 1)
# ---------------------------------------------------------------------------


# Module names whose presence on the import path would indicate an active
# GEPA subsystem. The list covers the three surfaces ADR 0018 §1
# enumerates (trace-analysis loop, constraint-gate checking, PR-generation
# path), plus the umbrella module name itself.
#
# False positives are loud; false negatives silently violate the safety
# floor. ADR 0018 §_Verification_ guards requires this list to be re-checked
# at every quarterly Hermes rebase. Adding a module name is fine; removing
# one requires a superseding ADR.
_FORBIDDEN_GEPA_MODULES: tuple[str, ...] = (
    "gepa",                                   # umbrella
    "gepa.trace_analysis",                    # ADR 0018 §1 item 1
    "gepa.constraint_gates",                  # ADR 0018 §1 item 2
    "gepa.pr_generation",                     # ADR 0018 §1 item 3
    "hermes.gepa",                            # upstream-namespaced wiring
    "hermes.gepa.evolver",                    # hypothetical upstream evolver loop
    "hermes.gepa.constraint_gates",           # hypothetical upstream gate module
    "hermes.gepa.pr_emitter",                 # hypothetical upstream PR-emit surface
    "hermes.prompt_arch.autonomous_evolution",  # hypothetical adjacent surface
)


async def verify_gepa_disabled(
    *,
    audit_writer: Optional[AuditLogWriter] = None,
    customer: Optional[str] = None,
    forbidden_modules: tuple[str, ...] = _FORBIDDEN_GEPA_MODULES,
) -> None:
    """Boot-time check: GEPA is disabled. Emits the verification audit row.

    Per ADR 0018 §_Verification_ point 1: "The overlay's GEPA-disable
    check runs at Machine boot. Boot-time check confirms GEPA's
    trace-analysis loop, constraint-gate checking, and PR-generation path
    are all inactive. Failure halts Machine boot."

    Per ADR 0018 §4: "Machine boot emits an audit-log row with
    `action_class = gepa_disabled_verified` confirming the boot-time
    disable check passed. This gives the audit corpus explicit evidence
    that the disable discipline is being applied — not just that no GEPA
    activity occurred (which is the default-on assumption upstream would
    otherwise satisfy passively)."

    On success the function returns None and (if `audit_writer` is
    supplied) emits the audit row. On failure it raises `GepaEnabledError`
    BEFORE attempting any audit emission — a failed disable check is the
    Machine-boot halt signal, not an audited operational event. The
    sticky-stop escalation path ([#843](https://github.com/venturecrane/ss-console/issues/843))
    is the operational notification surface for the halt, per ADR 0018
    §4 final paragraph.

    Args:
        audit_writer       — optional `AuditLogWriter`. When supplied, a
                             `GEPA_DISABLED_VERIFIED` row is written on
                             success. Production callers MUST supply one;
                             None is tolerated for unit-test paths that
                             exercise only the check itself.
        customer           — customer slug; recorded in the audit metadata.
                             Required when `audit_writer` is supplied
                             (an audit row without a customer scope is
                             not actionable). Ignored when `audit_writer`
                             is None.
        forbidden_modules  — closed list of module names that, if present
                             in sys.modules, indicate active GEPA.
                             Production callers should use the default;
                             tests pass a tuple to exercise the check
                             behavior.

    Raises:
        GepaEnabledError   — at least one forbidden module is loaded.
                             Message includes the offending module names
                             for triage.
        ValueError         — `audit_writer` supplied without `customer`.
    """
    import sys  # noqa: PLC0415 — local import so tests can monkeypatch

    if audit_writer is not None and not customer:
        raise ValueError(
            "verify_gepa_disabled: customer slug is required when an "
            "audit_writer is supplied; an audit row without a customer "
            "scope is not actionable"
        )

    loaded_forbidden = [m for m in forbidden_modules if m in sys.modules]
    if loaded_forbidden:
        raise GepaEnabledError(
            f"GEPA subsystems detected active at Machine boot: "
            f"{loaded_forbidden!r}. Per ADR 0018 §1, GEPA is disabled in "
            f"the SMD overlay — customer Machines do not run "
            f"prompt-architecture evolution, do not analyze traces for "
            f"prompt-arch root-cause, and do not emit prompt-arch PRs. "
            f"There is no allowlist, no observer mode, no review surface. "
            f"The quarterly Hermes-rebase agenda item is the maintenance "
            f"hook for new forbidden surfaces; if any of these module names "
            f"became legitimate post-rebase, a superseding ADR is required, "
            f"not a tweak to _FORBIDDEN_GEPA_MODULES."
        )

    if audit_writer is not None:
        await audit_writer.write(
            AuditEvent(
                action_type="GEPA_DISABLED_VERIFIED",
                actor="agent",
                actor_role=ActorRole.AGENT,
                skill_name=None,
                matter_ref=None,
                metadata={
                    "customer": customer,
                    "forbidden_modules_checked": list(forbidden_modules),
                    "loaded_forbidden_count": 0,
                },
            )
        )

    log.info(
        "verify_gepa_disabled: ok (checked=%d modules, customer=%s)",
        len(forbidden_modules),
        customer or "<no-audit-writer>",
    )


__all__ = [
    "GepaEnabledError",
    "verify_gepa_disabled",
]
