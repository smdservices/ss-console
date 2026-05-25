"""Tests for ai-employee/voice-gate/bin/ingest_samples.py.

Pure-validation path is unit-tested; R2 + D1 side effects are exercised via
a mocked subprocess runner so the tests do not require wrangler or network.
"""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[1]))

from ingest_samples import (  # noqa: E402
    ACCEPTED_AUTHORSHIP,
    KNOWN_COHORTS,
    KNOWN_SOURCES,
    IngestValidationError,
    VoiceSampleRow,
    build_row,
    insert_into_d1,
    main,
    sql_insert,
    upload_to_r2,
    validate_sample,
)


def _good_payload(**overrides):
    base = {
        "body": "Draft body text here.",
        "cohort": "client",
        "authorship": "customer",
    }
    base.update(overrides)
    return base


class TestValidateSample:
    def test_well_formed_passes(self):
        validated = validate_sample(_good_payload())
        assert validated["body"] == "Draft body text here."

    def test_non_object_rejected(self):
        with pytest.raises(IngestValidationError, match="must be an object"):
            validate_sample("not an object")

    @pytest.mark.parametrize("missing", ["body", "cohort", "authorship"])
    def test_missing_required_rejected(self, missing):
        payload = _good_payload()
        del payload[missing]
        with pytest.raises(IngestValidationError, match=missing):
            validate_sample(payload)

    def test_empty_body_rejected(self):
        with pytest.raises(IngestValidationError, match="body"):
            validate_sample(_good_payload(body=""))
        with pytest.raises(IngestValidationError, match="body"):
            validate_sample(_good_payload(body="   "))

    def test_unknown_cohort_rejected(self):
        with pytest.raises(IngestValidationError, match="cohort"):
            validate_sample(_good_payload(cohort="not-a-cohort"))

    def test_agent_authorship_rejected(self):
        with pytest.raises(IngestValidationError, match="authorship"):
            validate_sample(_good_payload(authorship="agent"))

    def test_subject_must_be_string_when_present(self):
        with pytest.raises(IngestValidationError, match="subject"):
            validate_sample(_good_payload(subject=42))

    def test_scenario_must_be_string_when_present(self):
        with pytest.raises(IngestValidationError, match="scenario"):
            validate_sample(_good_payload(scenario=["a", "b"]))

    def test_unknown_extra_keys_allowed(self):
        validate_sample(_good_payload(future_field="forward compat"))


class TestBuildRow:
    def test_well_formed_builds_row(self):
        row = build_row(
            customer_slug="smith-pi-firm",
            payload=_good_payload(),
            source="customer_upload",
            uploaded_by="person_smith_01",
        )
        assert isinstance(row, VoiceSampleRow)
        assert row.customer_slug == "smith-pi-firm"
        assert row.sample_id.startswith("vs_")
        assert row.r2_key == f"vaults/smith-pi-firm/voice/samples/{row.sample_id}.json"
        assert row.active == 1
        assert row.used_in_blind_test == 0
        assert row.sanitized == 0

    def test_sanitized_flag_propagates(self):
        row = build_row(
            customer_slug="smith-pi-firm",
            payload=_good_payload(),
            source="customer_upload",
            uploaded_by="person_smith_01",
            sanitized=True,
        )
        assert row.sanitized == 1

    def test_bad_customer_slug_rejected(self):
        with pytest.raises(IngestValidationError, match="customer_slug"):
            build_row(
                customer_slug="bad slug with spaces",
                payload=_good_payload(),
                source="customer_upload",
                uploaded_by="person_smith_01",
            )

    def test_bad_source_rejected(self):
        with pytest.raises(IngestValidationError, match="source"):
            build_row(
                customer_slug="smith-pi-firm",
                payload=_good_payload(),
                source="not_a_source",
                uploaded_by="person_smith_01",
            )

    def test_empty_uploaded_by_rejected(self):
        with pytest.raises(IngestValidationError, match="uploaded_by"):
            build_row(
                customer_slug="smith-pi-firm",
                payload=_good_payload(),
                source="customer_upload",
                uploaded_by="",
            )

    def test_deterministic_id_for_same_payload_and_time(self):
        ts = "2026-05-25T12:00:00Z"
        a = build_row(
            customer_slug="smith-pi-firm",
            payload=_good_payload(body="content A"),
            source="customer_upload",
            uploaded_by="person_smith_01",
            uploaded_at=ts,
        )
        b = build_row(
            customer_slug="smith-pi-firm",
            payload=_good_payload(body="content A"),
            source="customer_upload",
            uploaded_by="person_smith_01",
            uploaded_at=ts,
        )
        assert a.sample_id == b.sample_id

    def test_different_content_yields_different_id(self):
        ts = "2026-05-25T12:00:00Z"
        a = build_row(
            customer_slug="smith-pi-firm",
            payload=_good_payload(body="content A"),
            source="customer_upload",
            uploaded_by="person_smith_01",
            uploaded_at=ts,
        )
        b = build_row(
            customer_slug="smith-pi-firm",
            payload=_good_payload(body="content B"),
            source="customer_upload",
            uploaded_by="person_smith_01",
            uploaded_at=ts,
        )
        assert a.sample_id != b.sample_id


