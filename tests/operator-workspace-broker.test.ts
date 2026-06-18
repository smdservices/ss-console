import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const dockerfile = readFileSync(resolve('operator/templates/Dockerfile'), 'utf8')
const entrypoint = readFileSync(resolve('operator/templates/entrypoint.sh'), 'utf8')
const bootstrap = readFileSync(resolve('operator/templates/bootstrap.sh'), 'utf8')
const workspaceSkill = readFileSync(resolve('operator/skills/workspace/SKILL.md'), 'utf8')
const inboxTriageSkill = readFileSync(resolve('operator/skills/inbox-triage/SKILL.md'), 'utf8')
const emailReplySkill = readFileSync(resolve('operator/skills/email-reply/SKILL.md'), 'utf8')
const healthMonitorSkill = readFileSync(resolve('operator/skills/health-monitor/SKILL.md'), 'utf8')
const smdCustomerConfig = readFileSync(resolve('operator/customers/smd/customer.yaml'), 'utf8')

describe('ADR 0045 Workspace capability broker', () => {
  it('runs broker and gateway under distinct non-root principals', () => {
    expect(dockerfile).toContain('useradd -u 10000 -m -d /opt/data hermes')
    expect(dockerfile).toContain('useradd -u 10001 -r -m -d /opt/workspace-broker workspace-broker')
    expect(entrypoint).toContain('--reuid=workspace-broker')
    expect(entrypoint).toContain('--reuid=hermes')
    expect(entrypoint).toContain('--no-new-privs')
    expect(entrypoint).toContain('/usr/bin/env -i')
    expect(entrypoint).toContain('PYTHONPATH="/opt/workspace-broker"')
    expect(dockerfile).not.toMatch(/\bsudo\b/)
  })

  it('keeps broker code root-owned and credentials broker-only', () => {
    expect(dockerfile).toContain('chown -R root:root /opt/workspace-broker')
    expect(entrypoint).toContain('chown -R hermes:hermes /opt/data')
    expect(entrypoint).toContain('BROKER_DIR="/var/lib/smd-workspace-broker"')
    expect(entrypoint).not.toContain('BROKER_DIR="/opt/data/workspace-broker"')
    expect(entrypoint).toContain('rm -rf /opt/data/workspace-broker')
    expect(entrypoint).toContain('rm -f /opt/data/oauth/google.json')
    expect(entrypoint).toContain('rm -f "${BROKER_DIR}/google.json"')
    // Keystone (#1407): the broker's customer.yaml is now copied from the
    // root-owned LIVE_CUSTOMER_YAML (R2 source of truth), not the agent-writable
    // /opt/data — that relocation IS the self-loopback fix.
    expect(entrypoint).toContain('cp "${LIVE_CUSTOMER_YAML}" "${BROKER_CUSTOMER_PATH}"')
    expect(entrypoint).toContain('chmod 0700 "${BROKER_DIR}"')
    expect(entrypoint).toContain('chown -R workspace-broker:workspace-broker "${BROKER_DIR}"')
    expect(entrypoint).toContain(
      'chown workspace-broker:workspace-broker "${SMD_WORKSPACE_CREDENTIAL_PATH}"'
    )
    expect(entrypoint).toContain('chmod 0600 "${SMD_WORKSPACE_CREDENTIAL_PATH}"')
    expect(entrypoint).toContain(
      'materialize_credential(Path(os.environ["SMD_WORKSPACE_CREDENTIAL_PATH"]))'
    )
    expect(entrypoint.indexOf('chown -R hermes:hermes /opt/data')).toBeLessThan(
      entrypoint.indexOf('chown -R workspace-broker:workspace-broker "${BROKER_DIR}"')
    )
  })

  it('runs the gateway with a writable non-root home', () => {
    expect(entrypoint).toContain('export HOME=/opt/data')
    expect(entrypoint.indexOf('export HOME=/opt/data')).toBeLessThan(
      entrypoint.lastIndexOf('exec setpriv')
    )
    expect(entrypoint).not.toContain('HERMES_HOME_MODE')
  })

  it('strips every Google credential from the gateway environment', () => {
    expect(entrypoint).toContain(
      'unset GOOGLE_SERVICE_ACCOUNT_JSON GOOGLE_TOKEN_JSON GOOGLE_CLIENT_SECRET_JSON'
    )
    expect(entrypoint).toContain(
      'unset GOOGLE_IMPERSONATE_SUBJECT GOOGLE_OAUTH_SCOPES GOOGLE_TOKEN_PATH'
    )
    expect(bootstrap).not.toContain('GOOGLE_TOKEN_FILE="/opt/data/oauth/google.json"')
  })

  it('does not pass Google credentials into the broker child environment', () => {
    const brokerChild = entrypoint.slice(entrypoint.indexOf('setpriv'))
    expect(brokerChild).not.toContain('GOOGLE_SERVICE_ACCOUNT_JSON=')
    expect(brokerChild).not.toContain('GOOGLE_TOKEN_JSON=')
  })

  it('does not install Google provider libraries into the Hermes venv', () => {
    expect(dockerfile).not.toMatch(
      /uv pip install --no-cache-dir google-api-python-client google-auth/
    )
    expect(dockerfile).toContain('uv pip install --python /opt/workspace-broker/.venv/bin/python')
  })

  it('migrates the Workspace skill away from direct credential paths', () => {
    expect(workspaceSkill).toContain('workspace_docs_create')
    expect(workspaceSkill).not.toContain('/opt/data/oauth/google.json')
    expect(workspaceSkill).not.toContain('/app/connectors/google/')
  })

  it('keeps Wave A Gmail skills on read and draft tools only', () => {
    expect(inboxTriageSkill).toContain('workspace_gmail_search')
    expect(inboxTriageSkill).toContain('workspace_gmail_create_draft')
    expect(emailReplySkill).toContain('workspace_gmail_create_draft')
    expect(inboxTriageSkill).not.toContain('workspace_gmail_send')
    expect(emailReplySkill).not.toContain('workspace_gmail_send')
    expect(inboxTriageSkill).not.toContain('send_message')
    expect(smdCustomerConfig).not.toContain('workspace_gmail_send')
    expect(smdCustomerConfig).not.toContain('receive an autonomous reply')
  })

  it('does not present send_message as an email channel', () => {
    expect(healthMonitorSkill).toContain('not classified and verified')
    expect(healthMonitorSkill).not.toContain('use `send_message`')
  })
})
