import { describe, expect, test } from 'bun:test'
import type { SemanticSource } from '@localixai/mini-app-sdk/backend'
import type { SemanticService } from './service'
import { createOwnedRegistrations } from '../../lib/owned-registrations'
import { createMiniAppSemanticHost, createMiniAppToolSemanticHost } from './mini-app-host'

/** The service's source table with its real refusal of a second holder of a collection. */
function fakeService() {
  const sources = new Map<string, SemanticSource>()
  const service = {
    registerSource(source: SemanticSource) {
      if (sources.has(source.collection)) {
        throw new Error(`semantic source "${source.collection}" is already registered`)
      }
      sources.set(source.collection, source)
      return () => {
        if (sources.get(source.collection) === source) sources.delete(source.collection)
      }
    },
  } as unknown as SemanticService
  return { service, sources }
}

const filesSource = {
  collection: 'files',
  version: 1,
  scan: async () => ({ items: [], next: null }),
  read: async () => [],
} as never

describe('host.semantic registerSource across a mini app reload', () => {
  test('the reloaded backend of the same mini app takes over its own source', () => {
    const { service, sources } = fakeService()
    const registrations = createOwnedRegistrations()
    createMiniAppSemanticHost(service, 'search-3', registrations).registerSource(filesSource)
    const reloaded = createMiniAppSemanticHost(service, 'search-3', registrations)
    expect(() => reloaded.registerSource(filesSource)).not.toThrow()
    expect([...sources.keys()]).toEqual(['mini-app:search-3:files'])
  })

  test('releasing the mini app frees its sources and leaves another mini app untouched', async () => {
    const { service, sources } = fakeService()
    const registrations = createOwnedRegistrations()
    createMiniAppSemanticHost(service, 'search-3', registrations).registerSource(filesSource)
    createMiniAppSemanticHost(service, 'notes', registrations).registerSource(filesSource)
    await registrations.releaseOwner('search-3')
    expect([...sources.keys()]).toEqual(['mini-app:notes:files'])
  })

  test('a mini app cannot take a collection another mini app registered', () => {
    const { service, sources } = fakeService()
    const foreign = {} as unknown as SemanticSource
    sources.set('files', foreign)
    const host = createMiniAppSemanticHost(service, 'search-3', createOwnedRegistrations())
    host.registerSource(filesSource)
    expect(sources.has('files')).toBe(true)
    expect(sources.get('files')).toBe(foreign)
  })
})

describe("host.semantic on a mini app's tool load", () => {
  // The boot load holds each collection's source; a tool's load registering it again would swap
  // the live backend's readers for a tool scope's (or throw on the service's second holder).
  test('answers in its own collections and leaves the boot load its sources', async () => {
    const { service, sources } = fakeService()
    const asked: string[] = []
    Object.assign(service, {
      strategy: () => ({ mode: 'hybrid' }),
      reader: {
        query: async (_userId: string, collection: string, text: string) => {
          asked.push(`${collection}:${text}`)
          return []
        },
      },
    })
    createMiniAppSemanticHost(service, 'recall', createOwnedRegistrations()).registerSource({
      ...(filesSource as object),
      collection: 'cards',
    } as never)
    const tool = createMiniAppToolSemanticHost(service, 'recall')

    expect(() =>
      tool.registerSource({ ...(filesSource as object), collection: 'cards' } as never),
    ).not.toThrow()
    await tool.query('me', 'cards', 'cell energy')
    expect([...sources.keys()]).toEqual(['mini-app:recall:cards'])
    expect(asked).toEqual(['mini-app:recall:cards:cell energy'])
  })
})
