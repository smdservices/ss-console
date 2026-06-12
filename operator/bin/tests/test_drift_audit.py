"""Phase B Cut D — the operator drift-audit diff engine.

Pure unit tests (no network, no filesystem). The behaviours under test are the
ones that decide whether the audit is trustworthy or noisy:

* degraded snapshot fields are treated as UNKNOWN, never as drift;
* env checks only assert on vars the overlay snapshot can actually see;
* the load-bearing classes — strip_violation (critical) and cron_not_registered
  (the C1 defect class) — fire on real drift and stay silent on clean state;
* corrective classification (repo_patch vs live_flag) gates what D-act may draft.

Run::

    cd operator && python3 -m pytest bin/tests/test_drift_audit.py -v
"""

from __future__ import annotations

import sys
from pathlib import Path

_BIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BIN / "lib"))

import drift_audit as da  # noqa: E402

# A representative env contract slice — faithful to the real env-consumption.yaml:
# R2_* are required AT BOOT then stripped from the agent env (OP-P0-2), so their
# absence from the agent env is the DESIRED state, not "missing".
ENV_CONTRACT = {
    "vars": {
        "R2_ACCESS_KEY_ID": {"stage": "boot", "requirement": "required", "agent_env": "stripped"},
        "R2_SECRET_ACCESS_KEY": {"stage": "boot", "requirement": "required", "agent_env": "stripped"},
        "SMD_D1_AUDIT_BINDING": {"stage": "agent", "requirement": "required", "agent_env": "held"},
        "ANTHROPIC_API_KEY": {"stage": "agent", "requirement": "required", "agent_env": "held"},
    }
}

CUSTOMER_YAML = {
    "customer_id": "smd",
    "personas": [
        {
            "slug": "crane",
            "cron": [{"skill": "inbox-triage", "schedule": "0 7-19 * * *", "wake_policy": "always"}],
        }
    ],
    "voice_library": {"samples_path": "r2://x"},
}

BLOCK_REGISTRY = {
    "top_level": {
        "voice_library": {"status": "implemented"},
        "telegram": {"status": "inert", "note": "not wired in Phase 1"},
    },
    "persona": {
        "cron": {"status": "implemented"},
    },
}


def _snapshot(**over):
    base = {
        "schema": "operator.runtime.config/v1",
        "overlay_ref": {"value": "2e310674", "source": "direct_url"},
        "env_presence": {
            "R2_ACCESS_KEY_ID": {"present": False, "empty": False},
            "R2_SECRET_ACCESS_KEY": {"present": False, "empty": False},
            "SMD_D1_AUDIT_BINDING": {"present": True, "empty": False},
        },
        "materialized": {
            "profiles": [
                {
                    "slug": "crane",
                    "config_present": True,
                    "cron": {
                        "available": True,
                        "jobs": [{"name": "op-managed:smd:inbox-triage", "skill": "inbox-triage"}],
                    },
                }
            ]
        },
        "degraded": [],
    }
    base.update(over)
    return base


# --------------------------------------------------------------------------- #
# env family
# --------------------------------------------------------------------------- #


def test_clean_env_no_findings() -> None:
    assert da.audit_env("smd", _snapshot(), ENV_CONTRACT) == []


def test_strip_violation_is_critical() -> None:
    snap = _snapshot(
        env_presence={
            "R2_ACCESS_KEY_ID": {"present": True, "empty": False},  # stripped var present!
            "SMD_D1_AUDIT_BINDING": {"present": True, "empty": False},
        }
    )
    findings = da.audit_env("smd", snap, ENV_CONTRACT)
    strip = [f for f in findings if f.cls == "strip_violation"]
    assert len(strip) == 1
    assert strip[0].severity == "critical"
    assert strip[0].key == "R2_ACCESS_KEY_ID"
    assert strip[0].corrective == "live_flag"


