#!/usr/bin/env python3
"""crane_gmail.py — thin Gmail CLI for the Operator (user-OAuth token).

The `inbox-triage` skill shells to this for the mechanical fetch loop. It reads
a standard Google authorized-user token (refresh_token + client_id +
client_secret, scope gmail.modify), auto-refreshes, and persists the refreshed
token back. Deliberately minimal — Gmail only, the verbs triage needs — not the
full Google Workspace surface. Chosen over the native bundled skill so we own
the credential format end to end (onboarding-retro lesson: control the
integration, don't assume someone else's file formats).

Token resolution: --token, else $GOOGLE_TOKEN_PATH, else /opt/data/oauth/google.json
(the per-customer Fly volume path, ADR 0010). Credential loading/refresh is shared
with the sibling Google CLIs via _google_auth.py.

Subcommands:
  search <query> [--max N]      print matching message IDs, one per line
  get <id> [--format json|meta] print one message as JSON (full or metadata)
  capabilities                  print this adapter's CapabilitySet (ADR 0006)

Send is intentionally absent. The guarantee is the AUTHORED token scope
(gmail.modify) — Google itself refuses send for that scope — not a harness
posture (ADR 0035). The principal authored read/label/archive/draft, never send,
for their own Gmail identity at consent time.
"""

import argparse
import json
import sys

from _google_auth import add_token_arg, service

CAPABILITY = "Email"
ADAPTER = "google-gmail"
VERSION = "1.0.0"
# Contract method names (src/lib/operator/capabilities/email.ts). The CLI
# exposes the read/draft-read subset; everything else is declared unsupported.
SUPPORTED_METHODS = ["list_threads", "get_thread"]
UNSUPPORTED_METHODS = [
    "create_draft",
    "update_draft",
    "apply_label",
    "move_to_folder",
    "list_sent_since",
    "get_sent_item",
    "get_scoped_folders",
]


def describe_capabilities() -> dict:
    """CapabilitySet for the capability-disclosure / conformance contract."""
    return {
        "capability": CAPABILITY,
        "adapter": ADAPTER,
        "version": VERSION,
        "supported_methods": SUPPORTED_METHODS,
        "unsupported_methods": UNSUPPORTED_METHODS,
    }


def _service(token_path: str):
    return service("gmail", "v1", token_path)


def cmd_search(svc, args) -> int:
    resp = svc.users().messages().list(
        userId="me", q=args.query, maxResults=args.max
    ).execute()
    for m in resp.get("messages", []):
        print(m["id"])
    return 0


def cmd_get(svc, args) -> int:
    fmt = "full" if args.format == "json" else "metadata"
    kwargs = {"userId": "me", "id": args.id, "format": fmt}
    if fmt == "metadata":
        kwargs["metadataHeaders"] = ["Subject", "From", "To", "Date"]
    msg = svc.users().messages().get(**kwargs).execute()
    print(json.dumps(msg, ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="crane_gmail.py")
    add_token_arg(ap)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("capabilities", help="print this adapter's CapabilitySet (no token needed)")

    g = sub.add_parser("gmail")
    gsub = g.add_subparsers(dest="op", required=True)

    s = gsub.add_parser("search")
    s.add_argument("query")
    s.add_argument("--max", type=int, default=25)

    ge = gsub.add_parser("get")
    ge.add_argument("id")
    ge.add_argument("--format", choices=["json", "meta"], default="json")

    return ap


def main() -> int:
    args = build_parser().parse_args()
    if args.cmd == "capabilities":
        print(json.dumps(describe_capabilities(), ensure_ascii=False))
        return 0
    try:
        svc = _service(args.token)
        if args.op == "search":
            return cmd_search(svc, args)
        if args.op == "get":
            return cmd_get(svc, args)
    except Exception as exc:  # noqa: BLE001 — surface the raw error for the agent/operator
        print(f"crane_gmail error: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    return 2


if __name__ == "__main__":
    sys.exit(main())
