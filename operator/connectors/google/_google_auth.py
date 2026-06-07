#!/usr/bin/env python3
"""_google_auth.py — shared Google credential plumbing for the Operator's
Google connector CLIs (crane_gmail.py, crane_calendar.py, crane_drive.py).

Two AUTHORED credential shapes share one on-disk path and one entry point
(`credentials()` → `service()`); the loader dispatches on the JSON's `type`:

  * **authorized-user token** (user-OAuth; the default, no `type` or
    `"type": "authorized_user"`). A scope-limited token a principal minted at
    consent (refresh_token + client_id + client_secret + granted scopes) lives
    on the per-customer Fly volume; we load it, auto-refresh the access token,
    and persist the refreshed token back (0600 preserved).

  * **service-account key** (`"type": "service_account"`; domain-wide
    delegation). For a Workspace client whose own super-admin authorized our
    service account's client ID, the Operator impersonates a user. The key
    mints short-lived tokens on demand — there is NO refresh_token and nothing
    is persisted. The impersonation subject and the requested scopes are
    AUTHORED entitlement, sourced from the environment ($GOOGLE_IMPERSONATE_SUBJECT
    / $GOOGLE_OAUTH_SCOPES, materialized from customer.yaml), never defaulted;
    the loader is fail-closed if either is absent. The hard wall on top is what
    the client's admin authorized for that client ID in their Admin console.

Google API client libraries are imported lazily inside the functions so importing
this module (and the CLIs that import it) carries no hard dependency on google-*
packages — the `capabilities` subcommands and the conformance suite run without
them.

Governability note (ADR 0035 / ADR 0020): the security boundary is the TOKEN
SCOPE granted at consent (user-OAuth) or authorized for the client ID in the
Admin console (DWD), not the verbs these CLIs expose. `execute_code` can read the
same credential and call Google at its full granted scope, so the adapters' verb
minimalism is ergonomics; the hard wall is what Google itself permits. The scope
set is an AUTHORED entitlement, never a harness default.

Token resolution order: explicit path arg, else $GOOGLE_TOKEN_PATH, else
/opt/data/oauth/google.json (the per-customer Fly volume path, ADR 0010).
"""

from __future__ import annotations

import argparse
import json
import os

DEFAULT_TOKEN = "/opt/data/oauth/google.json"

# DWD (service-account) mode reads its authored entitlement from these env vars.
# They are materialized onto the Machine from customer.yaml (boot wiring is a
# follow-on); user-OAuth mode ignores them.
SCOPES_ENV = "GOOGLE_OAUTH_SCOPES"
SUBJECT_ENV = "GOOGLE_IMPERSONATE_SUBJECT"


def resolve_token_path(explicit: str | None = None) -> str:
    """Resolve the token path: explicit arg → $GOOGLE_TOKEN_PATH → default."""
    return explicit or os.environ.get("GOOGLE_TOKEN_PATH", DEFAULT_TOKEN)


def add_token_arg(parser: argparse.ArgumentParser) -> None:
    """Register the shared `--token` argument on a CLI's argparse parser."""
    parser.add_argument(
        "--token",
        default=os.environ.get("GOOGLE_TOKEN_PATH", DEFAULT_TOKEN),
        help="Path to the Google credential JSON (default: %(default)s).",
    )


def _parse_scopes(raw: str) -> list[str]:
    """Split a scopes env value on commas and/or whitespace, dropping empties."""
    return raw.replace(",", " ").split()


def _load_token_info(token_path: str) -> dict:
    """Read and parse the on-disk credential JSON (used to dispatch on `type`)."""
    with open(token_path, encoding="utf-8") as fh:
        return json.load(fh)


def _service_account_credentials(info: dict):
    """Build domain-wide-delegation credentials from a service-account key.

    Scopes and the impersonation subject are AUTHORED entitlement (ADR 0035),
    sourced from the environment, never defaulted — fail-closed if absent. Env
    is validated BEFORE the lazy google import so the fail-closed contract holds
    even where google-* is not installed.
    """
    scopes = _parse_scopes(os.environ.get(SCOPES_ENV, ""))
    subject = os.environ.get(SUBJECT_ENV, "").strip()
    if not scopes:
        raise RuntimeError(
            f"service-account credential requires {SCOPES_ENV} (authored scopes); none set"
        )
    if not subject:
        raise RuntimeError(
            f"service-account credential requires {SUBJECT_ENV} "
            "(user to impersonate); none set"
        )

    from google.oauth2 import service_account

    return service_account.Credentials.from_service_account_info(
        info, scopes=scopes, subject=subject
    )


def _authorized_user_credentials(token_path: str, info: dict):
    """Load a user-OAuth token, refreshing + persisting the access token if expired.

    Raises RuntimeError if the token is invalid and not refreshable (the operator
    must re-run consent).
    """
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    creds = Credentials.from_authorized_user_info(info)
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


def credentials(token_path: str):
    """Load Google credentials, dispatching on the on-disk credential kind.

    `"type": "service_account"` → domain-wide delegation (impersonation, no
    persist); anything else → user-OAuth authorized-user token (refresh +
    persist). Google libraries are imported inside the branch helpers, not at
    module top, so this file imports cleanly without google-* installed.
    """
    info = _load_token_info(token_path)
    if info.get("type") == "service_account":
        return _service_account_credentials(info)
    return _authorized_user_credentials(token_path, info)


def service(api: str, version: str, token_path: str):
    """Build an authenticated Google API client (e.g. service('calendar','v3',…))."""
    from googleapiclient.discovery import build

    return build(api, version, credentials=credentials(token_path), cache_discovery=False)
