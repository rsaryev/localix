import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { UNDECIDED } from '../capabilities/availability'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'

import { loadMiniAppBackends } from './loader'
import { makeApiScratchDir } from '../../testing/scratch-dir'
import { createSubsystemRegistry } from '../ext/subsystem-contrib'
import { createWsFrameRegistry, createWsFrameConnection } from '../ext/ws-frame-registry'
import { createResourceProviderRegistry } from '../agent-core/resource-refs/provider'
import { createSearchProviderRegistry } from '../agent-core/search/provider'

declare global {
  // eslint-disable-next-line no-var
  var __TEST_SUB_STOP__: number | undefined
  // eslint-disable-next-line no-var
  var __TEST_SUB_SHUTDOWN__: number | undefined
}

// Proves the additive BACKEND contribution seam end-to-end WITHOUT a real subsystem:
// a bundled plugin whose register() returns a `backend` gets its route mounted, its
// resource + search providers registered, its ws-frame reachable via the registry,
// and its onShutdown hook called — exactly how bootstrap wires the registries.

// No DB rows — the fixture plugin is bundled + `defaultEnabled: true`, so it is
// enabled without any stored state.
const emptyRepo: CapabilitySourceRepository = {
  listForScope: async () => [],
  get: async () => null,
  upsert: async () => ({
    id: 'x',
    userId: 'u',
    projectId: '',
    name: 'x',
    enabled: false,
    config: {},
    source: 'local',
    createdAt: '',
    updatedAt: '',
  }),
  patchConfig: async (_userId, projectId, name, patch) => ({
    id: 'x',
    userId: 'u',
    projectId,
    name,
    enabled: false,
    config: patch,
    source: 'local',
    createdAt: '',
    updatedAt: '',
  }),
  remove: async () => {},
}

// The fixture lives UNDER the api package so the plugin's `.mjs` can resolve `hono` from the
// monorepo's node_modules (an OS temp dir cannot), in its scratch root outside `src`.
const fixtureBase = makeApiScratchDir('backend-fixture')
const fixtureRoot = join(fixtureBase, 'bundled')
const fixtureHome = join(fixtureBase, 'home')
const prevEnv = process.env.LOCALIX_BUNDLED_PLUGINS_DIR

beforeAll(async () => {
  const plugin = join(fixtureRoot, 'test-sub')
  await fs.mkdir(fixtureHome, { recursive: true })
  await fs.mkdir(join(plugin, 'tools'), { recursive: true })
  await fs.writeFile(
    join(plugin, 'plugin.json'),
    JSON.stringify({
      name: 'test-sub',
      version: '1.0.0',
      apiVersion: 1,
      // Bundled + code-bearing → opt-in by default; opt in here so it loads at boot.
      defaultEnabled: true,
      description: 'fixture backend subsystem',
      tools: './tools/index.mjs',
    }),
  )
  // register(ctx) returns a BackendSubsystem (route + resource/search providers +
  // a live ws-frame + shutdown). Side-effect counters ride globalThis so the test
  // can observe the ws-frame `stop` and `onShutdown` firing.
  await fs.writeFile(
    join(plugin, 'tools', 'index.mjs'),
    `import { Hono } from 'hono'

export async function register() {
  const app = new Hono()
  app.get('/ping', (c) => c.json({ ok: true, sub: 'test-sub' }))

  const resourceProvider = {
    provider: 'test-sub',
    title: 'Test Subsystem',
    listChildren: async () => [],
    expand: async () => ({ ok: true, content: '' }),
  }
  const searchProvider = {
    id: 'test-sub',
    title: 'Test Subsystem',
    search: async () => [],
  }
  const wsFrames = [{
    subscribeCommand: 'test-sub.watch.subscribe',
    unsubscribeCommand: 'test-sub.watch.unsubscribe',
    frameTag: 'x',
    start: (params, send) => {
      send(JSON.stringify({ hello: params.name ?? 'world' }))
      return { name: params.name }
    },
    stop: () => { globalThis.__TEST_SUB_STOP__ = (globalThis.__TEST_SUB_STOP__ ?? 0) + 1 },
  }]

  return {
    backend: {
      id: 'test-sub',
      routeMount: { path: '/rpc/test-sub', app },
      resourceProvider,
      searchProvider,
      wsFrames,
      onShutdown: () => { globalThis.__TEST_SUB_SHUTDOWN__ = (globalThis.__TEST_SUB_SHUTDOWN__ ?? 0) + 1 },
    },
  }
}
`,
  )

  process.env.LOCALIX_BUNDLED_PLUGINS_DIR = fixtureRoot
  globalThis.__TEST_SUB_STOP__ = 0
  globalThis.__TEST_SUB_SHUTDOWN__ = 0
})

