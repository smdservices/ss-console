#!/usr/bin/env python3
"""run.py -- drive the shadow firm against a rig seat and score it mechanically.

WHY THIS EXISTS (ss#2389). We rehearse once and then go live. Every incident we
have had -- an unaudited direct-API send (ss#2258), cross-matter content
(ss#2167), a fabricated matter number under failure (ss#2168) -- was found by a
person noticing, after the fact, on a seat that had already passed its one
rehearsal. This is the standing version: the same hostile acts, replayed on
demand against a rig, scored from artifacts rather than from prose, and citable
by a release gate.

THE HARD LINE. No scenario may target a client seat, a client-visible address,
or a production tenant. That is enforced in ``scope.py`` and checked before any
scenario is loaded: an unallowlisted address anywhere in a scenario (including
inside a message body) or a seat whose own descriptor is not a rig aborts the
run with exit 2. There is no flag that relaxes it.

ARMING IS EXPLICIT. Without ``--drive`` the runner prints the plan and sends
nothing. That is not politeness: the credentials this suite needs are ambient in
any shell that has run ``infisical run``, and during development an invocation
meant as a dry run put three live probes into the rig seat within a minute. A
tool that fires adversarial mail the moment it is typed is one shell environment
away from firing it at something that matters.

USAGE
    infisical run --env=prod --path=/ss -- \\
        operator/rehearsal/run.py --seat pilot-smokeball --drive

    --drive                actually perform the hostile acts; without it, plan only
    --list                 print the registry and exit; drives nothing
    --only ID[,ID...]      run a subset
    --overlay-ref REF      the candidate ref this run certifies
                           (default: ARG OVERLAY_REF in operator/templates/Dockerfile)
    --inject NAME          declare a fault you have already injected on the rig
    --out DIR              where the report lands (default .stitch/shadow-firm/)

EXIT CODES
    0  green: every scenario PASSED. Only this run may be cited by a release gate.
    1  at least one scenario FAILED.
    3  nothing failed but something was SKIPPED, so the suite is incomplete.
       Deliberately not 0: a skipped scenario proves nothing and must never
       read as a pass.
    2  refused before driving anything (scope violation, bad registry, no seat).
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rehearsal import drivers, registry, report, scope  # noqa: E402 -- path injected above
from rehearsal.scoring import FAIL, PASS, SKIPPED, LegObservation, score_scenario  # noqa: E402

DOCKERFILE = Path(__file__).resolve().parents[2] / "operator" / "templates" / "Dockerfile"

EXIT_GREEN = 0
EXIT_FAILED = 1
EXIT_REFUSED = 2
EXIT_INCOMPLETE = 3


def pinned_overlay_ref() -> str:
    """The ref the Dockerfile pins today, so a run defaults to certifying it."""
    try:
        text = DOCKERFILE.read_text()
    except OSError:
        return "unknown"
    match = re.search(r"^ARG\s+OVERLAY_REF=([^\s#]+)", text, re.MULTILINE)
    return match.group(1).strip('"\'') if match else "unknown"


def _print_registry(scenarios: list[dict]) -> None:
    for scenario in scenarios:
        requires = ", ".join(scenario.get("requires") or []) or "nothing"
        print(f"{scenario['id']}  [{scenario['incident_class']}]  replays {', '.join(scenario['replays'])}")
        print(f"    {' '.join(str(scenario['title']).split())}")
        print(f"    requires: {requires}")
        for leg in scenario["legs"]:
            kinds = ", ".join(str(e["kind"]) for e in leg["expect"])
            print(f"      - {leg['id']}: {leg['drive']['kind']} -> expects {kinds}")
    print(f"\n{len(scenarios)} scenario(s). Nothing driven.")


def run_suite(args: argparse.Namespace) -> int:
    try:
        scenarios = registry.load_scenarios()
    except (registry.SchemaError, scope.ScopeViolation) as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return EXIT_REFUSED

    if args.only:
        wanted = {s.strip() for s in args.only.split(",") if s.strip()}
        unknown = wanted - {s["id"] for s in scenarios}
        if unknown:
            print(f"REFUSED: no such scenario(s): {sorted(unknown)}", file=sys.stderr)
            return EXIT_REFUSED
        scenarios = [s for s in scenarios if s["id"] in wanted]

    if args.just_list:
        _print_registry(scenarios)
        return EXIT_GREEN

    try:
        config = drivers.load_seat_config(args.seat)
    except FileNotFoundError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return EXIT_REFUSED
    try:
        scope.assert_seat_drivable(args.seat, config)
    except scope.ScopeViolation as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return EXIT_REFUSED

    if not args.drive:
        print(f"PLAN ONLY. Nothing sent. Target seat: {args.seat} (seat.kind={scope.seat_kind(config)})")
        _print_registry(scenarios)
        print("Re-run with --drive to perform these acts against the seat.")
        return EXIT_REFUSED

    capabilities = drivers.probe_capabilities(args.seat, config, inject=args.inject)
    audit = drivers.AuditReader(capabilities.audit_seam) if capabilities.audit_seam else None

    run = report.Run(
        seat=args.seat,
        overlay_ref=args.overlay_ref or pinned_overlay_ref(),
        started_at=report.now_stamp(),
    )
    for name, reason in sorted(capabilities.reasons.items()):
        run.notes.append(f"capability `{name}` unavailable: {reason}")

    for scenario in scenarios:
        print(f"== {scenario['id']} ({scenario['incident_class']})")
        observations: dict[str, LegObservation] = {}
        # The scenario window, opened before its first leg. A console-side leg
        # reconciles over THIS window, not its own: the sends it must account for
        # were provoked by an earlier leg and would fall outside a window that
        # opened when the reconcile leg started.
        scenario_start = datetime.now(timezone.utc)
        scenario_mark: str | None = None
        if audit is not None:
            try:
                scenario_mark = audit.snapshot()
            except Exception as exc:  # noqa: BLE001 -- unreadable ledger is UNKNOWN, never empty
                run.notes.append(f"{scenario['id']}: audit baseline read failed: {exc}")
        for leg in scenario["legs"]:
            print(f"   - {leg['id']} ...", flush=True)
            console_side = str((leg.get("drive") or {}).get("kind")) == "console_reconcile"
            observations[str(leg["id"])] = drivers.drive_leg(
                leg,
                capabilities=capabilities,
                requirements=list(scenario.get("requires") or []),
                audit=audit,
                settle_s=args.settle,
                window_start=scenario_start if console_side else None,
                audit_mark=scenario_mark if console_side else None,
            )
        result = score_scenario(scenario, observations)
        run.results.append(result)
        print(f"   {result.outcome}: {' '.join(str(result.reason).split())[:160]}")

    json_path, markdown_path = report.write(
        run, {s["id"]: s for s in scenarios}, Path(args.out) if args.out else None
    )
    counts = run.counts
    print(f"\nrun id: {run.run_id}")
    print(f"report: {markdown_path}")
    print(f"json:   {json_path}")
    print(
        f"{counts.get(PASS, 0)} pass / {counts.get(FAIL, 0)} fail / {counts.get(SKIPPED, 0)} skipped"
    )
    if run.is_green:
        print("GREEN. This id may be cited by an OVERLAY_REF bump PR.")
        return EXIT_GREEN
    if counts.get(FAIL, 0):
        print("NOT GREEN: a scenario failed. Do not bump OVERLAY_REF on this ref.")
        return EXIT_FAILED
    print(
        "NOT GREEN: scenarios were skipped, so the suite is incomplete. A skipped scenario "
        "did not run and proves nothing."
    )
    return EXIT_INCOMPLETE


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=str(__doc__).split("\n")[0])
    parser.add_argument("--seat", help="the rig seat slug to play hostile against")
    parser.add_argument("--only", default=None, help="comma-separated scenario ids")
    parser.add_argument(
        "--drive",
        action="store_true",
        help="actually perform the hostile acts; without it the runner plans and sends nothing",
    )
    parser.add_argument("--list", action="store_true", dest="just_list")
    parser.add_argument("--overlay-ref", default=None, dest="overlay_ref")
    parser.add_argument("--inject", default=None, help="name a fault already injected on the rig")
    parser.add_argument("--out", default=None)
    parser.add_argument("--settle", type=int, default=30, help="seconds a console-side leg waits")
    args = parser.parse_args(argv)
    if not args.just_list and not args.seat:
        parser.error("--seat is required (or --list, which drives nothing)")
    return run_suite(args)


if __name__ == "__main__":
    sys.exit(main())
