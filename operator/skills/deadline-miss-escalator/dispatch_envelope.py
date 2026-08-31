"""Build + write the escalator's pre-rendered dispatch envelope (WS-RENDER).

The out-of-turn dispatch seam: ``pre_run.py`` renders EVERYTHING — recipients,
subject, full body, skeleton body, the ledger appends a successful send earns —
into a consume-once file next to the provenance handoff:

    ``$HERMES_HOME/.smd/pre_run/deadline-miss-escalator.dispatch.json``

The overlay's ``shared/prerendered_dispatch.py`` reads it at ``pre_llm_call``,
dispatches each entry ``templated=True`` through the FULL gate (ceiling, taint,
content floor, fabrication scan, identifier gate), writes the ``fired`` appends
post-dispatch, and injects one context note. The model composes nothing.

Same writer discipline as the provenance handoff (0600, atomic rename, .smd
fence): the envelope is provenance-adjacent state the model must not author.

FAILURE DIRECTION. Every failure here — sibling missing, yaml unreadable,
staff pull down, write fault — degrades to "no envelope written": the wake
still fires, ``dispatch_expected`` stays False, and the SKILL.md failure-note
instruction plus the heartbeat ``no_send_attempted`` pager carry the miss.
Nothing here may suppress or delay a wake.

Sibling module, path-loaded by ``pre_run.py`` (module-size ratchet:
``tests/operator-module-size.test.ts``); stdlib + PyYAML-optional, same import
set as ``pre_run``.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SKILL_NAME = "deadline-miss-escalator"

_CONNECTOR_PYTHON_DEFAULT = "/opt/connectors/smokeball/.venv/bin/python"
_STAFF_PULL_TIMEOUT_SECONDS = 60
_DEFAULT_STAFF_LOOKUP_BUDGET = 50

#: Bounds the envelope so a pathological universe cannot write an unbounded
#: file for the overlay to trust.
_MAX_DISPATCHES = 10
_MAX_APPENDS_PER_DISPATCH = 200


def _load_sibling(filename: str, module_name: str):
    """Path-load a sibling module (the vendored-ledger loader pattern; the
    scheduler may stage pre_run.py alone, so /opt/data/skills is the seat
    fallback)."""
    candidates = [Path(__file__).resolve().parent]
    for base in ("/opt/data/skills", "/app/skills"):
        candidates.append(Path(base) / SKILL_NAME)
    for cand in candidates:
        module_path = cand / filename
        if module_path.is_file():
            spec = importlib.util.spec_from_file_location(module_name, module_path)
            if spec is None or spec.loader is None:
                continue
            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)
            return module
    return None


def _load_yaml(customer_yaml_path: str | None) -> dict:
    path = customer_yaml_path or os.environ.get("SMD_CUSTOMER_YAML_PATH")
    if not path:
        return {}
    try:
        import yaml
    except ImportError:
        return {}
    try:
        with open(path, encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
    except Exception:  # noqa: BLE001 — unreadable config = unauthored routing
        return {}
    return data if isinstance(data, dict) else {}


def _staff_lookup_budget(data: dict) -> int:
    esc = data.get("escalation") if isinstance(data.get("escalation"), dict) else {}
    raw = esc.get("staff_lookup_budget")
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 0:
        return _DEFAULT_STAFF_LOOKUP_BUDGET
    return raw


# Runs inside the connector venv. Matter ids arrive on STDIN as a JSON list —
# never argv (the pre_run nosemgrep contract keeps argv free of pulled data).
# Absent/disabled/former staff are reported as-is; the pure routing module
# decides usability. Errors are per-matter and wholesale, never fatal: a staff
# pull that dies must not kill the digest (central/fallback still route).
_STAFF_PULL_SNIPPET = """\
import json
import sys

from smokeball_connector.client import build_client_from_env

