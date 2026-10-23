/**
 * A Postman ENVIRONMENT export — `{{variables}}` and nothing else.
 *
 * This file has no requests in it, by definition, and that is exactly why it did not work: the
 * chain claimed a source only when an importer returned REQUESTS, so a Postman environment fell
 * past every importer and came back "format not recognised". Measured. The contract carries
 * environments now (see `ImportedEnvironment`), so a source that is only variables is a real
 * import.
 *
 * It completes the Postman story rather than adding a format. The collection importer already
 * hands back requests full of `{{base_url}}` — Postman's variable syntax is ours verbatim, no
 * translation — and then had nothing to render them against, because the values live in a separate
 * file people export separately. This is that file.
 */

import type { EnvironmentVariable } from '../collection/environments'
import type { ImportedEnvironment, ImportedRequest, Importer } from './types'

/**
 * Postman's own marker. `environment` is one you pick in the corner; `globals` is the workspace-wide
 * set — both are name/value pairs to us, and both are worth importing.
 */
const SCOPES = ['environment', 'globals']

interface PostmanEnvValue {
  key?: string
  value?: unknown
  enabled?: boolean
  /** `secret` marks a masked value in Postman's UI. */
  type?: string
}

interface PostmanEnvDocument {
  name?: string
  values?: PostmanEnvValue[]
  _postman_variable_scope?: string
}

function parse(text: string): PostmanEnvDocument | null {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return null
  }
  if (!doc || typeof doc !== 'object') return null
  const env = doc as PostmanEnvDocument
  if (typeof env._postman_variable_scope !== 'string') return null
  if (!SCOPES.includes(env._postman_variable_scope)) return null
  if (!Array.isArray(env.values)) return null
  return env
}

/**
 * The values, as our pairs.
 *
 * A DISABLED value is kept, switched off: our environments hold `disabled` as saved-but-inactive,
 * so dropping it would silently delete something the person can see in Postman and would then have
 * to retype. Our code stores values; it does not compute a wire format.
 */
export function environmentValues(values: readonly PostmanEnvValue[]): EnvironmentVariable[] {
  const out: EnvironmentVariable[] = []
  for (const variable of values) {
    if (typeof variable.key !== 'string' || variable.key.trim() === '') continue
    out.push({
      name: variable.key,
      value:
        typeof variable.value === 'string'
          ? variable.value
          : typeof variable.value === 'number' || typeof variable.value === 'boolean'
            ? String(variable.value)
            : '',
      ...(variable.enabled === false ? { disabled: true } : {}),
      ...(variable.type === 'secret' ? { secret: true } : {}),
    })
  }
  return out
}

export function convertPostmanEnv(text: string): ImportedRequest[] | null {
  // Not null — CLAIMED, with nothing in it. Returning null would hand the text to the next
  // importer, and there is no other reader for this file.
  return parse(text) ? [] : null
}

export function postmanEnvironments(text: string): ImportedEnvironment[] {
  const doc = parse(text)
  if (!doc) return []
  const variables = environmentValues(doc.values ?? [])
  if (variables.length === 0) return []
  return [{ name: doc.name?.trim() || 'postman', variables }]
}

/** Explain how Postman's secret metadata maps onto the native vault. */
export function postmanEnvNotes(text: string): string[] {
  const doc = parse(text)
  if (!doc) return []
  const secrets = (doc.values ?? []).filter((v) => v.type === 'secret' && v.key)
  if (secrets.length === 0) return []
  return [
    `Postman marked ${secrets.map((v) => `\`${v.key}\``).join(', ')} as SECRET. Those variables are ` +
      'kept as secret rows backed by the native Vault. Postman exports commonly omit their values; ' +
      'pick or enter each missing value before sending.',
  ]
}

export const postmanEnvImporter: Importer = {
  id: 'postman-env',
  name: 'Postman environment',
  convert: convertPostmanEnv,
  environments: postmanEnvironments,
  notes: postmanEnvNotes,
}
