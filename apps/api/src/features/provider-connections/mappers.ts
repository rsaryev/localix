import type { ProviderConnection, ProviderConnectionKey } from './contracts'
import type { ProviderConnectionKeyRecord, ProviderConnectionRecord } from './repository'

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
  return {
    id: record.id,
    providerId: record.providerId,
    providerName: record.providerName,
    label: record.label,
    authType: record.authType,
    hasApiKey: keys.length > 0,
    keyCount: keys.length,
    keys,
    ...(record.keys[0]?.settings ? { settings: { ...record.keys[0].settings } } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
