import { describe, expect, test } from 'bun:test'

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  KIT_LAYOUT_INPUTS,
  pluginNameForChange,
  watchPluginKitInputs,
  watchPluginsForRestage,
} from './dev-plugin-watch.mjs'
import { PLUGIN_KIT_INPUTS } from './stage-plugin-kit.mjs'

/** A kit watcher over fake watch/timer ports: emit changes per input, fire the live timer. */
function kitHarness(restageKit: () => Promise<void> | void = () => {}) {
  const repoRoot = resolve(import.meta.dir, '..')
  const listeners = new Map<string, () => void>()
  const live = new Map<number, { fn: () => void; delay: number }>()
  let nextTimer = 0
  const handle = watchPluginKitInputs({
    repoRoot,
    outPlugins: '/unused',
    restageKit,
    watch: ((path: string, _options: unknown, listener: () => void) => {
      listeners.set(path, listener)
      return { on: () => {}, close: () => {} }
    }) as never,
    setTimer: ((fn: () => void, delay: number) => {
      live.set(++nextTimer, { fn, delay })
      return nextTimer
    }) as never,
    clearTimer: ((id: number) => live.delete(id)) as never,
  })
  const change = (input: string) => listeners.get(resolve(repoRoot, input))?.()
  const pending = () => [...live.values()].map((timer) => timer.delay)
  const fire = async () => {
    const timers = [...live.entries()]
    live.clear()
    for (const [, timer] of timers) timer.fn()
    await Bun.sleep(0)
  }
  return { repoRoot, listeners, change, pending, fire, handle }
}

const CONTENT_INPUT = 'apps/ui/src/shared/ui'

// The API reloads on every source edit while the kit was staged once, so `/plugin create` failed
// with "the plugin kit has an unknown layout" until a restart. Every kit input is watched, and a
// burst of changes re-stages the kit once.
test('re-stages the plugin kit once per burst of changes to any of its inputs', async () => {
  let restaged = 0
  const kit = kitHarness(() => void restaged++)
  expect([...kit.listeners.keys()]).toEqual(
    PLUGIN_KIT_INPUTS.map((input) => resolve(kit.repoRoot, input)),
  )
  for (const input of PLUGIN_KIT_INPUTS) kit.change(input)
  await kit.fire()
  expect(restaged).toBe(1)
  kit.handle.close()
})

// Re-staging one second after every UI save — a stage runs `tsc` for the kit's declarations —
// kept the machine at 250–400% CPU for as long as anyone edited.
test('a content change waits for the inputs to go quiet; a layout change does not', () => {
  const kit = kitHarness()
  expect(KIT_LAYOUT_INPUTS).toContain('apps/api/src/features/plugins/authoring/kit-layout.ts')
  expect(KIT_LAYOUT_INPUTS).not.toContain(CONTENT_INPUT)

  kit.change(CONTENT_INPUT)
  expect(kit.pending()).toEqual([20_000])
  kit.change('apps/api/src/features/plugins/authoring/kit-layout.ts')
  expect(kit.pending()).toEqual([1000])
  // A content save during a pending layout re-stage does not postpone it.
  kit.change(CONTENT_INPUT)
  expect(kit.pending()).toEqual([1000])
  kit.handle.close()
})

test('a stage never overlaps another; changes during one earn exactly one more', async () => {
  let running = 0
  let peak = 0
  let stages = 0
  let release: () => void = () => {}
  const kit = kitHarness(async () => {
    stages++
    running++
    peak = Math.max(peak, running)
    await new Promise<void>((resolveStage) => (release = resolveStage))
    running--
  })
  kit.change(CONTENT_INPUT)
  await kit.fire()
  // Two more bursts land while the first stage is still running.
  kit.change(CONTENT_INPUT)
  await kit.fire()
  kit.change(CONTENT_INPUT)
  await kit.fire()
  expect(stages).toBe(1)
  release()
  await Bun.sleep(0)
  expect(stages).toBe(2)
  release()
  await Bun.sleep(0)
  expect(stages).toBe(2)
  expect(peak).toBe(1)
  kit.handle.close()
})

