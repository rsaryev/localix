import { afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { CapabilitySnapshot, PluginRecord, PluginViewSpec } from '@/shared/api/contracts'
import {
  __resetPluginContrib,
  pluginContribSnapshot,
  pluginContribVersion,
  preparePluginContribScope,
  refetchActivePluginContrib,
  refetchPluginContrib,
  restorePluginContribFrame,
  startPluginContribSync,
  type PluginContribSource,
} from './enabledPlugins'
import { backendClient } from '@/shared/api/client'
import { __resetThirdPartyViews, listThirdPartyViews } from './runtimeViews'
import { resolveUiLocation } from './uiLocations'
import { arePluginContributionsPending, pluginContributionActivation } from './pluginActivation'
import type { PluginUiSettled } from './pluginUiLoads'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function plugin(name: string, enabled = true): PluginRecord {
  return { name, enabled } as PluginRecord
}

function view(pluginName: string, id: string): PluginViewSpec {
  return {
    pluginName,
    projectId: '',
    id,
    fullName: `${pluginName}:${id}`,
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
    tools: EMPTY_TOOLS,
    views: [],
    agents: [],
    commands: [],
    mcp: [],
    skills: [],
    tips: [],
    grammar: { kinds: [], effects: [], classes: [], examples: [] },
    ...over,
  }
}

/** One capability-snapshot loader — the store's whole data source is this one call. */
function source(over: Partial<CapabilitySnapshot> = {}): PluginContribSource {
  return { loadSnapshot: async () => snapshot(over) }
}

afterEach(() => {
  __resetPluginContrib()
  __resetThirdPartyViews()
})

describe('plugin contribution synchronization', () => {
  test('a restored capability frame is not a completed plugin UI discovery', async () => {
    restorePluginContribFrame(null, {
      revision: 3,
      enabledNames: ['sample'],
      plugins: [plugin('sample')],
      views: [],
      tools: EMPTY_TOOLS,
    })
    expect(pluginContribSnapshot().enabledNames).toEqual(new Set(['sample']))
    expect(pluginContribSnapshot().document).toBeNull()

    await refetchPluginContrib(source({ revision: 3, plugins: [plugin('sample')] }))
    expect(pluginContribSnapshot().document).not.toBeNull()
  })

  test('a restored frame holds its UI plugins pending, so their restored tabs are not closed', () => {
    restorePluginContribFrame(null, {
      revision: 3,
      enabledNames: ['sample', 'plain'],
      plugins: [
        { ...plugin('sample'), ui: { entry: '/ui/sample.js', styles: [], revision: 'r1' } },
        plugin('plain'),
      ],
      views: [],
      tools: EMPTY_TOOLS,
    })
    expect(pluginContributionActivation('sample')).toBe('pending')
    expect(pluginContributionActivation('plain')).toBe('enabled')
    expect(arePluginContributionsPending()).toBe(true)
  })

  test('the production default loader does not receive the retry attempt as a plugin source', () => {
    const source = readFileSync(new URL('./enabledPlugins.ts', import.meta.url), 'utf8')

    expect(source).toContain('currentLoad: () => Promise<boolean> = () => refetchPluginContrib()')
    expect(source).not.toContain('currentLoad: () => Promise<boolean> = refetchPluginContrib')
  })

  test('keeps sync-failure reporting off the startup bundle', () => {
    const source = readFileSync(new URL('./enabledPlugins.ts', import.meta.url), 'utf8')
    // Type-only is erased; a value import would put the copy and the toast wiring on first paint.
    expect(source).not.toMatch(/^import (?!type )[^\n]*from ['"]\.\/pluginSyncProblems['"]/m)
    expect(source).toMatch(/^import type \* as \w+ from ['"]\.\/pluginSyncProblems['"]/m)
    expect(source).toContain("import('./pluginSyncProblems')")
  })

  test('loads the plugin UI runtime only after capability discovery needs it', () => {
    const source = readFileSync(new URL('./enabledPlugins.ts', import.meta.url), 'utf8')

    expect(source).not.toMatch(
      /import\s+\{\s*discoverEnabledPluginUi\s*\}\s+from\s+['"]\.\/pluginUiDiscovery['"]/,
    )
    expect(source).toContain("import('./pluginUiDiscovery')")
    expect(source).toContain('discoverPluginUi: PluginUiDiscovery = discoverPluginUiLazily')
  })

  test('retries the webview-before-sidecar race until contributions are established', async () => {
    let attempts = 0
    const load = mock(() =>
      refetchPluginContrib({
        loadSnapshot: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('sidecar not listening')
          return snapshot({ plugins: [plugin('sample')] })
        },
      }),
    )
    const queued: Array<{ run: () => void; delay: number }> = []
    const stop = startPluginContribSync(load, (run, delay) => {
      queued.push({ run, delay })
      return queued.length as never
    })

    await flush()
    expect(pluginContribSnapshot().enabledNames).toBeNull()
    expect(queued[0]?.delay).toBe(100)

    queued.shift()!.run()
    await flush()
    expect(pluginContribSnapshot().enabledNames).toEqual(new Set(['sample']))
    expect(pluginContribSnapshot().plugins.map((record) => record.name)).toEqual(['sample'])
    expect(load).toHaveBeenCalledTimes(2)
    expect(queued).toHaveLength(0)
    stop()
  })

  test('a transient failure preserves the last authoritative plugin UI', async () => {
    const initial = source({
      plugins: [plugin('catalog'), plugin('sample')],
      views: [view('sample', 'chart')],
    })
    expect(await refetchPluginContrib(initial)).toBe(true)
    const establishedVersion = pluginContribVersion()

    expect(
      await refetchPluginContrib({
        loadSnapshot: async () => {
          throw new Error('network blip')
        },
      }),
    ).toBe(false)

    expect(pluginContribSnapshot().enabledNames).toEqual(new Set(['catalog', 'sample']))
    expect(pluginContribSnapshot().plugins.map((record) => record.name)).toEqual([
      'catalog',
      'sample',
    ])
    expect(pluginContribVersion()).toBe(establishedVersion)
    expect(listThirdPartyViews().map((v) => v.fullName)).toEqual(['sample:chart'])
  })

  test('a project boundary clears the previous scope before its replacement loads', async () => {
    preparePluginContribScope('project-a')
    await refetchPluginContrib(
      source({ plugins: [plugin('sample')], views: [view('sample', 'chart')] }),
    )
    expect(pluginContribSnapshot().enabledNames).toEqual(new Set(['sample']))
    expect(listThirdPartyViews().map((row) => row.fullName)).toEqual(['sample:chart'])

    preparePluginContribScope('project-b')

    expect(pluginContribSnapshot()).toEqual({
      document: null,
      enabledNames: null,
      plugins: [],
      views: [],
      tools: null,
      revision: -1,
    })
    expect(listThirdPartyViews()).toEqual([])
    expect(resolveUiLocation('localix://ui/plugin/view/sample%3Achart')).toBeNull()
  })

  test('a late response from the previous project cannot repopulate the new scope', async () => {
    preparePluginContribScope('project-a')
    let releaseOld!: (loaded: CapabilitySnapshot) => void
    const pending = new Promise<CapabilitySnapshot>((resolve) => {
      releaseOld = resolve
    })
    const oldRequest = refetchPluginContrib({ loadSnapshot: () => pending })

    preparePluginContribScope('project-b')
    releaseOld(snapshot({ plugins: [plugin('sample')] }))
    await oldRequest

    expect(pluginContribSnapshot()).toEqual({
      document: null,
      enabledNames: null,
      plugins: [],
      views: [],
      tools: null,
      revision: -1,
    })
  })

  // The shape behind "the server answered 200 once and the workbench shows no
  // plugins at all, while Settings lists them fine": a scope change bumps the
  // request version WITHOUT starting a request, so the in-flight load found itself
  // superseded by nobody. Reporting success there stopped the retry loop forever.
  test('a superseded request with no successor is not reported as a successful sync', async () => {
    preparePluginContribScope('project-a')
    let release!: (loaded: CapabilitySnapshot) => void
    const pending = new Promise<CapabilitySnapshot>((resolve) => {
      release = resolve
    })
    const onlyRequest = refetchPluginContrib({ loadSnapshot: () => pending })

    // A scope boundary invalidates the load, but starts nothing in its place.
    preparePluginContribScope('project-b')
    release(snapshot({ plugins: [plugin('sample')] }))

    expect(await onlyRequest).toBe(false)
    expect(pluginContribSnapshot().plugins).toEqual([])

    // …so the retry loop keeps going, and the next load fills the new scope.
    await refetchPluginContrib(source({ plugins: [plugin('sample')] }))
    expect(pluginContribSnapshot().plugins.map((p) => p.name)).toEqual(['sample'])
  })

  test('a superseded request still defers to a successor that is actually in flight', async () => {
    preparePluginContribScope('project-a')
    let releaseOld!: (loaded: CapabilitySnapshot) => void
    const oldPending = new Promise<CapabilitySnapshot>((resolve) => {
      releaseOld = resolve
    })
    const oldRequest = refetchPluginContrib({ loadSnapshot: () => oldPending })
    const newRequest = refetchPluginContrib(source({ plugins: [plugin('newer')] }))

    releaseOld(snapshot({ plugins: [plugin('older')] }))
    // The older load is done retrying — its successor owns publication.
    expect(await oldRequest).toBe(true)
    expect(await newRequest).toBe(true)
    expect(pluginContribSnapshot().plugins.map((p) => p.name)).toEqual(['newer'])
  })

  test('a mutation in ANOTHER scope still converges the active project catalog', async () => {
    // The reported bug. Settings' scope picker and the workbench's route project are
    // routinely different values, and this converge used to return early unless they
    // matched — so toggling a plugin from Settings refetched NOTHING, and the tool list
    // and contributed views only caught up if the server's debounced poke arrived.
    // Converging the active scope after any capability mutation is both correct (the
    // singleton always describes the workbench's project) and cheap.
    preparePluginContribScope('project-a')
    let enabled = [plugin('catalog')]
    const loadActive = mock(() => refetchPluginContrib(source({ plugins: enabled })))
    const stop = startPluginContribSync(loadActive)
    await flush()
    expect(pluginContribSnapshot().enabledNames).toEqual(new Set(['catalog']))

    // A plugin toggled while a DIFFERENT scope is selected in Settings.
    enabled = [plugin('catalog'), plugin('sample')]
    expect(await refetchActivePluginContrib()).toBe(true)
    expect(loadActive).toHaveBeenCalledTimes(2)
    expect(pluginContribSnapshot().enabledNames).toEqual(new Set(['catalog', 'sample']))
    stop()
  })

  test('a snapshot at the revision already held does not restart dependent catalogs', async () => {
    // The client-side reload key for dependent endpoints (plugin commands, skills)
    // must not advance for a redundant poke — a replayed `resources.changed` on
    // socket reconnect, or two pokes coalesced from one double toggle.
    const settled = source({ revision: 7, plugins: [plugin('sample')] })
    await refetchPluginContrib(settled)
    const converged = pluginContribVersion()

    await refetchPluginContrib(settled)
    expect(pluginContribVersion()).toBe(converged)
    expect(pluginContribSnapshot().revision).toBe(7)

    // A real mutation does advance it.
    await refetchPluginContrib(source({ revision: 8, plugins: [plugin('sample', false)] }))
    expect(pluginContribVersion()).toBe(converged + 1)
  })

  test('a plugin set that changed WITHOUT a revision bump still advances the reload key', async () => {
    // A plugin folder dropped straight onto disk changes what discovery returns without
    // going through any service, so nothing bumps the server revision. Keying dependents
    // on the revision alone would leave them stale.
    await refetchPluginContrib(source({ revision: 4, plugins: [plugin('sample')] }))
    const converged = pluginContribVersion()

    await refetchPluginContrib(
      source({ revision: 4, plugins: [plugin('sample'), plugin('dropped-in')] }),
    )
    expect(pluginContribVersion()).toBe(converged + 1)
  })

  test('an older slow response cannot overwrite a newer toggle result', async () => {
    let resolveOld!: (loaded: CapabilitySnapshot) => void
    const pending = new Promise<CapabilitySnapshot>((resolve) => {
      resolveOld = resolve
    })
    const oldRequest = refetchPluginContrib({ loadSnapshot: () => pending })

    await refetchPluginContrib(source({ plugins: [plugin('catalog'), plugin('sample', false)] }))
    resolveOld(snapshot({ plugins: [plugin('catalog'), plugin('sample')] }))
    await oldRequest

    expect(pluginContribSnapshot().enabledNames).toEqual(new Set(['catalog']))
    expect(pluginContribVersion()).toBe(1)
  })

  test('an older response cannot publish after its plugin chunk finishes late', async () => {
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

    const oldRequest = refetchPluginContrib(
      source({ plugins: [plugin('sample')] }),
      blockedDiscovery,
    )
    await started

    await refetchPluginContrib(source({ plugins: [plugin('catalog')] }), async () => {})
    // The older response published when ITS snapshot landed (names do not wait for UI);
    // the newer one published over it. What the late chunk must not do is publish again.
    const settledVersion = pluginContribVersion()
    releaseDiscovery()
    await oldRequest

    expect(pluginContribSnapshot().enabledNames).toEqual(new Set(['catalog']))
    expect(pluginContribVersion()).toBe(settledVersion)
  })

  test('names publish before plugin UI loads; each view registers as its artifact settles', async () => {
    const withUi = (name: string) => ({
      ...plugin(name),
      ui: { entry: `/ui/${name}.js`, styles: [], revision: 'r1' },
    })
    const settlers: PluginUiSettled[] = []
    let finishDiscovery!: () => void
    const refetched = refetchPluginContrib(
      source({ plugins: [withUi('slow'), withUi('fast'), plugin('no-ui')] }),
      (_plugins, settled) => {
        settlers.push(settled!)
        return new Promise<void>((resolve) => {
          finishDiscovery = resolve
        })
      },
    )
    await Promise.resolve()
    await Promise.resolve()

    // The snapshot is in hand, so every name gate opens now — not after the slowest artifact.
    expect(pluginContribSnapshot().enabledNames).toEqual(new Set(['slow', 'fast', 'no-ui']))
    // A plugin whose UI has not registered yet reads as pending, so a restored tab of its
    // kind is kept rather than closed as unavailable.
    expect(pluginContributionActivation('slow')).toBe('pending')
    expect(pluginContributionActivation('no-ui')).toBe('enabled')
    expect(arePluginContributionsPending()).toBe(true)
    const beforeSettle = pluginContribVersion()

    settlers[0]!('fast', true)
    expect(pluginContributionActivation('fast')).toBe('enabled')
    expect(pluginContributionActivation('slow')).toBe('pending')
    // One plugin settling is not a capability change: other scopes' documents stay fresh.
    expect(pluginContribVersion()).toBe(beforeSettle)

    settlers[0]!('slow', true)
    expect(arePluginContributionsPending()).toBe(false)
    expect(pluginContribVersion()).toBe(beforeSettle + 1)
    finishDiscovery()
    expect(await refetched).toBe(true)

    // A later refetch of the same set does not re-enter the pending state for loaded UI.
    await refetchPluginContrib(
      source({ plugins: [withUi('slow'), withUi('fast'), plugin('no-ui')] }),
      async () => {},
    )
    expect(pluginContributionActivation('slow')).toBe('enabled')
  })

  test('a successful empty response really removes disabled contributions', async () => {
    await refetchPluginContrib(
      source({ plugins: [plugin('sample')], views: [view('sample', 'chart')] }),
    )
    await refetchPluginContrib(source())

    expect(pluginContribSnapshot().enabledNames).toEqual(new Set())
    expect(listThirdPartyViews()).toEqual([])
  })

  test('retains an installed plugin even when it contributes no UI views', async () => {
    await refetchPluginContrib(source({ plugins: [plugin('commands-only')] }))

    expect(pluginContribSnapshot().plugins.map((record) => record.name)).toEqual(['commands-only'])
    expect(listThirdPartyViews()).toEqual([])
  })

  test('derives removable UI locations from runtime plugin views', async () => {
    await refetchPluginContrib(
      source({ plugins: [plugin('monitoring')], views: [view('monitoring', 'usage')] }),
    )

    const location = resolveUiLocation('localix://ui/plugin/view/monitoring%3Ausage')
    expect(location?.descriptor).toMatchObject({
      effect: 'read',
      surface: 'plugin',
    })
    expect(location?.target).toEqual({
      kind: 'work-item',
      workKind: 'plugin-view',
      id: 'plugin-view:monitoring:usage',
      title: 'usage',
      payload: { pluginName: 'monitoring', projectId: '', viewId: 'usage' },
    })

    await refetchPluginContrib(source())
    expect(resolveUiLocation('localix://ui/plugin/view/monitoring%3Ausage')).toBeNull()
  })
})

/**
 * Bundled plugins carry their enabled state PER PROJECT, so the scope a refetch runs
 * in decides how much of the surface exists. Measured against the live API on one
 * install: 4 of 19 plugins enabled with no `projectId`, 13 of 17 with one. A
 * no-argument refetch that ignored the prepared scope therefore hid nine plugins'
 * views until Settings → Plugins happened to refetch in the right scope.
 */
describe('plugin contrib default scope', () => {
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
    preparePluginContribScope('project-a')
    expect(await captureScope(() => refetchPluginContrib())).toEqual(['project-a'])
  })

  test('the scope follows a project boundary without reinstalling a loader', async () => {
    preparePluginContribScope('project-a')
    preparePluginContribScope('project-b')
    expect(await captureScope(() => refetchActivePluginContrib())).toEqual(['project-b'])
  })

  test('with no scope prepared it still asks globally, as before', async () => {
    expect(await captureScope(() => refetchPluginContrib())).toEqual([null])
  })
})