def test_stripped_var_absent_is_not_required_missing() -> None:
    # Regression (caught on real staging data): R2_* are required-at-boot then
    # stripped from the agent env. Their absence from env_presence is the DESIRED
    # state — it must NOT be reported required_missing (only strip_violation when
    # PRESENT). A stripped var present, plus a clean held var, yields exactly one
    # critical strip_violation and zero required_missing.
    snap = _snapshot(
        env_presence={
            "R2_ACCESS_KEY_ID": {"present": False, "empty": False},  # correctly stripped
            "R2_SECRET_ACCESS_KEY": {"present": False, "empty": False},
            "SMD_D1_AUDIT_BINDING": {"present": True, "empty": False},
        }
    )
    findings = da.audit_env("smd", snap, ENV_CONTRACT)
    assert findings == [], f"stripped-absent vars should be clean, got {findings}"


def test_required_missing_only_within_allowlist() -> None:
    # ANTHROPIC_API_KEY is required but NOT in env_presence (overlay doesn't read
    # it). It must NOT be reported missing — that's unknown, not absent.
    snap = _snapshot(
        env_presence={"SMD_D1_AUDIT_BINDING": {"present": False, "empty": False}}
    )
    findings = da.audit_env("smd", snap, ENV_CONTRACT)
    classes = {(f.cls, f.key) for f in findings}
    assert ("required_missing", "SMD_D1_AUDIT_BINDING") in classes
    assert not any(f.key == "ANTHROPIC_API_KEY" for f in findings)


def test_required_empty_flagged() -> None:
    snap = _snapshot(
        env_presence={"SMD_D1_AUDIT_BINDING": {"present": True, "empty": True}}
    )
    findings = da.audit_env("smd", snap, ENV_CONTRACT)
    assert any(f.cls == "required_empty" and f.key == "SMD_D1_AUDIT_BINDING" for f in findings)


def test_degraded_env_presence_is_unknown_not_drift() -> None:
    snap = _snapshot(env_presence=None)
    findings = da.audit_env("smd", snap, ENV_CONTRACT)
    # Exactly one info note, no strip/missing findings.
    assert len(findings) == 1
    assert findings[0].cls == "env_presence_degraded"
    assert findings[0].severity == "info"


# --------------------------------------------------------------------------- #
# cron family
# --------------------------------------------------------------------------- #


def test_clean_cron_no_findings() -> None:
    assert da.audit_cron("smd", _snapshot(), CUSTOMER_YAML) == []


def test_cron_not_registered_when_absent() -> None:
    snap = _snapshot(
        materialized={"profiles": [{"slug": "crane", "cron": {"available": True, "jobs": []}}]}
    )
    findings = da.audit_cron("smd", snap, CUSTOMER_YAML)
    assert len(findings) == 1
    assert findings[0].cls == "cron_not_registered"
    assert findings[0].key == "inbox-triage"
    assert findings[0].severity == "warn"


def test_degraded_cron_read_is_unknown_not_drift() -> None:
    # available:False (degraded) must NEVER produce cron_not_registered.
    snap = _snapshot(
        materialized={"profiles": [{"slug": "crane", "cron": {"available": False, "jobs": []}}]}
    )
    assert da.audit_cron("smd", snap, CUSTOMER_YAML) == []


def test_cron_matched_by_skill_or_managed_name() -> None:
    # Registered under the skill key alone (no managed name) still counts.
    snap = _snapshot(
        materialized={
            "profiles": [
                {"slug": "crane", "cron": {"available": True, "jobs": [{"skill": "inbox-triage"}]}}
            ]
        }
    )
    assert da.audit_cron("smd", snap, CUSTOMER_YAML) == []


def test_profile_not_materialized_flagged() -> None:
    snap = _snapshot(materialized={"profiles": []})
    findings = da.audit_cron("smd", snap, CUSTOMER_YAML)
    assert any(f.cls == "profile_not_materialized" for f in findings)


# --------------------------------------------------------------------------- #
# block family
# --------------------------------------------------------------------------- #


def test_block_authored_but_inert_is_info() -> None:
    cust = {"telegram": {"enabled": False}, "personas": []}
    findings = da.audit_blocks("smd", cust, BLOCK_REGISTRY)
    assert len(findings) == 1
    assert findings[0].cls == "block_authored_but_inert"
    assert findings[0].severity == "info"
    assert findings[0].key == "telegram"


def test_implemented_block_not_flagged() -> None:
    cust = {"voice_library": {"samples_path": "x"}, "personas": []}
    assert da.audit_blocks("smd", cust, BLOCK_REGISTRY) == []


