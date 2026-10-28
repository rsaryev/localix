import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { createMiniAppBackendHost } from './backend-host'
import { createSubsystemRegistry, type BackendSubsystem } from '../ext/subsystem-contrib'
import { createCapabilityRegistry } from '../ext/capability-registry'
import { CAP_DOCUMENT_EXTRACT } from '@localixai/mini-app-sdk/backend'
import { createWsFrameRegistry } from '../ext/ws-frame-registry'
import { createResourceProviderRegistry } from '../agent-core/resource-refs/provider'
import { createSearchProviderRegistry } from '../agent-core/search/provider'
import { createContextProviderRegistry } from '../context-fabric/registry'

/** A minimal sample-shaped subsystem: route + resource + search + WS + shutdown. */
function makeBackend(id: string, counters: { registered: number; shutdown: number }) {
  counters.registered++
  const backendId = `${id}:backend`
  const app = new Hono()
  app.get('/ping', (c) => c.json({ ok: true, sub: backendId }))
  const backend: BackendSubsystem = {
    id: backendId,
    routeMount: { path: `/rpc/${id}`, app: app as never },
    uiActions: {
      dashboard: (payload, context) => ({ payload, context }),
    },
    resourceProvider: {
      provider: id,
      title: id,
      listChildren: async () => [],
      expand: async () => ({ ok: true, content: id }),
    },
    searchProvider: {
      id: `${id}:search`,
      title: id,
      tier: 'eager',
      search: async () => [],
    },
    wsFrames: [
      {
        subscribeCommand: `${id}:watch.subscribe`,
        unsubscribeCommand: `${id}:watch.unsubscribe`,
        frameTag: 't',
        start: () => ({}),
        stop: () => {},
      },
    ],
    // A capability, so the wire/unwire lifecycle can be observed. Capabilities used to be the
    // boot-frozen exception: registered on first wire and NEVER unregistered.
    capabilities: { [CAP_DOCUMENT_EXTRACT]: (async () => ({ text: id })) as never },
    onShutdown: () => {
      counters.shutdown++
    },
  }
  return backend
}

function setup() {
  const counters = { registered: 0, shutdown: 0 }
  // The mutable "DB": which mini apps are enabled right now.
  const enabled = new Set<string>(['sample'])
  const registries = {
    subsystemRegistry: createSubsystemRegistry(),
    capabilityRegistry: createCapabilityRegistry(),
    wsFrameRegistry: createWsFrameRegistry(),
    resourceRefsRegistry: createResourceProviderRegistry(),
    contextProviderRegistry: createContextProviderRegistry(),
  }
  let settled = 0
  const settledWaiters: (() => void)[] = []
  const host = createMiniAppBackendHost({
    ...registries,
    refreshDebounceMs: 5,
    // Fresh register() per load, like the real loader: a new backend object each time.
    loadBackends: async () =>
      [...enabled].map((name) => ({ app: name, backend: makeBackend(name, counters) })),
    onSettled: () => {
      settled++
      for (const wake of settledWaiters.splice(0)) wake()
    },
  })
  // One outer app, dispatcher mounted once — the app.ts shape.
  const app = new Hono()
  app.use('*', host.middleware())
  app.get('/other', (c) => c.json({ core: true }))
  return {
    host,
    app,
    enabled,
    counters,
    registries,
    settled: () => settled,
    /** Resolves at the next settled refresh. */
    nextSettle: () => new Promise<void>((resolve) => settledWaiters.push(resolve)),
  }
}

