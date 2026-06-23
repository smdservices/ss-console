"""Entrypoint: serve the reference connector over stdio (the transport Hermes
launches author-built connectors with). Installed as the ``reference-mcp``
console-script."""

from __future__ import annotations

from .server import server


def main() -> None:
    server.run_stdio()


if __name__ == "__main__":
    main()
