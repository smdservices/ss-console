"""End-to-end durability scenarios against the REAL job ledger (B1, ADR 0051).

``test_job_ledger.py`` covers each ledger primitive in isolation; this file
proves the cross-primitive SCENARIOS the design's Verification section names —
the ones a single-method unit test cannot, because the property is emergent from
several operations wired together against the same persistent sqlite store:

  * Deterministic crash test: a side-effecting step journals its idempotency
    key BEFORE the effect; a crash AFTER the effect but BEFORE completion-record
    leaves the key 'in_progress'; on resume the step is NOT re-executed (it fails
    closed to 'review'). Variant: a step that DID complete is 'skip'ped, not
    re-fired.
  * Fencing test: two live claimants (the respawn-produces-two-workers case);
    the stale-epoch one cannot deliver or spend — no double-delivery, no
    double-spend, against the real epoch-fenced UPDATE.
  * Cost accounting: provider-reported usage recorded across segments sums into
    spent_cents monotonically, and a record that would set spent over budget is
    visible to the caller's breach check.

The ledger persists across an in-test "crash" because it is a real on-disk
sqlite file — closing/reopening a ``JobLedgerWriter`` over the same path is
exactly what a process restart does (per-op connections, no shared handle).
"""

from __future__ import annotations

from workspace_broker.job_ledger import JobLedgerWriter

T0 = "2026-06-18T00:00:00.000Z"
T1 = "2026-06-18T00:01:00.000Z"
T2 = "2026-06-18T00:10:00.000Z"
CUTOFF_NONE_EXPIRED = "2026-06-17T00:00:00.000Z"
CUTOFF_ALL_EXPIRED = "2026-06-18T09:00:00.000Z"


def _new_job(w: JobLedgerWriter, budget_cents: int = 500) -> str:
    return w.create(
        {
            "customer_slug": "acme",
            "persona_id": "intake-coordinator",
            "model": "claude-sonnet-4-6",
            "brief": "Review the three production documents and surface gaps.",
            "budget_cents": budget_cents,
        }
    )


# -- Deterministic crash test (ADR 0051 Verification) -------------------------
def test_crash_after_effect_before_completion_does_not_reexecute(tmp_path):
    """The canonical durability invariant. A worker journals the step key, does
    the (side-effecting) effect, then CRASHES before recording completion. A
    fresh worker reopens the ledger, re-claims, and must NOT re-execute the
    effect: the in_progress key fails closed to 'review' (we cannot know if the
    effect landed, so we never blindly re-fire)."""
    db = str(tmp_path / "broker.db")
    w = JobLedgerWriter(db)
    job_id = _new_job(w)
    epoch = w.claim(job_id, "worker-A", now=T0, lease_expiry_cutoff=CUTOFF_NONE_EXPIRED)

    step = "send:invoice-42"
    # Record-key-BEFORE-effect: the journal survives the crash the in-context
    # decision would not.
    assert w.idempotency_begin(job_id, step, epoch) == "proceed"
    # ... the effect fires here (e.g. an email is sent) ...
    # CRASH before idempotency_complete + before status advances. Simulate by
    # dropping the writer entirely (no completion recorded).
    del w

    # A fresh process reopens the SAME on-disk ledger and re-claims after the
    # lease expires.
    w2 = JobLedgerWriter(db)
    epoch2 = w2.claim(job_id, "worker-B", now=T2, lease_expiry_cutoff=CUTOFF_ALL_EXPIRED)
    assert epoch2 == epoch + 1
    # The resume sees the un-completed step and fails closed — it does NOT
    # re-execute the effect.
    assert w2.idempotency_begin(job_id, step, epoch2) == "review"


def test_crash_after_completion_skips_not_refire(tmp_path):
    """The complement: a step that DID complete before the crash is 'skip'ped on
    resume — the durable progress is honored, no needless re-run."""
    db = str(tmp_path / "broker.db")
    w = JobLedgerWriter(db)
    job_id = _new_job(w)
    epoch = w.claim(job_id, "worker-A", now=T0, lease_expiry_cutoff=CUTOFF_NONE_EXPIRED)

    step = "send:report-7"
    assert w.idempotency_begin(job_id, step, epoch) == "proceed"
    assert w.idempotency_complete(job_id, step, epoch) is True
    del w  # crash after the step fully completed

    w2 = JobLedgerWriter(db)
    epoch2 = w2.claim(job_id, "worker-B", now=T2, lease_expiry_cutoff=CUTOFF_ALL_EXPIRED)
    # Resume sees the completed step and skips it (no double-fire).
    assert w2.idempotency_begin(job_id, step, epoch2) == "skip"


