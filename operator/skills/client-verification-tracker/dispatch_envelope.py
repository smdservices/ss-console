"""Build + write the verification tracker's pre-rendered dispatch envelope.

WS-RENDER sibling (module-size ratchet). The internal escalations the chase
raises — hold surfaces, ceiling hand-offs, the config-missing note, and the
degraded chase-due note — are rendered here from the pre_run's own plans into
a consume-once envelope the overlay dispatches OUT OF TURN through the full
gate, writing the ledger appends post-dispatch. The model composes nothing.

THE DEGRADED-CHASE THROTTLE. While ``settings.return_link`` is unauthored
(the live state on every seat — build fork 2), a due client chase cannot
render and degrades to ONE seat-level surface line: "client reminders are due
and the return destination is not authored; a person sends them". Like the
config-missing surface (#1899), it is remembered under a stable seat-level
sentinel and re-fires on the refire window — never daily, never silent, and
never a ``chased`` row (no client was nudged; the ledger stays honest).

Failure direction: any fault here degrades to "no envelope written" — the
wake fires undecorated, the SKILL.md failure-note instruction and the
heartbeat pager carry the miss. Nothing may suppress or delay a wake.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

SKILL_NAME = "client-verification-tracker"

#: Seat-level sentinel for the unauthored-return-link surface. Same shape as
#: the pre_run's config sentinel: fire once, re-fire on the refire window.
RETURN_LINK_SOURCE_ID = "__return_link__"
_RETURN_LINK_LABEL = "chase-return-link-missing"

_MAX_DISPATCHES = 10
_MAX_APPENDS_PER_DISPATCH = 200


def _load_sibling(filename: str, module_name: str):
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


def _write_envelope(payload: dict) -> bool:
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


def _numbers_by_matter(items) -> dict[str, tuple[str | None, str | None]]:
    out: dict[str, tuple[str | None, str | None]] = {}
    for item in items:
        number = getattr(item, "matter_number", None)
        absent = getattr(item, "matter_number_absent", None)
        out.setdefault(item.matter_id, (number, absent))
    return out


def build_and_write(
    *,
    plans,
    items,
    ledger,
    ledger_events,
    today,
    refire_days: int,
    ceiling: int | None,
    customer_yaml_path: str | None = None,
) -> dict:
    """Render + write the envelope; return the EMITTED_WAKE metadata additions
    ({} on any failure — the wake proceeds undecorated)."""
    try:
        render = _load_sibling("render.py", "cvt_render")
        routing = _load_sibling("routing.py", "cvt_routing")
        if render is None or routing is None:
            return {}
        customer_yaml = _load_yaml(customer_yaml_path)
        states = ledger.derive_state(ledger_events)
        numbers = _numbers_by_matter(items)

        # Enrich plans into render entries. Chase plans collapse into ONE
        # seat-level degraded line (or nothing, inside the refire window).
        entries: list[dict] = []
        chase_count = 0
        for plan in plans:
            base = {
                "matter_id": plan.matter_id,
                "action": plan.action,
                "attempt": plan.attempt,
                "ceiling": ceiling,
                "reason": getattr(plan, "reason", ""),
                "item_key": plan.item_key,
            }
            # The plan carries the pull's code-projected number (decide()'s
            # stamp); the items map is the fallback for older plan shapes.
            number = getattr(plan, "matter_number", None)
            absent = getattr(plan, "matter_number_absent", None)
            if number is None and absent is None:
                number, absent = numbers.get(plan.matter_id, (None, None))
            base["matter_number"] = number
            base["matter_number_absent"] = absent
            if plan.action == "chase":
                chase_count += 1
                continue
            if plan.action == "surface_hold":
                base["event"] = "fired"
            elif plan.action == "handoff":
                base["event"] = "handed_off"
            elif plan.action == "surface_config_missing":
                base["event"] = "fired"
            else:
                continue  # unknown action renders nothing
            entries.append(base)

        return_link_key = None
        if chase_count:
            # return_link authored AND a signer pull would be needed for a
            # full Shape B render; neither exists yet, so every due chase
            # degrades to the seat-level surface — throttled on the refire
            # window under its own sentinel so it never daily-spams (#1899).
            return_link_key = ledger.item_key("", RETURN_LINK_SOURCE_ID, _RETURN_LINK_LABEL, "")
            sentinel_state = states.get(return_link_key)
            if ledger.should_fire(
                sentinel_state, today, refire_days=refire_days, ack_snooze_days=refire_days
            ):
                entries.append(
                    {
                        "matter_id": "",
                        "action": "chase",
                        "attempt": ledger.next_attempt(sentinel_state),
                        "ceiling": None,
                        "reason": "return_link_unauthored",
                        "item_key": return_link_key,
                        "matter_number": None,
                        "matter_number_absent": None,
                        "event": "fired",
                    }
                )

        if not entries:
            return {}

        # Routing: seat-level entries (matter_id "") route like an unstaffed
        # matter — central under central mode, fallback under matter_staff.
        matter_ids = []
        for entry in entries:
            if entry["matter_id"] not in matter_ids:
                matter_ids.append(entry["matter_id"])
        result = routing.resolve_case_alert_routing(customer_yaml, {}, matter_ids)

        by_recipients: dict[tuple, list[dict]] = {}
        unroutable_ids = set(result.unroutable)
        for entry in entries:
            routed = result.routed.get(entry["matter_id"])
            if routed is None:
                continue  # fail-closed floor; listed unroutable below
            by_recipients.setdefault((routed.emails, routed.routing_leg), []).append(entry)

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
            subject, full_body = render.render_alert(group, today_iso=today_iso)
            skeleton_body = render.render_skeleton(len(group))
            appends = [
                {
                    "item_key": entry["item_key"],
                    "matter_id": entry["matter_id"] or None,
                    "event": entry["event"],
                    "attempt": int(entry["attempt"] or 1),
                    "token": None,
                }
                for entry in group[:_MAX_APPENDS_PER_DISPATCH]
            ]
            dispatches.append(
                {
                    "recipients": list(emails),
                    "cc": [],
                    "routing_leg": leg,
                    "subject": subject,
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
            for entry in group:
                wake_items.append({"item_key": entry["item_key"], "ack_code": None})

        if not dispatches:
            return {}

        memo_matters = sorted(
            {
                entry["matter_id"]
                for entry in entries
                if entry["matter_id"]
                and (
                    entry["matter_id"] in unroutable_ids
                    or (
                        result.routed.get(entry["matter_id"]) is not None
                        and result.routed[entry["matter_id"]].routing_leg
                        == routing.LEG_FALLBACK
                    )
                )
            }
        )
        envelope = {
            "skill": SKILL_NAME,
            "render_mode": "slot-templated",
            "started_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "dispatches": dispatches,
            "unroutable": [
                {
                    "matter_id": m,
                    "matter_number": numbers.get(m, (None, None))[0],
                    "reason": "no_usable_recipient",
                }
                for m in sorted(unroutable_ids)
            ],
            "memo_matters": memo_matters,
            # The failure note is DECLARED but not slot-enforced for this
            # skill (enforce: false): the turn's Shape A approve-and-send is a
            # legitimate in-turn send whose template pre_run cannot pre-key
            # (signer resolution is a turn judgment), and a gate armed with
            # only the failure note would block it.
            "in_turn": [
                {"name": "failure_note", "template": render.FAILURE_NOTE, "slots": {}}
            ],
            "in_turn_enforce": False,
        }
        if not _write_envelope(envelope):
            return {}
        return {
            "render_mode": "slot-templated",
            "body_sha256": wake_hashes,
            "items": wake_items,
            "dispatch_expected": True,
            "dispatch_count": len(dispatches),
            "routing_legs": legs,
            **({"chase_degraded_return_link_unauthored": chase_count} if chase_count else {}),
        }
    except Exception as exc:  # noqa: BLE001 — the envelope is optional; the wake is not
        sys.stderr.write("[pre_run] dispatch envelope build failed (" + str(exc) + ")\n")
        return {}
