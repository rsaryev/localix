import { describe, expect, test } from 'bun:test'

import type { CatalogModel } from '@localixai/agent/catalog'
import { filterModels, availableModelFilters } from './filterModels'

type M = { id: string; name: string; providerId: string; outputModalities: string[] }
const m = (id: string, name: string, providerId: string): M => ({
  id,
  name,
  providerId,
  outputModalities: ['text'],
})

const catalog = [
  m('openai/gpt-5', 'GPT-5', 'openai'),
  m('openai/gpt-5-mini', 'GPT-5 Mini', 'openai'),
  m('anthropic/opus', 'Claude Opus', 'anthropic'),
] as never[]

// A richer catalog with capability metadata for the facet-filter tests.
type Caps = {
  id: string
  name: string
  providerId: string
  supportsTools: boolean
  supportsReasoning: boolean
  inputModalities: string[]
  outputModalities: string[]
  cost?: { input: number; output: number }
}
const cap = (id: string, p: Partial<Caps>): Caps => ({
  id,
  name: id,
  providerId: 'p',
  supportsTools: false,
  supportsReasoning: false,
  inputModalities: ['text'],
  outputModalities: ['text'],
  ...p,
})
const caps = [
  cap('tools-only', { supportsTools: true }),
  cap('reasoner', { supportsReasoning: true }),
  cap('vision', { inputModalities: ['text', 'image'] }),
  cap('imager', { outputModalities: ['text', 'image'] }),
  cap('clipper', { outputModalities: ['video'] }),
  cap('free', { cost: { input: 0, output: 0 } }),
  cap('paid', { cost: { input: 1, output: 2 } }),
] as never[]

describe('filterModels', () => {
  test('no provider → empty', () => {
    expect(filterModels(catalog, null, '')).toEqual([])
    expect(filterModels(catalog, undefined, '')).toEqual([])
  })

  test('narrows the catalog to the selected provider', () => {
    expect(filterModels(catalog, 'openai', '').map((x) => x.id)).toEqual([
      'openai/gpt-5',
      'openai/gpt-5-mini',
    ])
  })

  test('search matches name OR id, case-insensitively', () => {
    expect(filterModels(catalog, 'openai', 'MINI').map((x) => x.id)).toEqual(['openai/gpt-5-mini'])
    expect(filterModels(catalog, 'openai', 'gpt-5').map((x) => x.id)).toEqual([
      'openai/gpt-5',
      'openai/gpt-5-mini',
    ])
  })

  test('whitespace-only query is treated as no query', () => {
    expect(filterModels(catalog, 'openai', '   ').length).toBe(2)
  })

  test('capability filters narrow by facet', () => {
    expect(filterModels(caps, 'p', '', ['tools']).map((x) => x.id)).toEqual(['tools-only'])
    expect(filterModels(caps, 'p', '', ['reasoning']).map((x) => x.id)).toEqual(['reasoner'])
    expect(filterModels(caps, 'p', '', ['vision']).map((x) => x.id)).toEqual(['vision'])
    expect(filterModels(caps, 'p', '', ['free']).map((x) => x.id)).toEqual(['free'])
  })

  test('lists every model on the connection, filtering only by provider', () => {
    // The picker used to drop image/video OUTPUT models, which the pi adapter
    // merged into the chat catalog beside the text ones. The adapter no longer
    // lists them at all, so this is a plain provider narrowing again.
    const ids = filterModels(caps, 'p', '').map((x) => x.id)
    expect(ids).toContain('tools-only')
    expect(ids).toContain('vision')
    expect(filterModels(caps, 'other-provider', '')).toEqual([])
  })

  test('unknown cost is not treated as free', () => {
    // The base `caps` row "tools-only" has no cost → must NOT match the free facet.
    expect(filterModels(caps, 'p', '', ['free']).map((x) => x.id)).not.toContain('tools-only')
  })

  test('multiple filters AND together', () => {
    const both = [cap('toolbrain', { supportsTools: true, supportsReasoning: true })] as never[]
    expect(filterModels(both, 'p', '', ['tools', 'reasoning']).map((x) => x.id)).toEqual([
      'toolbrain',
    ])
    expect(filterModels(caps, 'p', '', ['tools', 'reasoning'])).toEqual([])
  })
})

describe('availableModelFilters', () => {
  test('only facets present in the list are offered, in stable order (no image/video facet)', () => {
    expect(availableModelFilters(caps)).toEqual(['tools', 'reasoning', 'vision', 'free'])
  })

  test('a plain text-only list offers nothing', () => {
    const plain = [cap('plain', {})] as never[]
    expect(availableModelFilters(plain)).toEqual([])
  })
})

describe('capability facets that change what a run costs', () => {
  const model = (over: Partial<CatalogModel>): CatalogModel =>
    ({
      id: 'p/m',
      name: 'M',
      providerId: 'p',
      providerName: 'P',
      supportsTools: true,
      supportsReasoning: false,
      supportsAttachment: false,
      inputModalities: ['text'],
      outputModalities: ['text'],
      ...over,
    }) as CatalogModel

  test('caching means the provider PRICES it, not that the field exists', () => {
    // For a long agent run this is the whole bill: without caching every turn pays full price
    // for the same prefix again. A zero rate is no caching, not free caching.
    const priced = model({ cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } })
    const unpriced = model({ cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 } })
    const unknown = model({})

    expect(filterModels([priced, unpriced, unknown], 'p', '', ['caching'])).toEqual([priced])
  })

  test('a facet with no matching model is not offered', () => {
    expect(availableModelFilters([model({})])).not.toContain('caching')
    expect(
      availableModelFilters([model({ cost: { input: 1, output: 2, cacheRead: 0.1 } })]),
    ).toContain('caching')
  })

  test('search finds a model by the level it can reason at', () => {
    const deep = model({ supportsReasoning: true, reasoningEfforts: ['low', 'high', 'xhigh'] })
    const shallow = model({ id: 'p/other', supportsReasoning: true, reasoningEfforts: ['low'] })

    expect(filterModels([deep, shallow], 'p', 'xhigh')).toEqual([deep])
  })
})