def test_progress_survives_reopen_and_resumes_from_recorded_tip(tmp_path):
    """A non-side-effecting checkpoint (spend + rotated session tip) persists
    across a crash so the resume reloads the right lineage and the spend is not
    lost (it counts against the budget on the next segment)."""
    db = str(tmp_path / "broker.db")
    w = JobLedgerWriter(db)
    job_id = _new_job(w, budget_cents=1000)
    epoch = w.claim(job_id, "worker-A", now=T0, lease_expiry_cutoff=CUTOFF_NONE_EXPIRED)
    assert w.record(job_id, epoch, {"spent_cents": 300, "current_tip_session_id": "sess-7"}) is True
    del w  # crash mid-job

    w2 = JobLedgerWriter(db)
    row = w2.read(job_id)
    # Durable control facts survived the reopen.
    assert row["spent_cents"] == 300
    assert row["current_tip_session_id"] == "sess-7"
    assert row["status"] not in {"delivered", "done", "needs_review", "cancelled"}


# -- Fencing test: no double-delivery / no double-spend -----------------------
def test_two_live_workers_no_double_delivery(tmp_path):
    """Respawn-produces-two-workers: A claims; its lease lapses; B re-claims; A
    wakes and tries to deliver (record result_ref + status). A's writes are all
    fenced no-ops, so the result is delivered exactly once — B's."""
    db = str(tmp_path / "broker.db")
    w = JobLedgerWriter(db)
    job_id = _new_job(w)
    epoch_a = w.claim(job_id, "worker-A", now=T0, lease_expiry_cutoff=CUTOFF_NONE_EXPIRED)
    epoch_b = w.claim(job_id, "worker-B", now=T2, lease_expiry_cutoff=CUTOFF_ALL_EXPIRED)
    assert epoch_b == epoch_a + 1

    # B drives the job to delivered.
    assert w.record(job_id, epoch_b, {"result_ref": "r2://B", "status": "complete"}) is True
    assert w.record(job_id, epoch_b, {"status": "delivering"}) is True
    assert w.record(job_id, epoch_b, {"status": "delivered"}) is True

    # Stale A wakes and tries to deliver its own result — every write a no-op.
    assert w.record(job_id, epoch_a, {"result_ref": "r2://A", "status": "complete"}) is False
    assert w.record(job_id, epoch_a, {"status": "delivering"}) is False

    row = w.read(job_id)
    assert row["result_ref"] == "r2://B"  # B's result, never overwritten by A
    assert row["status"] == "delivered"


def test_two_live_workers_no_double_spend(tmp_path):
    """The cost analogue of no-double-delivery: a stale worker cannot add its
    segment's spend on top of the live worker's. Spend reflects exactly one
    lineage of segments."""
    db = str(tmp_path / "broker.db")
    w = JobLedgerWriter(db)
    job_id = _new_job(w, budget_cents=1000)
    epoch_a = w.claim(job_id, "worker-A", now=T0, lease_expiry_cutoff=CUTOFF_NONE_EXPIRED)
    epoch_b = w.claim(job_id, "worker-B", now=T2, lease_expiry_cutoff=CUTOFF_ALL_EXPIRED)

    assert w.record(job_id, epoch_b, {"spent_cents": 200}) is True
    # Stale A's spend write is fenced — it does NOT add on top.
    assert w.record(job_id, epoch_a, {"spent_cents": 999}) is False
    assert w.read(job_id)["spent_cents"] == 200


# -- Cost accounting across segments ------------------------------------------
def test_spend_accumulates_monotonically_across_segments(tmp_path):
    """Provider-reported usage recorded after each segment sums into spent_cents;
    the worker computes new_spent = prev + delta and records the absolute, so
    the ledger reflects the running total the budget guard reads."""
    db = str(tmp_path / "broker.db")
    w = JobLedgerWriter(db)
    job_id = _new_job(w, budget_cents=1000)
    epoch = w.claim(job_id, "worker-A", now=T0, lease_expiry_cutoff=CUTOFF_NONE_EXPIRED)

    spent = 0
    for delta in (120, 85, 200):
        spent += delta  # worker accumulates real per-segment usage
        assert w.record(job_id, epoch, {"spent_cents": spent}) is True
    assert w.read(job_id)["spent_cents"] == 405


def test_recorded_spend_over_budget_is_visible_to_breach_check(tmp_path):
    """A mid-segment overshoot lands in the ledger as an absolute spent_cents the
    next read sees as over budget — the worker's breach check (spent >= budget)
    then dead-letters. The ledger does not itself reject the overshoot record (it
    is the worker's job to act on it), so we assert the recorded value is what the
    breach check reads."""
    db = str(tmp_path / "broker.db")
    w = JobLedgerWriter(db)
    job_id = _new_job(w, budget_cents=300)
    epoch = w.claim(job_id, "worker-A", now=T0, lease_expiry_cutoff=CUTOFF_NONE_EXPIRED)
    assert w.record(job_id, epoch, {"spent_cents": 360}) is True
    row = w.read(job_id)
    assert row["spent_cents"] >= row["budget_cents"]  # the breach the worker acts on
