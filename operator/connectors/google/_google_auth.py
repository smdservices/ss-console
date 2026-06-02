#!/usr/bin/env python3
"""_google_auth.py — shared user-OAuth credential plumbing for the Operator's
Google connector CLIs (crane_gmail.py, crane_calendar.py, crane_drive.py).

One scope-limited Google authorized-user token serves all three connectors. The
token (refresh_token + client_id + client_secret + granted scopes) lives on the
per-customer Fly volume; this module loads it, auto-refreshes the access token,
and persists the refreshed token back (0600 preserved). Google API client
libraries are imported lazily inside the functions so importing this module (and
the CLIs that import it) carries no hard dependency on google-* packages — the
`capabilities` subcommands and the conformance suite run without them.

Governability note (ADR 0035 / ADR 0020): the security boundary is the TOKEN
SCOPE granted at consent, not the verbs these CLIs expose. `execute_code` can
read this same token and call Google at its full granted scope, so the adapters'
verb minimalism is ergonomics; the hard wall is what Google itself permits for
the granted scopes (e.g. `gmail.modify` cannot send). The scope set is an
AUTHORED entitlement (what the principal consented to), never a harness default.

Token resolution order: explicit path arg, else $GOOGLE_TOKEN_PATH, else
/opt/data/oauth/google.json (the per-customer Fly volume path, ADR 0010).
"""

from __future__ import annotations

import argparse
import os

DEFAULT_TOKEN = "/opt/data/oauth/google.json"


def resolve_token_path(explicit: str | None = None) -> str:
    """Resolve the token path: explicit arg → $GOOGLE_TOKEN_PATH → default."""
    return explicit or os.environ.get("GOOGLE_TOKEN_PATH", DEFAULT_TOKEN)


def add_token_arg(parser: argparse.ArgumentParser) -> None:
    """Register the shared `--token` argument on a CLI's argparse parser."""
    parser.add_argument(
        "--token",
        default=os.environ.get("GOOGLE_TOKEN_PATH", DEFAULT_TOKEN),
        help="Path to the Google authorized-user token JSON (default: %(default)s).",
    )


def credentials(token_path: str):
    """Load the authorized-user token, refreshing + persisting if expired.

    Raises RuntimeError if the token is invalid and not refreshable (the
    operator must re-run consent). Google libraries are imported here, not at
    module top, so this file imports cleanly without google-* installed.
    """
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    creds = Credentials.from_authorized_user_file(token_path)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            # Persist the refreshed access token. O_TRUNC write keeps 0600.
            fd = os.open(token_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as fh:
                fh.write(creds.to_json())
        else:
            raise RuntimeError("token invalid and not refreshable (re-run consent)")
    return creds


def service(api: str, version: str, token_path: str):
    """Build an authenticated Google API client (e.g. service('calendar','v3',…))."""
    from googleapiclient.discovery import build

    return build(api, version, credentials=credentials(token_path), cache_discovery=False)
