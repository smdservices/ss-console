"""Scheduled retention runner (issue #863).

Cron entrypoint that runs the per-customer retention policy across both
the memory and voice pipelines. Designed for invocation from a daily
scheduled job inside the per-customer Hermes Machine; not meant to be
called from Captain's workstation by hand.

Usage::

    python -m bin.cron-retention <slug> [--dry-run] [--scope firm_wide]

Exit codes
----------

* ``0`` — retention completed (zero or more rows removed).
* ``2`` — pre-flight failed (missing slug, customer.yaml parse error).
* ``3`` — retention completed but per-pipeline errors were recorded; the
  caller should surface to the dashboard.
* ``4`` — unexpected non-retention exception (config load failure, etc.).

Design notes
------------

* The cron does NOT import the per-customer D1/R2 client constructors
  directly. Those live in the Hermes runtime bridge and require live
  Cloudflare bindings. The cron's role is to wire policy → runner →
  audit. Pluggable constructors are passed via the ``--build-clients``
  module attribute so production wiring lives in the Hermes adapter
  glue and the script stays import-clean for tests.

* ``--dry-run`` short-circuits AFTER policy resolution but BEFORE any
  deletes. Useful for verifying customer.yaml ``memory.retention.*``
  values against the per-tenant row counts.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, Callable, Optional

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[1]))  # operator/ on sys.path

from adapter.memory.retention import (  # noqa: E402
    DeletingScope,
    MemoryRetentionPolicy,
    RetentionRunResult,
    run_full_retention,
)

log = logging.getLogger("aie.bin.cron_retention")


# ---------------------------------------------------------------------------
# Client-builder protocol
#
# The cron expects a Python module to expose ``build_clients(slug)`` that
# returns a dict with the runtime-bound executor, storage client, voice
# retention callable, and audit writer. Production wires this to the
# Hermes adapter glue; tests pass a fixture module that returns fakes.
# ---------------------------------------------------------------------------


_BUILD_CLIENTS_DEFAULT_MODULE = "adapter.runtime.retention_clients"


def _load_client_builder(module_name: str) -> Callable[[str], Awaitable[dict]]:
    """Import the named module and return its ``build_clients`` callable.

    A missing module is reported as a pre-flight failure (exit 2) — the
    Hermes runtime is responsible for shipping the production builder;
    the test harness ships its own. Either way, the cron does not
    invent the bindings.
    """
    module = importlib.import_module(module_name)
    builder = getattr(module, "build_clients", None)
    if builder is None:
        raise RuntimeError(
            f"client-builder module {module_name!r} does not define "
            "build_clients(slug); see bin/cron-retention.py docstring"
        )
    return builder


# ---------------------------------------------------------------------------
# customer.yaml loader
# ---------------------------------------------------------------------------


def _load_customer_yaml(customers_root: Path, slug: str) -> dict:
    """Parse the customer.yaml file for ``slug``.

    Lazy-imports PyYAML so the cron stays runnable in test environments
    that satisfy this import via fixtures. The parsed dict is returned
    raw; :meth:`MemoryRetentionPolicy.from_customer_yaml` is the only
    consumer that interprets the ``memory.retention.*`` block.
    """
    config_path = customers_root / slug / "customer.yaml"
    if not config_path.exists():
        raise FileNotFoundError(
            f"customer.yaml not found at {config_path}; "
            "verify customer slug and customers root"
        )
    import yaml  # type: ignore[import-not-found]

    with config_path.open("r", encoding="utf-8") as handle:
        parsed = yaml.safe_load(handle)
    if not isinstance(parsed, dict):
        raise RuntimeError(
            f"customer.yaml at {config_path} did not parse to a mapping"
        )
    return parsed


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------


def _print_summary(result: RetentionRunResult, *, dry_run: bool) -> None:
    """Emit one summary line per pipeline for easy CI / dashboard diffing."""
    mode = "DRY-RUN" if dry_run else "EXECUTED"
    print(
        f"[{mode}] retention/memory customer={result.customer_slug} "
        f"considered={result.memory.total_considered} "
        f"deleted={result.memory.total_deleted} "
        f"errors={result.memory.total_errors}"
    )
    voice = result.voice
    print(
        f"[{mode}] retention/voice  customer={result.customer_slug} "
        f"considered={int(voice.get('considered', 0) or 0)} "
        f"deleted={int(voice.get('deleted', 0) or 0)} "
        f"errors={int(voice.get('errors', 0) or 0)}"
    )
    drafts = result.drafts
    print(
        f"[{mode}] retention/drafts customer={result.customer_slug} "
        f"considered={drafts.considered} "
        f"deleted={drafts.deleted} "
        f"errors={drafts.errors}"
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="cron-retention",
        description=(
            "Run retention policy across memory + voice pipelines for one "
            "customer. Schedule daily inside the per-customer Hermes Machine."
        ),
    )
    parser.add_argument("slug", help="Customer slug (matches customers/<slug>/customer.yaml)")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Resolve policy and report counts without deleting anything.",
    )
    parser.add_argument(
        "--scope",
        choices=[scope.value for scope in DeletingScope],
        default=DeletingScope.ALL.value,
        help=(
            "Access-scope sweep. Default 'all' so aged partner_only / "
            "attorney_list data is not retained forever (issue #1126; access "
            "scope is a read ACL, not a deletion exemption). Pass firm_wide / "
            "partner_only / attorney_list to NARROW a targeted redaction pass."
        ),
    )
    parser.add_argument(
        "--customers-root",
        type=Path,
        default=None,
        help="Override customers/ root (defaults to operator/customers/).",
    )
    parser.add_argument(
        "--client-builder",
        default=os.environ.get(
            "AIE_RETENTION_CLIENT_BUILDER", _BUILD_CLIENTS_DEFAULT_MODULE
        ),
        help=(
            "Dotted module path exposing build_clients(slug). Defaults to "
            "the Hermes runtime binding; tests override."
        ),
    )
    return parser.parse_args(argv)


async def _run(args: argparse.Namespace) -> int:
    repo_root = Path(__file__).resolve().parents[2]
    customers_root = args.customers_root or (
        repo_root / "operator" / "customers"
    )

    try:
        parsed_yaml = _load_customer_yaml(customers_root, args.slug)
    except FileNotFoundError as exc:
        print(f"[preflight] {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001
        print(f"[preflight] customer.yaml load failed: {exc}", file=sys.stderr)
        return 4

    try:
        policy = MemoryRetentionPolicy.from_customer_yaml(parsed_yaml)
    except Exception as exc:  # noqa: BLE001
        print(f"[preflight] policy build failed: {exc}", file=sys.stderr)
        return 4

    try:
        builder = _load_client_builder(args.client_builder)
    except Exception as exc:  # noqa: BLE001
        print(
            f"[preflight] client builder {args.client_builder!r} unavailable: {exc}",
            file=sys.stderr,
        )
        return 2

    clients = await builder(args.slug)

    deleting_scope = DeletingScope(args.scope)
    now = datetime.now(timezone.utc)

    if args.dry_run:
        # Dry-run: skip the cleanup but still report the policy + scope.
        print(
            "[DRY-RUN] policy "
            + json.dumps(
                {
                    "matters_days": policy.matters_days,
                    "documents_days": policy.documents_days,
                    "recipients_days": policy.recipients_days,
                    "voice_samples_days": policy.voice_samples_days,
                    "audit_log_days": policy.audit_log_days,
                    "drafts_days": policy.drafts_days,
                },
                sort_keys=True,
            )
        )
        print(
            f"[DRY-RUN] scope={deleting_scope.value} customer={args.slug} "
            "(no deletes performed)"
        )
        return 0

    try:
        result = await run_full_retention(
            customer_slug=args.slug,
            policy=policy,
            memory_executor=clients["memory_executor"],
            memory_storage=clients["memory_storage"],
            voice_retention=clients["voice_retention"],
            audit_writer=clients.get("audit_writer"),
            deleting_scope=deleting_scope,
            now=now,
        )
    except Exception as exc:  # noqa: BLE001
        print(
            f"[error] retention run raised: {type(exc).__name__}: {exc}",
            file=sys.stderr,
        )
        return 4

    _print_summary(result, dry_run=False)

    if result.total_errors > 0:
        # Per-row errors are recorded on the result; surface a non-zero
        # exit so the cron's wrapper can light up the dashboard without
        # parsing the summary lines.
        return 3
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    logging.basicConfig(
        level=os.environ.get("AIE_LOG_LEVEL", "INFO"),
        format="[%(asctime)s] [%(name)s] %(message)s",
    )
    args = parse_args(argv)
    try:
        return asyncio.new_event_loop().run_until_complete(_run(args))
    except KeyboardInterrupt:
        print("[cron-retention] interrupted by user", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
