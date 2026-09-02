"""What a decision-less ("blind") wake must still do (2026-09-02).

THE INCIDENT. pilot-smokeball's Smokeball refresh token hit its 30-day
absolute expiry. ``pre_run`` took a fail-open path, and the seat produced a
scheduled tick with NEITHER a ``SUPPRESSED_WAKE`` nor an ``EMITTED_WAKE`` row
-- the dead-man's-switch signal SKILL.md step 5 names -- while the woken turn,
handed no rendered dispatch, composed a verification alert out of nothing
and sent it. Two guarantees failed in the same tick, and both had been written
down rather than enforced:

* **The row.** ``_try_write_emitted_wake`` takes a ``WakeDecision``, so every
  decision-less wake skipped it. The exemption was reasoned for the two bases
  where the writer is genuinely unusable and then applied to all of them,
  including a crash fail-open where the writer is fine. A blind wake is the
  MOST important tick to record, not the least: it is the one where the turn
  knows least and can invent most.
* **The body.** The one-line failure note was a SKILL.md instruction. An
  instruction to the model is not a control. It is now an envelope, dispatched
  out of turn on the same path as a real digest.

Neither write may suppress or delay the wake -- observability is never a gate
-- so both are best-effort and bounded, exactly as the decision path's row
already is.

Sibling module, path-loaded by ``pre_run.py`` (module-size ratchet:
``tests/operator-module-size.test.ts``), resolved from the synced skill dir
like ``dispatch_envelope.py`` and ``broker_writer.py``.

Kept parallel with the escalator's copy in SHAPE, not byte-for-byte: the two
skills are the only `templated` / `slot-templated` senders and their
blind-wake behaviour must not diverge, but ``plan_counts`` differs on purpose
(this gate serializes every plan; the escalator caps at 50).
"""

from __future__ import annotations

import asyncio
import sys

#: The only two fail-open bases where an ``EMITTED_WAKE`` row is genuinely
#: unwritable: the first fires BECAUSE no writer resolved, the second BECAUSE a
#: write to that writer just failed. Asking a broken writer to record that it
#: is broken adds nothing. Every OTHER blind wake has a working writer and
#: must leave a row.
UNWRITABLE_BASES = frozenset({"no_audit_writer_fail_open", "suppress_heartbeat_failed_fail_open"})


#: The only keys a blind wake may add to the stdout wake line. A closed set:
#: the payload is injected verbatim into the woken turn's prompt, so anything
#: that leaks in here is something the turn will read as fact.
WAKE_PAYLOAD_KEYS = ("dispatch_expected", "dispatch_variant")


def wake_blind(
    basis: str,
    *,
    load_sibling,
    writer_factory,
    skill_name: str,
    next_scheduled_at: str,
) -> dict:
    """Render the note, write the row, return the wake-line additions.

    One entry point so ``pre_run`` carries a delegation rather than a copy of
    this policy (module-size ratchet).
    """
    extra = render_failure_note(basis, load_sibling)
    write_row(
        basis,
        writer_factory=writer_factory,
        skill_name=skill_name,
        next_scheduled_at=next_scheduled_at,
        extra=extra,
    )
    return {k: v for k, v in extra.items() if k in WAKE_PAYLOAD_KEYS}


def render_failure_note(basis: str, load_sibling) -> dict:
    """Write the failure-note envelope so the turn has a rendered body to
    deliver instead of a gap to fill. {} when it could not be written (no
    authored recipient, or render.py unavailable) -- an honest fail-closed
    floor, and the row below is then what makes the slot visible."""
    try:
        envelope_mod = load_sibling("dispatch_envelope.py", "cvt_dispatch_envelope")
        if envelope_mod is None:
            return {}
        return envelope_mod.write_failure_note_envelope(reason=basis) or {}
    except Exception as exc:  # noqa: BLE001 — observability never gates the wake
        sys.stderr.write("[pre_run] blind-wake failure note failed (" + str(exc) + ")\n")
        return {}


def write_row(
    basis: str,
    *,
    writer_factory,
    skill_name: str,
    next_scheduled_at: str,
    extra: dict,
) -> None:
    """Best-effort ``EMITTED_WAKE`` row for a wake with no decision behind it."""
    if basis in UNWRITABLE_BASES:
        return
    try:
        writer = writer_factory()
        if writer is None:
            return
        asyncio.run(
            writer.write_emitted_wake(
                skill_name=skill_name,
                # No decision means no inputs digest to stamp. Empty is the
                # honest value; a fabricated digest would make a blind tick
                # look like it had read something.
                pre_run_inputs=b"",
                decision_basis=basis,
                next_scheduled_at=next_scheduled_at,
                extra_metadata={"blind_wake": True, **extra},
            )
        )
    except Exception as exc:  # noqa: BLE001 — observability never gates the wake
        sys.stderr.write("[pre_run] blind-wake row failed (" + str(exc) + ")\n")


# ---------------------------------------------------------------------------
# The DECISION path's row, moved here from pre_run.py so that every
# EMITTED_WAKE write -- blind and decided -- lives in one module.
# ---------------------------------------------------------------------------

def _plan_counts(decision: "WakeDecision") -> dict:
    """How many per-item plans the gate handed over.

    Only ``plans_total`` here: this gate serializes the whole plan list (no
    ``_MAX_SERIALIZED_PLANS`` cap, unlike its three siblings), so emitted and
    total are the same number and a ``plans_truncated`` field would be a
    constant dressed as a measurement.
    """
    if not decision.plans:
        return {}
    return {"plans_total": len(decision.plans)}



async def try_write_emitted_wake(
    audit_writer_factory,
    decision,
    *,
    skill_name: str,
    next_scheduled_at: str,
) -> None:
    """Best-effort EMITTED_WAKE row for a real-decision wake (#2253).

    The suppress path logged its reasoning and the wake path logged nothing, so
    the ledger held a record of every tick the gate stayed quiet and no record
    of the ticks it fired. On 2026-08-10 the sibling escalator woke with its
    connector down and sent an alert stating a date it could not read; the only
    way anyone found it was reading the mailbox.

    BEST-EFFORT IS THE CONTRACT, and it inverts the suppress path's on purpose.
    Below, an audit failure escalates to a wake, because a silent suppress is
    indistinguishable from a broken gate. Here the wake is already the decision,
    so every failure — no writer wired, socket down, broker refusal, a writer
    object too old to have the method — is swallowed. A wake that a failed audit
    write could suppress or delay would be a gate made of observability.

    It is not free, and the cost is stated rather than assumed away: the
    broker-socket writer blocks for up to its heartbeat timeout against a
    hung broker — the same bound the suppress path already accepts. Bounded, and
    never a change of decision.

    Not called on the fail-open paths: `ledger_unavailable_fail_open` returns
    before there is a decision to record, `no_audit_writer_fail_open` fires
    because there is no writer to call, and `suppress_heartbeat_failed_fail_open`
    fires because a write to that writer just failed.
    """
    try:
        writer = audit_writer_factory()
        if writer is None:
            return
        await writer.write_emitted_wake(
            skill_name=skill_name,
            pre_run_inputs=decision.pre_run_inputs_digest,
            decision_basis=decision.decision_basis,
            next_scheduled_at=next_scheduled_at,
            extra_metadata={**decision.extra_metadata, **_plan_counts(decision)},
        )
    except Exception:  # noqa: BLE001 — observability never gates the wake
        pass


