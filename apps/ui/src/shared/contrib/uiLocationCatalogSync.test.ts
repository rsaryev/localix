import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import {
  UI_AGENT_LOCATION_CATALOG_VERSION,
  type UiAgentLocationCatalogSnapshot,
} from '@localixai/plugin-sdk/ui'
import {
  createUiLocationCatalogSync,
  readyWorkbenchToolSurface,
  readyWorkbenchToolSurfaceForProject,
  startUiLocationCatalogSync,
  type UiLocationCatalogSyncPorts,
} from './uiLocationCatalogSync'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function snapshot(revision = 1, title = 'Terminal'): UiAgentLocationCatalogSnapshot {
  return {
    version: UI_AGENT_LOCATION_CATALOG_VERSION,
    revision,
    locations: [
      {
        uri: 'localix://ui/work-item/terminal',
        title,
        description: 'Reveal or create a workspace terminal.',
        surface: 'work-item',
        params: {},
      },
    ],
  }
}

function harness(
  publish: UiLocationCatalogSyncPorts['publish'] = async () => ({ catalogId: 'ui1_initial' }),
) {
  let currentSnapshot = snapshot()
  let locationListener: (() => void) | null = null
  let reconnectListener: (() => void) | null = null
  const queued: Array<() => void> = []
  const retries: Array<() => void> = []
  const delays: number[] = []
  const published: string[] = []
  const unsubscribed: string[] = []
  const cancelled: unknown[] = []
  const ports: UiLocationCatalogSyncPorts = {
    snapshot: () => currentSnapshot,
    publish,
    subscribeLocations: (listener) => {
      locationListener = listener
      return () => {
        locationListener = null
        unsubscribed.push('locations')
      }
    },
    subscribeReconnect: (listener) => {
      reconnectListener = listener
      return () => {
        reconnectListener = null
        unsubscribed.push('reconnect')
      }
    },
    queue: (run) => queued.push(run),
    scheduleRetry: (run, delayMs) => {
      retries.push(run)
      delays.push(delayMs)
      return retries.length as unknown as ReturnType<typeof setTimeout>
    },
    cancelRetry: (timer) => cancelled.push(timer),
    onPublished: (catalogId) => published.push(catalogId),
  }
  return {
    ports,
    queued,
    retries,
    delays,
    published,
    unsubscribed,
    cancelled,
    update(next: UiAgentLocationCatalogSnapshot) {
      currentSnapshot = next
      locationListener?.()
    },
    reconnect() {
      reconnectListener?.()
    },
  }
}

afterEach(() => {
  mock.restore()
})

