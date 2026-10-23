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
 * revision or awaits `whenUiSurfacesReady()`. The entry-graph half is the startup
 * budget's job; these tests pin the other: the one reader that must see a complete
 * catalog — the agent-facing catalog publication — cannot publish before discovery
 * settles.
 */
const catalogSyncCallSite = readFileSync(
  new URL('../../pages/chat/model/useMiniAppContributions.ts', import.meta.url),
  'utf8',
)

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  mock.restore()
})

test('the route publishes the catalog gated on staged discovery, after failing closed', () => {
  // The call site is the only place that hands the discovery promise to the sync. Without it the
  // behavioural gate below never engages; and the scope must be prepared synchronously first, or
  // project B's first catalog can capture project A's plugin destinations.
  const prepare = catalogSyncCallSite.indexOf('prepareMiniAppContribScope(routeProjectId)')
  const publish = catalogSyncCallSite.indexOf(
    'startUiLocationCatalogSync(routeProjectId, whenUiSurfacesReady())',
  )
  expect(prepare).toBeGreaterThan(-1)
  expect(publish).toBeGreaterThan(prepare)
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
