#!/usr/bin/env python3
"""Boot-smoke probe: author-built connector classification agreement (ADR 0053).

Run at boot with the Hermes venv python (the overlay is pip-installed there, so
``shared.action_classes`` is importable) and the connector catalog baked into the
image at /app/connectors. For every author-built connector manifest, assert that
each tool it declares in ``tool_classes`` resolves — under its RUNTIME-prefixed
name ``mcp_<server>_<tool>`` — to the SAME ActionClass in the overlay's enforced
``classify_tool()``.

This is the manifest<=map agreement check run where BOTH artifacts are present:
the baked manifest.toml (ss-console) and the installed overlay map
(hermes-smd-overlay). It cannot run in either repo's unit CI alone (each checks
out one repo); here on the Machine it closes the cross-repo gap.

What it catches: a connector whose manifest says echo=read while the overlay map
says internal_write (or REFUSED because the OVERLAY_REF was not bumped to classify
it). A drift fails the boot — the agent does not start with a connector whose
governance the two sides disagree on.

What it does NOT assert: tools deliberately omitted from ``tool_classes`` (e.g.
the reference connector's ``surprise``). Those are proven REFUSED by the overlay's
fail-closed default and the post-deploy live check, not here — asserting a
declared class for them would defeat the fail-closed proof.

Exit 0 = all declared classes agree (or nothing to check). Exit 1 = drift.
"""

from __future__ import annotations

import pathlib
import sys
import tomllib

from shared.action_classes import classify_tool

CONNECTORS_DIR = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/app/connectors")


def main() -> int:
    failures: list[str] = []
    checked = 0
    connectors = 0

    for manifest_path in sorted(CONNECTORS_DIR.glob("*/manifest.toml")):
        try:
            data = tomllib.loads(manifest_path.read_text())
        except (OSError, tomllib.TOMLDecodeError) as exc:
            failures.append(f"{manifest_path}: unreadable manifest ({exc})")
            continue
        conn = data.get("connector", data)
        server = conn.get("name")
        tool_classes = conn.get("tool_classes") or {}
        if not server or not tool_classes:
            continue
        connectors += 1
        prefix = f"mcp_{str(server).replace('-', '_')}_"
        for tool, declared in tool_classes.items():
            runtime_name = f"{prefix}{tool}"
            verdict = classify_tool(runtime_name)
            actual = verdict.action_class.value
            checked += 1
            if actual != declared:
                failures.append(
                    f"{runtime_name}: manifest declares {declared!r} but the overlay "
                    f"map resolves {actual!r} (unmapped={verdict.unmapped}). "
                    f"Bump OVERLAY_REF to a build that classifies it, or fix the "
                    f"manifest/map disagreement."
                )

    if failures:
        print("connector-classification-probe: DRIFT", file=sys.stderr)
        for line in failures:
            print(f"  {line}", file=sys.stderr)
        return 1

    print(
        f"connector-classification-probe: OK "
        f"({checked} declared tool(s) across {connectors} author-built connector(s) "
        f"agree with the overlay map)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
