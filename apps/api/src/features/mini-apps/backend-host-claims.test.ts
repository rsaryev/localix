import { describe, expect, it } from 'bun:test'
import type { SemanticSource } from '@localixai/mini-app-sdk/backend'
import { createMiniAppBackendHost } from './backend-host'
import { createSubsystemRegistry, type BackendSubsystem } from '../ext/subsystem-contrib'
import { createCapabilityRegistry } from '../ext/capability-registry'
import { createWsFrameRegistry } from '../ext/ws-frame-registry'
import { createResourceProviderRegistry } from '../agent-core/resource-refs/provider'
import { createContextProviderRegistry } from '../context-fabric/registry'
import { createOwnedRegistrations } from '../../lib/owned-registrations'
import { createMiniAppSemanticHost } from '../embeddings/mini-app-host'
import type { SemanticService } from '../embeddings/service'

/** The semantic service's source table, with its real refusal of a second holder of a name. */
function fakeService() {
  const sources = new Map<string, SemanticSource>()
  const service = {
    registerSource(source: SemanticSource) {
      if (sources.has(source.collection)) throw new Error('already registered')
      sources.set(source.collection, source)
      return () => {
        if (sources.get(source.collection) === source) sources.delete(source.collection)
      }
    },
  } as unknown as SemanticService
  return { service, sources }
}

/** The host services a loader binds to each app, plus what the backend host tells them. */
function setup(
  loads: () => Array<{ app: string; revision?: string; backendId?: string }>,
  options: { settle?: boolean } = {},
) {
  const { service, sources } = fakeService()
  const registrations = createOwnedRegistrations()
  const released: string[] = []
  const serial = { value: 0 }
  const shutdowns: number[] = []
  const host = createMiniAppBackendHost({
    subsystemRegistry: createSubsystemRegistry(),
    capabilityRegistry: createCapabilityRegistry(),
    wsFrameRegistry: createWsFrameRegistry(),
    resourceRefsRegistry: createResourceProviderRegistry(),
    contextProviderRegistry: createContextProviderRegistry(),
    // A fresh load per reconcile, each with its own host services and closures, like the loader.
    loadBackends: async () =>
      loads().map(({ app, revision, backendId }) => {
        const load = ++serial.value
        createMiniAppSemanticHost(service, app, registrations).registerSource({
          collection: 'cards',
          version: 1,
          scan: async () => ({ items: [], next: null }),
          read: async () => [{ key: `load-${load}` }] as never,
        })
        const backend: BackendSubsystem = {
          id: backendId ?? `${app}:backend`,
          onShutdown: () => void shutdowns.push(load),
        }
        return { app, revision, backend }
      }),
    releaseHostServices: async (app) => {
      released.push(app)
      await registrations.releaseOwner(app)
    },
    ...(options.settle === false
      ? {}
      : {
          settleHostServices: (app: string, outcome: 'kept' | 'replaced') =>
            registrations.settle(app, outcome),
        }),
  })
  const served = async (app: string) =>
    (await sources.get(`mini-app:${app}:cards`)?.read([]))?.map((item) => item.key)
  return { host, sources, released, served, shutdowns }
}

describe('host registrations of a mini app across reconciles', () => {
  it('keeps serving the wired backend when an unrelated reconcile discards a fresh duplicate', async () => {
    const t = setup(() => [{ app: 'notes', revision: 'r1' }])
    await t.host.reconcile()
    expect(await t.served('notes')).toEqual(['load-1'])
    await t.host.reconcile()
    await t.host.reconcile()
    expect(await t.served('notes')).toEqual(['load-1'])
  })

  it('serves the rebuilt backend once its revision moves, and keeps it after later reconciles', async () => {
    let revision = 'r1'
    const t = setup(() => [{ app: 'notes', revision }])
    await t.host.reconcile()
    revision = 'r2'
    await t.host.reconcile()
    expect(await t.served('notes')).toEqual(['load-2'])
    await t.host.reconcile()
    expect(await t.served('notes')).toEqual(['load-2'])
    expect(t.shutdowns).toEqual([1])
  })

  it('releases the claims of a backend the plan refused, and holds none for it', async () => {
    const t = setup(() => [{ app: 'bad', revision: 'r1', backendId: 'not-namespaced' }])
    await t.host.reconcile()
    expect(t.host.wired()).toEqual([])
    expect(t.released).toEqual(['bad'])
    expect(t.sources.size).toBe(0)
  })

  it('does not release a mini app that is wired because another of its backends was refused', async () => {
    const t = setup(() => [
      { app: 'notes', revision: 'r1' },
      { app: 'notes', revision: 'r1', backendId: 'not-namespaced' },
    ])
    await t.host.reconcile()
    expect(t.host.wired()).toEqual(['notes'])
    expect(t.released).toEqual([])
  })
})
