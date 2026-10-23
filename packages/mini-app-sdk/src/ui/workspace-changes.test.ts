import { afterEach, describe, expect, test } from 'bun:test'

import {
  bindPluginUiRuntime,
  pluginFiles,
  type PluginUiRuntime,
  type PluginWorkspaceChange,
  type PluginWorkspaceWatchHandlers,
} from './runtime'
import { createWorkspaceChangeCoalescer, MAX_COALESCED_PATHS } from './workspace-changes'

/** Manual timers: a test decides when the window closes. */
function manualTimers() {
  const pending = new Map<number, () => void>()
  let next = 0
  return {
    timers: {
      set: (handler: () => void) => {
        pending.set(++next, handler)
        return next
      },
      clear: (handle: unknown) => void pending.delete(handle as number),
    },
    get armed() {
      return pending.size
    },
    fire() {
      const handlers = [...pending.values()]
      pending.clear()
      for (const handler of handlers) handler()
    },
  }
}

describe('createWorkspaceChangeCoalescer', () => {
  test('folds every batch of one window into a single delivery of distinct paths', () => {
    const clock = manualTimers()
    const seen: PluginWorkspaceChange[] = []
    const coalescer = createWorkspaceChangeCoalescer('s1', (c) => seen.push(c), 500, clock.timers)
    coalescer.push(['/w/a.ts', '/w'])
    coalescer.push(['/w/b.ts', '/w'])
    expect(seen).toEqual([])
    // The window starts at the FIRST change and later ones do not push it back: steady churn
    // still delivers, where a trailing debounce would starve until the churn stopped.
    expect(clock.armed).toBe(1)
    clock.fire()
    expect(seen).toEqual([{ sessionId: 's1', paths: ['/w/a.ts', '/w', '/w/b.ts'] }])
    coalescer.push(['/w/c.ts'])
    clock.fire()
    expect(seen.at(-1)).toEqual({ sessionId: 's1', paths: ['/w/c.ts'] })
  })

  test('a coarse batch, or too many paths, delivers the coarse form', () => {
    const clock = manualTimers()
    const seen: PluginWorkspaceChange[] = []
    const coalescer = createWorkspaceChangeCoalescer('s1', (c) => seen.push(c), 500, clock.timers)
    coalescer.push(['/w/a.ts'])
    coalescer.push(null)
    coalescer.push(['/w/b.ts'])
    clock.fire()
    expect(seen).toEqual([{ sessionId: 's1', paths: null }])

    coalescer.push(Array.from({ length: MAX_COALESCED_PATHS + 1 }, (_, i) => `/w/${i}.ts`))
    clock.fire()
    expect(seen.at(-1)).toEqual({ sessionId: 's1', paths: null })
  })

  test('nothing is delivered after close', () => {
    const clock = manualTimers()
    const seen: PluginWorkspaceChange[] = []
    const coalescer = createWorkspaceChangeCoalescer('s1', (c) => seen.push(c), 500, clock.timers)
    coalescer.push(['/w/a.ts'])
    coalescer.close()
    clock.fire()
    coalescer.push(['/w/b.ts'])
    expect(clock.armed).toBe(0)
    expect(seen).toEqual([])
  })
})

describe('pluginFiles.watchWorkspace', () => {
  let unbind: (() => void) | undefined
  afterEach(() => {
    unbind?.()
    unbind = undefined
  })

  test('holds the host feed for one chat, coalesces it, and releases it on unsubscribe', async () => {
    let handlers = null as PluginWorkspaceWatchHandlers | null
    let held = null as string | null
    unbind = bindPluginUiRuntime({
      files: {
        watchWorkspace: (sessionId: string, next: PluginWorkspaceWatchHandlers) => {
          held = sessionId
          handlers = next
          return () => {
            held = null
          }
        },
      },
    } as unknown as PluginUiRuntime)
    const seen: PluginWorkspaceChange[] = []
    const live: boolean[] = []
    const off = pluginFiles.watchWorkspace('s1', (c) => seen.push(c), {
      windowMs: 5,
      onLive: (value) => live.push(value),
    })
    expect(held).toBe('s1')
    handlers!.onLive(true)
    handlers!.onChange(['/w/a.ts'])
    handlers!.onChange(['/w/b.ts'])
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(live).toEqual([true])
    expect(seen).toEqual([{ sessionId: 's1', paths: ['/w/a.ts', '/w/b.ts'] }])
    off()
    expect(held).toBeNull()
  })

  test('a host without a watcher answers not-live and never delivers', () => {
    unbind = bindPluginUiRuntime({ files: {} } as unknown as PluginUiRuntime)
    const live: boolean[] = []
    const off = pluginFiles.watchWorkspace(
      's1',
      () => {
        throw new Error('no feed, no delivery')
      },
      { onLive: (value) => live.push(value) },
    )
    expect(live).toEqual([false])
    off()
  })
})