describe('createMiniAppBackendHost', () => {
  it('boot reconcile wires routes, providers, and frames; disable tears them down', async () => {
    const { host, app, enabled, counters, registries } = setup()
    await host.reconcile()
    expect(host.wired()).toEqual(['sample'])
    expect((await app.request('/rpc/sample/ping')).status).toBe(200)
    expect(registries.resourceRefsRegistry.get('sample')).toBeDefined()
    expect(registries.wsFrameRegistry.findBySubscribe('sample:watch.subscribe')).toBeDefined()
    expect(registries.subsystemRegistry.list().map((s) => s.id)).toEqual(['sample:backend'])

    enabled.delete('sample')
    await host.reconcile()
    expect(host.wired()).toEqual([])
    expect(counters.shutdown).toBe(1)
    // The route falls through to the outer app's 404 — not a half-dead handler.
    expect((await app.request('/rpc/sample/ping')).status).toBe(404)
    expect(registries.resourceRefsRegistry.get('sample')).toBeUndefined()
    expect(registries.wsFrameRegistry.findBySubscribe('sample:watch.subscribe')).toBeUndefined()
    expect(registries.subsystemRegistry.list()).toEqual([])
    // Core routes are untouched by the dispatcher.
    expect((await app.request('/other')).status).toBe(200)
  })

  // Regression: a rebuilt user mini app kept serving the first build ever wired, so its new route
  // answered 404 through three rebuilds. A moved revision re-wires; an unchanged one does not.
  it('re-wires a mini app whose code revision moved, and only then', async () => {
    const counters = { registered: 0, shutdown: 0 }
    let revision = 'build-1'
    let routePath = '/old'
    const host = createMiniAppBackendHost({
      subsystemRegistry: createSubsystemRegistry(),
      capabilityRegistry: createCapabilityRegistry(),
      wsFrameRegistry: createWsFrameRegistry(),
      resourceRefsRegistry: createResourceProviderRegistry(),
      contextProviderRegistry: createContextProviderRegistry(),
      loadBackends: async () => {
        counters.registered++
        const app = new Hono()
        app.get(routePath, (c) => c.json({ revision }))
        const backend: BackendSubsystem = {
          id: 'timer:backend',
          routeMount: { path: '/rpc/timer', app: app as never },
          onShutdown: () => {
            counters.shutdown++
          },
        }
        return [{ app: 'timer', backend, revision }]
      },
    })
    const app = new Hono()
    app.use('*', host.middleware())
    await host.reconcile()
    expect((await app.request('/rpc/timer/old')).status).toBe(200)

    await host.reconcile()
    expect(counters.shutdown).toBe(0)

    revision = 'build-2'
    routePath = '/'
    await host.reconcile()
    expect(counters.shutdown).toBe(1)
    expect(await (await app.request('/rpc/timer')).json()).toEqual({ revision: 'build-2' })
    expect((await app.request('/rpc/timer/old')).status).toBe(404)
  })

  it('enable-after-boot brings a mini app fully alive (the restart bug)', async () => {
    const { host, app, enabled } = setup()
    enabled.clear()
    await host.reconcile()
    expect((await app.request('/rpc/sample/ping')).status).toBe(404)

    enabled.add('sample')
    await host.reconcile()
    const res = await app.request('/rpc/sample/ping')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, sub: 'sample:backend' })
  })

  it('brokers UI actions only while the owning mini app is wired', async () => {
    const { host, enabled } = setup()
    await host.reconcile()
    const context = {
      userId: 'user-1',
      projectId: '',
      cwd: '/repo',
      sessionId: 'session-1',
      viewId: 'dashboard',
    }
    expect(
      await host.invokeUiAction({
        app: 'sample',
        action: 'dashboard',
        payload: { page: 2 },
        context,
      }),
    ).toEqual({ payload: { page: 2 }, context })

    enabled.delete('sample')
    await host.reconcile()
    expect(
      host.invokeUiAction({
        app: 'sample',
        action: 'dashboard',
        payload: null,
        context,
      }),
    ).rejects.toMatchObject({ code: 'not_available' })
  })

  it('does not expose inherited object properties as undeclared UI actions', async () => {
    const { host } = setup()
    await host.reconcile()
    expect(
      host.invokeUiAction({
        app: 'sample',
        action: 'constructor',
        payload: null,
        context: { userId: 'u', projectId: '', cwd: '/repo', viewId: 'dashboard' },
      }),
    ).rejects.toMatchObject({ code: 'not_available' })
  })

  it('keeps same-name global and project UI actions in their exact scopes', async () => {
    const registries = {
      subsystemRegistry: createSubsystemRegistry(),
      capabilityRegistry: createCapabilityRegistry(),
      wsFrameRegistry: createWsFrameRegistry(),
      resourceRefsRegistry: createResourceProviderRegistry(),
      contextProviderRegistry: createContextProviderRegistry(),
    }
    const host = createMiniAppBackendHost({
      ...registries,
      loadBackends: async () => [
        {
          app: 'sample',
          projectId: '',
          backend: { id: 'sample:global', uiActions: { dashboard: () => 'global' } },
        },
        {
          app: 'sample',
          projectId: 'project-1',
          backend: { id: 'sample:project', uiActions: { dashboard: () => 'project' } },
        },
      ],
    })
    await host.reconcile()
    const baseContext = { userId: 'u', cwd: '/repo', viewId: 'dashboard' }
    expect(
      await host.invokeUiAction({
        app: 'sample',
        action: 'dashboard',
        payload: null,
        context: { ...baseContext, projectId: '' },
      }),
    ).toBe('global')
    expect(
      await host.invokeUiAction({
        app: 'sample',
        action: 'dashboard',
        payload: null,
        context: { ...baseContext, projectId: 'project-1' },
      }),
    ).toBe('project')
    // Process-global providers still select one scope instead of double-wiring.
    expect(registries.subsystemRegistry.list().map((backend) => backend.id)).toEqual([
      'sample:global',
    ])
  })

  it('re-enable runs register() again and rewires cleanly', async () => {
    const { host, enabled, counters, app } = setup()
    await host.reconcile()
    const afterBoot = counters.registered
    enabled.delete('sample')
    await host.reconcile()
    enabled.add('sample')
    await host.reconcile()
    expect(counters.registered).toBeGreaterThan(afterBoot)
    expect((await app.request('/rpc/sample/ping')).status).toBe(200)
  })

  it('an already-wired mini app is not churned by an unrelated toggle', async () => {
    const { host, enabled, counters } = setup()
    await host.reconcile()
    enabled.add('other')
    await host.reconcile()
    // sample was reloaded (fresh register()) but its WIRED instance was kept:
    // no shutdown ran, so live streams/services were untouched.
    expect(counters.shutdown).toBe(0)
    expect(host.wired().sort()).toEqual(['other', 'sample'])
  })

  it('a throwing loadBackends leaves state intact and still settles a refresh', async () => {
    const counters = { registered: 0, shutdown: 0 }
    let fail = false
    let settled = 0
    let wake = () => {}
    const host = createMiniAppBackendHost({
      loadBackends: async () => {
        if (fail) throw new Error('boom')
        return [{ app: 'sample', backend: makeBackend('sample', counters) }]
      },
      subsystemRegistry: createSubsystemRegistry(),
      capabilityRegistry: createCapabilityRegistry(),
      wsFrameRegistry: createWsFrameRegistry(),
      resourceRefsRegistry: createResourceProviderRegistry(),
      contextProviderRegistry: createContextProviderRegistry(),
      refreshDebounceMs: 5,
      onSettled: () => {
        settled++
        wake()
      },
    })
    await host.reconcile()
    fail = true
    const settle = new Promise<void>((resolve) => (wake = resolve))
    host.refresh()
    await settle
    expect(settled).toBe(1)
    expect(host.wired()).toEqual(['sample'])
  })

  it('setSearchRegistry registers already-wired providers and unwire removes them', async () => {
    const { host, enabled, registries: _r } = setup()
    await host.reconcile()
    const search = createSearchProviderRegistry()
    host.setSearchRegistry(search)
    expect(search.get('sample:search')).toBeDefined()
    enabled.delete('sample')
    await host.reconcile()
    expect(search.get('sample:search')).toBeUndefined()
  })

  it('overlapping refreshes serialize to last-state-wins', async () => {
    const { host, enabled, app, nextSettle } = setup()
    await host.reconcile()
    const settle = nextSettle()
    enabled.delete('sample')
    host.refresh()
    enabled.add('sample')
    host.refresh()
    enabled.delete('sample')
    host.refresh()
    await settle
    expect(host.wired()).toEqual([])
    expect((await app.request('/rpc/sample/ping')).status).toBe(404)
  })

  // `routeMount.path` is a free string from the mini app — '/rpc/<id>' is a convention, not
  // a constraint — and the authoring kit tells authors to copy a bundled mini app's structure.
  // So two mini apps CAN claim one path, while every id-keyed guard beside it stays happy.
  it('a duplicate route mount cannot evict the mini app that claimed the path first', async () => {
    const enabled = new Set<string>(['alpha', 'beta'])
    const sharedPath = '/rpc/shared'
    const mk = (name: string): BackendSubsystem => {
      const app = new Hono()
      app.get('/who', (c) => c.json({ who: name }))
      return { id: `${name}:backend`, routeMount: { path: sharedPath, app: app as never } }
    }
    const warnings: string[] = []
    const host = createMiniAppBackendHost({
      subsystemRegistry: createSubsystemRegistry(),
      capabilityRegistry: createCapabilityRegistry(),
      wsFrameRegistry: createWsFrameRegistry(),
      resourceRefsRegistry: createResourceProviderRegistry(),
      contextProviderRegistry: createContextProviderRegistry(),
      logger: { warn: (m: string) => warnings.push(m) } as never,
      loadBackends: async () => [...enabled].map((name) => ({ app: name, backend: mk(name) })),
    })
    const app = new Hono()
    app.use('*', host.middleware())

    await host.reconcile()
    // First-wins, and said out loud rather than silently shadowing.
    expect(await (await app.request(`${sharedPath}/who`)).json()).toEqual({ who: 'alpha' })
    expect(warnings.some((w) => w.includes(sharedPath))).toBe(true)

    // THE BUG: disabling the loser deleted the path outright, killing the route of a
    // mini app that is still enabled — subsystem alive, UI tab alive, /rpc dead.
    enabled.delete('beta')
    await host.reconcile()
    expect(await (await app.request(`${sharedPath}/who`)).json()).toEqual({ who: 'alpha' })
  })

  it('rejects a backend that claims process-global identities outside its owner namespace', async () => {
    const warnings: Array<{ message: string; meta: unknown }> = []
    const wsFrameRegistry = createWsFrameRegistry()
    const host = createMiniAppBackendHost({
      subsystemRegistry: createSubsystemRegistry(),
      capabilityRegistry: createCapabilityRegistry(),
      wsFrameRegistry,
      resourceRefsRegistry: createResourceProviderRegistry(),
      contextProviderRegistry: createContextProviderRegistry(),
      logger: { warn: (message, meta) => warnings.push({ message, meta }) },
      loadBackends: async () => [
        {
          app: 'alpha',
          backend: {
            id: 'beta:backend',
            searchProvider: {
              id: 'beta:search',
              title: 'Foreign search',
              tier: 'eager',
              search: async () => [],
            },
            contextProviders: [{ provider: { id: 'beta:context' } } as never],
            wsFrames: [
              {
                subscribeCommand: 'beta:watch.subscribe',
                unsubscribeCommand: 'beta:watch.unsubscribe',
                frameTag: 'l',
                start: () => ({}),
                stop: () => {},
              },
            ],
          },
        },
      ],
    })

    await host.reconcile()
    expect(host.wired()).toEqual([])
    expect(wsFrameRegistry.list()).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.message).toContain('mini app backend rejected')
    expect(warnings[0]?.meta).toMatchObject({
      problems: [
        expect.stringContaining('backend subsystem'),
        expect.stringContaining('search provider'),
        expect.stringContaining('context provider'),
        expect.stringContaining('websocket subscribe command'),
        expect.stringContaining('websocket unsubscribe command'),
      ],
    })
  })

  it('rejects duplicate backend ids from one owner before registration', async () => {
    const warnings: string[] = []
    const backend = (suffix: string): BackendSubsystem => ({
      id: 'alpha:backend',
      wsFrames: [
        {
          subscribeCommand: `alpha:${suffix}.subscribe`,
          unsubscribeCommand: `alpha:${suffix}.unsubscribe`,
          frameTag: 'l',
          start: () => ({}),
          stop: () => {},
        },
      ],
    })
    const host = createMiniAppBackendHost({
      subsystemRegistry: createSubsystemRegistry(),
      capabilityRegistry: createCapabilityRegistry(),
      wsFrameRegistry: createWsFrameRegistry(),
      resourceRefsRegistry: createResourceProviderRegistry(),
      contextProviderRegistry: createContextProviderRegistry(),
      logger: { warn: (m: string) => warnings.push(m) } as never,
      loadBackends: async () => [
        { app: 'alpha', backend: backend('first') },
        { app: 'alpha', backend: backend('second') },
      ],
    })

    await host.reconcile()
    expect(host.wired()).toEqual(['alpha'])
    expect(warnings.some((warning) => warning.includes('duplicate mini app backend id'))).toBe(true)
  })

  it('a mini app STILL tears down its own mount on disable', async () => {
    // The reverse direction: if the identity check over-reaches, disabled mini apps keep
    // serving traffic forever. Guards the fix above from becoming a leak.
    const enabled = new Set<string>(['solo'])
    const mk = (name: string): BackendSubsystem => {
      const app = new Hono()
      app.get('/who', (c) => c.json({ who: name }))
      return { id: `${name}:backend`, routeMount: { path: `/rpc/${name}`, app: app as never } }
    }
    const host = createMiniAppBackendHost({
      subsystemRegistry: createSubsystemRegistry(),
      capabilityRegistry: createCapabilityRegistry(),
      wsFrameRegistry: createWsFrameRegistry(),
      resourceRefsRegistry: createResourceProviderRegistry(),
      contextProviderRegistry: createContextProviderRegistry(),
      loadBackends: async () => [...enabled].map((name) => ({ app: name, backend: mk(name) })),
    })
    const app = new Hono()
    app.use('*', host.middleware())
    app.get('*', (c) => c.json({ core: true }, 404))

    await host.reconcile()
    expect((await app.request('/rpc/solo/who')).status).toBe(200)
    enabled.delete('solo')
    await host.reconcile()
    expect((await app.request('/rpc/solo/who')).status).toBe(404)
  })
})

