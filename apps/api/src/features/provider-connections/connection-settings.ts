/**
 * A CONNECTION'S SETTINGS: what it names besides its key — the cloud region, resource or project
 * its requests go to (`AWS_REGION`, `AZURE_RESOURCE_NAME`, `GOOGLE_VERTEX_PROJECT`). They are
 * stored with each key's credential (`env`), where the engine reads them, and shown back in the
 * connection's settings, so they carry no secret: a name that reads like one is refused.
 */
import type { RuntimeApiKeyCredential } from '@localixai/agent/runtime'

import { ApiError } from '../../lib/errors'

const NAME = /^[A-Z][A-Z0-9_]{0,63}$/
const SECRET = /KEY|SECRET|TOKEN|CREDENTIALS|PASSWORD/i

/** The settings to store: trimmed, the empty ones left out; undefined when none remain. */
export function cleanSettings(
  input: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  if (!input) return undefined
  const settings: Record<string, string> = {}
  for (const [name, raw] of Object.entries(input)) {
    if (!NAME.test(name) || SECRET.test(name)) {
      throw new ApiError(
        400,
        'provider_connection_bad_setting',
        `"${name}" cannot be a connection setting; secrets belong in the key`,
      )
    }
    const value = raw.trim()
    if (value) settings[name] = value
  }
  return Object.keys(settings).length > 0 ? settings : undefined
}

/** An API-key credential carrying its connection's settings, when it has any. */
export function apiKeyCredential(
  key: string,
  settings: Readonly<Record<string, string>> | undefined,
): RuntimeApiKeyCredential {
  return { type: 'api-key', key, ...(settings ? { env: { ...settings } } : {}) }
}
