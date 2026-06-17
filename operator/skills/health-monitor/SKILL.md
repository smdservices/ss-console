---
name: health-monitor
description: Fleet health check — polls the console health endpoint and emails Captain on degraded status.
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux]
prerequisites:
  skills: []
  commands: []
metadata:
  hermes:
    tags: [Health, Monitoring, SMD, Customer-Zero, Cron]
  smd:
    customer: smd
    trust_ceiling: autonomous
---

# SMD Fleet Health Monitor

## When to Use

Runs on a 30-minute cron. Calls the console-side fleet-health endpoint, evaluates each Machine's status, and emails Captain when any Machine is degraded. Applies a 2-hour per-slug suppression window to avoid repeat pages.

**Requires** `code_execution: autonomous` (already authored for SMD customer-zero) and the `OPERATOR_HEALTH_READ_KEY` Fly secret.

## Alert Conditions

Alert (send email) when any entry has:

- `heartbeat_status: red` — Machine is not checking in
- `summary_status: red` — Operational rollup is red
- `open_alerts > 0` — Active open alerts on the runtime summary

Yellow is noted in the run log only — no email.

## Step 1 — Fetch fleet health

Use `execute_code` to call the health endpoint. The `OPERATOR_HEALTH_READ_KEY` env var is the bearer secret.

```python
import json, os, urllib.request

key = os.environ.get('OPERATOR_HEALTH_READ_KEY', '')
if not key:
    raise RuntimeError('OPERATOR_HEALTH_READ_KEY not set')

req = urllib.request.Request(
    'https://smd.services/api/admin/fleet/health',
    headers={'Authorization': f'Bearer {key}', 'Accept': 'application/json'},
)
with urllib.request.urlopen(req, timeout=15) as resp:
    data = json.loads(resp.read())

print(json.dumps(data))
```

If the request fails (network error, non-200), treat it as a system alert: the console itself is unreachable. Email Captain immediately with the error text. Do NOT apply suppression to endpoint-unreachable failures.

## Step 2 — Load suppression state

Use `execute_code` to read per-slug alert timestamps from the suppression file. Missing file = empty state.

```python
import json, os

path = '/opt/data/health_monitor_suppression.json'
if os.path.exists(path):
    with open(path) as f:
        state = json.load(f)
else:
    state = {}
print(json.dumps(state))
```

## Step 3 — Evaluate entries

For each entry in the health response, determine if it is degraded and unsuppressed:

1. **Degraded?** `heartbeat_status == 'red'` OR `summary_status == 'red'` OR `open_alerts > 0`
2. **Suppressed?** The slug has a suppression timestamp less than 2 hours ago (compare against current UTC).

Build two lists: `to_alert` (degraded + unsuppressed) and `yellow_slugs` (yellow status, for log only).

## Step 4 — Send alert email

If `to_alert` is non-empty, use `send_message` to send one email:

- **To:** `smdurgan@venturecrane.com`
- **Subject:** `[Operator Alert] Fleet degraded — <comma-separated slugs>`
- **Body:** Plain text. One line per degraded slug:

  ```
  <slug>: heartbeat=<status>, summary=<status or none>, open_alerts=<n>, last_heartbeat=<ts or never>
  ```

  Blank line, then: `Checked at: <generated_at from response>`

Do not send an email when `to_alert` is empty.

The `OPERATOR_HEALTH_READ_KEY` value must never appear in any email body, log line, or memory entry.

## Step 5 — Update suppression state

Use `execute_code` to write the updated suppression file. For each slug in `to_alert`, set `state[slug]` to the current UTC ISO 8601 timestamp.

```python
import json, datetime

# state = previously loaded dict, updated with alerted slugs
with open('/opt/data/health_monitor_suppression.json', 'w') as f:
    json.dump(state, f)
```

## Step 6 — Log run outcome

Output one line:

- Alerts sent: `health-monitor: alerted <n> slug(s): <list> at <ts>`
- All green: `health-monitor: all green at <ts>`
- Yellow only: `health-monitor: <n> yellow (no alert) at <ts>`

## Restrictions

- Only read/write `/opt/data/health_monitor_suppression.json` and the fleet-health endpoint.
- Maximum one alert email per slug per 2-hour window (enforced by suppression state).
- `OPERATOR_HEALTH_READ_KEY` must never appear in any output.