describe('UI location catalog frontend sync', () => {
  test('holds an early run until the active route publishes its immutable catalog id', async () => {
    let finishPublish!: (response: Response) => void
    const response = new Promise<Response>((resolve) => {
      finishPublish = resolve
    })
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(
      (async () => response) as unknown as typeof globalThis.fetch,
    )
    const stop = startUiLocationCatalogSync('project-7', Promise.resolve())

    try {
      await tick()
      expect(fetch).toHaveBeenCalledTimes(1)

      let settled = false
      const surfacePromise = readyWorkbenchToolSurface(1_000).then((surface) => {
        settled = true
        return surface
      })
      await tick()
      expect(settled).toBe(false)

      finishPublish(
        new Response(JSON.stringify({ catalogId: 'ui1_ready', accepted: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      expect(await surfacePromise).toEqual({
        capabilities: ['workbench-ui'],
        catalogs: { 'workbench-ui': 'ui1_ready' },
      })
    } finally {
      stop()
    }
  })

  test('follows a route replacement instead of releasing on the old catalog teardown', async () => {
    const finishes: Array<(response: Response) => void> = []
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(
      (async () =>
        new Promise<Response>((resolve) => {
          finishes.push(resolve)
        })) as unknown as typeof globalThis.fetch,
    )
    const stopFirst = startUiLocationCatalogSync('project-a', Promise.resolve())
    await tick()
    expect(fetch).toHaveBeenCalledTimes(1)

    const surfacePromise = readyWorkbenchToolSurface(1_000)
    stopFirst()
    const stopSecond = startUiLocationCatalogSync('project-b', Promise.resolve())
    try {
      await tick()
      expect(fetch).toHaveBeenCalledTimes(2)

      finishes[1]?.(
        new Response(JSON.stringify({ catalogId: 'ui1_project_b', accepted: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      expect(await surfacePromise).toEqual({
        capabilities: ['workbench-ui'],
        catalogs: { 'workbench-ui': 'ui1_project_b' },
      })
    } finally {
      finishes[0]?.(
        new Response(JSON.stringify({ catalogId: 'ui1_project_a', accepted: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      stopSecond()
    }
  })

  test('holds the next run while a changed registry publishes its fresh catalog', async () => {
    let finishRefresh!: (response: Response) => void
    const refreshResponse = new Promise<Response>((resolve) => {
      finishRefresh = resolve
    })
    const fetch = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ catalogId: 'ui1_before_plugin', accepted: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockImplementationOnce((async () => refreshResponse) as unknown as typeof globalThis.fetch)
    const { registerUiLocation, unregisterUiLocation } = await import('./uiLocations')
    const locationId = 'test.catalog-refresh.plugin-settings'
    const stop = startUiLocationCatalogSync('project-refresh', Promise.resolve())

    try {
      expect(await readyWorkbenchToolSurface(1_000)).toEqual({
        capabilities: ['workbench-ui'],
        catalogs: { 'workbench-ui': 'ui1_before_plugin' },
      })

      expect(
        registerUiLocation({
          id: locationId,
          uri: 'localix://ui/settings/test-catalog-refresh',
          title: 'Fresh plugin settings',
          description: 'Open settings contributed by a newly enabled plugin.',
          agent: { description: 'Open settings contributed by a newly enabled plugin.' },
          effect: 'read',
          surface: 'settings',
          exposure: {},
          resolve: () => ({ kind: 'settings', tab: 'plugins' }),
        }),
      ).toBe(true)
      await tick()
      expect(fetch).toHaveBeenCalledTimes(2)

      let settled = false
      const surfacePromise = readyWorkbenchToolSurface(1_000).then((surface) => {
        settled = true
        return surface
      })
      await tick()
      expect(settled).toBe(false)

      finishRefresh(
        new Response(JSON.stringify({ catalogId: 'ui1_after_plugin', accepted: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      expect(await surfacePromise).toEqual({
        capabilities: ['workbench-ui'],
        catalogs: { 'workbench-ui': 'ui1_after_plugin' },
      })
    } finally {
      stop()
      unregisterUiLocation(locationId)
    }
  })

  test('reuses only the target project catalog for a cross-project retry', async () => {
    spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ catalogId: 'ui1_project_retry_a', accepted: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ catalogId: 'ui1_project_retry_b', accepted: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    const stopFirst = startUiLocationCatalogSync('project-retry-a', Promise.resolve())
    await tick()
    stopFirst()
    const stopSecond = startUiLocationCatalogSync('project-retry-b', Promise.resolve())

    try {
      await tick()
      expect(await readyWorkbenchToolSurfaceForProject('project-retry-a')).toEqual({
        capabilities: ['workbench-ui'],
        catalogs: { 'workbench-ui': 'ui1_project_retry_a' },
      })
      expect(await readyWorkbenchToolSurfaceForProject('project-retry-b')).toEqual({
        capabilities: ['workbench-ui'],
        catalogs: { 'workbench-ui': 'ui1_project_retry_b' },
      })
    } finally {
      stopSecond()
    }
  })

  test('does not reuse a stale catalog when the same project starts a fresh sync', async () => {
    const fetch = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ catalogId: 'ui1_old_same_project', accepted: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockImplementationOnce(
        (async () => new Promise<Response>(() => {})) as unknown as typeof globalThis.fetch,
      )
    const stopFirst = startUiLocationCatalogSync('project-same', Promise.resolve())
    await tick()
    expect(fetch).toHaveBeenCalledTimes(1)
    stopFirst()

    const stopSecond = startUiLocationCatalogSync('project-same', Promise.resolve())
    try {
      await tick()
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(await readyWorkbenchToolSurfaceForProject('project-same', 0)).toEqual({
        capabilities: ['workbench-ui'],
      })
    } finally {
      stopSecond()
    }
  })

  test('publishes the complete initial snapshot for the active project', async () => {
    const publish = mock(
      async (_projectId: string | null, _snapshot: UiAgentLocationCatalogSnapshot) => ({
        catalogId: 'ui1_terminal',
      }),
    )
    const h = harness(publish)
    const stop = createUiLocationCatalogSync('project-7', h.ports)

    expect(h.queued).toHaveLength(1)
    h.queued.shift()!()
    await tick()

    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0]).toEqual(['project-7', snapshot()])
    expect(h.published).toEqual(['ui1_terminal'])
    stop()
  })

  test('coalesces registry changes while one publication is in flight', async () => {
    let completeFirst!: (value: { catalogId: string }) => void
    const first = new Promise<{ catalogId: string }>((resolve) => {
      completeFirst = resolve
    })
    const publish = mock(
      async (_projectId: string | null, _snapshot: UiAgentLocationCatalogSnapshot) => first,
    )
      .mockImplementationOnce(
        (_projectId: string | null, _snapshot: UiAgentLocationCatalogSnapshot) => first,
      )
      .mockResolvedValueOnce({ catalogId: 'ui1_updated' })
    const h = harness(publish)
    const stop = createUiLocationCatalogSync(null, h.ports)

    h.queued.shift()!()
    await tick()
    h.update(snapshot(2, 'Integrated terminal'))
    h.update(snapshot(3, 'Workspace terminal'))
    while (h.queued.length > 0) h.queued.shift()!()
    expect(publish).toHaveBeenCalledTimes(1)

    completeFirst({ catalogId: 'ui1_initial' })
    await tick()

    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish.mock.calls[1]?.[1]).toEqual(snapshot(3, 'Workspace terminal'))
    expect(h.published).toEqual(['ui1_updated'])
    stop()
  })

  test('force-publishes unchanged content after a transport reconnect', async () => {
    const publish = mock(
      async (_projectId: string | null, _snapshot: UiAgentLocationCatalogSnapshot) => ({
        catalogId: 'ui1_same',
      }),
    )
    const h = harness(publish)
    const stop = createUiLocationCatalogSync(null, h.ports)

    h.queued.shift()!()
    await tick()
    h.reconnect()
    h.queued.shift()!()
    await tick()

    expect(publish).toHaveBeenCalledTimes(2)
    expect(h.published).toEqual(['ui1_same', 'ui1_same'])
    stop()
  })

  /**
   * A restarting API answers 502, and every failed non-GET request raises an incident. At a
   * flat one-second retry the sidecar turned that restart into a stream of identical
   * "PUT ui-locations failed" notifications — the outage reported dozens of times.
   */
  test('backs off between failed publishes and reports the outage once', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    let failing = true
    const publish = mock(async () => {
      if (failing) throw new Error('sidecar unavailable')
      return { catalogId: 'ui1_back' }
    })
    const h = harness(publish)
    const stop = createUiLocationCatalogSync('project-7', h.ports)

    h.queued.shift()!()
    await tick()
    for (let attempt = 0; attempt < 6; attempt++) {
      h.retries.at(-1)!()
      await tick()
    }

    expect(h.delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000])
    expect(
      warn.mock.calls.filter((call) =>
        String(call[0]).includes('[ui-locations] catalog sync failed'),
      ),
    ).toHaveLength(1)

    // Recovery resets the ladder, so the next outage is reported and retried promptly again.
    failing = false
    h.retries.at(-1)!()
    await tick()
    expect(h.published).toEqual(['ui1_back'])

    failing = true
    h.update(snapshot(2, 'Terminal panel'))
    h.queued.shift()!()
    await tick()
    expect(h.delays.at(-1)).toBe(1_000)

    stop()
  })

  test('retries failures and teardown cancels every remaining effect', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    const publish = mock(
      async (_projectId: string | null, _snapshot: UiAgentLocationCatalogSnapshot) => {
        throw new Error('sidecar unavailable')
      },
    )
    const h = harness(publish)
    const stop = createUiLocationCatalogSync('project-7', h.ports)

    h.queued.shift()!()
    await tick()
    expect(h.retries).toHaveLength(1)

    stop()
    h.retries[0]!()
    await tick()

    expect(publish).toHaveBeenCalledTimes(1)
    expect(h.unsubscribed).toEqual(['locations', 'reconnect'])
    expect(h.cancelled).toHaveLength(1)
    // Count only this module's warnings. `console.warn` is process-wide and `bun test`
    // runs every file in one process, so a spy's window also collects whatever other
    // suites' pending async work logs — a raw call count is not this test's alone.
    expect(
      warn.mock.calls.filter((call) =>
        String(call[0]).includes('[ui-locations] catalog sync failed'),
      ),
    ).toHaveLength(1)
  })
})
