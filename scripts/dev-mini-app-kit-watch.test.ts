import { expect, test } from 'bun:test'

import { resolve } from 'node:path'

import { KIT_LAYOUT_INPUTS, watchMiniAppKitInputs } from './dev-mini-app-kit-watch.mjs'
import { MINI_APP_KIT_INPUTS } from './stage-mini-app-kit.mjs'

/** A kit watcher over fake watch/timer ports: emit changes per input, fire the live timer. */
function kitHarness(restageKit: () => Promise<void> | void = () => {}) {
  const repoRoot = resolve(import.meta.dir, '..')
  const listeners = new Map<string, () => void>()
  const live = new Map<number, { fn: () => void; delay: number }>()
  let nextTimer = 0
  const handle = watchMiniAppKitInputs({
    repoRoot,
    outKit: '/unused',
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
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { repoRoot, listeners, change, pending, fire, handle }
}

const CONTENT_INPUT = 'apps/ui/src'

// The API reloads on every source edit while the kit was staged once, so building a mini app failed
// with "the mini app kit has an unknown layout" until a restart. Every kit input is watched, and a
// burst of changes re-stages the kit once.
test('re-stages the mini app kit once per burst of changes to any of its inputs', async () => {
  let restaged = 0
  const kit = kitHarness(() => void restaged++)
  expect([...kit.listeners.keys()]).toEqual(
    MINI_APP_KIT_INPUTS.map((input) => resolve(kit.repoRoot, input)),
  )
  for (const input of MINI_APP_KIT_INPUTS) kit.change(input)
  await kit.fire()
  expect(restaged).toBe(1)
  kit.handle.close()
})

// Re-staging one second after every UI save — a stage runs `tsc` for the kit's declarations —
// kept the machine at 250–400% CPU for as long as anyone edited.
test('a content change waits for the inputs to go quiet; a layout change does not', () => {
  const kit = kitHarness()
  expect(KIT_LAYOUT_INPUTS).toContain('apps/api/src/features/mini-apps/kit-layout.ts')
  expect(KIT_LAYOUT_INPUTS).not.toContain(CONTENT_INPUT)

  kit.change(CONTENT_INPUT)
  expect(kit.pending()).toEqual([20_000])
  kit.change('apps/api/src/features/mini-apps/kit-layout.ts')
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
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(stages).toBe(2)
  release()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(stages).toBe(2)
  expect(peak).toBe(1)
  kit.handle.close()
})
