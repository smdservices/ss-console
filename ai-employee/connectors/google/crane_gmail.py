#!/usr/bin/env python3
"""crane_gmail.py — thin Gmail CLI for the AI Employee (user-OAuth token).

The `inbox-triage` skill shells to this for the mechanical fetch loop. It reads
a standard Google authorized-user token (refresh_token + client_id +
client_secret, scope gmail.modify), auto-refreshes, and persists the refreshed
token back. Deliberately minimal — Gmail only, the verbs triage needs — not the
full Google Workspace surface. Chosen over the native bundled skill so we own
the credential format end to end (onboarding-retro lesson: control the
integration, don't assume someone else's file formats).

Token resolution: --token, else $GOOGLE_TOKEN_PATH, else /opt/data/oauth/google.json
(the per-customer Fly volume path, ADR 0010).

Subcommands:
  search <query> [--max N]      print matching message IDs, one per line
  get <id> [--format json|meta] print one message as JSON (full or metadata)

Send is intentionally absent — the token scope (gmail.modify) cannot send, so
Crane structurally cannot send as the principal.
"""

import argparse
import json
import os
import sys

DEFAULT_TOKEN = "/opt/data/oauth/google.json"


def _creds(token_path: str):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    creds = Credentials.from_authorized_user_file(token_path)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            # Persist the refreshed access token (0600 preserved by O_TRUNC write).
            fd = os.open(token_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as fh:
                fh.write(creds.to_json())
        else:
            raise RuntimeError("token invalid and not refreshable (re-run consent)")
    return creds


def _service(token_path: str):
    from googleapiclient.discovery import build

    return build("gmail", "v1", credentials=_creds(token_path), cache_discovery=False)


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


def main() -> int:
    ap = argparse.ArgumentParser(prog="crane_gmail.py")
    ap.add_argument("--token", default=os.environ.get("GOOGLE_TOKEN_PATH", DEFAULT_TOKEN))
    sub = ap.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("gmail")
    gsub = g.add_subparsers(dest="op", required=True)

    s = gsub.add_parser("search")
    s.add_argument("query")
    s.add_argument("--max", type=int, default=25)

    ge = gsub.add_parser("get")
    ge.add_argument("id")
    ge.add_argument("--format", choices=["json", "meta"], default="json")

    args = ap.parse_args()
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
