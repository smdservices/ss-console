#!/usr/bin/env python3
"""One-time Gmail OAuth consent runner (user-OAuth path, option #1).

Reads a Desktop OAuth client JSON on stdin, runs the loopback consent flow
(opens the operator's browser), captures the refresh token, saves it 0600,
and proves access by reading a few unread subjects. No org policy, no service
account. This is the tracer bullet for the user-OAuth Gmail path.

    pbpaste | uv run --with google-auth-oauthlib --with google-api-python-client \
        operator/bin/gmail-oauth-consent.py

Scope: gmail.modify (read + archive + trash + draft; NO send). Token written to
~/.crane/google-token.json (0600) — that is the credential we mount on the
customer Machine volume next. The client_secret stays on stdin / in memory; it
is never written by this script.
"""

import json
import os
import sys

SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]
LOGIN_HINT = "smdurgan@smdurgan.com"
TOKEN_OUT = os.path.expanduser("~/.crane/google-token.json")


def main() -> int:
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

    print(">>> Opening your browser. Pick smdurgan@smdurgan.com and approve the single Gmail scope.", flush=True)
    flow = InstalledAppFlow.from_client_config(client_config, scopes=SCOPES)
    creds = flow.run_local_server(port=0, login_hint=LOGIN_HINT, open_browser=True,
                                  authorization_prompt_message="If the browser did not open, visit:\n{url}")

    os.makedirs(os.path.dirname(TOKEN_OUT), exist_ok=True)
    # Write 0600 from the start.
    fd = os.open(TOKEN_OUT, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(creds.to_json())
    print(f">>> Token saved (0600) to {TOKEN_OUT}. Has refresh token: {bool(creds.refresh_token)}", flush=True)

    gmail = build("gmail", "v1", credentials=creds, cache_discovery=False)
    resp = gmail.users().messages().list(userId="me", q="is:unread", maxResults=5).execute()
    ids = [m["id"] for m in resp.get("messages", [])]
    print(f"PASS: read {LOGIN_HINT}. {len(ids)} unread:")
    for mid in ids:
        msg = gmail.users().messages().get(userId="me", id=mid, format="metadata",
                                           metadataHeaders=["Subject", "From"]).execute()
        h = {x["name"]: x["value"] for x in msg["payload"]["headers"]}
        print(f"  - {h.get('From','?')[:38]:38} | {h.get('Subject','(no subject)')[:68]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
