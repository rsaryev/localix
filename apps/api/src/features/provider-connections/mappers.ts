import { isSecretSettingName } from '@localixai/agent/catalog'
import type { ProviderConnection, ProviderConnectionKey } from './contracts'
import type { ProviderConnectionKeyRecord, ProviderConnectionRecord } from './repository'

/**
 * The settings a DTO may show: every one whose name does not read like a secret. `cleanSettings`
 * refuses such a name, but a value stored by an older build must still never be shown back.
 */
const shownSettings = (
  settings: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined => {
  if (!settings) return undefined
  const shown = Object.fromEntries(
    Object.entries(settings).filter(([name]) => !isSecretSettingName(name)),
  )
  return Object.keys(shown).length > 0 ? shown : undefined
}

export const maskKey = (apiKey: string): string => {
  const tail = apiKey.slice(-4)
  return tail ? `…${tail}` : '…'
}

export const toKeyDto = (record: ProviderConnectionKeyRecord): ProviderConnectionKey => ({
  id: record.id,
  label: record.label,
  maskedKey: maskKey(record.apiKey),
  priority: record.priority,
  enabled: record.enabled,
})

export const toDto = (record: ProviderConnectionRecord): ProviderConnection => {
  const keys = record.keys.map((k) => toKeyDto(k))
  const settings = shownSettings(record.keys[0]?.settings)
  return {
    id: record.id,
    providerId: record.providerId,
    providerName: record.providerName,
    label: record.label,
    authType: record.authType,
    hasApiKey: keys.length > 0,
    keyCount: keys.length,
    keys,
    ...(settings ? { settings } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
