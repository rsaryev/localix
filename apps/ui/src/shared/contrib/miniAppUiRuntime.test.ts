import { describe, expect, test } from 'bun:test'
import type { MiniAppUiHost } from '@localixai/mini-app-sdk/ui'

import { createMiniAppUiRuntime, type MiniAppUiArtifact } from './miniAppUiRuntime'

type Modules = Record<string, () => unknown>

/**
 * A runtime whose "network" maps `name@revision` to a module factory. Every host-side effect —
 * styles, removals, registrations, announcements — lands in ONE log, so a test reads the order.
 */
function harness(build: (log: string[]) => Modules) {
  const log: string[] = []
  const failures: string[] = []
  const modules = build(log)
  const runtime = createMiniAppUiRuntime({
    importEntry: async ({ name, revision }) => {
      const factory = modules[`${name}@${revision}`]
      if (!factory) throw new Error(`no ${name}@${revision}`)
      return factory()
    },
    mountStyles: async ({ name, revision }) => {
      log.push(`styles+ ${name}@${revision}`)
      return () => log.push(`styles- ${name}@${revision}`)
    },
    hostFor: (name) => ({ name }) as unknown as MiniAppUiHost,
    remove: (name) => log.push(`remove ${name}`),
    announce: () => log.push('announce'),
    report: (name) => failures.push(name),
  })
  return { runtime, log, failures }
}

const artifact = (name: string, revision: string): MiniAppUiArtifact => ({
  name,
  entry: `/rpc/plugins/${name}/ui/entry.js`,
  styles: [],
  revision,
})

/** A module whose `registerUi` logs `register <name>@<label>`. */
const version = (log: string[], label: string) => () => ({
  registerUi: (host: MiniAppUiHost) => {
    log.push(`register ${(host as unknown as { name: string }).name}@${label}`)
  },
})

describe('converging on the snapshot', () => {
  test('loads each enabled artifact once, however often the same snapshot arrives', async () => {
    let imports = 0
    const { runtime, log } = harness((log) => ({
      'sample@r1': () => {
        imports += 1
        return version(log, 'r1')()
      },
    }))
    await Promise.all([
      runtime.reconcile([artifact('sample', 'r1')]),
      runtime.reconcile([artifact('sample', 'r1')]),
    ])
    await runtime.reconcile([artifact('sample', 'r1')])
    expect(imports).toBe(1)
    expect(log).toEqual(['styles+ sample@r1', 'register sample@r1'])
    expect([...runtime.loaded()]).toEqual([['sample', 'r1']])
  })

  // One bad plugin used to reject the whole pass, and its caller awaits the pass before
  // publishing the capability snapshot — so a single broken chunk hid EVERY plugin.
  test('a plugin that fails to import is reported and skipped, not fatal to the pass', async () => {
    const { runtime, log, failures } = harness((log) => ({ 'healthy@r1': version(log, 'r1') }))
    await runtime.reconcile([artifact('broken', 'r1'), artifact('healthy', 'r1')])
    expect(failures).toEqual(['broken'])
    expect(log).toEqual(['styles+ healthy@r1', 'register healthy@r1'])
  })

  test('a plugin whose first import failed is retried on the next pass', async () => {
    let attempts = 0
    const { runtime } = harness(() => ({
      'flaky@r1': () => {
        attempts += 1
        if (attempts === 1) throw new Error('cold start')
        return {}
      },
    }))
    await runtime.reconcile([artifact('flaky', 'r1')])
    await runtime.reconcile([artifact('flaky', 'r1')])
    expect(attempts).toBe(2)
    expect([...runtime.loaded().keys()]).toEqual(['flaky'])
  })

  // The caller registers each plugin's view as it lands; a pass-level signal would make every
  // plugin wait for the slowest artifact again.
  test('each plugin is reported settled as ITS work ends, not when the pass ends', async () => {
    let releaseSlow!: () => void
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve
    })
    const { runtime } = harness((log) => ({
      'fast@r1': version(log, 'r1'),
      'slow@r1': () => slowGate.then(version(log, 'r1')),
    }))
    const settled: string[] = []
    const pass = runtime.reconcile(
      [artifact('slow', 'r1'), artifact('fast', 'r1'), artifact('broken', 'r1')],
      (name) => settled.push(name),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    // A failed plugin settles too: its tab is then genuinely unavailable, not still loading.
    expect(settled.sort()).toEqual(['broken', 'fast'])
    releaseSlow()
    await pass
    expect(settled).toContain('slow')
    // An unchanged plugin on the next pass settles at once.
    const again: string[] = []
    await runtime.reconcile([artifact('fast', 'r1')], (name) => again.push(name))
    expect(again).toContain('fast')
  })
})

