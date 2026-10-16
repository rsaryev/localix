import { describe, expect, test } from 'bun:test'
import { maskKey, toKeyDto, toDto } from './mappers'
import type { ProviderConnectionKeyRecord, ProviderConnectionRecord } from './repository'

const key = (o: Partial<ProviderConnectionKeyRecord> = {}): ProviderConnectionKeyRecord =>
  ({
    id: 'k1',
    label: 'L',
    apiKey: 'sk-abcdef1234',
    priority: 0,
    enabled: true,
    authType: 'api-key',
    createdAt: '2026-01-01',
    ...o,
  }) as ProviderConnectionKeyRecord

const conn = (keys: ProviderConnectionKeyRecord[]): ProviderConnectionRecord =>
  ({
    id: 'c1',
    providerId: 'p',
    providerName: 'P',
    label: 'C',
    authType: 'api-key',
    keys,
    createdAt: 'a',
    updatedAt: 'b',
  }) as ProviderConnectionRecord

describe('maskKey + DTOs never leak the raw key', () => {
  test('maskKey shows only the last 4', () => {
    expect(maskKey('sk-abcdef1234')).toBe('…1234')
    expect(maskKey('')).toBe('…')
  })
  test('toKeyDto masks and omits the raw apiKey', () => {
    const dto = toKeyDto(key({ apiKey: 'secret-WXYZ' }))
    expect(dto.maskedKey).toBe('…WXYZ')
    expect('apiKey' in dto).toBe(false)
  })
  test('toDto derives hasApiKey/keyCount and masks every key', () => {
    const dto = toDto(conn([key(), key({ id: 'k2' })]))
    expect(dto).toMatchObject({ hasApiKey: true, keyCount: 2 })
    expect(dto.keys.every((k) => !('apiKey' in k))).toBe(true)
    expect(toDto(conn([])).hasApiKey).toBe(false)
  })
})
