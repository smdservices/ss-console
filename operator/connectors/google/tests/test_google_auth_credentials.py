"""Unit coverage for `_google_auth.credentials()` dual-mode dispatch.

These tests run WITHOUT google-* installed (like the conformance suite): the
dispatch decision and the service-account fail-closed contract are exercised
before any lazy google import, and the branch builders are monkeypatched to
sentinels so we never construct real credentials here.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import _google_auth  # type: ignore[import-not-found]


def _write(tmp_path: Path, info: dict) -> str:
    p = tmp_path / "cred.json"
    p.write_text(json.dumps(info), encoding="utf-8")
    return str(p)


def test_parse_scopes_handles_commas_whitespace_and_empties():
    assert _google_auth._parse_scopes("a b c") == ["a", "b", "c"]
    assert _google_auth._parse_scopes("a,b,c") == ["a", "b", "c"]
    assert _google_auth._parse_scopes(" a, b ,\n c ") == ["a", "b", "c"]
    assert _google_auth._parse_scopes("") == []
    assert _google_auth._parse_scopes("   ,  ") == []


def test_credentials_routes_service_account(tmp_path, monkeypatch):
    monkeypatch.setattr(
        _google_auth, "_service_account_credentials", lambda info: ("SA", info)
    )
    monkeypatch.setattr(
        _google_auth,
        "_authorized_user_credentials",
        lambda *a, **k: pytest.fail("authorized_user path must not run for a SA key"),
    )
    path = _write(tmp_path, {"type": "service_account", "client_email": "x@y.iam"})
    kind, info = _google_auth.credentials(path)
    assert kind == "SA"
    assert info["type"] == "service_account"


def test_credentials_routes_authorized_user_when_no_type(tmp_path, monkeypatch):
    # The relayed user-OAuth token carries no `type` field — must NOT be treated
    # as a service account.
    monkeypatch.setattr(
        _google_auth,
        "_service_account_credentials",
        lambda info: pytest.fail("SA path must not run for an authorized-user token"),
    )
    monkeypatch.setattr(
        _google_auth, "_authorized_user_credentials", lambda token_path, info: "USER"
    )
    path = _write(tmp_path, {"refresh_token": "r", "client_id": "c", "client_secret": "s"})
    assert _google_auth.credentials(path) == "USER"


def test_service_account_fails_closed_without_scopes(tmp_path, monkeypatch):
    monkeypatch.delenv(_google_auth.SCOPES_ENV, raising=False)
    monkeypatch.setenv(_google_auth.SUBJECT_ENV, "user@example.com")
    with pytest.raises(RuntimeError, match=_google_auth.SCOPES_ENV):
        _google_auth._service_account_credentials({"type": "service_account"})


def test_service_account_fails_closed_without_subject(tmp_path, monkeypatch):
    monkeypatch.setenv(_google_auth.SCOPES_ENV, "https://www.googleapis.com/auth/calendar")
    monkeypatch.delenv(_google_auth.SUBJECT_ENV, raising=False)
    with pytest.raises(RuntimeError, match=_google_auth.SUBJECT_ENV):
        _google_auth._service_account_credentials({"type": "service_account"})
