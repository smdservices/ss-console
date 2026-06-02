#!/usr/bin/env python3
"""crane_drive.py — thin Google Drive + Docs CLI for the Operator (user-OAuth token).

Mirrors crane_gmail.py: a deliberately minimal CLI the agent shells to via
`execute_code`. Implements the read + create-draft subset of the DocumentStorage
capability contract (src/lib/operator/capabilities/document-storage.ts), covering
both Drive files and Google Docs:

  list                  list files (optionally within a folder / by query)
  get <id>              read one file's metadata
  export <id>           export a Doc (or file) to text (default text/plain)
  create-doc            create an app-owned Google Doc from text content
  capabilities          print this adapter's CapabilitySet (ADR 0006; no token)

External sharing is the EXTERNAL_SEND-class action and is intentionally absent —
there is NO share verb (the contract's share_document / send_share_invitation are
banned, and share_document_draft is declared unsupported for v1). The conformance
suite asserts no banned verb exists.

The hard wall is the AUTHORED token scope, not these verbs (ADR 0035):
`execute_code` can call the Drive API at the granted scope directly. Reads use
`drive.readonly` (read/export any file); `create-doc` needs `drive.file` (create
+ access only files the app owns — it cannot touch the principal's existing
files). `drive.readonly` is a whole-Drive read grant: an authored entitlement,
flagged in ADR 0020 as the highest-blast-radius scope in the v1 set.

Token resolution shared with the sibling Google CLIs via _google_auth.py.
"""

from __future__ import annotations

import argparse
import json
import sys

from _google_auth import add_token_arg, service

CAPABILITY = "DocumentStorage"
ADAPTER = "google-drive"
VERSION = "1.0.0"
# Contract method names (document-storage.ts). CLI exposes read + create; the
# rest (incl. external sharing) are declared unsupported.
SUPPORTED_METHODS = ["list_folder", "get_document", "download_document", "upload_document"]
UNSUPPORTED_METHODS = [
    "update_document",
    "list_versions",
    "download_version",
    "share_document_draft",
    "get_scoped_folders",
]

_FILE_FIELDS = "id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink"
_GOOGLE_DOC_MIME = "application/vnd.google-apps.document"


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
    return service("drive", "v3", token_path)


def cmd_list(svc, args) -> int:
    q_parts = []
    if args.folder:
        q_parts.append(f"'{args.folder}' in parents")
    if args.q:
        q_parts.append(args.q)
    params = {
        "pageSize": args.max,
        "fields": f"files({_FILE_FIELDS})",
        "orderBy": "modifiedTime desc",
    }
    if q_parts:
        params["q"] = " and ".join(q_parts)
    resp = svc.files().list(**params).execute()
    # Echo source items verbatim — no fabricated fields (NO_FIELD_FABRICATION).
    print(json.dumps(resp.get("files", []), ensure_ascii=False))
    return 0


def cmd_get(svc, args) -> int:
    meta = svc.files().get(fileId=args.id, fields=_FILE_FIELDS).execute()
    print(json.dumps(meta, ensure_ascii=False))
    return 0


def cmd_export(svc, args) -> int:
    # Google-native files (Docs/Sheets/Slides) must be exported; binary files
    # are fetched with get_media. Try export first, fall back to media.
    try:
        data = svc.files().export(fileId=args.id, mimeType=args.mime).execute()
    except Exception:  # noqa: BLE001 — not a Google-apps file; fetch raw bytes
        data = svc.files().get_media(fileId=args.id).execute()
    if isinstance(data, bytes):
        sys.stdout.write(data.decode("utf-8", errors="replace"))
    else:
        sys.stdout.write(str(data))
    return 0


def cmd_create_doc(svc, args) -> int:
    from googleapiclient.http import MediaInMemoryUpload

    body = {"name": args.title, "mimeType": _GOOGLE_DOC_MIME}
    if args.folder:
        body["parents"] = [args.folder]
    media = MediaInMemoryUpload(args.content.encode("utf-8"), mimetype="text/plain")
    created = svc.files().create(
        body=body, media_body=media, fields=_FILE_FIELDS
    ).execute()
    print(json.dumps({
        "id": created.get("id"),
        "name": created.get("name"),
        "mime_type": created.get("mimeType"),
        "web_view_link": created.get("webViewLink"),
        "status": "pending_review",
        "drafted_by_skill": args.drafted_by_skill,
    }, ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="crane_drive.py")
    add_token_arg(ap)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("capabilities", help="print this adapter's CapabilitySet (no token needed)")

    ls = sub.add_parser("list")
    ls.add_argument("--folder", help="parent folder ID to list within")
    ls.add_argument("--q", help="raw Drive query (e.g. \"name contains 'invoice'\")")
    ls.add_argument("--max", type=int, default=25)

    ge = sub.add_parser("get")
    ge.add_argument("id")

    ex = sub.add_parser("export")
    ex.add_argument("id")
    ex.add_argument("--mime", default="text/plain", help="export MIME type (default text/plain)")

    cd = sub.add_parser("create-doc")
    cd.add_argument("--title", required=True)
    cd.add_argument("--content", required=True, help="plain-text body of the draft Doc")
    cd.add_argument("--folder", help="parent folder ID (app-owned)")
    cd.add_argument("--drafted-by-skill", required=True, help="audit: skill that authored the draft")

    return ap


def main() -> int:
    args = build_parser().parse_args()
    if args.cmd == "capabilities":
        print(json.dumps(describe_capabilities(), ensure_ascii=False))
        return 0
    dispatch = {
        "list": cmd_list,
        "get": cmd_get,
        "export": cmd_export,
        "create-doc": cmd_create_doc,
    }
    try:
        svc = _service(args.token)
        return dispatch[args.cmd](svc, args)
    except Exception as exc:  # noqa: BLE001 — surface the raw error for the agent/operator
        print(f"crane_drive error: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
