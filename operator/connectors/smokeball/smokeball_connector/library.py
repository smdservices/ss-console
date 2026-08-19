"""Deterministic resolution of the firm's format template for a document class.

The model never chooses typography, and that includes never choosing WHICH
template. This module resolves the one class template from the authored
library location, the same way every time:

    customer.yaml  self_initiation.document_library.{matter_number, folder_name,
                   templates?}            (the live seat copy, world-readable)
      -> the library matter (by its matter number)
      -> the library folder (by name)
      -> the file named ``templates[class]`` or ``Template - <Class>.docx``
      -> its bytes (``client.download_file``)

"Not resolved" is a first-class, reported outcome, never a refusal: the draft
still files, on the starter base, and ``FormatReport.template_expected`` lets
the delivery note say plainly that the firm's template did not resolve and why.
A rename, a moved folder, an unauthored location: each is a sentence in the
note, not a silent fallback that reads like "never configured".

The live customer.yaml is the registered "config-as-data" shape (the block the
self-initiation conductor reads the same way); a connector process cannot rely
on env inheritance from the gateway, so the path is a fixed default with an env
override for tests and local runs.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any

DEFAULT_CUSTOMER_YAML = "/var/lib/smd-config/customer.yaml"
CUSTOMER_YAML_ENV = "SMD_CUSTOMER_YAML_PATH"

CLASS_TITLES: dict[str, str] = {
    "discovery_set": "Discovery Set",
    "discovery_response": "Discovery Response",
    "demand_letter": "Demand Letter",
    "mediation_brief": "Mediation Brief",
    "memo": "Memo",
    "letter": "Letter",
}


@dataclass(frozen=True)
class LibraryConfig:
    authored: bool
    matter_number: str | None = None
    folder_name: str | None = None
    templates: dict[str, str] = field(default_factory=dict)
    source: str = ""

    def template_name(self, document_class: str) -> str:
        custom = self.templates.get(document_class)
        if custom:
            return custom if custom.lower().endswith(".docx") else f"{custom}.docx"
        return f"Template - {CLASS_TITLES.get(document_class, document_class)}.docx"


def load_library_config(path: str | None = None) -> LibraryConfig:
    """Read the library location from the seat's live customer.yaml. Missing
    file, missing block, or an unparseable file all mean "not authored"; the
    reason is carried in ``source`` for the report."""
    path = path or os.environ.get(CUSTOMER_YAML_ENV) or DEFAULT_CUSTOMER_YAML
    try:
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
    except OSError as exc:
        return LibraryConfig(authored=False, source=f"customer.yaml not readable at {path}: {exc.__class__.__name__}")
    try:
        import yaml

        data = yaml.safe_load(raw) or {}
    except Exception as exc:  # noqa: BLE001 - an unparseable config is "not authored", reported
        return LibraryConfig(authored=False, source=f"customer.yaml not parseable: {exc.__class__.__name__}")
    block = ((data.get("self_initiation") or {}).get("document_library")) if isinstance(data, dict) else None
    if not isinstance(block, dict):
        return LibraryConfig(authored=False, source="self_initiation.document_library not authored")
    templates = block.get("templates") or {}
    if not isinstance(templates, dict):
        templates = {}
    number = block.get("matter_number")
    return LibraryConfig(
        authored=bool(number) and bool(block.get("folder_name")),
        matter_number=str(number).strip() if number else None,
        folder_name=str(block.get("folder_name")).strip() if block.get("folder_name") else None,
        templates={str(k): str(v) for k, v in templates.items()},
        source=path,
    )


@dataclass(frozen=True)
class ResolvedTemplate:
    bytes: bytes
    name: str
    file_id: str
    matter_id: str
    folder_id: str | None


@dataclass(frozen=True)
class NotResolved:
    reason: str
    matter_id: str | None = None
    folder_id: str | None = None


def _listing(resp: Any) -> list[dict[str, Any]]:
    if isinstance(resp, list):
        return [e for e in resp if isinstance(e, dict)]
    if isinstance(resp, dict):
        for key in ("value", "items", "results", "data"):
            if isinstance(resp.get(key), list):
                return [e for e in resp[key] if isinstance(e, dict)]
    return []


def _norm(s: Any) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip().casefold()


def find_matter_id(client: Any, matter_number: str) -> str | None:
    """Exact match on the matter ``number`` field. Search first (cheap), then
    page the listing; the number is the stable human-legible key a firm
    authors, never an internal id."""
    want = _norm(matter_number)
    try:
        resp = client.get("/matters", Search=matter_number, Limit=50, Offset=0)
        for m in _listing(resp):
            if _norm(m.get("number")) == want:
                return str(m.get("id"))
    except Exception:  # noqa: BLE001 - fall through to paging
        pass
    offset = 0
    while True:
        try:
            resp = client.get("/matters", Limit=500, Offset=offset)
        except Exception:  # noqa: BLE001
            return None
        items = _listing(resp)
        for m in items:
            if _norm(m.get("number")) == want:
                return str(m.get("id"))
        if len(items) < 500:
            return None
        offset += 500


def find_folder_id(client: Any, matter_id: str, folder_name: str) -> str | None:
    try:
        resp = client.get(f"/matters/{matter_id}/documents/folders", Limit=500, Offset=0)
    except Exception:  # noqa: BLE001
        return None
    want = _norm(folder_name)
    for f in _listing(resp):
        if _norm(f.get("name")) == want:
            return str(f.get("id"))
    return None


def list_matter_files(client: Any, matter_id: str) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    offset = 0
    while True:
        try:
            resp = client.get(f"/matters/{matter_id}/documents/files", Limit=500, Offset=offset)
        except Exception:  # noqa: BLE001
            break
        items = _listing(resp)
        files.extend(items)
        if len(items) < 500:
            break
        offset += 500
    return files


def _entry_folder_id(entry: dict[str, Any]) -> str | None:
    """The folder a file entry sits in. Observed live on the pilot tenant
    (2026-08-19, vfy_01M0DTM2EGQZP9FZTM53S17CJ7): a file inside a folder
    carries ``folder: {id, href}`` and a root file carries no ``folder`` key at
    all; ``folderId`` never appears. Both spellings are read so the resolver
    survives either shape; the matter-level ``/documents/files`` listing does
    include files inside folders."""
    folder = entry.get("folder")
    if isinstance(folder, dict) and folder.get("id"):
        return str(folder["id"])
    for key in ("folderId", "folder_id", "parentFolderId"):
        if entry.get(key):
            return str(entry[key])
    return None


def resolve_template(client: Any, cfg: LibraryConfig, document_class: str) -> ResolvedTemplate | NotResolved:
    """The one class template, or the reason there is none. Never raises on a
    missing piece; a transport error downloading a FOUND template does raise,
    because silently rendering on the starter when the firm's file exists would
    misreport the format."""
    if not cfg.authored:
        return NotResolved(f"document library location not authored ({cfg.source or 'self_initiation.document_library'})")
    matter_id = find_matter_id(client, cfg.matter_number or "")
    if not matter_id:
        return NotResolved(f"library matter {cfg.matter_number!r} not found")
    folder_id = find_folder_id(client, matter_id, cfg.folder_name or "")
    want = _norm(cfg.template_name(document_class))
    candidates = [e for e in list_matter_files(client, matter_id) if _norm(e.get("name")) == want]
    if folder_id:
        in_folder = [e for e in candidates if _entry_folder_id(e) == folder_id]
        if in_folder:
            candidates = in_folder
    if not candidates:
        where = f"folder {cfg.folder_name!r}" if folder_id else f"matter {cfg.matter_number!r} (folder {cfg.folder_name!r} not found)"
        return NotResolved(f"no file named {cfg.template_name(document_class)!r} in {where}", matter_id=matter_id, folder_id=folder_id)
    # Newest wins when a firm re-uploads under the same name.
    candidates.sort(key=lambda e: str(e.get("dateCreated") or e.get("createdDate") or ""), reverse=True)
    chosen = candidates[0]
    file_id = str(chosen.get("id") or chosen.get("fileId"))
    _meta, blob = client.download_file(matter_id, file_id)
    return ResolvedTemplate(bytes=blob, name=str(chosen.get("name")), file_id=file_id, matter_id=matter_id, folder_id=folder_id)


def is_library_file(entry: dict[str, Any], cfg: LibraryConfig, library_folder_id: str | None) -> bool:
    """Templates are not record: a library file must never be a record-check
    source (a header-only letterhead extracts to nothing and would refuse the
    whole draft). Match by the class-template naming convention, and by folder
    when the listing carries a folder id and the library folder is known."""
    name = _norm(entry.get("name"))
    if any(name == _norm(cfg.template_name(cls)) for cls in CLASS_TITLES):
        return True
    if name.startswith("template - ") and name.endswith(".docx"):
        return True
    folder = _entry_folder_id(entry)
    return bool(library_folder_id and folder and folder == library_folder_id)


__all__ = [
    "CLASS_TITLES",
    "CUSTOMER_YAML_ENV",
    "DEFAULT_CUSTOMER_YAML",
    "LibraryConfig",
    "NotResolved",
    "ResolvedTemplate",
    "find_folder_id",
    "find_matter_id",
    "is_library_file",
    "list_matter_files",
    "load_library_config",
    "resolve_template",
]
