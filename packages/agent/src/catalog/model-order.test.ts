import { describe, expect, test } from 'bun:test'

import {
  POPULAR_PROVIDER_IDS,
  sortCatalogModelsNewestFirst,
  sortProvidersByPopularity,
} from './model-order'
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

  test('keeps dated ordering across seeded mixed fixtures', () => {
    let seed = 0x51_7a_2026
    const random = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return seed / 0x1_0000_0000
    }

    for (let run = 0; run < 64; run += 1) {
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
  test('on-device first, then the popular providers in their order, then the rest by id', () => {
    const ids = ['zenmux', 'groq', 'local', 'anthropic', 'abacus', 'openrouter', 'openai']
    expect(sortProvidersByPopularity(ids, (id) => id)).toEqual([
      'local',
      'openai',
      'anthropic',
      'openrouter',
      'groq',
      'abacus',
      'zenmux',
    ])
  })

  test('names each popular provider once', () => {
    expect(new Set(POPULAR_PROVIDER_IDS).size).toBe(POPULAR_PROVIDER_IDS.length)
  })

  test('keeps source order for several connections of one provider, without mutating', () => {
    const source = [
      { id: 'proxy-1', providerId: 'proxy' },
      { id: 'openai-key', providerId: 'openai' },
      { id: 'openai-oauth', providerId: 'openai' },
      { id: 'proxy-2', providerId: 'proxy' },
    ]

    expect(sortProvidersByPopularity(source, (entry) => entry.providerId)).toEqual([
      source[1],
      source[2],
      source[0],
      source[3],
    ])
    expect(source.map(({ id }) => id)).toEqual(['proxy-1', 'openai-key', 'openai-oauth', 'proxy-2'])
  })
})
