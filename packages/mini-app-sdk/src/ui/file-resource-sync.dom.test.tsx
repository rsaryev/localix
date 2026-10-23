import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import {
  bindMiniAppUiRuntime,
  type MiniAppUiRuntime,
  type MiniAppWorkspaceWatchHandlers,
} from './runtime'
import { useFileResourceSync } from './file-resource-sync'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())
const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms))

test('live file sync has no periodic reads, queues invalidation during reads, and falls back on signal loss', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  let watcher!: MiniAppWorkspaceWatchHandlers
  let released = 0
  const unbind = bindMiniAppUiRuntime({
    files: {
      watchWorkspace: (_session, handlers) => {
        watcher = handlers
        handlers.onLive(true)
        return () => {
          released++
        }
      },
    },
  } as MiniAppUiRuntime)
  const root = createRoot(document.createElement('div'))
  const pending: Array<(value: number) => void> = []
  const applied: number[] = []
  let calls = 0
  let initial = true
  let aborted = false
  function Probe() {
    useFileResourceSync({
      sessionId: 's',
      prefix: '.localix/resumes',
      windowMs: 0,
      fallbackMs: 20,
      read: (signal) => {
        calls++
        signal.addEventListener(
          'abort',
          () => {
            aborted = true
          },
          { once: true },
        )
        if (initial) return new Promise<number>((resolve) => pending.push(resolve))
        return Promise.resolve(calls)
      },
      apply: (value) => applied.push(value),
    })
    return null
  }
  try {
    await act(async () => {
      root.render(<Probe />)
      await tick()
    })
    await act(async () => {
      await tick()
    })
    expect(calls).toBe(1)
    await act(async () => {
      watcher.onChange(['/repo/.localix/resumes/a/resume.json'])
      watcher.onChange(['/repo/.localix/resumes/a/resume.json'])
      await tick()
    })
    expect(calls).toBe(1)
    await act(async () => {
      pending[0]!(1)
      await tick()
    })
    expect(applied).toEqual([])
    expect(calls).toBe(2)
    initial = false
    await act(async () => {
      pending[1]!(2)
      await tick(65)
    })
    expect(applied).toEqual([2])
    expect(calls).toBe(2)
    await act(async () => {
      watcher.onLive(false)
      await tick()
    })
    await act(async () => {
      await tick(45)
    })
    expect(calls).toBeGreaterThan(2)
    initial = true
    await act(async () => {
      watcher.onChange(['/repo/.localix/resumes/a/resume.json'])
      await tick()
    })
    await act(async () => root.unmount())
    expect(aborted).toBe(true)
    expect(released).toBe(1)
    const count = applied.length
    for (const release of pending.slice(2)) release(999)
    await tick()
    expect(applied).toHaveLength(count)
  } finally {
    await act(async () => root.unmount())
    unbind()
  }
})
