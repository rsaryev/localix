import { afterEach, expect, mock, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { startUiLocationCatalogSync } from './uiLocationCatalogSync'

/**
 * The staging rule for core UI contribution discovery.
 *
 * `contrib.{ts,tsx}` is EAGER: a rail section and a work-item kind must exist
 * before the shell paints. `*.surface.{ts,tsx}` is STAGED: ~80 declarations, each
 * dragging its own icon and sometimes its owner's model module, none of them read
 * during first paint. Eager-globbing them put all of that in the entry graph,
 * which `scripts/check-ui-startup-budget.mjs` ratchets.
 *
 * Staging is only safe while every reader either subscribes to the registry
 * revision or awaits `whenUiSurfacesReady()`. These tests pin both halves: the
 * glob stays lazy, AND the one reader that must see a complete catalog — the
 * agent-facing catalog publication — cannot publish before discovery settles.
 */
const discovery = readFileSync(new URL('./discover.ts', import.meta.url), 'utf8')
const manifest = readFileSync(new URL('./uiSurfaceManifest.ts', import.meta.url), 'utf8')
const catalogSync = readFileSync(new URL('./uiLocationCatalogSync.ts', import.meta.url), 'utf8')
const viteConfig = readFileSync(new URL('../../../vite.config.ts', import.meta.url), 'utf8')
const catalogSyncCallSite = readFileSync(
  new URL('../../pages/chat/model/usePluginContributions.ts', import.meta.url),
  'utf8',
)

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  mock.restore()
})

test('feature contribs stay eager and surface declarations stay staged', () => {
  expect(discovery).toContain(
    "import.meta.glob('/src/features/*/contrib.{ts,tsx}', { eager: true })",
  )
  // The surface glob lives behind the lazy manifest boundary and nowhere else.
  // Reintroducing it here would put every declaration back in the entry chunk.
  expect(discovery).not.toContain("import.meta.glob('/src/**/*.surface.{ts,tsx}'")
  expect(manifest).toContain("'/src/**/*.surface.{ts,tsx}'")
  expect(discovery).toContain("import('./uiSurfaceManifest')")
})

test('the manifest stays one chunk rather than one chunk per declaration', () => {
  // Eager INSIDE the lazy boundary. A lazy glob here would emit ~80 chunks and
  // force every module they share with the shell into further shared chunks —
  // startup requests traded for startup bytes.
  expect(manifest).toContain('{ eager: true }')
})

test('discoverUi starts the staged pass at composition without blocking on it', () => {
  // Started, not awaited: registration is in flight from the earliest possible
  // moment, but the entry chunk never waits for those modules.
  expect(discovery).toContain('void whenUiSurfacesReady()')
  expect(discovery).toMatch(/export function whenUiSurfacesReady\(\): Promise<void>/)
  // One registration pass over the whole set keeps first-owner-wins ownership
  // deterministic instead of depending on chunk arrival order.
  expect(discovery).toContain('registerDiscoveredUiSurfaces(uiSurfaceModules, registerSurface)')
})

test('the startup icon group cannot pull lazy-only icons onto the startup path', () => {
  // `$initial` is load-bearing: without it the group hoists every icon in the
  // app — including ones only a lazy surface renders — into a chunk the startup
  // document preloads. Measured: +43 kB of startup bytes for glyphs nothing on
  // screen needs yet.
  const group = viteConfig.slice(viteConfig.indexOf("name: 'startup-icons'"))
  expect(group).toContain("tags: ['$initial']")
  expect(group).toContain('includeDependenciesRecursively: false')
})

test('the agent catalog publication is gated on staged discovery', () => {
  expect(catalogSync).toContain('whenContributionsReady: Promise<void>')
  expect(catalogSync).toContain('queue: (run) => afterContributions(() => enqueueMicrotask(run))')
  expect(catalogSyncCallSite).toContain(
    'startUiLocationCatalogSync(routeProjectId, whenUiSurfacesReady())',
  )
})

test('no catalog is published until staged discovery settles', async () => {
  let settleDiscovery!: () => void
  const contributionsReady = new Promise<void>((resolve) => {
    settleDiscovery = resolve
  })
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    (async () =>
      new Response(JSON.stringify({ catalogId: 'ui1_staged', accepted: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof globalThis.fetch,
  )
  const stop = startUiLocationCatalogSync('project-staged', contributionsReady)

  try {
    await tick()
    // Publishing here would hand the agent a catalog missing every colocated
    // core destination, and only correct it on the invalidation follow-up.
    expect(fetch).not.toHaveBeenCalled()

    settleDiscovery()
    await tick()
    expect(fetch).toHaveBeenCalledTimes(1)
  } finally {
    stop()
  }
})

test('failed staged discovery still publishes whatever registered', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    (async () =>
      new Response(JSON.stringify({ catalogId: 'ui1_degraded', accepted: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof globalThis.fetch,
  )
  const stop = startUiLocationCatalogSync(
    'project-degraded',
    Promise.reject(new Error('a surface module failed to load')),
  )

  try {
    await tick()
    expect(fetch).toHaveBeenCalledTimes(1)
  } finally {
    stop()
  }
})
