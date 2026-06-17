import { type Scope, type ValidationError } from './types'
import { isPlainObject, optionalStringList, requireStringList } from './helpers'

export function checkScope(root: Record<string, unknown>, errors: ValidationError[]): Scope {
  const raw = root['scope']
  if (raw === undefined || raw === null) {
    errors.push({ code: 'MissingField', path: 'scope', message: 'scope is required' })
    return emptyScope()
  }
  if (!isPlainObject(raw)) {
    errors.push({ code: 'TypeMismatch', path: 'scope', message: 'scope must be an object' })
    return emptyScope()
  }
  return {
    email_folders_visible: requireStringList(
      raw,
      'email_folders_visible',
      'scope.email_folders_visible',
      errors
    ),
    email_folders_blind: requireStringList(
      raw,
      'email_folders_blind',
      'scope.email_folders_blind',
      errors
    ),
    email_keyword_blocks: requireStringList(
      raw,
      'email_keyword_blocks',
      'scope.email_keyword_blocks',
      errors
    ),
    domain_blocks: requireStringList(raw, 'domain_blocks', 'scope.domain_blocks', errors),
    matter_blocks: optionalStringList(raw, 'matter_blocks', 'scope.matter_blocks', errors),
    inbound_allow_from: optionalStringList(
      raw,
      'inbound_allow_from',
      'scope.inbound_allow_from',
      errors
    ),
  }
}

function emptyScope(): Scope {
  return {
    email_folders_visible: [],
    email_folders_blind: [],
    email_keyword_blocks: [],
    domain_blocks: [],
    matter_blocks: [],
    inbound_allow_from: [],
  }
}
