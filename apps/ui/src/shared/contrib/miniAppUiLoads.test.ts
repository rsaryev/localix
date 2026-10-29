import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { CapabilitySnapshot, MiniAppRecord } from '@/shared/api/contracts'
import {
  __resetMiniAppContrib,
  miniAppContribVersion,
  refetchMiniAppContrib,
  subscribeMiniAppContrib,
} from './enabledMiniApps'
import {
  areMiniAppUiLoadsInFlight,
  miniAppContributionActivation,
  subscribeMiniAppActivation,
} from './miniAppActivation'
import {
  __resetMiniAppUiLoads,
  claimMiniAppUiLoads,
  miniAppUiPending,
  runMiniAppUiLoads,
  type MiniAppUiDiscovery,
  type MiniAppUiSettled,
} from './miniAppUiLoads'
import { __setMiniAppUiProblemHost } from './miniAppUiProblems'
import { __setRegistryFlushScheduler, flushRegistryChanges } from './registryChanges'

const withUi = (name: string) =>
  ({ name, enabled: true, ui: { entry: `/ui/${name}.js`, styles: [], revision: 'r1' } }) as never
const plain = (name: string) => ({ name, enabled: true }) as MiniAppRecord

function snapshot(miniApps: MiniAppRecord[]): CapabilitySnapshot {
  return {
    revision: 1,
    scope: { projectId: '', agentId: null },
    plugins: [],
    miniApps,
    views: [],
  } as never
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
  __resetMiniAppContrib()
  __resetMiniAppUiLoads()
  __setMiniAppUiProblemHost(null)
  __setRegistryFlushScheduler(null)
})

