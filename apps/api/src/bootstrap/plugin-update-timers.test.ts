import { describe, expect, test } from 'bun:test'

import { AUTO_UPDATE_INTERVAL_MS, firstPassDelayMs } from '../features/plugins/auto-update-schedule'
import type { IdleTaskContext } from '../lib/idle-tasks'
import { armPluginUpdateTimers } from './plugin-update-timers'

type Outcome = { skipped: boolean; refreshed: string[]; updated: string[]; failed: string[] }

/** A clock that only moves when the test fires a timer. */
function fakeClock() {
  const armed: Array<{
    kind: 'timeout' | 'interval'
    ms: number
    run: () => void
    cleared: boolean
  }> = []
  const arm = (kind: 'timeout' | 'interval') => (run: () => void, ms: number) => {
    const timer = { kind, ms, run, cleared: false }
    armed.push(timer)
    return timer
  }
  return {
    armed,
    timers: {
      setTimeout: arm('timeout'),
      setInterval: arm('interval'),
      clear: (timer: unknown) => void ((timer as { cleared: boolean }).cleared = true),
    },
    live: () => armed.filter((timer) => !timer.cleared),
  }
}

/** Every promise callback queued so far has run. */
const settled = () => new Promise<void>((resolve) => setImmediate(resolve))

function arm(opts: { outcomes?: Array<Outcome | Error>; official?: () => Promise<object> } = {}) {
  const clock = fakeClock()
  const passes: Array<{ userId: string }> = []
  const logs: Array<{ level: 'info' | 'warn'; entry: object }> = []
  const outcomes = [...(opts.outcomes ?? [])]
  const controller = new AbortController()
  const { officialMarketplaceTask } = armPluginUpdateTimers({
    pluginService: {
      updates: {
        autoUpdatePass: async (userId: string) => {
          passes.push({ userId })
          const next = outcomes.shift() ?? {
            skipped: false,
            refreshed: [],
            updated: [],
            failed: [],
          }
          if (next instanceof Error) throw next
          return next
        },
      } as never,
      ensureOfficialMarketplace: (opts.official ?? (async () => ({ added: true }))) as never,
    },
    userId: 'u1',
    logger: {
      info: (entry) => logs.push({ level: 'info', entry }),
      warn: (entry) => logs.push({ level: 'warn', entry }),
    },
    signal: controller.signal,
    schedule: { timers: clock.timers, random: () => 0.5 },
  })
  return { clock, passes, logs, controller, officialMarketplaceTask }
}

describe('the plugin auto-update timers', () => {
  test('the first pass runs after the random start delay, then every six hours', async () => {
    const { clock, passes } = arm()
    expect(passes).toEqual([])
    expect(clock.live().map(({ kind, ms }) => [kind, ms])).toEqual([
      ['timeout', firstPassDelayMs(() => 0.5)],
    ])

    clock.armed[0]!.run()
    await settled()
    expect(passes).toEqual([{ userId: 'u1' }])
    const every = clock.armed.find((timer) => timer.kind === 'interval')!
    expect(every.ms).toBe(AUTO_UPDATE_INTERVAL_MS)

    every.run()
    every.run()
    await settled()
    expect(passes).toHaveLength(3)
  })

  test('a pass that updated or failed something is logged; a quiet or switched-off one is not', async () => {
    const { clock, logs } = arm({
      outcomes: [
        // Off under DISABLE_AUTOUPDATER and the rest: the pass answers skipped with nothing done.
        { skipped: true, refreshed: [], updated: [], failed: [] },
        { skipped: false, refreshed: ['localix'], updated: [], failed: [] },
        { skipped: false, refreshed: ['localix'], updated: ['notes@localix'], failed: ['x@ada'] },
      ],
    })
    clock.armed[0]!.run()
    await settled()
    const every = clock.armed.find((timer) => timer.kind === 'interval')!
    every.run()
    await settled()
    expect(logs).toEqual([])

    every.run()
    await settled()
    expect(logs).toEqual([
      {
        level: 'info',
        entry: {
          event: 'plugins.auto_update',
          skipped: false,
          refreshed: ['localix'],
          updated: ['notes@localix'],
          failed: ['x@ada'],
        },
      },
    ])
  })

  test('a failing pass is a warning, and the next one still runs', async () => {
    const { clock, passes, logs } = arm({ outcomes: [new Error('offline')] })
    clock.armed[0]!.run()
    await settled()
    expect(logs).toEqual([
      { level: 'warn', entry: { event: 'plugins.auto_update_failed', error: 'offline' } },
    ])
    clock.armed.find((timer) => timer.kind === 'interval')!.run()
    await settled()
    expect(passes).toHaveLength(2)
  })

  test('shutting down before the first pass disarms it; after it, the six-hour cadence stops', () => {
    const before = arm()
    before.controller.abort()
    expect(before.clock.live()).toEqual([])

    const after = arm()
    after.clock.armed[0]!.run()
    const cadence = () => after.clock.live().filter(({ kind }) => kind === 'interval')
    expect(cadence()).toHaveLength(1)
    after.controller.abort()
    expect(cadence()).toEqual([])
  })

  test('the official marketplace task registers it once idle, logging what it did or why not', async () => {
    const ctx = { signal: new AbortController().signal, yield: async () => {} } as IdleTaskContext
    const added = arm()
    expect(added.officialMarketplaceTask.name).toBe('official_plugin_marketplace')
    await added.officialMarketplaceTask.run(ctx)
    expect(added.logs).toEqual([
      { level: 'info', entry: { event: 'plugins.official_marketplace', added: true } },
    ])

    const failed = arm({
      official: async () => {
        throw new Error('github unreachable')
      },
    })
    await failed.officialMarketplaceTask.run(ctx)
    expect(failed.logs).toEqual([
      {
        level: 'warn',
        entry: { event: 'plugins.official_marketplace_failed', error: 'github unreachable' },
      },
    ])
  })
})
