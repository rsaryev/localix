import { describe, expect, test } from 'bun:test'
import { createResourceContextResolver } from './resource-resolver'

const reference = {
  version: 1 as const,
  id: 'selected',
  kind: 'resource',
  uri: 'localix://resource/example/owned/item',
  freshness: 'resolve-at-send' as const,
  presentation: { label: 'item' },
  scope: { userId: 'u', sessionId: 's' },
}

describe('createResourceContextResolver', () => {
  test('uses the generic registry without knowing a resource provider', async () => {
    const calls: string[] = []
    const resolver = createResourceContextResolver({
      register: () => true,
      unregister: () => {},
      get: () => undefined,
      list: () => [],
      listChildren: async () => [],
      browse: async (_userId, partial) => ({
        version: 1,
        partial,
        parent: null,
        provider: null,
        segment: partial,
        groups: [],
        notices: [],
        total: 0,
        truncated: false,
      }),
      expand: async (userId, uri) => {
        calls.push(`${userId}:${uri}`)
        return { ok: true, language: 'yaml', content: 'kind: Example' }
      },
    })
    // Destinations belong to the registration; the predicate only says which references.
    expect(resolver.supports(reference, 'edit-prediction')).toBe(true)
    expect(resolver.supports(reference, 'chat')).toBe(true)
    expect(resolver.supports({ ...reference, kind: 'file' }, 'chat')).toBe(false)
    expect(
      await resolver.estimate(
        reference,
        { destination: 'edit-prediction', userId: 'u', sessionId: 's', maxBytes: 100 },
        new AbortController().signal,
      ),
    ).toMatchObject({ bytes: 13, tokens: 4 })
    const result = await resolver.resolve(
      reference,
      { destination: 'edit-prediction', userId: 'u', sessionId: 's', maxBytes: 100 },
      new AbortController().signal,
    )
    expect(result).toEqual([
      expect.objectContaining({
        providerId: 'resource-reference',
        uri: 'localix://resource/example/owned/item',
        kind: 'resource/yaml',
        content: 'kind: Example',
      }),
    ])
    expect(calls).toEqual([
      'u:localix://resource/example/owned/item',
      'u:localix://resource/example/owned/item',
    ])
  })

  test('says why a linked resource is missing instead of returning nothing', async () => {
    const resolver = createResourceContextResolver({
      register: () => true,
      unregister: () => {},
      get: () => undefined,
      list: () => [],
      listChildren: async () => [],
      browse: async (_userId, partial) => ({
        version: 1,
        partial,
        parent: null,
        provider: null,
        segment: partial,
        groups: [],
        notices: [],
        total: 0,
        truncated: false,
      }),
      expand: async () => ({ ok: false, error: 'not connected' }),
    })
    const result = await resolver.resolve(
      { ...reference, presentation: { token: '@resource:item', label: 'item' } },
      { destination: 'chat', userId: 'u', sessionId: 's', maxBytes: 100 },
      new AbortController().signal,
    )
    expect(result).toEqual([
      expect.objectContaining({
        kind: 'unavailable',
        content: '@resource:item: could not be read (not connected)',
      }),
    ])
  })

  test('does not resolve an aborted request', async () => {
    const resolver = createResourceContextResolver({
      register: () => true,
      unregister: () => {},
      get: () => undefined,
      list: () => [],
      listChildren: async () => [],
      browse: async (_userId, partial) => ({
        version: 1,
        partial,
        parent: null,
        provider: null,
        segment: partial,
        groups: [],
        notices: [],
        total: 0,
        truncated: false,
      }),
      expand: async () => ({ ok: true, content: 'must not be read' }),
    })
    const controller = new AbortController()
    controller.abort()
    expect(
      await resolver.resolve(
        reference,
        { destination: 'edit-prediction', userId: 'u', sessionId: 's', maxBytes: 100 },
        controller.signal,
      ),
    ).toEqual([])
  })
})