describe('a failed first UI load is not a settle', () => {
  test('it stays loading, is retried on the startup backoff, and loads on a later pass', async () => {
    const clock = manualClock()
    let attempts = 0
    const discover: MiniAppUiDiscovery = async (_miniApps, settled) => {
      attempts += 1
      settled?.('flaky', attempts >= 3)
    }
    const claim = claimMiniAppUiLoads([withUi('flaky')])
    await runMiniAppUiLoads(
      claim,
      [withUi('flaky')],
      discover,
      () => {},
      clock.schedule,
      clock.cancel,
    )

    expect([...miniAppUiPending().loading]).toEqual(['flaky'])
    expect(clock.queued.map((entry) => entry.delay)).toEqual([100])
    clock.queued.shift()!.run()
    await ticks()
    expect([...miniAppUiPending().loading]).toEqual(['flaky'])
    expect(clock.queued.map((entry) => entry.delay)).toEqual([200])
    clock.queued.shift()!.run()
    await ticks()
    expect(miniAppUiPending().loading.size).toBe(0)
    expect(clock.queued).toHaveLength(0)
  })

  test('past its budget it reads failed: not loading, still keeping its tabs', async () => {
    const clock = manualClock()
    const discover: MiniAppUiDiscovery = async (_miniApps, settled) => settled?.('broken', false)
    const claim = claimMiniAppUiLoads([withUi('broken')])
    await runMiniAppUiLoads(
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
    expect(miniAppUiPending().loading.size).toBe(0)
    expect([...miniAppUiPending().failed]).toEqual(['broken'])
  })

  // A console line was all a mini app whose UI never came up left behind; the person looked at a
  // workbench without its screens and was told nothing.
  test('past its budget the person is told, under the mini app; a later load settles it', async () => {
    const rows: string[] = []
    __setMiniAppUiProblemHost({
      problems: (report, options) => {
        rows.push(`${options.scope}: ${report.problems[0]?.message}`)
        return undefined
      },
      problemsCleared: (_subject, scope) => void rows.push(`${scope}: cleared`),
    })
    const clock = manualClock()
    let importWorks = false
    const discover: MiniAppUiDiscovery = async (_miniApps, settled) =>
      settled?.('broken', importWorks)
    const publish = (miniApps: MiniAppRecord[]) =>
      runMiniAppUiLoads(
        claimMiniAppUiLoads(miniApps),
        miniApps,
        discover,
        () => {},
        clock.schedule,
        clock.cancel,
      )
    await publish([withUi('broken')])
    while (clock.queued.length > 0) {
      clock.queued.shift()!.run()
      await ticks()
    }
    expect(rows).toEqual(['mini-app-ui:broken: The "broken" mini app could not load its UI.'])
    importWorks = true
    await publish([withUi('broken')])
    expect(rows.at(-1)).toBe('mini-app-ui:broken: cleared')
  })

  // The runtime settles every name it reconciles, an unloaded one as ok; that settle used to put the
  // mini app back among the ever-loaded, so enabling it again was no first load, and its broken
  // import was neither loading nor failed: the grid closed its restored tabs.
  test('enabling a mini app again after it was disabled is a first load again', async () => {
    const clock = manualClock()
    let importWorks = true
    const discover: MiniAppUiDiscovery = async (_miniApps, settled) =>
      settled?.('again', importWorks)
    const publish = (miniApps: MiniAppRecord[]) =>
      runMiniAppUiLoads(
        claimMiniAppUiLoads(miniApps),
        miniApps,
        discover,
        () => {},
        clock.schedule,
        clock.cancel,
      )
    await publish([withUi('again')])
    expect(miniAppUiPending().loading.size).toBe(0)
    await publish([])
    importWorks = false
    claimMiniAppUiLoads([withUi('again')])
    expect([...miniAppUiPending().loading]).toEqual(['again'])
  })

  test('a newer publish disowns the older pass: its settles and its retry timer', async () => {
    const clock = manualClock()
    let settle!: MiniAppUiSettled
    const discover: MiniAppUiDiscovery = async (_miniApps, settled) => {
      settle = settled!
      settled?.('slow', false)
    }
    const older = claimMiniAppUiLoads([withUi('slow')])
    await runMiniAppUiLoads(
      older,
      [withUi('slow')],
      discover,
      () => {},
      clock.schedule,
      clock.cancel,
    )
    expect(clock.queued).toHaveLength(1)
    claimMiniAppUiLoads([withUi('slow')])
    expect(clock.queued).toHaveLength(0)
    settle('slow', true)
    expect([...miniAppUiPending().loading]).toEqual(['slow'])
  })
})

// The grid's side of a failed import (its restored tabs are kept) is pinned where the grid lives:
// `entities/workspace-grid/model/failedMiniAppTab.test.ts`.
describe('the capability store over the UI loads', () => {
  // Ownership used to move when a newer request STARTED; the one-shot refetch on socket connect
  // failing then orphaned the pass that did publish, and the mini app stayed pending for good.
  test('settles stay with the publishing pass when a newer request fails before publishing', async () => {
    let settle!: MiniAppUiSettled
    const published = refetchMiniAppContrib(
      { loadSnapshot: async () => snapshot([withUi('late')]) },
      (_miniApps, settled) => {
        settle = settled!
        return new Promise<void>(() => {})
      },
    )
    await ticks()
    const failed = await refetchMiniAppContrib({
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

  // Measured: each settle re-rendered the app synchronously, one ~55 ms long task per mini app.
  test('N mini apps settling in one burst notify every subscriber exactly once', async () => {
    const names = ['a', 'b', 'c', 'd', 'e']
    let settle!: MiniAppUiSettled
    void refetchMiniAppContrib(
      { loadSnapshot: async () => snapshot([...names.map(withUi), plain('core-ish')]) },
      (_miniApps, settled) => {
        settle = settled!
        return new Promise<void>(() => {})
      },
    )
    await ticks()
    const before = miniAppContribVersion()
    let storeNotified = 0
    let activationNotified = 0
    const offStore = subscribeMiniAppContrib(() => (storeNotified += 1))
    const offActivation = subscribeMiniAppActivation(() => (activationNotified += 1))
    try {
      for (const name of names) settle(name, true)
      // State is current at once; nobody has been woken yet.
      expect(miniAppContributionActivation('e')).toBe('enabled')
      expect(miniAppContribVersion()).toBe(before + 1)
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
