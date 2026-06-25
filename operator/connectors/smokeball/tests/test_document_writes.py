"""Unit coverage for the document round-trip writes (add_file / delete_file).

No live Smokeball calls: an ``httpx.MockTransport`` is injected so the real
two-stage upload logic runs against scripted responses. These lock the contract
that bit the original seeding effort — the second-stage PUT must go to the
presigned URL with an EMPTY ``Content-Type`` and NO ``x-api-key``/``Authorization``
(those would break the S3 signature)."""

from __future__ import annotations

import base64

import httpx
import pytest

from smokeball_connector.client import SmokeballClient, SmokeballWriteError

_UPLOAD_URL = "https://s3.example.com/apiuploads/abc-123?X-Amz-Signature=deadbeef"


def _mock_client(handler, **overrides) -> SmokeballClient:
    kwargs = dict(region="us", environment="staging", client_id="cid", client_secret="sec", api_key="apikey")
    kwargs.update(overrides)
    client = SmokeballClient(**kwargs)
    client._http = httpx.Client(transport=httpx.MockTransport(handler))
    return client


def _handler(captured: list[httpx.Request], *, no_upload_url: bool = False):
    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        path = request.url.path
        if path.endswith("/oauth2/token"):
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600, "token_type": "Bearer"})
        if request.method == "POST" and path.endswith("/documents/files"):
            body = {"fileId": "file-9"}
            if not no_upload_url:
                body["uploadUrl"] = _UPLOAD_URL
            return httpx.Response(202, json=body)
        if str(request.url) == _UPLOAD_URL:  # the presigned S3 PUT
            return httpx.Response(200)
        if request.method == "DELETE":
            return httpx.Response(202, json={"href": "/tracking/del-1"})
        return httpx.Response(200, json={"ok": True})

    return handler


def test_add_file_two_stage_metadata_then_presigned_put() -> None:
    captured: list[httpx.Request] = []
    client = _mock_client(_handler(captured))
    raw = b"%PDF-1.4 fake pdf bytes"
    result = client.add_file("m-1", "Demand Letter.pdf", raw)

    assert result == {"fileId": "file-9", "matterId": "m-1", "fileName": "Demand Letter.pdf", "uploaded": True}

    post = next(r for r in captured if r.method == "POST" and r.url.path.endswith("/documents/files"))
    assert post.url.path == "/matters/m-1/documents/files"
    import json as _json
    assert _json.loads(post.content) == {"fileName": "Demand Letter.pdf"}
    # the metadata call IS authenticated
    assert post.headers.get("x-api-key") == "apikey"
    assert post.headers.get("authorization") == "Bearer tok"

    put = next(r for r in captured if r.method == "PUT")
    assert str(put.url) == _UPLOAD_URL
    assert put.content == raw
    # the presigned PUT must carry an EMPTY content-type and NO app/bearer auth
    assert put.headers.get("content-type") == ""
    assert "x-api-key" not in put.headers
    assert "authorization" not in put.headers


def test_add_file_includes_folder_id_when_given() -> None:
    captured: list[httpx.Request] = []
    client = _mock_client(_handler(captured))
    client.add_file("m-1", "x.txt", b"hi", folder_id="folder-7")
    post = next(r for r in captured if r.method == "POST" and r.url.path.endswith("/documents/files"))
    import json as _json
    assert _json.loads(post.content) == {"fileName": "x.txt", "folderId": "folder-7"}


def test_add_file_raises_when_no_upload_url() -> None:
    captured: list[httpx.Request] = []
    client = _mock_client(_handler(captured, no_upload_url=True))
    with pytest.raises(SmokeballWriteError, match="uploadUrl"):
        client.add_file("m-1", "x.txt", b"hi")
    # the presigned PUT must NOT have been attempted
    assert not any(r.method == "PUT" for r in captured)


def test_delete_file_targets_the_matter_scoped_path() -> None:
    captured: list[httpx.Request] = []
    client = _mock_client(_handler(captured))
    client.delete_file("m-1", "file-9")
    dele = next(r for r in captured if r.method == "DELETE")
    assert dele.url.path == "/matters/m-1/documents/files/file-9"
    assert dele.headers.get("x-api-key") == "apikey"  # API call IS authenticated


def test_server_add_file_rejects_bad_base64(monkeypatch) -> None:
    from smokeball_connector import server

    # never reaches the network: bad base64 is refused before the client is built
    with pytest.raises(ValueError, match="base64"):
        server.add_file("m-1", "x.txt", "not!!base64!!")


def test_server_add_file_decodes_base64_and_delegates(monkeypatch) -> None:
    from smokeball_connector import server

    seen: dict = {}

    class _FakeClient:
        def add_file(self, matter_id, file_name, data, *, folder_id=None):
            seen.update(matter_id=matter_id, file_name=file_name, data=data, folder_id=folder_id)
            return {"fileId": "f-1", "uploaded": True}

    monkeypatch.setattr(server, "_get_client", lambda: _FakeClient())
    payload = base64.b64encode(b"hello bytes").decode()
    out = server.add_file("m-2", "note.txt", payload, folder_id="fld-1")
    assert out == {"fileId": "f-1", "uploaded": True}
    assert seen == {"matter_id": "m-2", "file_name": "note.txt", "data": b"hello bytes", "folder_id": "fld-1"}