/**
 * Capabilities were the documented exception to hot toggling: "registered on first wire and never
 * unregistered", with the consumer side resolving them ONCE into chat deps at boot. That broke both
 * directions — a mini app enabled after boot never lit up, and a DISABLED mini app's implementation kept
 * being called, because the deps object still held the function it had captured. This covers the
 * registry half; `bootstrap.ts` now passes a resolver rather than a value for the other half.
 */
describe('capabilities follow the wire/unwire lifecycle', () => {
  it('registers on wire, drops on disable, and comes back on re-enable', async () => {
    const h = setup()
    await h.host.reconcile()
    expect(h.registries.capabilityRegistry.get(CAP_DOCUMENT_EXTRACT)).toBeDefined()

    // Disable: the mini app's code must stop serving core, not merely stop taking new routes.
    h.enabled.delete('sample')
    await h.host.reconcile()
    expect(h.registries.capabilityRegistry.get(CAP_DOCUMENT_EXTRACT)).toBeUndefined()

    // Re-enable: the `capabilitiesWired` bookkeeping must have been cleared too, or the second wire
    // would be skipped as already-registered and the capability would never return.
    h.enabled.add('sample')
    await h.host.reconcile()
    expect(h.registries.capabilityRegistry.get(CAP_DOCUMENT_EXTRACT)).toBeDefined()
  })

  it('a first-wins loser cannot evict the winner it lost to', async () => {
    const registry = createCapabilityRegistry()
    registry.register('winner', { [CAP_DOCUMENT_EXTRACT]: (async () => ({ text: 'w' })) as never })
    registry.register('loser', { [CAP_DOCUMENT_EXTRACT]: (async () => ({ text: 'l' })) as never })
    // The loser's declaration was ignored at register time; unregistering it must not take the
    // winner's entry with it.
    registry.unregister('loser')
    expect(registry.get(CAP_DOCUMENT_EXTRACT)).toBeDefined()
    registry.unregister('winner')
    expect(registry.get(CAP_DOCUMENT_EXTRACT)).toBeUndefined()
  })
})