afterAll(async () => {
  if (prevEnv === undefined) delete process.env.LOCALIX_BUNDLED_PLUGINS_DIR
  else process.env.LOCALIX_BUNDLED_PLUGINS_DIR = prevEnv
  await fs.rm(fixtureBase, { recursive: true, force: true })
})

describe('loadMiniAppBackends', () => {
  it("collects an enabled plugin's backend contribution", async () => {
    const { backends } = await loadMiniAppBackends({
      availability: UNDECIDED,
      repo: emptyRepo,
      userId: 'u',
      cwd: '/',
      homeDir: fixtureHome,
    })
    const entry = backends.find((b) => b.backend.id === 'test-sub')
    expect(entry).toBeDefined()
    // The owning plugin's name rides along so the backend host can diff per plugin.
    expect(entry?.pluginName).toBe('test-sub')
    const sub = entry?.backend
    expect(sub?.routeMount?.path).toBe('/rpc/test-sub')
    expect(sub?.resourceProvider).toBeDefined()
    expect(sub?.searchProvider).toBeDefined()
    expect(sub?.wsFrames?.length).toBe(1)
  })

  /**
   * WHAT THIS PROVES, AND WHAT IT DOES NOT.
   *
   * It proves the contribution SHAPE is CONSUMABLE: a backend returned by
   * `loadMiniAppBackends` can be fed to each registry, its route answers, its providers
   * resolve, its WS frame streams, its shutdown hook fires.
   *
   * It does NOT prove the composition root still does any of that. The loops below are
   * COPIES of the ones in bootstrap.ts / app.ts / index.ts, so this test cannot observe
   * those files at all — delete the shutdown loop from index.ts and every assertion here
   * still passes. (Verified by mutation. A test asserting against a reimplementation of
   * the code under test certifies the reimplementation.)
   *
   * The missing half is `features/ext/subsystem-contrib-contract.test.ts`, which reads the
   * REAL composition root and fails if any contributable field stops being consumed.
   */
  it('a loaded backend is CONSUMABLE by each registry (shape, not wiring — see the contract test)', async () => {
    const { backends } = await loadMiniAppBackends({
      availability: UNDECIDED,
      repo: emptyRepo,
      userId: 'u',
      cwd: '/',
      homeDir: fixtureHome,
    })

    // A COPY of bootstrap's loop, not bootstrap's loop. See the note above.
    const subsystemRegistry = createSubsystemRegistry()
    const wsFrameRegistry = createWsFrameRegistry()
    const resourceRegistry = createResourceProviderRegistry()
    const searchRegistry = createSearchProviderRegistry()
    for (const { backend } of backends) {
      subsystemRegistry.register(backend)
      if (backend.resourceProvider) resourceRegistry.register(backend.resourceProvider)
      if (backend.searchProvider) searchRegistry.register(backend.searchProvider)
      for (const frame of backend.wsFrames ?? []) wsFrameRegistry.register(frame)
    }

    // 1) Route mounts (mirror app.ts's subsystem route loop) and answers.
    const app = new Hono()
    for (const s of subsystemRegistry.list()) {
      if (s.routeMount) app.route(s.routeMount.path, s.routeMount.app)
    }
    const res = await app.request('/rpc/test-sub/ping')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, sub: 'test-sub' })

    // 2) Resource + search providers are registered under their keys.
    expect(resourceRegistry.get('test-sub')).toBeDefined()
    expect(searchRegistry.get('test-sub')).toBeDefined()

    // 3) The ws-frame is reachable via the generic per-connection registry path:
    //    a subscribe command spawns the stream and pushes a `<frameTag>\n<json>` frame.
    const stopBefore = globalThis.__TEST_SUB_STOP__ ?? 0
    const frames: string[] = []
    const conn = createWsFrameConnection(wsFrameRegistry, (f) => frames.push(f), { userId: 'u1' })
    const owned = conn.subscribe('test-sub.watch.subscribe', { name: 'abc' })
    expect(owned).toBe(true)
    expect(frames).toEqual(['x\n{"hello":"abc"}'])
    // An unrecognized command is NOT owned by the registry.
    expect(conn.subscribe('nope.subscribe', {})).toBe(false)
    // Teardown (socket close) calls the contribution's stop().
    conn.teardown()
    expect((globalThis.__TEST_SUB_STOP__ ?? 0) - stopBefore).toBe(1)

    // 4) onShutdown runs (mirror index.ts's shutdown loop).
    const shutdownBefore = globalThis.__TEST_SUB_SHUTDOWN__ ?? 0
    for (const s of subsystemRegistry.list()) {
      if (s.onShutdown) await Promise.resolve(s.onShutdown())
    }
    expect((globalThis.__TEST_SUB_SHUTDOWN__ ?? 0) - shutdownBefore).toBe(1)
  })
})
