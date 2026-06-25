"""Unit coverage for the env-gated boot diagnostic (server._boot_diagnose).

The diagnostic exists because the normal channel could not exercise the write
path: the agent drafted email replies instead of calling add_file. So the probe
runs at connector import with no agent turn, logging the granted token scopes and
(optionally) the literal result of one upload. These tests lock that it is OFF by
default, logs the granted scopes when enabled, and surfaces the literal API error
body on a write failure."""

from __future__ import annotations

from smokeball_connector import server
from smokeball_connector.client import SmokeballApiError


class _FakeClient:
    def __init__(self, *, scopes, matters=None, add_file_exc=None, add_file_result=None):
        self._scopes = scopes
        self._matters = matters
        self._add_file_exc = add_file_exc
        self._add_file_result = add_file_result or {"fileId": "f-1"}

    def auth_status(self):
        return {"auth_mode": "authorization_code", "granted_scopes": self._scopes}

    def get(self, path, **kw):
        return self._matters

    def add_file(self, matter_id, file_name, data, folder_id=None):
        if self._add_file_exc is not None:
            raise self._add_file_exc
        return self._add_file_result


def test_boot_diagnose_is_noop_when_flag_unset(monkeypatch, capsys) -> None:
    monkeypatch.delenv("SMOKEBALL_BOOT_DIAGNOSE", raising=False)
    server._boot_diagnose()
    assert capsys.readouterr().err == ""


def test_boot_diagnose_logs_granted_scopes_without_write(monkeypatch, capsys) -> None:
    monkeypatch.setenv("SMOKEBALL_BOOT_DIAGNOSE", "1")
    monkeypatch.delenv("SMOKEBALL_DIAGNOSE_WRITE", raising=False)
    monkeypatch.setattr(server, "_get_client", lambda: _FakeClient(scopes=["documents/read", "documents/write"]))
    server._boot_diagnose()
    err = capsys.readouterr().err
    assert "auth OK" in err
    assert "documents/write" in err
    assert "write" not in err.split("granted_scopes")[0]  # no write probe ran


def test_boot_diagnose_write_probe_surfaces_api_error_body(monkeypatch, capsys) -> None:
    exc = SmokeballApiError("POST", "/matters/m-johnson/documents/files", 403, "matter access denied")
    monkeypatch.setenv("SMOKEBALL_BOOT_DIAGNOSE", "1")
    monkeypatch.setenv("SMOKEBALL_DIAGNOSE_WRITE", "1")
    monkeypatch.delenv("SMOKEBALL_DIAGNOSE_MATTER_ID", raising=False)
    monkeypatch.setattr(
        server,
        "_get_client",
        lambda: _FakeClient(scopes=["documents/write"], matters={"value": [{"id": "m-johnson"}]}, add_file_exc=exc),
    )
    server._boot_diagnose()
    err = capsys.readouterr().err
    assert "write FAILED HTTP 403" in err
    assert "matter access denied" in err


def test_boot_diagnose_write_probe_logs_success(monkeypatch, capsys) -> None:
    monkeypatch.setenv("SMOKEBALL_BOOT_DIAGNOSE", "1")
    monkeypatch.setenv("SMOKEBALL_DIAGNOSE_WRITE", "1")
    monkeypatch.setenv("SMOKEBALL_DIAGNOSE_MATTER_ID", "m-explicit")
    monkeypatch.setattr(
        server,
        "_get_client",
        lambda: _FakeClient(scopes=["documents/write"], add_file_result={"fileId": "f-99"}),
    )
    server._boot_diagnose()
    err = capsys.readouterr().err
    assert "write OK" in err
    assert "f-99" in err
    assert "m-explicit" in err


def test_diagnose_find_matter_prefers_explicit_env(monkeypatch) -> None:
    monkeypatch.setenv("SMOKEBALL_DIAGNOSE_MATTER_ID", "m-explicit")
    # get() would return something else; explicit env must win without a lookup.
    assert server._diagnose_find_matter(_FakeClient(scopes=[], matters={"value": [{"id": "other"}]})) == "m-explicit"


def test_diagnose_find_matter_searches_when_no_explicit(monkeypatch) -> None:
    monkeypatch.delenv("SMOKEBALL_DIAGNOSE_MATTER_ID", raising=False)
    found = server._diagnose_find_matter(_FakeClient(scopes=[], matters={"value": [{"id": "m-johnson"}]}))
    assert found == "m-johnson"