describe('per-request scope', () => {
  /** A subsystem whose route ECHOES its Hono env — i.e. what the host handed it. */
  function scopeEchoBackend(): BackendSubsystem {
    const app = new Hono()
    app.get('/where', (c) => c.json({ env: c.env ?? null }))
    return { id: 'scoped:backend', routeMount: { path: '/rpc/scoped', app: app as never } }
  }

  function scopedSetup(
    resolveScope?: Parameters<typeof createMiniAppBackendHost>[0]['resolveScope'],
  ) {
    const host = createMiniAppBackendHost({
      subsystemRegistry: createSubsystemRegistry(),
      capabilityRegistry: createCapabilityRegistry(),
      wsFrameRegistry: createWsFrameRegistry(),
      resourceRefsRegistry: createResourceProviderRegistry(),
      contextProviderRegistry: createContextProviderRegistry(),
      loadBackends: async () => [{ app: 'scoped', backend: scopeEchoBackend() }],
      ...(resolveScope ? { resolveScope } : {}),
    })
    const app = new Hono<{ Variables: { userId: string } }>()
    // The app.ts shape: userId is a context variable set by app middleware BEFORE the dispatcher.
    app.use('*', async (c, next) => {
      const scopedContext = c as unknown as {
        set(key: 'userId', value: string): void
      }
      scopedContext.set('userId', 'user-a')
      await next()
    })
    app.use('*', host.middleware())
    return { host, app }
  }

  it('hands the mini app route the scope resolved for THIS request', async () => {
    // The point of the seam: two calls, two projects, one wired backend.
    const { host, app } = scopedSetup(({ userId, request }) => {
      const projectId = new URL(request.url).searchParams.get('projectId') ?? ''
      return { userId, projectId, cwd: `/repos/${projectId || 'default'}` }
    })
    await host.reconcile()

    const first = await (await app.request('/rpc/scoped/where?projectId=alpha')).json()
    expect(first).toEqual({ env: { userId: 'user-a', projectId: 'alpha', cwd: '/repos/alpha' } })

    // Same wired instance, different project — the captured-at-load cwd could not do this.
    const second = await (await app.request('/rpc/scoped/where?projectId=beta')).json()
    expect(second).toEqual({ env: { userId: 'user-a', projectId: 'beta', cwd: '/repos/beta' } })
  })

  it('a host with no resolver still serves the route, with no environment', async () => {
    const { host, app } = scopedSetup()
    await host.reconcile()
    const res = await app.request('/rpc/scoped/where')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ env: null })
  })

  it('a THROWING resolver degrades to no environment rather than a 500', async () => {
    // A mini app route that does not need scope must not be taken down by scope resolution.
    const { host, app } = scopedSetup(() => {
      throw new Error('project lookup exploded')
    })
    await host.reconcile()
    const res = await app.request('/rpc/scoped/where')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ env: null })
  })
})