# --------------------------------------------------------------------------- #
# overlay_ref family
# --------------------------------------------------------------------------- #


def test_overlay_ref_pin_mismatch_is_repo_patch() -> None:
    findings = da.audit_overlay_ref_repo("aaaaaaaaaaaa", "bbbbbbbbbbbb")
    assert len(findings) == 1
    assert findings[0].cls == "overlay_ref_pin_mismatch"
    assert findings[0].corrective == "repo_patch"


def test_overlay_ref_pin_match_clean() -> None:
    assert da.audit_overlay_ref_repo("abc", "abc") == []


def test_running_behind_dockerfile_is_live_flag() -> None:
    snap = _snapshot(overlay_ref={"value": "oldsha000000", "source": "direct_url"})
    findings = da.audit_overlay_ref_running("smd", snap, "newsha000000")
    assert len(findings) == 1
    assert findings[0].cls == "running_behind_dockerfile"
    assert findings[0].corrective == "live_flag"


def test_degraded_overlay_ref_is_unknown() -> None:
    snap = _snapshot(overlay_ref={"value": None, "source": None})
    assert da.audit_overlay_ref_running("smd", snap, "newsha000000") == []


def test_running_matches_dockerfile_clean() -> None:
    snap = _snapshot(overlay_ref={"value": "samesha00000", "source": "direct_url"})
    assert da.audit_overlay_ref_running("smd", snap, "samesha00000") == []


# --------------------------------------------------------------------------- #
# composition + summary
# --------------------------------------------------------------------------- #


def test_audit_customer_clean_machine_is_silent() -> None:
    findings = da.audit_customer(
        slug="smd",
        snapshot=_snapshot(),
        env_contract=ENV_CONTRACT,
        customer_yaml=CUSTOMER_YAML,
        block_registry=BLOCK_REGISTRY,
        dockerfile_pin="2e310674",
    )
    assert findings == []


def test_audit_customer_surfaces_real_drift() -> None:
    snap = _snapshot(
        env_presence={"R2_ACCESS_KEY_ID": {"present": True, "empty": False}},
        materialized={"profiles": [{"slug": "crane", "cron": {"available": True, "jobs": []}}]},
        overlay_ref={"value": "oldsha", "source": "direct_url"},
    )
    findings = da.audit_customer(
        slug="smd",
        snapshot=snap,
        env_contract=ENV_CONTRACT,
        customer_yaml=CUSTOMER_YAML,
        block_registry=BLOCK_REGISTRY,
        dockerfile_pin="2e310674",
    )
    classes = {f.cls for f in findings}
    assert {"strip_violation", "cron_not_registered", "running_behind_dockerfile"} <= classes
    summary = da.summarize(findings)
    assert summary["critical"] == 1


def test_findings_sort_critical_first() -> None:
    fs = [
        da.Finding("smd", "info_x", "info", "k", "d", "live_flag"),
        da.Finding("smd", "crit_x", "critical", "k", "d", "live_flag"),
        da.Finding("smd", "warn_x", "warn", "k", "d", "live_flag"),
    ]
    ordered = sorted(fs, key=lambda f: f.sort_key())
    assert [f.severity for f in ordered] == ["critical", "warn", "info"]


# --------------------------------------------------------------------------- #
# render_markdown
# --------------------------------------------------------------------------- #


def test_render_clean_says_no_drift() -> None:
    md = da.render_markdown([], degraded_by_slug={})
    assert "No drift detected" in md
    assert "0 critical" in md


def test_render_surfaces_degraded_as_unknown_not_clean() -> None:
    # A degraded read must be visible — a quiet report should never hide that we
    # couldn't look.
    md = da.render_markdown(
        [],
        degraded_by_slug={"smd": [{"field": "cron", "reason": "jobs.json unparseable"}]},
    )
    assert "Degraded reads" in md
    assert "jobs.json unparseable" in md


def test_render_tables_findings_and_escapes_pipes() -> None:
    findings = [da.Finding("smd", "strip_violation", "critical", "R2_X", "a | b pipe", "live_flag")]
    md = da.render_markdown(findings, degraded_by_slug={})
    assert "| critical | smd | strip_violation | R2_X | live_flag |" in md
    assert "a \\| b pipe" in md  # pipe escaped so it doesn't break the table
