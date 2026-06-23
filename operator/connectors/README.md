# Author-built MCP connectors

When the Operator must connect to a system that has **no acceptable vendor or
community MCP server**, we author one. This directory is where those connectors
live. See **ADR 0053** for the doctrine.

A connector here is a **Python stdio MCP server** that is baked into the shared
Operator image, registered once in the overlay
(`hermes-smd-overlay` `MCP_CONNECTOR_REGISTRY`), and **activated per-customer**
only when a `customer.yaml` binds it (`backend: mcp:<name>`). A connector that no
customer binds is inert — it is never launched, surfaces no tools, and receives
no secrets, exactly like a skill in the catalog that no persona enables. There is
no separate repo, release pipeline, or runtime fetch.

## Layout

```
_sdk/         the shared contract every connector is built on (NOT published):
              ConnectorServer (non-empty inputSchema), the manifest schema, and
              the conformance harness with the runtime-name oracle.
_reference/   a SYNTHETIC self-test connector (echo / record / surprise). It is
              not a vendor integration — it proves every rail of the platform,
              including fail-closed refusal of an unclassified tool.
```

## Adding a connector (the declarative contract)

1. **Write the package** under `connectors/<name>/` — a stdio MCP server built on
   `ConnectorServer`, exposing a `<name>-mcp` console-script
   (`[project.scripts]` in its `pyproject.toml`).
2. **Ship a `manifest.toml`** — capability, required-secret _names_, `auth_model`,
   static launch env, and `tool_classes` (the conformance **oracle**, keyed by
   bare tool name).
3. **Add a conformance test** under `connectors/<name>/tests/` that runs
   `operator_connector_sdk.conformance` against the server.
4. **Register it** in the overlay: one `McpConnectorSpec` (with the absolute venv
   `command` and `auth_model`) **and** the `mcp_<server>_<tool>: ActionClass`
   literal lines in `shared/action_classes.py`. The literal map is the enforced
   authority; the manifest is checked _against_ it. This is the deliberate
   two-repo review gate for any tool that can take an action.
5. **Bind it** in a `customer.yaml` (`backend: mcp:<name>`).

The image install (one isolated venv per connector), the secret staging, and the
fail-closed governance are built once and apply to every connector — adding #N is
declarative, not bespoke wiring.

## What the platform generalizes — and does not

The connector **lifecycle** (author → install → activate → govern → verify) is
general. The tool **vocabulary** is not — skills stay connector-native by design.
