"""Coverage for the connector entrypoint's startup scope readout.

The gateway spawns the connector at boot to list its tools, so main() runs
deterministically at startup. _startup_scope_readout() mints once there so the
granted token scopes are logged at boot — the only agent-independent readout of
the live firm-delegated grant. It must never block serving."""

from __future__ import annotations

from smokeball_connector import __main__ as entry


def test_startup_scope_readout_invokes_auth_status(monkeypatch) -> None:
    called: dict[str, bool] = {}

    class _FakeClient:
        def auth_status(self) -> dict:
            called["yes"] = True
            return {"granted_scopes": ["documents/write"]}

    monkeypatch.setattr(entry, "_get_client", lambda: _FakeClient())
    entry._startup_scope_readout()
    assert called.get("yes") is True


def test_startup_scope_readout_never_raises_on_client_failure(monkeypatch, capsys) -> None:
    def _boom():
        raise KeyError("SMOKEBALL_CLIENT_ID")

    monkeypatch.setattr(entry, "_get_client", _boom)
    entry._startup_scope_readout()  # must not raise
    assert "startup scope readout skipped" in capsys.readouterr().err


def test_startup_scope_readout_never_raises_on_auth_failure(monkeypatch) -> None:
    class _FakeClient:
        def auth_status(self) -> dict:
            raise RuntimeError("mint rejected")

    monkeypatch.setattr(entry, "_get_client", lambda: _FakeClient())
    entry._startup_scope_readout()  # must not raise
