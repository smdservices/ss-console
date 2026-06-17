#!/usr/bin/env python3
"""crane_gmail.py - thin Gmail CLI for the Operator.

The `inbox-triage` skill shells to this for the mechanical fetch loop. Customer
Workspace deployments normally use a customer-owned service-account key with
domain-wide delegation; the legacy user-OAuth path is still supported by shared
credential loading in _google_auth.py.

Token resolution: --token, else $GOOGLE_TOKEN_PATH, else /opt/data/oauth/google.json
(the per-customer Fly volume path, ADR 0010). Credential loading/refresh is shared
with the sibling Google CLIs via _google_auth.py.

Subcommands:
  search <query> [--max N]      print matching message IDs, one per line
  get <id> [--format json|meta] spill the message JSON (full or metadata) to a
                                temp file; print an envelope {message_id, path,
                                size_bytes}. The caller reads the JSON from path.
                                Large HTML bodies overflow tool stdout (#1167).
  send                          send a MIME message as the impersonated user
  create-draft                  create a Gmail draft
  modify <id>                   add/remove labels on a message
  archive <id>                  remove INBOX from a message
  capabilities                  print this adapter's CapabilitySet (ADR 0006)
"""

import argparse
import base64
import json
import os
import sys
import tempfile
from email.message import EmailMessage

from _google_auth import add_token_arg, service

CAPABILITY = "Email"
ADAPTER = "google-gmail"
VERSION = "1.0.0"
# Contract method names (src/lib/operator/capabilities/email.ts).
SUPPORTED_METHODS = [
    "list_threads",
    "get_thread",
    "create_draft",
    "apply_label",
    "move_to_folder",
    "send_message",
]
UNSUPPORTED_METHODS = [
    "update_draft",
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
    # Large HTML bodies overflow the tool stdout limit, which silently truncated
    # ~40% of messages to parse_failed in unattended cron runs (#1167). Spill the
    # full payload to a temp file and emit only a small envelope pointing to it;
    # the caller reads the message JSON from disk.
    payload = json.dumps(msg, ensure_ascii=False)
    fd, path = tempfile.mkstemp(prefix=f"crane_gmail_{args.id}_", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(payload)
    except Exception:
        os.unlink(path)
        raise
    print(json.dumps(
        {"message_id": args.id, "path": path, "size_bytes": len(payload.encode("utf-8"))},
        ensure_ascii=False,
    ))
    return 0


def _message_from_args(args) -> EmailMessage:
    msg = EmailMessage()
    msg["To"] = args.to
    msg["Subject"] = args.subject
    if args.cc:
        msg["Cc"] = args.cc
    if args.bcc:
        msg["Bcc"] = args.bcc
    msg.set_content(args.body)
    return msg


def _raw_message(msg: EmailMessage) -> str:
    encoded = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")
    return encoded.rstrip("=")


def cmd_send(svc, args) -> int:
    body = {"raw": _raw_message(_message_from_args(args))}
    if args.thread_id:
        body["threadId"] = args.thread_id
    sent = svc.users().messages().send(userId="me", body=body).execute()
    print(json.dumps(sent, ensure_ascii=False))
    return 0


def cmd_create_draft(svc, args) -> int:
    body = {"message": {"raw": _raw_message(_message_from_args(args))}}
    if args.thread_id:
        body["message"]["threadId"] = args.thread_id
    draft = svc.users().drafts().create(userId="me", body=body).execute()
    print(json.dumps(draft, ensure_ascii=False))
    return 0


def cmd_modify(svc, args) -> int:
    body = {"addLabelIds": args.add_label, "removeLabelIds": args.remove_label}
    updated = svc.users().messages().modify(userId="me", id=args.id, body=body).execute()
    print(json.dumps(updated, ensure_ascii=False))
    return 0


def cmd_archive(svc, args) -> int:
    updated = svc.users().messages().modify(
        userId="me", id=args.id, body={"removeLabelIds": ["INBOX"]}
    ).execute()
    print(json.dumps(updated, ensure_ascii=False))
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

    for name in ("send", "create-draft"):
        p = gsub.add_parser(name)
        p.add_argument("--to", required=True)
        p.add_argument("--subject", required=True)
        p.add_argument("--body", required=True)
        p.add_argument("--cc")
        p.add_argument("--bcc")
        p.add_argument("--thread-id")

    mo = gsub.add_parser("modify")
    mo.add_argument("id")
    mo.add_argument("--add-label", action="append", default=[])
    mo.add_argument("--remove-label", action="append", default=[])

    ar = gsub.add_parser("archive")
    ar.add_argument("id")

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
        if args.op == "send":
            return cmd_send(svc, args)
        if args.op == "create-draft":
            return cmd_create_draft(svc, args)
        if args.op == "modify":
            return cmd_modify(svc, args)
        if args.op == "archive":
            return cmd_archive(svc, args)
    except Exception as exc:  # noqa: BLE001 — surface the raw error for the agent/operator
        print(f"crane_gmail error: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    return 2


if __name__ == "__main__":
    sys.exit(main())