describe('what the backend host tells a person', () => {
  function reportingSetup() {
    const reports: Array<[string, readonly string[]]> = []
    const reconciles: Array<string | undefined> = []
    let backends: Array<{ app: string; backend: BackendSubsystem }> = []
    let explode = false
    const host = createMiniAppBackendHost({
      subsystemRegistry: createSubsystemRegistry(),
      capabilityRegistry: createCapabilityRegistry(),
      wsFrameRegistry: createWsFrameRegistry(),
      resourceRefsRegistry: createResourceProviderRegistry(),
      contextProviderRegistry: createContextProviderRegistry(),
      loadBackends: async () => {
        if (explode) throw new Error('catalog unreadable')
        return backends
      },
      conditions: {
        backendProblems: (app, problems) => reports.push([app, problems]),
        reconciled: (error) => reconciles.push(error),
      },
    })
    return {
      host,
      reports,
      reconciles,
      set: (next: typeof backends) => (backends = next),
      explode: (on: boolean) => (explode = on),
    }
  }

  it('reports a refused backend with its reason, and a clean pass for it once fixed', async () => {
    const t = reportingSetup()
    t.set([{ app: 'bad', backend: { id: 'unowned' } }])
    await t.host.reconcile()
    expect(t.reports).toEqual([
      ['bad', ['backend subsystem identity "unowned" must be namespaced by owner "bad:"']],
    ])
    t.reports.length = 0
    t.set([{ app: 'bad', backend: { id: 'bad:backend' } }])
    await t.host.reconcile()
    expect(t.reports).toEqual([['bad', []]])
  })

  it('names the mini app whose backend id another mini app already owns', async () => {
    const t = reportingSetup()
    t.set([
      { app: 'first', backend: { id: 'first:backend' } },
      // Owner-namespaced by the identity rule's standard, but the id is taken this pass.
      { app: 'first', backend: { id: 'first:backend' } },
    ])
    await t.host.reconcile()
    expect(t.reports).toEqual([
      ['first', ['backend id "first:backend" is already used by "first"']],
    ])
  })

  it('keeps a failed reconcile visible until a pass succeeds', async () => {
    const t = reportingSetup()
    t.explode(true)
    await expect(t.host.reconcile()).rejects.toThrow('catalog unreadable')
    t.explode(false)
    await t.host.reconcile()
    expect(t.reconciles).toEqual(['catalog unreadable', undefined])
  })
})

describe('releasing host registrations of a mini app that is no longer wired', () => {
  it('releases the mini app on disable, not on a rebuild that keeps it', async () => {
    const counters = { registered: 0, shutdown: 0 }
    let revision = 'build-1'
    const enabled = new Set(['sample'])
    const released: string[] = []
    const host = createMiniAppBackendHost({
      subsystemRegistry: createSubsystemRegistry(),
      capabilityRegistry: createCapabilityRegistry(),
      wsFrameRegistry: createWsFrameRegistry(),
      resourceRefsRegistry: createResourceProviderRegistry(),
      contextProviderRegistry: createContextProviderRegistry(),
      loadBackends: async () =>
        [...enabled].map((name) => ({ app: name, revision, backend: makeBackend(name, counters) })),
      releaseHostServices: async (app) => {
        released.push(app)
      },
    })
    await host.reconcile()
    revision = 'build-2'
    await host.reconcile()
    expect(host.wired()).toEqual(['sample'])
    expect(released).toEqual([])
    enabled.delete('sample')
    await host.reconcile()
    expect(released).toEqual(['sample'])
  })
})
