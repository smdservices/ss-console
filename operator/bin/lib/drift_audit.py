"""Operator drift audit — the pure diff engine (no network, no filesystem).

Compares declared desired-state (the repo's contracts + customer.yaml + the
OVERLAY_REF pins) against a live ``operator.runtime.config/v1`` snapshot read
from a Machine through the ADR 0043 seam, and returns a flat list of Findings.

DESIGN INVARIANTS (these are what make the audit trustworthy, not noisy):

* **Degraded is unknown, never absent.** A snapshot field the Machine could not
  introspect (``env_presence: None``, a profile's ``cron.available: False``, an
  unresolved ``overlay_ref``) is treated as *we don't know* — the engine emits
  nothing for it (or one explicit info note), never a drift finding. This is the
  single most important rule: it stops a transient read failure from looking
  identical to "the cron job vanished."

* **Only assert on what the snapshot can see.** ``env_presence`` is allow-listed
  to the *overlay's* ``consumes.yaml`` — a strictly different set from this repo's
  ``env-consumption.yaml``. A contract var that is not a key in ``env_presence``
  is outside the overlay's introspection surface → unknown → skipped. The engine
  only checks the intersection, so it never reports a var "missing" merely
  because the overlay doesn't read it.

* **corrective tells D-act what it may do.** ``repo_patch`` = drift between two
  repo artifacts, safe to draft a code PR for. ``live_flag`` = the corrective is
  a Fly secret or a reprovision touching live Machine state — the audit must
  NEVER author that; it files an issue. The diff engine only classifies; D-act
  enforces.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# env-consumption stages whose vars actually reach the Machine environment.
MACHINE_STAGES = frozenset({"boot", "agent", "broker"})
# The op-managed cron job naming convention (overlay bootstrap/cron_materialize).
_MANAGED_CRON_PREFIX = "op-managed"

SEVERITY_ORDER = {"critical": 0, "warn": 1, "info": 2}


@dataclass(frozen=True)
class Finding:
    """One drift finding. ``key`` is a stable sub-identifier within (slug, cls)
    so D-act can name a deterministic branch and dedupe re-runs."""

    slug: str
    cls: str
    severity: str  # critical | warn | info
    key: str
    detail: str
    corrective: str  # repo_patch | live_flag

    def sort_key(self) -> tuple[int, str, str, str]:
        return (SEVERITY_ORDER.get(self.severity, 9), self.slug, self.cls, self.key)


# --------------------------------------------------------------------------- #
# Family A — env contract vs live env_presence
# --------------------------------------------------------------------------- #


def audit_env(slug: str, snapshot: dict[str, Any], env_contract: dict[str, Any]) -> list[Finding]:
    findings: list[Finding] = []
    env_presence = snapshot.get("env_presence")
    if env_presence is None:
        # Degraded: the agent process / allow-list wasn't introspectable. Unknown,
        # not absent — emit one info note and check nothing.
        findings.append(
            Finding(
                slug,
                "env_presence_degraded",
                "info",
                "env_presence",
                "env_presence unavailable (agent process or allow-list not introspectable); "
                "env checks skipped",
                "live_flag",
            )
        )
        return findings

    for name, spec in (env_contract.get("vars") or {}).items():
        if not isinstance(spec, dict):
            continue
        pres = env_presence.get(name)
        if pres is None:
            # Outside the overlay's introspection allow-list → unknown → skip.
            continue
        present = bool(pres.get("present"))
        empty = bool(pres.get("empty"))

        # strip_violation (CRITICAL): a var the contract says is stripped from the
        # agent env is actually PRESENT there — the OP-P0-2 disease, in reverse.
        if spec.get("agent_env") == "stripped" and present:
            findings.append(
                Finding(
                    slug,
                    "strip_violation",
                    "critical",
                    name,
                    f"{name} is agent_env:stripped in the contract but PRESENT in the agent "
                    "environment (a stripped secret reappeared — OP-P0-2 class)",
                    "live_flag",
                )
            )

        if spec.get("requirement") == "required" and spec.get("stage") in MACHINE_STAGES:
            if not present:
                findings.append(
                    Finding(
                        slug,
                        "required_missing",
                        "warn",
                        name,
                        f"{name} is required at stage {spec.get('stage')} but absent from the "
                        "agent environment",
                        "live_flag",
                    )
                )
            elif empty:
                findings.append(
                    Finding(
                        slug,
                        "required_empty",
                        "warn",
                        name,
                        f"{name} is required but present-and-empty in the agent environment",
                        "live_flag",
                    )
                )
    return findings


# --------------------------------------------------------------------------- #
# Family B — authored customer.yaml vs materialized state
# --------------------------------------------------------------------------- #


def audit_cron(slug: str, snapshot: dict[str, Any], customer_yaml: dict[str, Any]) -> list[Finding]:
    findings: list[Finding] = []
    profiles = {
        p.get("slug"): p for p in snapshot.get("materialized", {}).get("profiles", []) if isinstance(p, dict)
    }
    for persona in customer_yaml.get("personas") or []:
        authored = persona.get("cron") or []
        if not authored:
            continue
        pslug = persona.get("slug")
        prof = profiles.get(pslug)
        if prof is None:
            findings.append(
                Finding(
                    slug,
                    "profile_not_materialized",
                    "warn",
                    str(pslug),
                    f"persona '{pslug}' is authored with cron but has no materialized profile",
                    "live_flag",
                )
            )
            continue
        cron = prof.get("cron") or {}
        if not cron.get("available", False):
            # Degraded cron read → unknown, skip (never a false cron_not_registered).
            continue
        jobs = cron.get("jobs") or []
        registered_skills = {j.get("skill") for j in jobs if isinstance(j, dict)}
        registered_names = {j.get("name") for j in jobs if isinstance(j, dict)}
        for entry in authored:
            skill = entry.get("skill") if isinstance(entry, dict) else None
            expected = f"{_MANAGED_CRON_PREFIX}:{slug}:{skill}"
            if skill not in registered_skills and expected not in registered_names:
                findings.append(
                    Finding(
                        slug,
                        "cron_not_registered",
                        "warn",
                        str(skill),
                        f"persona '{pslug}' authors cron skill '{skill}' but it is absent from the "
                        "materialized cron jobs (authored-but-inert: the C1 defect class)",
                        "live_flag",
                    )
                )
    return findings


def audit_blocks(
    slug: str, customer_yaml: dict[str, Any], block_registry: dict[str, Any]
) -> list[Finding]:
    """INFO-level: surface authored customer.yaml blocks the registry marks inert.

    The static C2 conformance gate already enforces authored-blocks ⊆ registry at
    author time; this is the runtime mirror — informational, so a human sees on
    each live customer which authored blocks are deliberately not wired yet."""
    findings: list[Finding] = []
    top = block_registry.get("top_level") or {}
    persona_reg = block_registry.get("persona") or {}

    def _inert(spec: Any) -> str | None:
        if isinstance(spec, dict) and spec.get("status") == "inert":
            return str(spec.get("note") or "")
        return None

    for key in customer_yaml:
        note = _inert(top.get(key))
        if note is not None:
            findings.append(
                Finding(
                    slug,
                    "block_authored_but_inert",
                    "info",
                    key,
                    f"top-level block '{key}' is authored but registry-declared inert: {note}",
                    "repo_patch",
                )
            )
    seen_persona_keys: set[str] = set()
    for persona in customer_yaml.get("personas") or []:
        for key in persona:
            if key in seen_persona_keys:
                continue
            note = _inert(persona_reg.get(key))
            if note is not None:
                seen_persona_keys.add(key)
                findings.append(
                    Finding(
                        slug,
                        "block_authored_but_inert",
                        "info",
                        f"personas[].{key}",
                        f"persona block '{key}' is authored but registry-declared inert: {note}",
                        "repo_patch",
                    )
                )
    return findings


# --------------------------------------------------------------------------- #
# Family C — OVERLAY_REF three-way
# --------------------------------------------------------------------------- #


def audit_overlay_ref_repo(dockerfile_pin: str | None, test_pin: str | None) -> list[Finding]:
    """Repo-level (not per-customer): Dockerfile pin vs the test's pin. Draftable."""
    if dockerfile_pin and test_pin and dockerfile_pin != test_pin:
        return [
            Finding(
                "*",
                "overlay_ref_pin_mismatch",
                "warn",
                "pin",
                f"Dockerfile OVERLAY_REF {dockerfile_pin[:12]} != test pin {test_pin[:12]} "
                "(two repo artifacts disagree)",
                "repo_patch",
            )
        ]
    return []