describe('replacing and unloading in place', () => {
  test('a new revision is imported and styled first, then swapped, then the old styles go', async () => {
    const { runtime, log } = harness((log) => ({
      'sample@r1': version(log, 'r1'),
      'sample@r2': version(log, 'r2'),
    }))
    await runtime.reconcile([artifact('sample', 'r1')])
    await runtime.reconcile([artifact('sample', 'r2')])
    expect(log).toEqual([
      'styles+ sample@r1',
      'register sample@r1',
      'styles+ sample@r2',
      'remove sample',
      'register sample@r2',
      'styles- sample@r1',
      'announce',
    ])
  })

  test('a broken build keeps the running version: nothing is removed', async () => {
    const { runtime, log, failures } = harness((log) => ({ 'sample@r1': version(log, 'r1') }))
    await runtime.reconcile([artifact('sample', 'r1')])
    await runtime.reconcile([artifact('sample', 'r2')])
    expect(failures).toEqual(['sample'])
    expect(log).toEqual(['styles+ sample@r1', 'register sample@r1'])
    expect([...runtime.loaded()]).toEqual([['sample', 'r1']])
  })

  test('a registration that throws midway is rolled back to the previous module', async () => {
    const { runtime, log, failures } = harness((log) => ({
      'sample@r1': version(log, 'r1'),
      'sample@r2': () => ({
        registerUi: () => {
          log.push('register sample@r2 (partial)')
          throw new Error('bad registration')
        },
      }),
    }))
    await runtime.reconcile([artifact('sample', 'r1')])
    await runtime.reconcile([artifact('sample', 'r2')])
    expect(failures).toEqual(['sample'])
    expect(log).toEqual([
      'styles+ sample@r1',
      'register sample@r1',
      'styles+ sample@r2',
      'remove sample',
      'register sample@r2 (partial)',
      'remove sample',
      'styles- sample@r2',
      'register sample@r1',
      'announce',
    ])
    expect([...runtime.loaded()]).toEqual([['sample', 'r1']])
  })

  test('a plugin that left the enabled set is unloaded, styles and all', async () => {
    const { runtime, log } = harness((log) => ({ 'sample@r1': version(log, 'r1') }))
    await runtime.reconcile([artifact('sample', 'r1')])
    await runtime.reconcile([])
    expect(log).toEqual([
      'styles+ sample@r1',
      'register sample@r1',
      'remove sample',
      'styles- sample@r1',
      'announce',
    ])
    expect(runtime.loaded().size).toBe(0)
  })

  test('snapshots racing each other: the latest wanted revision wins, stale work is skipped', async () => {
    const imported: string[] = []
    const track = (key: string) => () => {
      imported.push(key)
      return {}
    }
    const { runtime } = harness(() => ({
      'sample@r1': track('r1'),
      'sample@r2': track('r2'),
      'sample@r3': track('r3'),
    }))
    await Promise.all([
      runtime.reconcile([artifact('sample', 'r1')]),
      runtime.reconcile([artifact('sample', 'r2')]),
      runtime.reconcile([artifact('sample', 'r3')]),
    ])
    expect(imported).toEqual(['r3'])
    expect([...runtime.loaded()]).toEqual([['sample', 'r3']])
  })
})
