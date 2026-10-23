import { describe, expect, test } from 'bun:test'

import {
  buildResourceUri,
  createResourceProviderRegistry,
  type ResourceNode,
  type ResourceRefProvider,
} from './resource-refs'

function provider(label: string): ResourceRefProvider {
  return {
    provider: 'catalog',
    title: label,
    async listChildren() {
      return [{ uri: buildResourceUri('catalog', ['item']), label, hasChildren: false }]
    },
    async expand() {
      return { ok: true, content: label }
    },
  }
}

describe('resource registry lifecycle', () => {
  test('browsing follows registrations and removals after registry creation', async () => {
    const registry = createResourceProviderRegistry()
    const partial = buildResourceUri('catalog')
    expect((await registry.browse('user', '')).groups).toEqual([])

    const first = provider('First owner')
    registry.register(first)
    expect((await registry.browse('user', partial)).groups[0]?.resources[0]?.label).toBe(
      'First owner',
    )

    registry.unregister(first)
    expect((await registry.browse('user', partial)).groups).toEqual([])
    registry.register(provider('New owner'))
    expect((await registry.browse('user', partial)).groups[0]?.resources[0]?.label).toBe(
      'New owner',
    )
  })

  test('an admitted browse finishes with its captured owner while later requests use the new one', async () => {
    const registry = createResourceProviderRegistry()
    const partial = buildResourceUri('catalog')
    let release!: (nodes: ResourceNode[]) => void
    let started!: () => void
    const admitted = new Promise<void>((resolve) => {
      started = resolve
    })
    const pending = new Promise<ResourceNode[]>((resolve) => {
      release = resolve
    })
    const first = {
      ...provider('First owner'),
      listChildren: () => {
        started()
        return pending
      },
    }
    registry.register(first)
    const request = registry.browse('user', partial)
    await admitted
    registry.unregister(first)
    registry.register(provider('New owner'))
    release([
      { uri: buildResourceUri('catalog', ['old']), label: 'Old result', hasChildren: false },
    ])

    const result = await request
    expect(result.groups[0]?.label).toBe('First owner')
    expect(result.groups[0]?.resources[0]?.label).toBe('Old result')
    expect((await registry.browse('user', partial)).groups[0]?.resources[0]?.label).toBe(
      'New owner',
    )
  })

  for (const option of ['timeoutMs', 'maxNodesPerProvider', 'maxExpansionBytes'] as const) {
    test.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
      `rejects invalid ${option}: %s`,
      (value) => {
        expect(() => createResourceProviderRegistry({ [option]: value })).toThrow(
          new RangeError(`resource provider ${option} must be a positive safe integer`),
        )
      },
    )
  }
})