def audit_overlay_ref_running(
    slug: str, snapshot: dict[str, Any], dockerfile_pin: str | None
) -> list[Finding]:
    running = (snapshot.get("overlay_ref") or {}).get("value")
    if not running:
        # Degraded (no direct_url.json / sentinel) → unknown, skip.
        return []
    if dockerfile_pin and running != dockerfile_pin:
        return [
            Finding(
                slug,
                "running_behind_dockerfile",
                "warn",
                "running",
                f"running overlay {running[:12]} != Dockerfile pin {dockerfile_pin[:12]} "
                "(Machine needs a reprovision to the pinned ref)",
                "live_flag",
            )
        ]
    return []


# --------------------------------------------------------------------------- #
# Composition
# --------------------------------------------------------------------------- #


def audit_customer(
    *,
    slug: str,
    snapshot: dict[str, Any],
    env_contract: dict[str, Any],
    customer_yaml: dict[str, Any],
    block_registry: dict[str, Any],
    dockerfile_pin: str | None,
) -> list[Finding]:
    """All per-customer families for one Machine snapshot (repo-level pin mismatch
    is audited once by the caller, not here)."""
    findings: list[Finding] = []
    findings += audit_env(slug, snapshot, env_contract)
    findings += audit_cron(slug, snapshot, customer_yaml)
    findings += audit_blocks(slug, customer_yaml, block_registry)
    findings += audit_overlay_ref_running(slug, snapshot, dockerfile_pin)
    return findings


