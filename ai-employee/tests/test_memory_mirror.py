"""L1 memory mirror correctness — contract tests.

Per test plan v2 §"Layer 1 — Plumbing & integration — Memory mirror
correctness". Verifies the contract the hermes-smd-memory-mirror plugin
in the overlay repo (venturecrane/hermes-smd-overlay) must honor when
mirroring Honcho conclusions into the per-customer D1 persona_observations
table.

Three contract layers:

  1. Schema layer — the persona_observations table has the documented
     columns + the CHECK constraint that source_evidence_json is
     non-empty (ADR 0016 §1 fabrication discipline). Verified by
     reading migrations/0007_persona_observations.sql.
  2. Classification layer — evidence_status is computed from the
     source_evidence_json shape at mirror time. The pure-function
     classifier is verified here against representative inputs.
  3. End-to-end mirror behavior — full mirror happens in the overlay
     repo and requires Honcho running. v1 of this file contracts the
     shape; the live test lives in
     venturecrane/hermes-smd-overlay/plugins/hermes-smd-memory-mirror/
     tests/.

The classifier mirrors the spec from ADR 0016 §"evidence_status":
  - "evidenced": source_evidence_json contains >= 1 ID
  - "unevidenced": source_evidence_json is empty list / null
  - "insufficient": source_evidence_json has malformed entries (not
    parseable as IDs)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parent))

REPO_ROOT = _HERE.parents[2]
MIGRATION_PATH = (
    REPO_ROOT
    / "ai-employee"
    / "migrations"
    / "0007_persona_observations.sql"
)


REQUIRED_COLUMNS = (
    "observation_id",
    "persona_slug",
    "observation_type",
    "observation_body",
    "source_evidence_json",
    "confidence",
    "created_at",
    "promoted_at",
    "promoted_by",
    "dismissed_at",
    "dismissed_by",
    "dismissed_reason",
)


class TestSchemaLayer:
    """The persona_observations table has the documented columns + CHECK."""

    def test_migration_file_exists(self):
        assert MIGRATION_PATH.exists(), (
            f"migration 0007 missing at {MIGRATION_PATH}"
        )

    @pytest.mark.parametrize("column", REQUIRED_COLUMNS)
    def test_column_documented_in_migration(self, column):
        text = MIGRATION_PATH.read_text(encoding="utf-8")
        # Look for the column name as a token in a CREATE TABLE / ALTER TABLE
        # context. Conservative check: the column name appears in the file.
        assert column in text, (
            f"persona_observations column {column!r} not in migration"
        )

    def test_source_evidence_json_check_constraint(self):
        text = MIGRATION_PATH.read_text(encoding="utf-8")
        # ADR 0016 §1 fabrication discipline: source_evidence_json MUST be
        # non-empty. The CHECK constraint enforces this at the SQL level.
        assert "CHECK" in text and "source_evidence_json" in text, (
            "persona_observations is missing the source_evidence_json CHECK "
            "constraint — fabrication discipline (ADR 0016) cannot be enforced"
        )

    def test_observation_type_values_documented(self):
        text = MIGRATION_PATH.read_text(encoding="utf-8")
        # ADR 0016 documents observation_type ∈ {voice_drift,
        # recurring_correction, preference_signal, other}.
        for expected in ("voice_drift", "recurring_correction", "preference_signal"):
            assert expected in text, (
                f"observation_type {expected!r} not referenced in migration "
                f"comments — ADR 0016 §1 vocabulary may have drifted"
            )


# ---- Classification layer (pure-function) -------------------------------


def classify_evidence_status(source_evidence_json: str | None) -> str:
    """Mirror the classifier from ADR 0016 §"evidence_status".

    This is the reference implementation tested here; the overlay repo's
    memory-mirror plugin must produce the SAME classification given the
    same input. Drift between this reference and the overlay's
    implementation is a P0.
    """
    if source_evidence_json is None:
        return "unevidenced"
    if not isinstance(source_evidence_json, str):
        return "insufficient"
    stripped = source_evidence_json.strip()
    if not stripped:
        return "unevidenced"
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        return "insufficient"
    if isinstance(parsed, list):
        if not parsed:
            return "unevidenced"
        # Each entry should be a non-empty string ID (message_id, span_id,
        # audit_log row id). Malformed entries downgrade to "insufficient".
        for entry in parsed:
            if not isinstance(entry, str) or not entry.strip():
                return "insufficient"
        return "evidenced"
    if isinstance(parsed, dict):
        # Some honcho versions emit {"message_ids": [...]} or similar.
        ids = parsed.get("message_ids") or parsed.get("ids") or []
        if not isinstance(ids, list) or not ids:
            return "unevidenced"
        for entry in ids:
            if not isinstance(entry, str) or not entry.strip():
                return "insufficient"
        return "evidenced"
    return "insufficient"


class TestClassificationLayer:
    def test_evidenced_when_ids_present(self):
        payload = json.dumps(["msg_001", "msg_002", "msg_003"])
        assert classify_evidence_status(payload) == "evidenced"

    def test_unevidenced_when_empty_list(self):
        assert classify_evidence_status("[]") == "unevidenced"

    def test_unevidenced_when_null(self):
        assert classify_evidence_status(None) == "unevidenced"

    def test_unevidenced_when_empty_string(self):
        assert classify_evidence_status("") == "unevidenced"
        assert classify_evidence_status("   ") == "unevidenced"

    def test_insufficient_when_malformed_json(self):
        assert classify_evidence_status("{not json") == "insufficient"

    def test_insufficient_when_non_string_entries(self):
        # Numbers in the list aren't valid IDs.
        payload = json.dumps([1, 2, 3])
        assert classify_evidence_status(payload) == "insufficient"

    def test_insufficient_when_empty_string_entries(self):
        payload = json.dumps(["msg_001", "", "msg_003"])
        assert classify_evidence_status(payload) == "insufficient"

    def test_evidenced_when_dict_with_message_ids(self):
        payload = json.dumps({"message_ids": ["msg_001", "msg_002"]})
        assert classify_evidence_status(payload) == "evidenced"

    def test_unevidenced_when_dict_with_empty_ids(self):
        payload = json.dumps({"message_ids": []})
        assert classify_evidence_status(payload) == "unevidenced"


class TestMirrorContract:
    """Contract assertions the overlay's memory-mirror plugin must honor."""

    def test_classifier_handles_all_documented_evidence_states(self):
        """ADR 0016 documents three evidence_status values; classifier
        returns exactly those (no fourth value silently introduced)."""
        results = {
            classify_evidence_status('["msg_001"]'),
            classify_evidence_status("[]"),
            classify_evidence_status("not json"),
            classify_evidence_status(None),
        }
        assert results.issubset({"evidenced", "unevidenced", "insufficient"})
        # All three documented states are reachable from the test inputs.
        assert results == {"evidenced", "unevidenced", "insufficient"}

    def test_dismissed_at_and_promoted_at_are_distinct_columns(self):
        """Captain dismissal triggers Honcho DELETE (bug #658 workaround)
        + sets dismissed_at on the persona_observations row. Promotion is
        a different action (lands in customer.yaml). The schema must
        track both lifecycle paths independently."""
        text = MIGRATION_PATH.read_text(encoding="utf-8")
        assert "dismissed_at" in text and "promoted_at" in text