matter_ids = json.load(sys.stdin)
client = build_client_from_env()
out = {}
for matter_id in matter_ids:
    entry = {"responsible": None, "assisting": []}
    try:
        matter = client.get(f"/matters/{matter_id}")
        if not isinstance(matter, dict):
            matter = {}
        staff_ids = []
        rid = matter.get("personResponsibleStaffId")
        if isinstance(rid, str) and rid:
            staff_ids.append(("responsible", rid))
        for key in ("personAssistingStaffIds", "personAssistingStaffId", "personAssistingStaffs"):
            raw = matter.get(key)
            if isinstance(raw, str) and raw:
                staff_ids.append(("assisting", raw))
            elif isinstance(raw, list):
                for sid in raw:
                    if isinstance(sid, str) and sid:
                        staff_ids.append(("assisting", sid))
        for kind, sid in staff_ids:
            try:
                staff = client.get(f"/staff/{sid}")
            except Exception as exc:
                entry.setdefault("errors", []).append(str(exc)[:200])
                continue
            if not isinstance(staff, dict):
                continue
            record = {
                "email": staff.get("email"),
                "enabled": staff.get("enabled"),
                "former": staff.get("former"),
            }
            if kind == "responsible":
                entry["responsible"] = record
            else:
                entry["assisting"].append(record)
    except Exception as exc:
        entry["error"] = str(exc)[:200]
    out[matter_id] = entry
