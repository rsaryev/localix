import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { CapabilitySnapshot, MiniAppRecord, MiniAppViewSpec } from '@/shared/api/contracts'
import {
  __resetMiniAppContrib,
  announceMiniAppUiChanged,
  miniAppCapabilityVersion,
  miniAppContribSnapshot,
  miniAppContribVersion,
  prepareMiniAppContribScope,
  refetchActiveMiniAppContrib,
  refetchMiniAppContrib,
  restoreMiniAppContribFrame,
  startMiniAppContribSync,
  type MiniAppContribSource,
} from './enabledMiniApps'
import { backendClient } from '@/shared/api/client'
import { __resetThirdPartyViews, listThirdPartyViews } from './runtimeViews'
import { resolveUiLocation } from './uiLocations'
import { areMiniAppContributionsPending, miniAppContributionActivation } from './miniAppActivation'
import type { MiniAppUiSettled } from './miniAppUiLoads'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function miniApp(name: string, enabled = true): MiniAppRecord {
  return { name, enabled } as MiniAppRecord
}

function view(app: string, id: string): MiniAppViewSpec {
  return {
    app,
    projectId: '',
    id,
    fullName: `${app}:${id}`,
    title: id,
  }
}

const EMPTY_TOOLS: CapabilitySnapshot['tools'] = {
  enabled: [],
  disabled: [],
  catalog: [],
  categoryLabels: {},
  mcp: [],
  mcpUnprobedServers: [],
}

function snapshot(over: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    revision: 1,
    scope: { projectId: '', agentId: null },
    plugins: [],
    miniApps: [],
    tools: EMPTY_TOOLS,
    views: [],
    themes: [],
    agents: [],
    commands: [],
    miniAppCommands: [],
    mcp: [],
    skills: [],
    tips: [],
    grammar: { kinds: [], effects: [], classes: [], examples: [] },
    ...over,
  }
}

/** One capability-snapshot loader — the store's whole data source is this one call. */
function source(over: Partial<CapabilitySnapshot> = {}): MiniAppContribSource {
  return { loadSnapshot: async () => snapshot(over) }
}

afterEach(() => {
  __resetMiniAppContrib()
  __resetThirdPartyViews()
})

