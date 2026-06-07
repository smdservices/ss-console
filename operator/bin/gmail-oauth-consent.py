#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "google-auth-oauthlib",
#   "google-api-python-client",
# ]
# ///
"""One-time Google OAuth consent runner for the Operator (user-OAuth path).

Reads a Desktop OAuth client JSON on stdin, runs the loopback consent flow
(opens the operator's browser), captures the refresh token, saves it 0600, and
proves access with read probes against each granted surface. No org policy, no
service account.

Dependencies are declared inline (PEP 723), so `uv run` installs them itself —
no `--with` flags, which keeps the invocation short enough not to line-wrap:

    pbpaste | uv run operator/bin/gmail-oauth-consent.py

Scopes (the customer-zero v1 set — read + draft across the Workspace surface;
NEVER send / share-notify, which are outside these scopes or adapter-suppressed):

  * gmail.modify      read / label / archive / trash / draft. NO send.
  * calendar.events   read + create/update events (adapter forces sendUpdates=none).
  * drive.readonly    read/export any Drive file incl. Docs (broad-read; see ADR 0020).
  * drive.file        create/update files the app owns (draft Docs). No broad write.

The scope SET is the authored entitlement and the real security boundary (ADR
0035): `execute_code` can call Google at the granted scope, so what the token
grants is what the Operator can do. This script is the only place the grant is
minted, so it verifies the returned grant is a SUPERSET of what's required and
refuses to overwrite a working token with a narrower one (which would silently
regress the live inbox-triage path).

Token written to ~/.crane/google-token.json (0600) by default — the credential
mounted on the customer Machine volume at /opt/data/oauth/google.json (ADR 0010).
The client_secret stays on stdin / in memory; it is never written.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys

DEFAULT_SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
]
DEFAULT_LOGIN_HINT = "smdurgan@smdurgan.com"
DEFAULT_TOKEN_OUT = os.path.expanduser("~/.crane/google-token.json")


def _parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(prog="gmail-oauth-consent.py")
    ap.add_argument("--login-hint", default=DEFAULT_LOGIN_HINT)
    ap.add_argument("--token-out", default=DEFAULT_TOKEN_OUT)
    ap.add_argument(
        "--scopes",
        default=",".join(DEFAULT_SCOPES),
        help="comma-separated OAuth scopes (default: the customer-zero v1 set)",
    )
    return ap.parse_args()


def main() -> int:
    args = _parse_args()
    scopes = [s.strip() for s in args.scopes.split(",") if s.strip()]
    token_out = os.path.expanduser(args.token_out)

    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build
    except ImportError:
        print("FAIL: run via uv --with google-auth-oauthlib --with google-api-python-client", file=sys.stderr)
        return 2

    try:
        client_config = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"FAIL: clipboard is not valid JSON: {exc}", file=sys.stderr)
        return 2
    if "installed" not in client_config:
        print(f"FAIL: expected a Desktop ('installed') client, got keys {list(client_config)}", file=sys.stderr)
        return 2

    # Re-consent safety: back up an existing token so a narrowed grant can be
    # rolled back rather than silently regressing the live inbox-triage path.
    backup = None
    if os.path.exists(token_out):
        backup = token_out + ".bak"
        shutil.copy2(token_out, backup)
        print(f">>> Existing token backed up to {backup}", flush=True)

    print(f">>> Opening your browser. Pick {args.login_hint} and approve ALL requested scopes.", flush=True)
    print(f"    Requesting: {', '.join(s.rsplit('/', 1)[-1] for s in scopes)}", flush=True)
    flow = InstalledAppFlow.from_client_config(client_config, scopes=scopes)
    creds = flow.run_local_server(
        port=0,
        login_hint=args.login_hint,
        open_browser=True,
        authorization_prompt_message="If the browser did not open, visit:\n{url}",
    )

    # Verify the granted grant is a superset of what we asked for. A subset
    # (user unchecked a box, incremental-auth quirk) must NOT overwrite a
    # working token — restore the backup and fail loud.
    if not creds.has_scopes(scopes):
        granted = sorted(creds.scopes or [])
        print(f"FAIL: granted scopes are not a superset of required. Granted: {granted}", file=sys.stderr)
        if backup:
            shutil.move(backup, token_out)
            print(">>> Restored the previous token from backup.", file=sys.stderr)
        return 3

    os.makedirs(os.path.dirname(token_out), exist_ok=True)
    fd = os.open(token_out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)  # 0600 from the start
    with os.fdopen(fd, "w") as fh:
        fh.write(creds.to_json())
    print(f">>> Token saved (0600) to {token_out}. Has refresh token: {bool(creds.refresh_token)}", flush=True)

    # Functional read probes: each confirms a granted scope actually works.
    try:
        gmail = build("gmail", "v1", credentials=creds, cache_discovery=False)
        unread = gmail.users().messages().list(userId="me", q="is:unread", maxResults=5).execute()
        print(f"PASS gmail.modify: {len(unread.get('messages', []))} unread visible.", flush=True)

        cal = build("calendar", "v3", credentials=creds, cache_discovery=False)
        events = cal.events().list(calendarId="primary", maxResults=5, singleEvents=True,
                                   orderBy="startTime").execute()
        print(f"PASS calendar.events: {len(events.get('items', []))} upcoming event(s) visible.", flush=True)

        drive = build("drive", "v3", credentials=creds, cache_discovery=False)
        files = drive.files().list(pageSize=5, fields="files(id, name)").execute()
        print(f"PASS drive.readonly: {len(files.get('files', []))} file(s) visible.", flush=True)
    except Exception as exc:  # noqa: BLE001 — a failing probe means a scope didn't take
        print(f"FAIL: read probe errored ({type(exc).__name__}: {exc}).", file=sys.stderr)
        if backup:
            shutil.move(backup, token_out)
            print(">>> Restored the previous token from backup.", file=sys.stderr)
        return 4

    if backup:
        os.remove(backup)  # success — drop the backup so a full-scope token isn't left lying around
    print(">>> Done. drive.file (create) is granted by scope; exercised live by crane_drive.py create-doc.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
