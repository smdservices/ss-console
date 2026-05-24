# ai-employee-ms-graph

Microsoft Graph adapter for SMD's AI Employee. Implements three capability interfaces from `docs/specs/ai-employee/capability-contracts.md`:

| Capability        | Adapter class     | Graph surface                                                |
| ----------------- | ----------------- | ------------------------------------------------------------ |
| `Email`           | `MSGraphMailbox`  | `/me/messages` + `/me/mailFolders` (read + draft)            |
| `Calendar`        | `MSGraphCalendar` | `/me/calendarView`, `/me/events`, `/me/calendar/getSchedule` |
| `DocumentStorage` | `MSGraphDrive`    | `/me/drive` (read) + `/me/drive/special/approot` (write)     |

## Phase 1 scope

Read + draft only. **No `Mail.Send`.** Programmatic send is wave-2 stream [#881](https://github.com/venturecrane/ss-console/issues/881) under a separate delegated scope and a distinct adapter method. The `MSGraphOAuth` constructor refuses to ship with `Mail.Send` in its scope list — defense-in-depth against accidental drift.

Delegated scopes requested at consent time (see `oauth.PHASE_1_SCOPES`):

- `offline_access` — required for a refresh token
- `User.Read`
- `Mail.Read`, `Mail.ReadWrite`, `MailboxSettings.Read`
- `Calendars.ReadWrite`
- `Files.Read`, `Files.ReadWrite.AppFolder`

Write into OneDrive is confined to the agent's AppFolder (Microsoft provisions `/Apps/SMD Services AI Employee/` on the customer's drive). Drive-wide write would require `Files.ReadWrite` which is intentionally out of Phase 1.

## Token storage

Per [ADR 0010](../../../docs/adr/0010-per-customer-oauth-token-storage.md), tokens live on the per-customer Fly volume at `/opt/data/oauth/microsoft.json`. Never in Infisical. The `TokenStore` class enforces atomic writes (tempfile + rename) and `0600` mode.

```text
/opt/data/oauth/microsoft.json   chmod 0600, owned by uid 10000 (hermes)
```

JSON shape on disk matches [ADR 0010 §Storage shape](../../../docs/adr/0010-per-customer-oauth-token-storage.md):

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "scopes": ["Mail.Read", "Calendars.ReadWrite", "..."],
  "expires_at": "2026-05-23T12:34:56.000Z",
  "obtained_at": "2026-05-23T11:34:56.000Z",
  "provider": "microsoft",
  "token_type": "Bearer"
}
```

## Refresh policy

10-minute safety margin per [oauth-lifecycle.md](../../../docs/specs/ai-employee/oauth-lifecycle.md). Refresh happens transparently inside `MSGraphOAuth.get_valid_tokens()`. `invalid_grant` upstream is mapped to `AdapterError(code="auth_expired", ...)` which the runtime uses to drive the re-consent flow (see `bin/reauth-connector.sh`).

## customer.yaml binding

```yaml
connectors:
  Email:
    adapter: microsoft-graph
    backend: build:ms-graph
    scopes:
      - https://graph.microsoft.com/Mail.Read
      - https://graph.microsoft.com/Mail.ReadWrite
      - https://graph.microsoft.com/MailboxSettings.Read
  Calendar:
    adapter: microsoft-graph
    backend: build:ms-graph
    scopes:
      - https://graph.microsoft.com/Calendars.ReadWrite
  DocumentStorage:
    adapter: microsoft-graph
    backend: build:ms-graph
    scopes:
      - https://graph.microsoft.com/Files.Read
      - https://graph.microsoft.com/Files.ReadWrite.AppFolder
```

No token reference — token storage is per-Machine, not per-customer.yaml.

## Setup

See [docs/runbooks/ai-employee/ms-graph-azure-ad-setup.md](../../../docs/runbooks/ai-employee/ms-graph-azure-ad-setup.md) for the Azure AD app registration steps (one-time, by Captain) and per-customer consent via `bin/reauth-connector.sh`.

## Tests

```bash
cd ai-employee/connectors/ms_graph
pip install -e .[dev]
pytest
```

The suite covers the lifecycle spec's verification list: storage round-trip, refresh on expiry, invalid_grant → auth_expired, file mode 0600, scope-set integrity, no Mail.Send leakage.
