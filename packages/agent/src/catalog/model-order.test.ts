import { describe, expect, test } from 'bun:test'

import { sortCatalogModelsNewestFirst, sortProvidersOAuthFirst } from './model-order'
import type { CatalogModel } from './types'

function model(
  id: string,
  options: { releaseDate?: string; providerId?: string; name?: string } = {},
): CatalogModel {
  const providerId = options.providerId ?? 'provider'
  return {
    id,
    name: options.name ?? id,
    providerId,
    providerName: providerId,
    releaseDate: options.releaseDate,
    supportsTools: true,
    supportsReasoning: false,
    supportsAttachment: false,
    inputModalities: ['text'],
    outputModalities: ['text'],
  }
}

describe('catalog model ordering', () => {
  test('sorts valid release dates descending and places undated models last', () => {
    const models = [
      model('undated'),
      model('older', { releaseDate: '2024-01-15' }),
      model('newest', { releaseDate: '2025-06-01' }),
      model('invalid', { releaseDate: 'unknown' }),
      model('middle', { releaseDate: '2025-01-01' }),
    ]

    expect(sortCatalogModelsNewestFirst(models).map(({ id }) => id)).toEqual([
      'newest',
      'middle',
      'older',
      'undated',
      'invalid',
    ])
  })

  test('preserves authoritative source order for equal release dates', () => {
    const releaseDate = '2025-01-01'
    const models = [
      model('provider-b/z', { providerId: 'provider-b', name: 'Alpha', releaseDate }),
      model('provider-a/z', { providerId: 'provider-a', name: 'Zulu', releaseDate }),
      model('provider-a/b', { providerId: 'provider-a', name: 'Alpha', releaseDate }),
      model('provider-a/a', { providerId: 'provider-a', name: 'Alpha', releaseDate }),
    ]

    expect(sortCatalogModelsNewestFirst(models).map(({ id }) => id)).toEqual([
      'provider-b/z',
      'provider-a/z',
      'provider-a/b',
      'provider-a/a',
    ])
  })

  test('does not infer release order from opaque undated model ids', () => {
    const models = [
      model('gpt-latest'),
      model('gpt-4.1'),
      model('gpt-5.3-codex'),
      model('gpt-5.4'),
      model('gpt-5.2'),
      model('gpt-5'),
    ]

    expect(sortCatalogModelsNewestFirst(models)).toEqual(models)
  })

  test('rejects ambiguous and calendar-invalid dates instead of engine-dependent parsing', () => {
    const models = [
      model('ambiguous-year', { releaseDate: '2026' }),
      model('impossible-day', { releaseDate: '2026-02-30' }),
      model('locale-date', { releaseDate: '07/22/2026' }),
      model('valid-day', { releaseDate: '2025-12-31' }),
      model('valid-instant', { releaseDate: '2026-01-01T00:00:00.000Z' }),
    ]

    expect(sortCatalogModelsNewestFirst(models).map(({ id }) => id)).toEqual([
      'valid-instant',
      'valid-day',
      'ambiguous-year',
      'impossible-day',
      'locale-date',
    ])
  })

  test('preserves OAuth bands and dated ordering across seeded mixed fixtures', () => {
    let seed = 0x51_7a_2026
    const random = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return seed / 0x1_0000_0000
    }

    for (let run = 0; run < 64; run += 1) {
      const source = Array.from({ length: 40 }, (_, index) => ({
        id: `provider-${index}`,
        oauth: random() < 0.4,
      }))
      const oauthIds = source.filter(({ oauth }) => oauth).map(({ id }) => id)
      const providers = sortProvidersOAuthFirst(source, oauthIds, ({ id }) => id)
      const firstKeyOnly = providers.findIndex(({ oauth }) => !oauth)
      expect(firstKeyOnly < 0 || providers.slice(firstKeyOnly).every(({ oauth }) => !oauth)).toBe(
        true,
      )
      expect(providers.filter(({ oauth }) => oauth)).toEqual(source.filter(({ oauth }) => oauth))
      expect(providers.filter(({ oauth }) => !oauth)).toEqual(source.filter(({ oauth }) => !oauth))

      const models = Array.from({ length: 40 }, (_, index) =>
        model(`model-${index}`, {
          releaseDate:
            random() < 0.7
              ? `202${Math.floor(random() * 7)}-${String(1 + Math.floor(random() * 12)).padStart(2, '0')}-01`
              : undefined,
        }),
      )
      const ordered = sortCatalogModelsNewestFirst(models)
      const timestamps = ordered
        .map(({ releaseDate }) => (releaseDate ? Date.parse(releaseDate) : undefined))
        .filter((value): value is number => value !== undefined)
      expect(
        timestamps.every((value, index) => index === 0 || timestamps[index - 1]! >= value),
      ).toBe(true)
      expect(ordered.slice(timestamps.length).every(({ releaseDate }) => !releaseDate)).toBe(true)
    }
  })

  test('does not mutate the source array and preserves exact duplicate order', () => {
    const first = model('same', { name: 'Same' })
    const second = model('same', { name: 'Same' })
    const source = [second, first]
    const sorted = sortCatalogModelsNewestFirst(source)

    expect(sorted).not.toBe(source)
    expect(sorted).toEqual([second, first])
    expect(source).toEqual([second, first])
  })
})

describe('provider catalog ordering', () => {
  test('uses the OAuth capability list instead of a provider default auth type', () => {
    const source = [
      { id: 'key-only', authType: 'api-key' as const },
      { id: 'mixed', authType: 'api-key' as const },
      { id: 'oauth', authType: 'oauth-pkce' as const },
    ]

    expect(sortProvidersOAuthFirst(source, ['mixed', 'oauth'], (provider) => provider.id)).toEqual([
      source[1],
      source[2],
      source[0],
    ])
  })

  test('preserves source order for duplicate providers and colliding OAuth connections', () => {
    const source = [
      { id: 'proxy-1', providerId: 'proxy' },
      { id: 'openai-key', providerId: 'openai' },
      { id: 'openai-oauth', providerId: 'openai' },
      { id: 'proxy-2', providerId: 'proxy' },
    ]

    expect(sortProvidersOAuthFirst(source, ['openai'], (entry) => entry.providerId)).toEqual([
      source[1],
      source[2],
      source[0],
      source[3],
    ])
  })
})
