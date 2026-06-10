"""Google credential loading owned exclusively by the broker process."""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any

import yaml


def materialize_credential(credential_path: Path) -> None:
    """Decode the configured Google credential into the broker-owned store."""
    encoded = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON") or os.environ.get(
        "GOOGLE_TOKEN_JSON"
    )
    if not encoded:
        return
    raw = base64.b64decode(encoded, validate=True)
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise RuntimeError("Google credential must decode to a JSON object")
    credential_path.write_bytes(raw)
    credential_path.chmod(0o600)


def _customer_google_auth(customer_path: Path) -> dict[str, Any]:
    data = yaml.safe_load(customer_path.read_text(encoding="utf-8")) or {}
    config = data.get("google_auth") or {}
    if not isinstance(config, dict):
        raise RuntimeError("customer.yaml google_auth must be an object")
    return config


def credentials(credential_path: Path, customer_path: Path):
    """Build credentials from broker-owned secret material and authored config."""
    info = json.loads(credential_path.read_text(encoding="utf-8"))
    if info.get("type") == "service_account":
        config = _customer_google_auth(customer_path)
        subject = str(config.get("subject") or "").strip()
        scopes = [
            scope.strip()
            for scope in config.get("scopes") or []
            if isinstance(scope, str) and scope.strip()
        ]
        if not subject or not scopes:
            raise RuntimeError("DWD requires authored subject and scopes")
        from google.oauth2 import service_account

        return service_account.Credentials.from_service_account_info(
            info, scopes=scopes, subject=subject
        )

    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    creds = Credentials.from_authorized_user_info(info)
    if not creds.valid:
        if not creds.expired or not creds.refresh_token:
            raise RuntimeError("Google token is invalid and not refreshable")
        creds.refresh(Request())
        credential_path.write_text(creds.to_json(), encoding="utf-8")
        credential_path.chmod(0o600)
    return creds


def service(api: str, version: str, credential_path: Path, customer_path: Path):
    """Build a Google API client within the broker security domain."""
    from googleapiclient.discovery import build

    return build(
        api,
        version,
        credentials=credentials(credential_path, customer_path),
        cache_discovery=False,
    )
