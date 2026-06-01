"""Tests for adapter.evidence.manifest."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[3]))

from adapter.evidence.manifest import (  # noqa: E402
    PACKET_VERSION,
    SIGNATURE_STUB,
    build_manifest,
    manifest_sha256_hex,
)


def _base_kwargs(**over):
    base = dict(
        customer_slug="acme",
        matter="all",
        period_start="2026-04-01T00:00:00Z",
        period_end="2026-05-01T00:00:00Z",
        file_hashes={"a.txt": "deadbeef", "b.txt": "cafef00d"},
        actor="captain@example.com",
        actor_role="captain",
        generated_at="2026-05-15T12:00:00.000Z",
        captain_name="Scott Durgan",
        captain_email="scott@smd.services",
        captain_key_id="key-abc",
    )
    base.update(over)
    return base


def test_manifest_to_dict_carries_required_fields():
    m = build_manifest(**_base_kwargs())
    body = m.to_dict()
    assert body["customer_slug"] == "acme"
    assert body["period_start"] == "2026-04-01T00:00:00Z"
    assert body["period_end"] == "2026-05-01T00:00:00Z"
    assert body["generated_at"] == "2026-05-15T12:00:00.000Z"
    assert body["packet_version"] == PACKET_VERSION
    assert body["captain_signature"]["name"] == "Scott Durgan"
    assert body["captain_signature"]["email"] == "scott@smd.services"
    assert body["captain_signature"]["key_id"] == "key-abc"
    assert body["captain_signature"]["signature"] == SIGNATURE_STUB
    assert body["captain_signature"]["algorithm"] == "stub-noop"
    assert body["generated_by"] == {"actor": "captain@example.com", "actor_role": "captain"}


def test_manifest_file_hashes_sorted_for_determinism():
    m = build_manifest(
        **_base_kwargs(file_hashes={"z.txt": "z", "a.txt": "a", "m.txt": "m"})
    )
    body = m.to_dict()
    assert list(body["file_hashes"].keys()) == ["a.txt", "m.txt", "z.txt"]


def test_manifest_to_bytes_is_deterministic():
    m1 = build_manifest(**_base_kwargs())
    m2 = build_manifest(**_base_kwargs())
    assert m1.to_bytes() == m2.to_bytes()


def test_manifest_sha256_matches_canonical_bytes():
    m = build_manifest(**_base_kwargs())
    raw = m.to_bytes()
    expected = hashlib.sha256(raw).hexdigest()
    assert manifest_sha256_hex(m) == expected


def test_manifest_extra_is_present_when_provided():
    m = build_manifest(**_base_kwargs(extra={"counts": {"audit_events": 5}}))
    body = m.to_dict()
    assert body["extra"] == {"counts": {"audit_events": 5}}


def test_manifest_signature_defaults_to_stub():
    m = build_manifest(**_base_kwargs())
    assert m.signature == SIGNATURE_STUB
    body = json.loads(m.to_bytes())
    assert body["captain_signature"]["signature"] == SIGNATURE_STUB
