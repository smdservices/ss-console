#!/usr/bin/env python3
"""Smoke test against a Filevine test tenant.

This script is NOT run in CI -- it needs real credentials. It exercises
the connector end-to-end against the env-provided Filevine tenant:

* Resolve a valid token via the auth provider.
* List a small batch of projects.
* Fetch one project by id.
* List that project's documents (no download -- the smoke test stays
  read-only on document bytes to avoid pulling production PHI/PII).
* Create a draft-style note attributed to the smoke-test reviewer
  account on a designated SMOKE_PROJECT_ID -- gated behind an explicit
  ``--write`` flag so a stray run does not modify a tenant.

Usage
-----

::

    export FILEVINE_ORG_SLUG=...
    export FILEVINE_API_BASE=https://api.filevine.io
    export FILEVINE_ACCESS_TOKEN=...   # 1-hour OAuth access token
    export FILEVINE_REFRESH_TOKEN=...  # refresh token (unused here; for completeness)
    export FILEVINE_SMOKE_PROJECT_ID=... # project to fetch + list documents on
    export FILEVINE_REVIEWER_ACCOUNT_ID=... # reviewer for the optional note draft

    python ai-employee/connectors/filevine/bin/smoke-test-filevine.py
    python ai-employee/connectors/filevine/bin/smoke-test-filevine.py --write

The unit-test-level smoke (mocked HTTP) lives in
``tests/test_smoke_unit.py`` and runs in CI.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from pathlib import Path

# Allow running from repo root or from the connector dir.
_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[3]))  # ai-employee/ on sys.path

from connectors.filevine import (  # noqa: E402
    FilevineClient,
    FilevineDocumentStorage,
    FilevinePracticeManagement,
    InMemoryFilevineAuth,
    TokenSet,
)


def _require_env(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        print(f"FATAL: required env var {name} is not set", file=sys.stderr)
        sys.exit(2)
    return val


async def _run(write_mode: bool) -> int:
    try:
        import httpx
    except ImportError:
        print("FATAL: httpx is required to run the smoke test", file=sys.stderr)
        return 2

    org_slug = _require_env("FILEVINE_ORG_SLUG")
    base_url = os.environ.get("FILEVINE_API_BASE", "https://api.filevine.io")
    access_token = _require_env("FILEVINE_ACCESS_TOKEN")
    refresh_token = os.environ.get("FILEVINE_REFRESH_TOKEN", "")
    project_id = _require_env("FILEVINE_SMOKE_PROJECT_ID")

    auth = InMemoryFilevineAuth(
        token=TokenSet(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at=time.time() + 3600,
        ),
        org_slug=org_slug,
    )

    async with httpx.AsyncClient(base_url=base_url, timeout=30.0) as http:
        client = FilevineClient(auth=auth, http=http, base_url=base_url)
        pm = FilevinePracticeManagement(client)
        ds = FilevineDocumentStorage(client)

        print("== Filevine connector smoke ==")
        print(f"  org_slug = {org_slug}")
        print(f"  base_url = {base_url}")

        print("\n[1/4] PracticeManagement.search_matters (limit=5)")
        matters = await pm.search_matters(limit=5)
        print(f"  -> {len(matters)} matters")
        for m in matters[:3]:
            print(f"     - {m.id} | {m.client_name} | {m.status} | {m.matter_type}")

        print(f"\n[2/4] PracticeManagement.get_matter({project_id})")
        matter = await pm.get_matter(project_id)
        if matter is None:
            print("  -> not found (404 or empty body)")
        else:
            print(f"  -> {matter.id} | {matter.client_name} | {matter.status}")
            print(f"     custom_fields keys: {sorted(matter.custom_fields)[:6]}")

        print(f"\n[3/4] DocumentStorage.list_documents({project_id})")
        docs = await ds.list_documents(project_id)
        print(f"  -> {len(docs)} documents")
        for d in docs[:3]:
            print(
                f"     - {d.id} | {d.filename} | {d.mime_type} | {d.size_bytes} bytes"
            )

        if write_mode:
            reviewer = _require_env("FILEVINE_REVIEWER_ACCOUNT_ID")
            print(f"\n[4/4] PracticeManagement.create_note(...) [write mode]")
            note = await pm.create_note(
                project_id,
                content=(
                    "Smoke test note from ai-employee Filevine connector. "
                    f"Generated at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}."
                ),
                reviewer_account_id=reviewer,
                drafted_by_skill="connector-smoke-test",
            )
            print(f"  -> note id {note.id} created")
        else:
            print("\n[4/4] Skipping create_note -- pass --write to exercise it")

        print("\nOK: Filevine connector smoke complete.")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write",
        action="store_true",
        help="Also exercise create_note (writes a draft note to the smoke project)",
    )
    args = parser.parse_args()
    return asyncio.run(_run(write_mode=args.write))


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