describe('mini app contribution synchronization', () => {
  test('a restored capability frame is not a completed mini app UI discovery', async () => {
    restoreMiniAppContribFrame(null, {
      revision: 3,
      enabledNames: ['sample'],
      miniApps: [miniApp('sample')],
      views: [],
      tools: EMPTY_TOOLS,
    })
    expect(miniAppContribSnapshot().enabledNames).toEqual(new Set(['sample']))
    expect(miniAppContribSnapshot().document).toBeNull()

    await refetchMiniAppContrib(source({ revision: 3, miniApps: [miniApp('sample')] }))
    expect(miniAppContribSnapshot().document).not.toBeNull()
  })

  test('a restored frame holds its UI mini apps pending, so their restored tabs are not closed', () => {
    restoreMiniAppContribFrame(null, {
      revision: 3,
      enabledNames: ['sample', 'plain'],
      miniApps: [
        { ...miniApp('sample'), ui: { entry: '/ui/sample.js', styles: [], revision: 'r1' } },
        miniApp('plain'),
      ],
      views: [],
      tools: EMPTY_TOOLS,
    })
    expect(miniAppContributionActivation('sample')).toBe('pending')
    expect(miniAppContributionActivation('plain')).toBe('enabled')
    expect(areMiniAppContributionsPending()).toBe(true)
  })

  test('the production default loader does not receive the retry attempt as a mini app source', () => {
    // startStartupRetry calls load(failureIndex); passing refetchMiniAppContrib directly would hand
    // that number to it as the MiniAppContribSource and every retry would throw.
    const source = readFileSync(new URL('./enabledMiniApps.ts', import.meta.url), 'utf8')

    expect(source).toContain('currentLoad: () => Promise<boolean> = () => refetchMiniAppContrib()')
    expect(source).not.toContain('currentLoad: () => Promise<boolean> = refetchMiniAppContrib')
  })

  test('retries the webview-before-sidecar race until contributions are established', async () => {
    let attempts = 0
    const load = mock(() =>
      refetchMiniAppContrib({
        loadSnapshot: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('sidecar not listening')
          return snapshot({ miniApps: [miniApp('sample')] })
        },
      }),
    )
    const queued: Array<{ run: () => void; delay: number }> = []
    const stop = startMiniAppContribSync(load, (run, delay) => {
      queued.push({ run, delay })
      return queued.length as never
    })

    await flush()
    expect(miniAppContribSnapshot().enabledNames).toBeNull()
    expect(queued[0]?.delay).toBe(100)

    queued.shift()!.run()
    await flush()
    expect(miniAppContribSnapshot().enabledNames).toEqual(new Set(['sample']))
    expect(miniAppContribSnapshot().miniApps.map((record) => record.name)).toEqual(['sample'])
    expect(load).toHaveBeenCalledTimes(2)
    expect(queued).toHaveLength(0)
    stop()
  })

  test('a transient failure preserves the last authoritative mini app UI', async () => {
    const initial = source({
      miniApps: [miniApp('catalog'), miniApp('sample')],
      views: [view('sample', 'chart')],
    })
    expect(await refetchMiniAppContrib(initial)).toBe(true)
    const establishedVersion = miniAppContribVersion()

    expect(
      await refetchMiniAppContrib({
        loadSnapshot: async () => {
          throw new Error('network blip')
        },
      }),
    ).toBe(false)

    expect(miniAppContribSnapshot().enabledNames).toEqual(new Set(['catalog', 'sample']))
    expect(miniAppContribSnapshot().miniApps.map((record) => record.name)).toEqual([
      'catalog',
      'sample',
    ])
    expect(miniAppContribVersion()).toBe(establishedVersion)
    expect(listThirdPartyViews().map((v) => v.fullName)).toEqual(['sample:chart'])
  })

  test('a project boundary clears the previous scope before its replacement loads', async () => {
    prepareMiniAppContribScope('project-a')
    await refetchMiniAppContrib(
      source({ miniApps: [miniApp('sample')], views: [view('sample', 'chart')] }),
    )
    expect(miniAppContribSnapshot().enabledNames).toEqual(new Set(['sample']))
    expect(listThirdPartyViews().map((row) => row.fullName)).toEqual(['sample:chart'])

    prepareMiniAppContribScope('project-b')

    expect(miniAppContribSnapshot()).toEqual({
      document: null,
      enabledNames: null,
      miniApps: [],
      views: [],
      tools: null,
      revision: -1,
    })
    expect(listThirdPartyViews()).toEqual([])
    expect(resolveUiLocation('localix://ui/mini-app/view/sample%3Achart')).toBeNull()
  })

  test('a late response from the previous project cannot repopulate the new scope', async () => {
    prepareMiniAppContribScope('project-a')
    let releaseOld!: (loaded: CapabilitySnapshot) => void
    const pending = new Promise<CapabilitySnapshot>((resolve) => {
      releaseOld = resolve
    })
    const oldRequest = refetchMiniAppContrib({ loadSnapshot: () => pending })

    prepareMiniAppContribScope('project-b')
    releaseOld(snapshot({ miniApps: [miniApp('sample')] }))
    await oldRequest

    expect(miniAppContribSnapshot()).toEqual({
      document: null,
      enabledNames: null,
      miniApps: [],
      views: [],
      tools: null,
      revision: -1,
    })
  })

  // The shape behind "the server answered 200 once and the workbench shows no
  // mini apps at all, while Settings lists them fine": a scope change bumps the
  // request version WITHOUT starting a request, so the in-flight load found itself
  // superseded by nobody. Reporting success there stopped the retry loop forever.
  test('a superseded request with no successor is not reported as a successful sync', async () => {
    prepareMiniAppContribScope('project-a')
    let release!: (loaded: CapabilitySnapshot) => void
    const pending = new Promise<CapabilitySnapshot>((resolve) => {
      release = resolve
    })
    const onlyRequest = refetchMiniAppContrib({ loadSnapshot: () => pending })

    // A scope boundary invalidates the load, but starts nothing in its place.
    prepareMiniAppContribScope('project-b')
    release(snapshot({ miniApps: [miniApp('sample')] }))

    expect(await onlyRequest).toBe(false)
    expect(miniAppContribSnapshot().miniApps).toEqual([])

    // …so the retry loop keeps going, and the next load fills the new scope.
    await refetchMiniAppContrib(source({ miniApps: [miniApp('sample')] }))
    expect(miniAppContribSnapshot().miniApps.map((p) => p.name)).toEqual(['sample'])
  })

  test('a superseded request still defers to a successor that is actually in flight', async () => {
    prepareMiniAppContribScope('project-a')
    let releaseOld!: (loaded: CapabilitySnapshot) => void
    const oldPending = new Promise<CapabilitySnapshot>((resolve) => {
      releaseOld = resolve
    })
    const oldRequest = refetchMiniAppContrib({ loadSnapshot: () => oldPending })
    const newRequest = refetchMiniAppContrib(source({ miniApps: [miniApp('newer')] }))

    releaseOld(snapshot({ miniApps: [miniApp('older')] }))
    // The older load is done retrying — its successor owns publication.
    expect(await oldRequest).toBe(true)
    expect(await newRequest).toBe(true)
    expect(miniAppContribSnapshot().miniApps.map((p) => p.name)).toEqual(['newer'])
  })

  test('a mutation in ANOTHER scope still converges the active project catalog', async () => {
    // The reported bug. Settings' scope picker and the workbench's route project are
    // routinely different values, and this converge used to return early unless they
    // matched — so toggling a mini app from Settings refetched NOTHING, and the tool list
    // and contributed views only caught up if the server's debounced poke arrived.
    // Converging the active scope after any capability mutation is both correct (the
    // singleton always describes the workbench's project) and cheap.
    prepareMiniAppContribScope('project-a')
    let enabled = [miniApp('catalog')]
    const loadActive = mock(() => refetchMiniAppContrib(source({ miniApps: enabled })))
    const stop = startMiniAppContribSync(loadActive)
    await flush()
    expect(miniAppContribSnapshot().enabledNames).toEqual(new Set(['catalog']))

    // A mini app toggled while a DIFFERENT scope is selected in Settings.
    enabled = [miniApp('catalog'), miniApp('sample')]
    expect(await refetchActiveMiniAppContrib()).toBe(true)
    expect(loadActive).toHaveBeenCalledTimes(2)
    expect(miniAppContribSnapshot().enabledNames).toEqual(new Set(['catalog', 'sample']))
    stop()
  })

  test('a snapshot at the revision already held does not restart dependent catalogs', async () => {
    // The client-side reload key for dependent endpoints (plugin commands, skills)
    // must not advance for a redundant poke — a replayed `resources.changed` on
    // socket reconnect, or two pokes coalesced from one double toggle.
    const settled = source({ revision: 7, miniApps: [miniApp('sample')] })
    await refetchMiniAppContrib(settled)
    const converged = miniAppContribVersion()

    await refetchMiniAppContrib(settled)
    expect(miniAppContribVersion()).toBe(converged)
    expect(miniAppContribSnapshot().revision).toBe(7)

    // A real mutation does advance it.
    await refetchMiniAppContrib(source({ revision: 8, miniApps: [miniApp('sample', false)] }))
    expect(miniAppContribVersion()).toBe(converged + 1)
  })

  test('a mini app UI reload re-reads derived surfaces but never stales capability documents', async () => {
    // Cached capability documents used to key on the UI reload counter, so every mini app
    // batch that settled at startup re-fetched every cached scope's whole snapshot.
    await refetchMiniAppContrib(source({ revision: 7, miniApps: [miniApp('sample')] }))
    const documents = miniAppCapabilityVersion()
    const surfaces = miniAppContribVersion()

    announceMiniAppUiChanged()
    expect(miniAppContribVersion()).toBe(surfaces + 1)
    expect(miniAppCapabilityVersion()).toBe(documents)

    await refetchMiniAppContrib(source({ revision: 8, miniApps: [miniApp('sample', false)] }))
    expect(miniAppCapabilityVersion()).toBe(documents + 1)
  })

  test('switching scope does not stale other scopes; a moved server or set in one scope does', async () => {
    await refetchMiniAppContrib(source({ revision: 7, miniApps: [miniApp('sample')] }))
    const documents = miniAppCapabilityVersion()

    prepareMiniAppContribScope('PRJ-1')
    await refetchMiniAppContrib(
      source({
        revision: 7,
        scope: { projectId: 'PRJ-1', agentId: null },
        miniApps: [miniApp('sample'), miniApp('kanban')],
      }),
    )
    expect(miniAppCapabilityVersion()).toBe(documents)

    await refetchMiniAppContrib(
      source({ revision: 7, scope: { projectId: 'PRJ-1', agentId: null }, miniApps: [] }),
    )
    expect(miniAppCapabilityVersion()).toBe(documents + 1)
  })

  test('a bare resync before any route installed its loader reads nothing', async () => {
    const fetchSnapshot = spyOn(backendClient, 'fetchCapabilitySnapshot').mockResolvedValue(
      snapshot(),
    )
    try {
      startMiniAppContribSync()()
      await flush()
      expect(fetchSnapshot).not.toHaveBeenCalled()

      const load = mock(() => refetchMiniAppContrib(source({ revision: 3 })))
      startMiniAppContribSync(load)()
      startMiniAppContribSync()()
      await flush()
      expect(load).toHaveBeenCalledTimes(2)
      expect(fetchSnapshot).not.toHaveBeenCalled()
    } finally {
      fetchSnapshot.mockRestore()
    }
  })

  test('reordering the same enabled names publishes the new document without advancing the reload key', async () => {
    await refetchMiniAppContrib(
      source({ revision: 7, miniApps: [miniApp('first'), miniApp('second')] }),
    )
    const converged = miniAppContribVersion()
    const reordered = snapshot({ revision: 7, miniApps: [miniApp('second'), miniApp('first')] })
    await refetchMiniAppContrib({ loadSnapshot: async () => reordered })
    expect(miniAppContribVersion()).toBe(converged)
    expect(miniAppContribSnapshot().document).toBe(reordered)
    expect(miniAppContribSnapshot().miniApps).toBe(reordered.miniApps)
    expect([...miniAppContribSnapshot().enabledNames!]).toEqual(['second', 'first'])
  })

  test('a mini app set that changed WITHOUT a revision bump still advances the reload key', async () => {
    // A mini app folder dropped straight onto disk changes what discovery returns without
    // going through any service, so nothing bumps the server revision. Keying dependents
    // on the revision alone would leave them stale.
    await refetchMiniAppContrib(source({ revision: 4, miniApps: [miniApp('sample')] }))
    const converged = miniAppContribVersion()

    await refetchMiniAppContrib(
      source({ revision: 4, miniApps: [miniApp('sample'), miniApp('dropped-in')] }),
    )
    expect(miniAppContribVersion()).toBe(converged + 1)
  })

  test('an older slow response cannot overwrite a newer toggle result', async () => {
    let resolveOld!: (loaded: CapabilitySnapshot) => void
    const pending = new Promise<CapabilitySnapshot>((resolve) => {
      resolveOld = resolve
    })
    const oldRequest = refetchMiniAppContrib({ loadSnapshot: () => pending })

    await refetchMiniAppContrib(
      source({ miniApps: [miniApp('catalog'), miniApp('sample', false)] }),
    )
    resolveOld(snapshot({ miniApps: [miniApp('catalog'), miniApp('sample')] }))
    await oldRequest

    expect(miniAppContribSnapshot().enabledNames).toEqual(new Set(['catalog']))
    expect(miniAppContribVersion()).toBe(1)
  })

  test('an older response cannot publish after its mini app chunk finishes late', async () => {
    let releaseDiscovery!: () => void
    let discoveryStarted!: () => void
    const started = new Promise<void>((resolve) => {
      discoveryStarted = resolve
    })
    const blockedDiscovery = () =>
      new Promise<void>((resolve) => {
        releaseDiscovery = resolve
        discoveryStarted()
      })

    const oldRequest = refetchMiniAppContrib(
      source({ miniApps: [miniApp('sample')] }),
      blockedDiscovery,
    )
    await started

    await refetchMiniAppContrib(source({ miniApps: [miniApp('catalog')] }), async () => {})
    // The older response published when ITS snapshot landed (names do not wait for UI);
    // the newer one published over it. What the late chunk must not do is publish again.
    const settledVersion = miniAppContribVersion()
    releaseDiscovery()
    await oldRequest

    expect(miniAppContribSnapshot().enabledNames).toEqual(new Set(['catalog']))
    expect(miniAppContribVersion()).toBe(settledVersion)
  })

  test('names publish before mini app UI loads; each view registers as its artifact settles', async () => {
    const withUi = (name: string) => ({
      ...miniApp(name),
      ui: { entry: `/ui/${name}.js`, styles: [], revision: 'r1' },
    })
    const settlers: MiniAppUiSettled[] = []
    let finishDiscovery!: () => void
    const refetched = refetchMiniAppContrib(
      source({ miniApps: [withUi('slow'), withUi('fast'), miniApp('no-ui')] }),
      (_mini_apps, settled) => {
        settlers.push(settled!)
        return new Promise<void>((resolve) => {
          finishDiscovery = resolve
        })
      },
    )
    await Promise.resolve()
    await Promise.resolve()

    // The snapshot is in hand, so every name gate opens now — not after the slowest artifact.
    expect(miniAppContribSnapshot().enabledNames).toEqual(new Set(['slow', 'fast', 'no-ui']))
    // A mini app whose UI has not registered yet reads as pending, so a restored tab of its
    // kind is kept rather than closed as unavailable.
    expect(miniAppContributionActivation('slow')).toBe('pending')
    expect(miniAppContributionActivation('no-ui')).toBe('enabled')
    expect(areMiniAppContributionsPending()).toBe(true)
    const beforeSettle = miniAppContribVersion()

    settlers[0]!('fast', true)
    expect(miniAppContributionActivation('fast')).toBe('enabled')
    expect(miniAppContributionActivation('slow')).toBe('pending')
    // One mini app settling is not a capability change: other scopes' documents stay fresh.
    expect(miniAppContribVersion()).toBe(beforeSettle)

    settlers[0]!('slow', true)
    expect(areMiniAppContributionsPending()).toBe(false)
    expect(miniAppContribVersion()).toBe(beforeSettle + 1)
    finishDiscovery()
    expect(await refetched).toBe(true)

    // A later refetch of the same set does not re-enter the pending state for loaded UI.
    await refetchMiniAppContrib(
      source({ miniApps: [withUi('slow'), withUi('fast'), miniApp('no-ui')] }),
      async () => {},
    )
    expect(miniAppContributionActivation('slow')).toBe('enabled')
  })

  test('a successful empty response really removes disabled contributions', async () => {
    await refetchMiniAppContrib(
      source({ miniApps: [miniApp('sample')], views: [view('sample', 'chart')] }),
    )
    await refetchMiniAppContrib(source())

    expect(miniAppContribSnapshot().enabledNames).toEqual(new Set())
    expect(listThirdPartyViews()).toEqual([])
  })

  test('retains an installed mini app even when it contributes no UI views', async () => {
    await refetchMiniAppContrib(source({ miniApps: [miniApp('commands-only')] }))

    expect(miniAppContribSnapshot().miniApps.map((record) => record.name)).toEqual([
      'commands-only',
    ])
    expect(listThirdPartyViews()).toEqual([])
  })

  test('derives removable UI locations from runtime mini app views', async () => {
    await refetchMiniAppContrib(
      source({ miniApps: [miniApp('monitoring')], views: [view('monitoring', 'usage')] }),
    )

    const location = resolveUiLocation('localix://ui/mini-app/view/monitoring%3Ausage')
    expect(location?.descriptor).toMatchObject({
      effect: 'read',
      surface: 'mini-app',
    })
    expect(location?.target).toEqual({
      kind: 'work-item',
      workKind: 'mini-app-view',
      id: 'mini-app-view:monitoring:usage',
      title: 'usage',
      payload: { miniAppName: 'monitoring', projectId: '', viewId: 'usage' },
    })

    await refetchMiniAppContrib(source())
    expect(resolveUiLocation('localix://ui/mini-app/view/monitoring%3Ausage')).toBeNull()
  })
})