class TestSqlInsert:
    def test_basic_statement_shape(self):
        row = build_row(
            customer_slug="smith-pi-firm",
            payload=_good_payload(),
            source="customer_upload",
            uploaded_by="person_smith_01",
        )
        sql = sql_insert(row)
        assert sql.startswith("INSERT INTO voice_samples")
        assert "VALUES" in sql
        assert row.sample_id in sql
        assert "vaults/smith-pi-firm/voice/samples" in sql

    def test_single_quotes_escaped(self):
        row = build_row(
            customer_slug="smith-pi-firm",
            payload=_good_payload(),
            source="customer_upload",
            uploaded_by="person_smith_01",
            notes="Captain's note about O'Brien",
        )
        sql = sql_insert(row)
        # Single quotes in notes must be doubled per SQL string literal rules.
        assert "Captain''s note about O''Brien" in sql

    def test_null_cohort_renders_as_null(self):
        row = build_row(
            customer_slug="smith-pi-firm",
            payload=_good_payload(),
            source="customer_upload",
            uploaded_by="person_smith_01",
            cohort_id=None,
        )
        sql = sql_insert(row)
        # The cohort_id field should be NULL (not quoted).
        # Find the recipient_cohort_id value in the VALUES tuple.
        # Position-based check: it's the 5th value in the VALUES list.
        assert "NULL" in sql


class MockSubprocessResult:
    def __init__(self, returncode=0, stderr=b""):
        self.returncode = returncode
        self.stderr = stderr
        self.stdout = b""


class TestUploadToR2:
    def test_invokes_wrangler_with_correct_path(self):
        row = build_row(
            customer_slug="smith-pi-firm",
            payload=_good_payload(),
            source="customer_upload",
            uploaded_by="person_smith_01",
        )
        captured = {}

        def fake_runner(cmd, input=None, capture_output=False, check=False):
            captured["cmd"] = cmd
            captured["input"] = input
            return MockSubprocessResult(returncode=0)

        upload_to_r2(row, r2_bucket="vault-smith-pi-firm", runner=fake_runner)
        assert "wrangler" in captured["cmd"]
        assert "r2" in captured["cmd"]
        assert "object" in captured["cmd"]
        assert "put" in captured["cmd"]
        # The path should include both bucket and key.
        path_arg = [a for a in captured["cmd"] if a.startswith("vault-smith-pi-firm/")][0]
        assert row.r2_key in path_arg
        # The JSON payload was piped in.
        assert captured["input"] == row.raw_json_bytes

    def test_failure_raises(self):
        row = build_row(
            customer_slug="smith-pi-firm",
            payload=_good_payload(),
            source="customer_upload",
            uploaded_by="person_smith_01",
        )

        def fake_runner(cmd, input=None, capture_output=False, check=False):
            return MockSubprocessResult(returncode=1, stderr=b"r2 bucket not found")

        with pytest.raises(RuntimeError, match="wrangler r2 object put failed"):
            upload_to_r2(row, r2_bucket="vault-smith-pi-firm", runner=fake_runner)


class TestInsertIntoD1:
    def test_invokes_wrangler_with_statement(self):
        row = build_row(
            customer_slug="smith-pi-firm",
            payload=_good_payload(),
            source="customer_upload",
            uploaded_by="person_smith_01",
        )
        captured = {}

        def fake_runner(cmd, capture_output=False, check=False):
            captured["cmd"] = cmd
            return MockSubprocessResult(returncode=0)

        insert_into_d1(row, d1_binding="customer-smith-pi-firm-db", runner=fake_runner)
        assert "wrangler" in captured["cmd"]
        assert "d1" in captured["cmd"]
        assert "execute" in captured["cmd"]
        assert "--remote" in captured["cmd"]
        # The statement is passed via --command.
        cmd_idx = captured["cmd"].index("--command")
        statement = captured["cmd"][cmd_idx + 1]
        assert "INSERT INTO voice_samples" in statement


class TestMain:
    def test_dry_run_with_valid_sample(self, tmp_path, capsys):
        sample_path = tmp_path / "sample.json"
        sample_path.write_text(json.dumps(_good_payload(subject="Hello")))
        exit_code = main([
            "--customer-slug", "smith-pi-firm",
            "--sample-file", str(sample_path),
            "--source", "customer_upload",
            "--uploaded-by", "person_smith_01",
            "--dry-run",
        ])
        assert exit_code == 0
        captured = capsys.readouterr()
        assert "DRY RUN" in captured.out
        assert "INSERT INTO voice_samples" in captured.out

    def test_missing_file_returns_2(self, tmp_path, capsys):
        exit_code = main([
            "--customer-slug", "smith-pi-firm",
            "--sample-file", str(tmp_path / "nope.json"),
            "--source", "customer_upload",
            "--uploaded-by", "person_smith_01",
            "--dry-run",
        ])
        assert exit_code == 2
        captured = capsys.readouterr()
        assert "does not exist" in captured.err

    def test_validation_failure_returns_3(self, tmp_path, capsys):
        sample_path = tmp_path / "bad.json"
        sample_path.write_text(json.dumps({"body": "x"}))  # missing cohort, authorship
        exit_code = main([
            "--customer-slug", "smith-pi-firm",
            "--sample-file", str(sample_path),
            "--source", "customer_upload",
            "--uploaded-by", "person_smith_01",
            "--dry-run",
        ])
        assert exit_code == 3
        captured = capsys.readouterr()
        assert "error" in captured.err.lower()


class TestConstants:
    def test_cohorts_match_voice_gate_types(self):
        # Mirror of RecipientCohort in ai-employee/voice-gate/types.ts.
        assert "client" in KNOWN_COHORTS
        assert "opposing-counsel" in KNOWN_COHORTS
        assert "court" in KNOWN_COHORTS
        assert "internal" in KNOWN_COHORTS

    def test_sources_match_migration_check(self):
        # Mirror of source enum in 0001_per_customer_schema.sql.
        assert KNOWN_SOURCES == frozenset(
            {"customer_upload", "bootstrap_scrape", "sent_folder"}
        )

    def test_only_customer_authorship_accepted(self):
        assert ACCEPTED_AUTHORSHIP == frozenset({"customer"})


if __name__ == "__main__":
    sys.exit(pytest.main([str(_HERE), "-v"]))
