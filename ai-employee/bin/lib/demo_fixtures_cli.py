"""CLI wrapper for the demo-fixture loader (issue #890).

Invoked from ``ai-employee/bin/load-demo-fixtures.sh``. The shell script
is the supported entrypoint; this module exists so the same code path
runs under tests via :mod:`pytest`.

Exit codes
----------

* ``0`` — load or unload completed (including idempotent no-ops).
* ``2`` — preflight failed (missing dir / bad slug / template slug /
  fixtures missing / unknown vertical).
* ``4`` — safety refusal: target customer holds real (non-demo) data.

Note: exit ``3`` is intentionally NOT used. The loader's correctness
model is binary at the substrate level — either every demo row is
written or none are. A partial-failure exit code would invite resume
semantics this tool does not implement. The unload path provides the
clean rollback.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import Optional

_HERE = Path(__file__).resolve()
# ai-employee/ on sys.path so the canonical `from bin.lib.demo_fixtures
# import ...` works whether the module is invoked via `uv run` or pytest.
sys.path.insert(0, str(_HERE.parents[2]))

from bin.lib.demo_fixtures import (  # noqa: E402
    DemoFixtureLoader,
    DemoFixturePreflightError,
    DemoFixtureSafetyRefusal,
    FilesystemMemoryStore,
    FilesystemVoiceStore,
    VERTICAL_REGISTRY,
    exit_code_for_load,
    exit_code_for_unload,
    render_load_report,
    render_unload_report,
)


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="load-demo-fixtures",
        description=(
            "Load the 8 synthetic PI matters (PR #832) plus the generated "
            "communications, calendar items, and voice samples into a "
            "customer's Hermes Machine substrate. Tagged is_demo_fixture: "
            "true; removable via --unload."
        ),
    )
    parser.add_argument(
        "customer_slug",
        help=(
            "Customer slug. Matches the directory name under "
            "ai-employee/customers/. The loader refuses to run on a slug "
            "that already holds non-demo rows in its substrate."
        ),
    )
    parser.add_argument(
        "vertical",
        choices=sorted(VERTICAL_REGISTRY.keys()),
        help=(
            "Vertical corpus to load. v1 supports 'pi' (personal-injury); "
            "additional verticals register a VerticalConfig in "
            "demo_fixtures.VERTICAL_REGISTRY."
        ),
    )
    parser.add_argument(
        "--unload",
        action="store_true",
        help=(
            "Remove every row tagged is_demo_fixture: true from the target "
            "customer's substrate. Idempotent: re-runs return cleanly when "
            "nothing tagged remains."
        ),
    )
    parser.add_argument(
        "--customers-root",
        type=Path,
        default=None,
        help=(
            "Override the customers root (defaults to ai-employee/customers/ "
            "computed from this script's location). Used by tests."
        ),
    )
    parser.add_argument(
        "--fixtures-root",
        type=Path,
        default=None,
        help=(
            "Override the fixtures root (defaults to ai-employee/fixtures/ "
            "computed from this script's location). Used by tests."
        ),
    )
    return parser


def _resolve_aie_root(explicit: Path | None) -> Path:
    if explicit is not None:
        return explicit.resolve()
    here = Path(__file__).resolve()
    # ai-employee/bin/lib/demo_fixtures_cli.py -> ai-employee/
    return here.parents[2]


def main(argv: Optional[list[str]] = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] [%(name)s] %(message)s",
    )
    args = _build_arg_parser().parse_args(argv)

    aie_root = _resolve_aie_root(None)
    customers_root = (
        args.customers_root.resolve() if args.customers_root else aie_root / "customers"
    )
    fixtures_root = (
        args.fixtures_root.resolve() if args.fixtures_root else aie_root / "fixtures"
    )

    customer_dir = customers_root / args.customer_slug
    memory_store = FilesystemMemoryStore(customer_dir)
    voice_store = FilesystemVoiceStore(customer_dir)

    try:
        loader = DemoFixtureLoader(
            customer_slug=args.customer_slug,
            vertical=args.vertical,
            customers_root=customers_root,
            fixtures_root=fixtures_root,
            memory_store=memory_store,
            voice_store=voice_store,
        )
    except DemoFixturePreflightError as exc:
        print(f"PREFLIGHT FAIL: {exc}", file=sys.stderr)
        return 2

    try:
        if args.unload:
            unload_report = loader.unload()
            print(render_unload_report(unload_report))
            return exit_code_for_unload(unload_report)
        load_report = loader.load()
        print(render_load_report(load_report))
        return exit_code_for_load(load_report)
    except DemoFixturePreflightError as exc:
        print(f"PREFLIGHT FAIL: {exc}", file=sys.stderr)
        return 2
    except DemoFixtureSafetyRefusal as exc:
        print(f"SAFETY REFUSAL: {exc}", file=sys.stderr)
        return 4


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
