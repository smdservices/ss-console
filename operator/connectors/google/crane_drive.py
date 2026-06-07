#!/usr/bin/env python3
"""crane_drive.py - thin Google Drive, Docs, and Sheets CLI for the Operator.

Mirrors crane_gmail.py: a deliberately minimal CLI the agent shells to via
`execute_code`. Customer Workspace deployments normally use a customer-owned
service-account key with domain-wide delegation.

  list                  list files (optionally within a folder / by query)
  get <id>              read one file's metadata
  export <id>           export a Doc (or file) to text (default text/plain)
  create-doc            create a Google Doc from text content
  docs-create           create a native Google Doc
  docs-get <id>         read a native Google Doc
  docs-append <id>      append text to a native Google Doc
  sheets-create         create a Google Sheet
  sheets-get-values     read a Sheets range
  sheets-update-values  write values to a Sheets range
  share <id>            create a Drive permission
  capabilities          print this adapter's CapabilitySet (ADR 0006; no token)

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
# Contract method names (document-storage.ts). The CLI also exposes practical
# Workspace subcommands for Docs, Sheets, and Drive permissions.
SUPPORTED_METHODS = ["list_folder", "get_document", "download_document", "upload_document"]
UNSUPPORTED_METHODS = [
    "list_versions",
    "download_version",
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


def _docs_service(token_path: str):
    return service("docs", "v1", token_path)


def _sheets_service(token_path: str):
    return service("sheets", "v4", token_path)


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


def cmd_docs_create(token_path: str, args) -> int:
    svc = _docs_service(token_path)
    doc = svc.documents().create(body={"title": args.title}).execute()
    if args.content:
        _append_doc_text(svc, doc["documentId"], args.content)
    print(json.dumps(doc, ensure_ascii=False))
    return 0


def cmd_docs_get(token_path: str, args) -> int:
    svc = _docs_service(token_path)
    doc = svc.documents().get(documentId=args.id).execute()
    print(json.dumps(doc, ensure_ascii=False))
    return 0


def cmd_docs_append(token_path: str, args) -> int:
    svc = _docs_service(token_path)
    doc = _append_doc_text(svc, args.id, args.text)
    print(json.dumps({"documentId": args.id, "response": doc}, ensure_ascii=False))
    return 0


def _append_doc_text(svc, document_id: str, text: str) -> dict:
    doc = svc.documents().get(documentId=document_id).execute()
    content = doc.get("body", {}).get("content", [])
    end_index = max((item.get("endIndex", 1) for item in content), default=1)
    requests = [{"insertText": {"location": {"index": max(end_index - 1, 1)}, "text": text}}]
    return svc.documents().batchUpdate(
        documentId=document_id, body={"requests": requests}
    ).execute()


def cmd_sheets_create(token_path: str, args) -> int:
    svc = _sheets_service(token_path)
    sheet = svc.spreadsheets().create(
        body={"properties": {"title": args.title}}, fields="spreadsheetId,spreadsheetUrl"
    ).execute()
    print(json.dumps(sheet, ensure_ascii=False))
    return 0


def cmd_sheets_get_values(token_path: str, args) -> int:
    svc = _sheets_service(token_path)
    values = svc.spreadsheets().values().get(
        spreadsheetId=args.id, range=args.range
    ).execute()
    print(json.dumps(values, ensure_ascii=False))
    return 0


def cmd_sheets_update_values(token_path: str, args) -> int:
    svc = _sheets_service(token_path)
    values = json.loads(args.values_json)
    if not isinstance(values, list):
        print("crane_drive error: --values-json must be a JSON array of rows", file=sys.stderr)
        return 1
    updated = svc.spreadsheets().values().update(
        spreadsheetId=args.id,
        range=args.range,
        valueInputOption=args.value_input_option,
        body={"values": values},
    ).execute()
    print(json.dumps(updated, ensure_ascii=False))
    return 0


def cmd_share(svc, args) -> int:
    if args.type in {"user", "group"} and not args.email:
        print(f"crane_drive error: --email is required for type={args.type}", file=sys.stderr)
        return 1
    if args.type == "domain" and not args.domain:
        print("crane_drive error: --domain is required for type=domain", file=sys.stderr)
        return 1
    body = {"type": args.type, "role": args.role}
    if args.email:
        body["emailAddress"] = args.email
    if args.domain:
        body["domain"] = args.domain
    permission = svc.permissions().create(
        fileId=args.id,
        body=body,
        sendNotificationEmail=args.notify,
        fields="id,type,role,emailAddress,domain",
    ).execute()
    print(json.dumps(permission, ensure_ascii=False))
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

    dc = sub.add_parser("docs-create")
    dc.add_argument("--title", required=True)
    dc.add_argument("--content")

    dg = sub.add_parser("docs-get")
    dg.add_argument("id")

    da = sub.add_parser("docs-append")
    da.add_argument("id")
    da.add_argument("--text", required=True)

    sc = sub.add_parser("sheets-create")
    sc.add_argument("--title", required=True)

    sg = sub.add_parser("sheets-get-values")
    sg.add_argument("id")
    sg.add_argument("--range", required=True)

    su = sub.add_parser("sheets-update-values")
    su.add_argument("id")
    su.add_argument("--range", required=True)
    su.add_argument("--values-json", required=True, help='JSON array of rows, e.g. [["A","B"]]')
    su.add_argument("--value-input-option", choices=["RAW", "USER_ENTERED"], default="USER_ENTERED")

    sh = sub.add_parser("share")
    sh.add_argument("id")
    sh.add_argument("--type", choices=["user", "group", "domain", "anyone"], required=True)
    sh.add_argument("--role", choices=["reader", "commenter", "writer"], required=True)
    sh.add_argument("--email")
    sh.add_argument("--domain")
    sh.add_argument("--notify", action="store_true")

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
        "share": cmd_share,
    }
    token_dispatch = {
        "docs-create": cmd_docs_create,
        "docs-get": cmd_docs_get,
        "docs-append": cmd_docs_append,
        "sheets-create": cmd_sheets_create,
        "sheets-get-values": cmd_sheets_get_values,
        "sheets-update-values": cmd_sheets_update_values,
    }
    try:
        if args.cmd in token_dispatch:
            return token_dispatch[args.cmd](args.token, args)
        svc = _service(args.token)
        return dispatch[args.cmd](svc, args)
    except Exception as exc:  # noqa: BLE001 — surface the raw error for the agent/operator
        print(f"crane_drive error: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