def summarize(findings: list[Finding]) -> dict[str, int]:
    out = {"critical": 0, "warn": 0, "info": 0}
    for f in findings:
        out[f.severity] = out.get(f.severity, 0) + 1
    return out


def render_markdown(findings: list[Finding], *, degraded_by_slug: dict[str, list]) -> str:
    """Render a human drift report (pure). Degraded reads are surfaced explicitly
    so a quiet section reads as 'clean', never as 'we couldn't look'."""
    counts = summarize(findings)
    lines = ["# Operator drift audit", ""]
    lines.append(
        f"**{counts['critical']} critical · {counts['warn']} warn · {counts['info']} info**"
    )
    lines.append("")
    if not findings:
        lines.append("No drift detected across audited customers.")
    else:
        lines.append("| sev | customer | class | key | corrective | detail |")
        lines.append("| --- | --- | --- | --- | --- | --- |")
        for f in sorted(findings, key=lambda x: x.sort_key()):
            detail = f.detail.replace("|", "\\|")
            lines.append(
                f"| {f.severity} | {f.slug} | {f.cls} | {f.key} | {f.corrective} | {detail} |"
            )
    degraded_any = {s: d for s, d in degraded_by_slug.items() if d}
    if degraded_any:
        lines += ["", "## Degraded reads (treated as unknown, not drift)"]
        for slug, items in sorted(degraded_any.items()):
            for item in items:
                field = item.get("field", "?") if isinstance(item, dict) else str(item)
                reason = item.get("reason", "") if isinstance(item, dict) else ""
                lines.append(f"- `{slug}` · {field}: {reason}")
    return "\n".join(lines) + "\n"


__all__ = [
    "Finding",
    "MACHINE_STAGES",
    "SEVERITY_ORDER",
    "audit_env",
    "audit_cron",
    "audit_blocks",
    "audit_overlay_ref_repo",
    "audit_overlay_ref_running",
    "audit_customer",
    "summarize",
    "render_markdown",
]
