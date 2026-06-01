"""CLI wrapper for the demo-prep runner (issue #819).

Invoked from ``operator/bin/prepare-demo-firm.sh``. The shell script
is the supported entrypoint; this module exists so the same code path
runs under tests via :mod:`unittest` / :mod:`pytest`.

Exit codes:

* ``0`` -- every required check passed (skips do not fail the run).
* ``2`` -- preflight failed (missing dir / bad slug / template slug).
* ``3`` -- at least one required check failed; see the per-step report.
* ``4`` -- unexpected error; stderr carries the traceback.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from bin.lib.demo_prep import (
    DemoPrepPreflightError,
    DemoPrepRunner,
    FilesystemMemoryReader,
    FilesystemVoiceReader,
    NoOpConnectorSmoke,
    overall_exit_code,
    render_report,
)


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="prepare-demo-firm",
        description=(
            "Pre-meeting readiness checks for a PI firm Operator demo. "
            "Composes with bin/provision-customer.sh: run provision first, "
            "then this tool to verify the substrate the script left behind."
        ),
    )
    parser.add_argument(
        "--firm-slug",
        required=True,
        help="Customer slug to validate. Matches the directory name under operator/customers/.",
    )
    parser.add_argument(
        "--customers-root",
        type=Path,
        default=None,
        help=(
            "Override the customers root (defaults to operator/customers/ "
            "computed from this script's location)."
        ),
    )
    parser.add_argument(
        "--fixture-root",
        action="append",
        type=Path,
        default=None,
        help=(
            "Additional fixture root to resolve demo.matter_fixture references "
            "against. Repeatable. Defaults to operator/skills/ and "
            "operator/fixtures/ when omitted."
        ),
    )
    parser.add_argument(
        "--min-voice-samples",
        type=int,
        default=None,
        help="Override the minimum voice-sample count (default 10).",
    )
    return parser


def _resolve_aie_root(explicit_root: Path | None) -> Path:
    """Locate ``operator/`` relative to this script.

    The CLI is invoked via ``uv run --quiet --with pyyaml python3 -m bin.lib.demo_prep_cli``
    from inside ``operator/``, matching the decommission CLI's pattern.
    The explicit override is for tests.
    """
    if explicit_root is not None:
        return explicit_root.resolve()
    here = Path(__file__).resolve()
    # operator/bin/lib/demo_prep_cli.py -> operator/
    return here.parents[2]


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] [%(name)s] %(message)s",
    )
    args = _build_arg_parser().parse_args(argv)

    aie_root = _resolve_aie_root(None)
    customers_root = args.customers_root.resolve() if args.customers_root else aie_root / "customers"

    fixture_roots: tuple[Path, ...]
    if args.fixture_root:
        fixture_roots = tuple(p.resolve() for p in args.fixture_root)
    else:
        fixture_roots = (
            (aie_root / "skills").resolve(),
            (aie_root / "fixtures").resolve(),
        )

    customer_dir = customers_root / args.firm_slug
    memory_reader = FilesystemMemoryReader(customer_dir)
    voice_reader = FilesystemVoiceReader(customer_dir)

    kwargs: dict = dict(
        customer_slug=args.firm_slug,
        customers_root=customers_root,
        fixture_roots=fixture_roots,
        memory_reader=memory_reader,
        voice_reader=voice_reader,
        connector_smoke=NoOpConnectorSmoke(),
    )
    if args.min_voice_samples is not None:
        kwargs["min_voice_samples"] = args.min_voice_samples

    try:
        runner = DemoPrepRunner(**kwargs)
        results = runner.run()
    except DemoPrepPreflightError as exc:
        print(f"PREFLIGHT FAIL: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001
        print(f"UNEXPECTED ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 4

    print(render_report(results, customer_slug=args.firm_slug))
    return overall_exit_code(results)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
