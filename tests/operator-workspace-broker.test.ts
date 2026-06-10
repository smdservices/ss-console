import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const dockerfile = readFileSync(resolve('operator/templates/Dockerfile'), 'utf8')
const entrypoint = readFileSync(resolve('operator/templates/entrypoint.sh'), 'utf8')
const bootstrap = readFileSync(resolve('operator/templates/bootstrap.sh'), 'utf8')
const workspaceSkill = readFileSync(resolve('operator/skills/workspace/SKILL.md'), 'utf8')

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
    expect(entrypoint).toContain('rm -f "${BROKER_DIR}/google.json"')
    expect(entrypoint).toContain('chmod 0700 "${BROKER_DIR}"')
    expect(entrypoint).toContain('chown workspace-broker:workspace-broker "${BROKER_DIR}"')
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
})
