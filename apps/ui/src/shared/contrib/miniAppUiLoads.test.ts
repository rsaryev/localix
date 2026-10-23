import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { CapabilitySnapshot, PluginRecord } from '@/shared/api/contracts'
import {
  __resetPluginContrib,
  pluginContribVersion,
  refetchPluginContrib,
  subscribePluginContrib,
} from './enabledPlugins'
import {
  areMiniAppUiLoadsInFlight,
  miniAppContributionActivation,
  subscribePluginActivation,
} from './miniAppActivation'
import {
  __resetPluginUiLoads,
  claimPluginUiLoads,
  pluginUiPending,
  runPluginUiLoads,
  type PluginUiDiscovery,
  type PluginUiSettled,
} from './miniAppUiLoads'
import { __setRegistryFlushScheduler, flushRegistryChanges } from './registryChanges'

const withUi = (name: string) =>
  ({ name, enabled: true, ui: { entry: `/ui/${name}.js`, styles: [], revision: 'r1' } }) as never
const plain = (name: string) => ({ name, enabled: true }) as PluginRecord

function snapshot(plugins: PluginRecord[]): CapabilitySnapshot {
  return { revision: 1, scope: { projectId: '', agentId: null }, plugins, views: [] } as never
}

/** A retry clock the test advances by hand, recording each requested delay. */
function manualClock() {
  const queued: Array<{ run: () => void; delay: number }> = []
  return {
    queued,
    schedule: (run: () => void, delay: number) => {
      queued.push({ run, delay })
      return queued.length as never
    },
    cancel: () => {
      queued.length = 0
    },
  }
}

const ticks = async (n = 5) => {
  for (let index = 0; index < n; index += 1) await Promise.resolve()
}

beforeEach(() => __setRegistryFlushScheduler(() => () => {}))
afterEach(() => {
  __resetPluginContrib()
  __resetPluginUiLoads()
  __setRegistryFlushScheduler(null)
})

describe('a failed first UI load is not a settle', () => {
  test('it stays loading, is retried on the startup backoff, and loads on a later pass', async () => {
    const clock = manualClock()
    let attempts = 0
    const discover: PluginUiDiscovery = async (_plugins, settled) => {
      attempts += 1
      settled?.('flaky', attempts >= 3)
    }
    const claim = claimPluginUiLoads([withUi('flaky')])
    await runPluginUiLoads(
      claim,
      [withUi('flaky')],
      discover,
      () => {},
      clock.schedule,
      clock.cancel,
    )

    expect([...pluginUiPending().loading]).toEqual(['flaky'])
    expect(clock.queued.map((entry) => entry.delay)).toEqual([100])
    clock.queued.shift()!.run()
    await ticks()
    expect([...pluginUiPending().loading]).toEqual(['flaky'])
    expect(clock.queued.map((entry) => entry.delay)).toEqual([200])
    clock.queued.shift()!.run()
    await ticks()
    expect(pluginUiPending().loading.size).toBe(0)
    expect(clock.queued).toHaveLength(0)
  })

  test('past its budget it reads failed: not loading, still keeping its tabs', async () => {
    const clock = manualClock()
    const discover: PluginUiDiscovery = async (_plugins, settled) => settled?.('broken', false)
    const claim = claimPluginUiLoads([withUi('broken')])
    await runPluginUiLoads(
      claim,
      [withUi('broken')],
      discover,
      () => {},
      clock.schedule,
      clock.cancel,
    )
    while (clock.queued.length > 0) {
      clock.queued.shift()!.run()
      await ticks()
    }
    expect(pluginUiPending().loading.size).toBe(0)
    expect([...pluginUiPending().failed]).toEqual(['broken'])
  })

  test('a newer publish disowns the older pass: its settles and its retry timer', async () => {
    const clock = manualClock()
    let settle!: PluginUiSettled
    const discover: PluginUiDiscovery = async (_plugins, settled) => {
      settle = settled!
      settled?.('slow', false)
    }
    const older = claimPluginUiLoads([withUi('slow')])
    await runPluginUiLoads(
      older,
      [withUi('slow')],
      discover,
      () => {},
      clock.schedule,
      clock.cancel,
    )
    expect(clock.queued).toHaveLength(1)
    claimPluginUiLoads([withUi('slow')])
    expect(clock.queued).toHaveLength(0)
    settle('slow', true)
    expect([...pluginUiPending().loading]).toEqual(['slow'])
  })
})

// The grid's side of a failed import (its restored tabs are kept) is pinned where the grid lives:
// `entities/workspace-grid/model/failedPluginTab.test.ts`.
describe('the capability store over the UI loads', () => {
  // Ownership used to move when a newer request STARTED; the one-shot refetch on socket connect
  // failing then orphaned the pass that did publish, and the plugin stayed pending for good.
  test('settles stay with the publishing pass when a newer request fails before publishing', async () => {
    let settle!: PluginUiSettled
    const published = refetchPluginContrib(
      { loadSnapshot: async () => snapshot([withUi('late')]) },
      (_plugins, settled) => {
        settle = settled!
        return new Promise<void>(() => {})
      },
    )
    await ticks()
    const failed = await refetchPluginContrib({
      loadSnapshot: async () => {
        throw new Error('socket-connect refetch failed')
      },
    })
    expect(failed).toBe(false)
    settle('late', true)
    expect(miniAppContributionActivation('late')).toBe('enabled')
    expect(areMiniAppUiLoadsInFlight()).toBe(false)
    void published
  })

  // Measured: each settle re-rendered the app synchronously, one ~55 ms long task per plugin.
  test('N plugins settling in one burst notify every subscriber exactly once', async () => {
    const names = ['a', 'b', 'c', 'd', 'e']
    let settle!: PluginUiSettled
    void refetchPluginContrib(
      { loadSnapshot: async () => snapshot([...names.map(withUi), plain('core-ish')]) },
      (_plugins, settled) => {
        settle = settled!
        return new Promise<void>(() => {})
      },
    )
    await ticks()
    const before = pluginContribVersion()
    let storeNotified = 0
    let activationNotified = 0
    const offStore = subscribePluginContrib(() => (storeNotified += 1))
    const offActivation = subscribePluginActivation(() => (activationNotified += 1))
    try {
      for (const name of names) settle(name, true)
      // State is current at once; nobody has been woken yet.
      expect(miniAppContributionActivation('e')).toBe('enabled')
      expect(pluginContribVersion()).toBe(before + 1)
      expect(storeNotified).toBe(0)
      expect(activationNotified).toBe(0)
      flushRegistryChanges()
      expect(storeNotified).toBe(1)
      expect(activationNotified).toBe(1)
    } finally {
      offStore()
      offActivation()
    }
  })
})