print(json.dumps(out, default=str))
"""


def pull_matter_staff(matter_ids: list[str], budget: int) -> dict[str, dict]:
    """Pull staff assignments for ``matter_ids`` (first ``budget`` of them) in
    the connector venv. Any failure returns what resolved; an absent entry is
    UNPOPULATED and routes to the fallback path — fail toward a person."""
    ids = [m for m in matter_ids if isinstance(m, str) and m and m != "unknown-matter"]
    ids = ids[: max(0, budget)]
    if not ids:
        return {}
    connector_python = os.environ.get("SMD_CONNECTOR_VENV_PYTHON", _CONNECTOR_PYTHON_DEFAULT)
    try:
        result = subprocess.run(
            # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-tainted-env-args.dangerous-subprocess-use-tainted-env-args — argv[0] is the module-constant connector-venv interpreter, overridable only via SMD_CONNECTOR_VENV_PYTHON from the Machine's own boot env (same trust domain; the test seam — the pre_run pull carries the identical justification). The snippet is a module constant; the matter ids ride STDIN, never argv.
            [connector_python, "-c", _STAFF_PULL_SNIPPET],
            input=json.dumps(ids),
            capture_output=True,
            text=True,
            timeout=_STAFF_PULL_TIMEOUT_SECONDS,
        )
        if result.returncode != 0:
            return {}
        raw = json.loads((result.stdout or "").strip().splitlines()[-1])
        return raw if isinstance(raw, dict) else {}
    except Exception:  # noqa: BLE001 — a staff pull must never kill the digest
        return {}


# ---------------------------------------------------------------------------
# Digest splitting — one dispatch entry PER RECIPIENT SET (case-alert-routing
# "one alert per recipient per run"). Counts stay list lengths by construction:
# the split filters the projection's own items/groups and re-counts by len().
# ---------------------------------------------------------------------------


def _filter_grouped(band: dict, matter_ids: set[str]) -> dict | None:
    matters = [g for g in (band.get("matters") or []) if g.get("matter_id") in matter_ids]
    if not matters:
        return None
    return {
        "total": sum(int(g.get("count") or 0) for g in matters),
        "matter_count": len(matters),
        "matters": matters,
    }


def split_digest(digest: dict, matter_ids: set[str], today_iso: str) -> dict:
    """The sub-digest for one recipient set: only ``matter_ids``'s items, every
    count recomputed as a list length, subject counting ONLY this sub-digest's
    needs-you band (Law 11)."""
    out: dict = {}
    needs_you = [i for i in (digest.get("needs_you") or []) if i.get("matter_id") in matter_ids]
    out["subject"] = f"[Deadlines] {len(needs_you)} need you, {today_iso}"
    out["needs_you"] = needs_you
    admin = digest.get("admin_confirms")
    if isinstance(admin, dict):
        filtered = _filter_grouped(admin, matter_ids)
        if filtered:
            out["admin_confirms"] = filtered
    elsewhere = digest.get("under_active_escalation_elsewhere")
    if isinstance(elsewhere, dict):
        filtered = _filter_grouped(elsewhere, matter_ids)
        if filtered:
            out["under_active_escalation_elsewhere"] = filtered
    clearance = [
        i for i in (digest.get("awaiting_clearance") or []) if i.get("matter_id") in matter_ids
    ]
    if clearance:
        out["awaiting_clearance"] = clearance
    blanket = [
        i for i in (digest.get("blanket_ack_only") or []) if i.get("matter_id") in matter_ids
    ]
    if blanket:
        out["blanket_ack_only"] = blanket
    probe = digest.get("probe_artifacts")
    if isinstance(probe, dict):
        # Seat-level census, attached to every dispatch: ss#2403 wants the
        # leftover-probe fact loud daily, whoever the reader is.
        out["probe_artifacts"] = probe
    return out


def _firing_items(sub_digest: dict) -> list[dict]:
    """The items a successful send RAISES: needs-you + admin + blanket. The
    elsewhere and clearance bands are informational and append nothing."""
    items = list(sub_digest.get("needs_you") or [])
    admin = sub_digest.get("admin_confirms") or {}
    for group in admin.get("matters") or []:
        items.extend(group.get("items") or [])
    items.extend(sub_digest.get("blanket_ack_only") or [])
    return items


def legacy_rekey_count(deadlines, states, ledger) -> int:
    """How many now-sentinel items carry raise/ack history under their LEGACY
    key (the pre-fix ``_MATTER_ID_KEYS`` bare-``id`` fallback made the item's
    own id its matter id). Non-zero -> the digest carries the authored one-run
    identity notice; self-extinguishing once legacy state stops matching."""
    count = 0
    for d in deadlines:
        if d.matter_id != "unknown-matter" or not d.task_id:
            continue
        legacy_key = ledger.item_key(d.task_id, d.task_id, d.label, d.authored_date)
        state = states.get(legacy_key)
        if state is not None and (state.attempts > 0 or state.acked):
            count += 1
    return count


# ---------------------------------------------------------------------------
# Envelope assembly + write
# ---------------------------------------------------------------------------


def _write_envelope(payload: dict) -> bool:
    """Atomic 0600 write beside the provenance handoff. False on any failure."""
    try:
        directory = Path(os.environ.get("HERMES_HOME") or "/opt/data") / ".smd" / "pre_run"
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        tmp = directory / ("." + SKILL_NAME + ".dispatch.json.tmp")
        tmp.unlink(missing_ok=True)
        handle = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(handle, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        os.replace(tmp, directory / (SKILL_NAME + ".dispatch.json"))
        return True
    except Exception as exc:  # noqa: BLE001 — never change the wake
        sys.stderr.write("[pre_run] dispatch envelope write failed (" + str(exc) + ")\n")
        return False


def build_and_write(
    *,
    digest: dict,
    deadlines,
    states: dict,
    ledger,
    today,
    ack_snooze_days: int,
    customer_yaml_path: str | None = None,
    staff_pull=pull_matter_staff,
) -> dict:
    """Render everything, write the envelope, and return the EMITTED_WAKE
    metadata additions ({} on any failure — the wake proceeds undecorated and
    the turn's failure-note instruction plus the heartbeat pager cover it).

    ``staff_pull`` is the test seam; production uses the connector subprocess.
    """
    try:
        render = _load_sibling("render.py", "escalator_render")
        routing = _load_sibling("routing.py", "escalator_routing")
        if render is None or routing is None:
            return {}
        customer_yaml = _load_yaml(customer_yaml_path)
        rekey = legacy_rekey_count(deadlines, states, ledger)

        # Every matter the digest names, routed once.
        matter_ids: list[str] = []
        for item in _firing_items(digest):
            if item.get("matter_id") not in matter_ids:
                matter_ids.append(item["matter_id"])
        for band in ("under_active_escalation_elsewhere", "admin_confirms"):
            grouped = digest.get(band) or {}
            for group in grouped.get("matters") or []:
                if group.get("matter_id") not in matter_ids:
                    matter_ids.append(group["matter_id"])
        for item in digest.get("awaiting_clearance") or []:
            if item.get("matter_id") not in matter_ids:
                matter_ids.append(item["matter_id"])

        esc = (
            customer_yaml.get("escalation")
            if isinstance(customer_yaml.get("escalation"), dict)
            else {}
        )
        routing_block = esc.get("case_alert_routing")
        mode = routing_block.get("mode") if isinstance(routing_block, dict) else None
        matter_staff: dict[str, dict] = {}
        if mode == "matter_staff":
            matter_staff = staff_pull(matter_ids, _staff_lookup_budget(customer_yaml))
        result = routing.resolve_case_alert_routing(customer_yaml, matter_staff, matter_ids)

        # Group matters by resolved recipient set -> one dispatch per set.
        by_recipients: dict[tuple, dict] = {}
        for matter_id, routed in result.routed.items():
            key = (routed.emails, routed.routing_leg)
            group = by_recipients.setdefault(key, {"matter_ids": set()})
            group["matter_ids"].add(matter_id)

        today_iso = today.isoformat()
        dispatches: list[dict] = []
        wake_hashes: list[dict] = []
        wake_items: list[dict] = []
        legs: dict[str, int] = {}
        for (emails, leg), group in sorted(
            by_recipients.items(), key=lambda kv: (kv[0][1], kv[0][0])
        ):
            if len(dispatches) >= _MAX_DISPATCHES:
                break
            sub = split_digest(digest, group["matter_ids"], today_iso)
            firing = _firing_items(sub)
            if not firing:
                # An alert with nothing in the needs-a-person universe is not
                # sent at all (output-format rule 8 generalized: a recipient
                # set whose only content is informational bands gets nothing).
                continue
            full_body = render.render_digest(
                sub, ack_snooze_days=ack_snooze_days, rekey_count=rekey
            )
            skeleton_body = render.render_skeleton(sub)
            appends = []
            for item in firing[:_MAX_APPENDS_PER_DISPATCH]:
                key_hex = ledger.item_key(
                    item.get("matter_id"),
                    item.get("task_id"),
                    item.get("label"),
                    item.get("authored_date"),
                )
                appends.append(
                    {
                        "item_key": key_hex,
                        "matter_id": item.get("matter_id"),
                        "event": "fired",
                        "attempt": ledger.next_attempt(states.get(key_hex)),
                        "token": item.get("ack_code"),
                    }
                )
                wake_items.append({"item_key": key_hex, "ack_code": item.get("ack_code")})
            dispatches.append(
                {
                    "recipients": list(emails),
                    "cc": [],
                    "routing_leg": leg,
                    "subject": sub["subject"],
                    "full_body": full_body,
                    "skeleton_body": skeleton_body,
                    "body_sha256_full": render.canonical_body_sha256(full_body),
                    "body_sha256_skeleton": render.canonical_body_sha256(skeleton_body),
                    "appends": appends,
                }
            )
            wake_hashes.append(
                {
                    "body_sha256_full": dispatches[-1]["body_sha256_full"],
                    "body_sha256_skeleton": dispatches[-1]["body_sha256_skeleton"],
                }
            )
            legs[leg] = legs.get(leg, 0) + 1

        # The turn's residual memo duty: fallback-delivered matters AND the
        # fail-closed floor both flag the matter in place (routing.md steps 5-6).
        number_by_matter = {}
        for item in _firing_items(digest):
            number_by_matter.setdefault(item.get("matter_id"), item.get("matter_number"))
        memo_matters = sorted(
            {
                m
                for m, routed in result.routed.items()
                if routed.routing_leg == routing.LEG_FALLBACK
            }
            | set(result.unroutable)
        )
        unroutable = [
            {
                "matter_id": m,
                "matter_number": number_by_matter.get(m),
                "reason": "no_usable_staff",
            }
            for m in result.unroutable
        ]

        envelope = {
            "skill": SKILL_NAME,
            "render_mode": "templated",
            "started_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "dispatches": dispatches,
            "unroutable": unroutable,
            "memo_matters": memo_matters,
            "in_turn": [
                {"name": "failure_note", "template": render.FAILURE_NOTE, "slots": {}}
            ],
        }
        if not dispatches:
            # Nothing routable: no envelope (the overlay would dispatch
            # nothing anyway); the turn keeps its unroutable-memo duty via the
            # wake line and the tracker view surfaces the gap.
            return {}
        if not _write_envelope(envelope):
            return {}
        return {
            "render_mode": "templated",
            "body_sha256": wake_hashes,
            "items": wake_items,
            "dispatch_expected": True,
            "dispatch_count": len(dispatches),
            "routing_legs": legs,
            **({"rekey_notice_items": rekey} if rekey else {}),
        }
    except Exception as exc:  # noqa: BLE001 — the envelope is optional; the wake is not
        sys.stderr.write("[pre_run] dispatch envelope build failed (" + str(exc) + ")\n")
        return {}
