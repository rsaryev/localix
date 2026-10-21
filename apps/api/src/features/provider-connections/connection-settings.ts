/**
 * A CONNECTION'S SETTINGS: what it names besides its key — the cloud region, resource or project
 * its requests go to (`AWS_REGION`, `AZURE_RESOURCE_NAME`, `GOOGLE_VERTEX_PROJECT`). They are
 * stored with each key's credential (`env`), where the engine reads them, and shown back in the
 * connection's settings, so they carry no secret: a name that reads like one is refused.
 */
import { isSecretSettingName } from '@localixai/agent/catalog'
import type { RuntimeApiKeyCredential } from '@localixai/agent/runtime'

import { ApiError } from '../../lib/errors'

const NAME = /^[A-Z][A-Z0-9_]{0,63}$/

/**
 * The settings to store: trimmed, the empty ones left out; undefined when none remain. A name that
 * reads like a secret is refused, and so is one the provider never asks for when `allowed` (the
 * catalog's settings for the provider) is given.
 */
export function cleanSettings(
  input: Readonly<Record<string, string>> | undefined,
  allowed?: readonly string[],
): Record<string, string> | undefined {
  if (!input) return undefined
  const settings: Record<string, string> = {}
  for (const [name, raw] of Object.entries(input)) {
    if (!NAME.test(name) || isSecretSettingName(name)) {
      throw new ApiError(
        400,
        'provider_connection_bad_setting',
        `"${name}" cannot be a connection setting; secrets belong in the key`,
      )
    }
    if (allowed && !allowed.includes(name)) {
      throw new ApiError(
        400,
        'provider_connection_bad_setting',
        `"${name}" is not a setting this provider uses`,
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

/**
 * The settings a provider takes, as the catalog lists them: a listed provider without settings
 * takes none (`[]`), an unlisted one is not checked by name (`undefined`).
 */
export function catalogSettingNames(catalog: {
  getFullCatalog(): Promise<{
    providers: readonly { id: string; settings?: readonly { name: string }[] }[]
  }>
}): (providerId: string) => Promise<string[] | undefined> {
  return async (providerId) => {
    const { providers } = await catalog.getFullCatalog()
    const provider = providers.find((entry) => entry.id === providerId)
    return provider && (provider.settings ?? []).map((setting) => setting.name)
  }
}
