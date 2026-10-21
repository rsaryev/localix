import { describe, expect, test } from 'bun:test'
import type { ProviderEntry } from '@localixai/agent/catalog'

import { connectableProviders } from './useModelSelectProviders'

const provider = (id: string, modelCount: number): ProviderEntry => ({
  id,
  name: id,
  modelCount,
  authType: 'api-key',
})

describe('providers offered for connection', () => {
  test('a provider with no chat models is not offered', () => {
    // A classifier-only provider took a key and then showed an empty model list.
    const offered = connectableProviders([provider('openai', 40), provider('typesafe', 0)], [])
    expect(offered.map((p) => p.id)).toEqual(['openai'])
  })

  test('a connected provider drops out; catalog order is kept', () => {
    const all = [provider('b', 1), provider('a', 2), provider('c', 3)]
    expect(connectableProviders(all, [{ providerId: 'a' }]).map((p) => p.id)).toEqual(['b', 'c'])
  })
})