/**
 * Bundled mini apps carry their enabled state PER PROJECT, so the scope a refetch runs
 * in decides how much of the surface exists. Measured against the live API on one
 * install: 4 of 19 mini apps enabled with no `projectId`, 13 of 17 with one. A
 * no-argument refetch that ignored the prepared scope therefore hid nine mini apps'
 * views until the Store happened to refetch in the right scope.
 */
describe('mini app contrib default scope', () => {
  const captureScope = async (run: () => Promise<unknown>): Promise<Array<string | null>> => {
    const seen: Array<string | null> = []
    const real = backendClient.fetchCapabilitySnapshot.bind(backendClient)
    backendClient.fetchCapabilitySnapshot = (async (opts?: { projectId?: string | null }) => {
      seen.push(opts?.projectId ?? null)
      return snapshot()
    }) as typeof backendClient.fetchCapabilitySnapshot
    try {
      await run()
    } finally {
      backendClient.fetchCapabilitySnapshot = real
    }
    return seen
  }

  test('a no-argument refetch queries the scope the store was prepared with', async () => {
    prepareMiniAppContribScope('project-a')
    expect(await captureScope(() => refetchMiniAppContrib())).toEqual(['project-a'])
  })

  test('the scope follows a project boundary without reinstalling a loader', async () => {
    prepareMiniAppContribScope('project-a')
    prepareMiniAppContribScope('project-b')
    expect(await captureScope(() => refetchActiveMiniAppContrib())).toEqual(['project-b'])
  })

  test('with no scope prepared it still asks globally, as before', async () => {
    expect(await captureScope(() => refetchMiniAppContrib())).toEqual([null])
  })
})
