#!/usr/bin/env python3
"""Remove a memo from a staging matter, through App 1 (our seeding app).

WHY THIS EXISTS (2026-08-13, ss#2360). Measuring what a Smokeball envelope
carries caused the Operator to write a supervision memo that states the wrong
"how": an App-1 API change was recorded as an in-app touch by a person. That is
a false record, and the staging tenant is also the corpus the establishment work
reads back as examples of the firm's own output — so a wrong memo left in place
can be learned from.

WHY NOT THE OPERATOR. The Smokeball connector exposes `get_memos_on_matter` and
`create_memo` and NOTHING ELSE for memos. The Operator structurally cannot delete
one, which is correct: an agent that can erase its own supervision record is not
a supervision record. This is our tooling reaching into our own rehearsal tenant,
on the same App 1 that seeded it — deliberately a different hand than the agent's.

STAGING ONLY. Refuses unless the resolved host is the staging API. Never point
this at a client tenant; a wrong entry in a real supervision log is corrected by
a correcting entry, not by deletion.

USAGE
    cd operator/customers/pilot-smokeball/seed
    infisical run --env=prod --path=/ss -- python3 delete_memo.py \
        --matter <matterId> --memo <memoId> [--apply]

Dry-run by default: prints what it would delete and exits. `--apply` performs it.
"""

from __future__ import annotations

import argparse
import json
import sys

from seed_staging import API_HOST, Api


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--matter", required=True, help="matter GUID")
    ap.add_argument("--memo", required=True, help="memo GUID")
    ap.add_argument("--apply", action="store_true", help="actually delete (default: dry run)")
    args = ap.parse_args()

    if "staging" not in API_HOST:
        sys.exit(f"refusing: API_HOST is {API_HOST!r}, which is not the staging tenant")

    api = Api()

    # Read it back first. Deleting by an id you have not looked at is how the
    # wrong record gets removed.
    code, memos = api.call("GET", f"/matters/{args.matter}/memos")
    if code != 200 or not isinstance(memos, dict):
        sys.exit(f"could not read memos on {args.matter}: HTTP {code} {memos}")

    items = memos.get("value") or memos.get("items") or []
    target = next((m for m in items if isinstance(m, dict) and m.get("id") == args.memo), None)
    if target is None:
        sys.exit(f"memo {args.memo} not found on matter {args.matter} — nothing to do")

    print("TARGET:")
    print(json.dumps({k: target.get(k) for k in ("id", "plainText", "createdDate", "isDeleted")}, indent=2))

    if not args.apply:
        print("\nDRY RUN — re-run with --apply to delete.")
        return

    code, resp = api.call("DELETE", f"/matters/{args.matter}/memos/{args.memo}")
    print(f"\nDELETE -> HTTP {code} {resp if resp else ''}")

    code, after = api.call("GET", f"/matters/{args.matter}/memos")
    remaining = (after.get("value") or after.get("items") or []) if isinstance(after, dict) else []
    still = [m for m in remaining if isinstance(m, dict) and m.get("id") == args.memo]
    print(f"VERIFY: memo present after delete = {bool(still)}")
    if still:
        print(json.dumps({k: still[0].get(k) for k in ("id", "isDeleted")}, indent=2))


if __name__ == "__main__":
    main()