describe('dev plugin watcher', () => {
  test('maps a change to the plugin it belongs to and ignores what staging strips', () => {
    expect(pluginNameForChange('gpu-monitor/plugin.json')).toBe('gpu-monitor')
    expect(pluginNameForChange('gpu-monitor/backend/index.ts')).toBe('gpu-monitor')
    expect(pluginNameForChange('gpu-monitor/skills/inspect-gpu-monitor/SKILL.md')).toBe(
      'gpu-monitor',
    )
    expect(pluginNameForChange('gpu-monitor')).toBe('gpu-monitor')
    // UI sources are built into the staged artifact, so an edit there is a re-stage: it is how
    // a UI change reaches the running workbench without reloading it.
    expect(pluginNameForChange('gpu-monitor/ui/register.tsx')).toBe('gpu-monitor')
    expect(pluginNameForChange('gpu-monitor/ui/system/Panel.tsx')).toBe('gpu-monitor')
    // The preview shell / build products / tests: no staged byte changes.
    expect(pluginNameForChange('gpu-monitor/preview/main.tsx')).toBeNull()
    expect(pluginNameForChange('gpu-monitor/dist/plugin/register.js')).toBeNull()
    expect(pluginNameForChange('gpu-monitor/node_modules/x/index.js')).toBeNull()
    expect(pluginNameForChange('gpu-monitor/.turbo/turbo-test.log')).toBeNull()
    expect(pluginNameForChange('gpu-monitor/backend/system.test.ts')).toBeNull()
    expect(pluginNameForChange('.DS_Store')).toBeNull()
    expect(pluginNameForChange(null)).toBeNull()
  })

  test('coalesces a burst of changes into one re-stage per plugin', () => {
    let onEvents: ((events: { path: string; type: string }[]) => void) | undefined
    const emit = (...files: string[]) =>
      onEvents?.(files.map((file) => ({ path: join('/repo/plugins', file), type: 'update' })))
    const timers: (() => void)[] = []
    const restaged: string[] = []
    const watcher = watchPluginsForRestage({
      repoRoot: '/repo',
      outPlugins: '/staged',
      restage: ({ name }) => {
        restaged.push(name)
        return { staged: true }
      },
      watch: (() => ({ on() {}, close() {} })) as never,
      subscribe: ((_dir: string, listener: typeof onEvents) => {
        onEvents = listener
        return { close() {} }
      }) as never,
      setTimer: ((fn: () => void) => {
        timers.push(fn)
        return timers.length
      }) as never,
    })
    // A scaffold: forty files land in one plugin, in ONE native batch; a save lands in another.
    emit(...Array.from({ length: 40 }, (_, i) => `gpu-monitor/backend/file-${i}.ts`))
    emit('trading/backend/index.ts')
    emit('gpu-monitor/ui/register.tsx', 'gpu-monitor/dist/plugin/register.js')
    // Only the LAST timer per plugin is live (earlier ones were cleared); firing every
    // scheduled callback must still yield exactly one re-stage per plugin.
    const live = timers.slice(-2)
    for (const fire of live) fire()
    expect(restaged.sort()).toEqual(['gpu-monitor', 'trading'])
    watcher.close()
  })

  // `bun install` is the fix a failed plugin's "Could not resolve" asks for, and it changes nothing
  // under `plugins/` — the plugin stayed missing until `bun run dev` was restarted.
  test('a dependency change re-stages exactly the plugins the marker names as failed', () => {
    const repoRoot = resolve(import.meta.dir, '..')
    const listeners = new Map<string, () => void>()
    const timers: (() => void)[] = []
    const restaged: string[] = []
    const watcher = watchPluginsForRestage({
      repoRoot,
      outPlugins: '/staged',
      restage: ({ name }) => {
        restaged.push(name)
        return { staged: true }
      },
      unavailable: () => ({ 'project-space': 'error: Could not resolve: "fractional-indexing"' }),
      watch: ((path: string, _opts: unknown, listener: () => void) => {
        listeners.set(path, listener)
        return { on() {}, close() {} }
      }) as never,
      subscribe: (() => ({ close() {} })) as never,
      setTimer: ((fn: () => void) => {
        timers.push(fn)
        return timers.length
      }) as never,
    })
    // `plugins/` itself is on the native watcher; only the non-recursive inputs use fs.watch.
    expect([...listeners.keys()].sort()).toEqual(
      [join(repoRoot, 'bun.lock'), join(repoRoot, 'node_modules')].sort(),
    )
    listeners.get(join(repoRoot, 'node_modules'))?.()
    listeners.get(join(repoRoot, 'bun.lock'))?.()
    timers.at(-1)?.()
    expect(restaged).toEqual(['project-space'])
    watcher.close()
  })

  // Bun's recursive fs.watch on macOS delivered a fraction of a burst like a scaffold's, so a
  // freshly created plugin could miss its re-stage. The native watcher sees every plugin.
  test('a real scaffold burst re-stages every plugin it touched (native watcher)', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'dev-plugin-watch-'))
    try {
      mkdirSync(join(repoRoot, 'plugins'))
      const restaged = new Set<string>()
      const lines: string[] = []
      const watcher = watchPluginsForRestage({
        repoRoot,
        outPlugins: '/staged',
        debounceMs: 30,
        log: (line) => lines.push(line),
        restage: ({ name }) => {
          restaged.add(name)
          return { staged: true }
        },
      })
      await Bun.sleep(150)
      for (const plugin of ['alpha', 'beta', 'gamma']) {
        mkdirSync(join(repoRoot, 'plugins', plugin, 'backend'), { recursive: true })
        writeFileSync(join(repoRoot, 'plugins', plugin, 'plugin.json'), '{}')
        writeFileSync(join(repoRoot, 'plugins', plugin, 'backend', 'index.ts'), 'export {}\n')
      }
      await Bun.sleep(600)
      watcher.close()
      expect(lines.filter((line) => line.includes('stopped'))).toEqual([])
      expect([...restaged].sort()).toEqual(['alpha', 'beta', 'gamma'])
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })
})
