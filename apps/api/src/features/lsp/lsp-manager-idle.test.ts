import { expect, spyOn, test } from 'bun:test'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createLspManager } from './lsp-manager'
import type { LspClientInfo } from './lsp-client'

function controlledTimers() {
  const timers: { run(): void; cancelled: boolean; unref: number }[] = []
  const set = spyOn(globalThis, 'setTimeout').mockImplementation(((run: () => void) => {
    const timer = { run, cancelled: false, unref: 0 }
    timers.push(timer)
    return {
      unref: () => {
        timer.unref++
      },
      timer,
    }
  }) as unknown as typeof setTimeout)
  const clear = spyOn(globalThis, 'clearTimeout').mockImplementation(((handle: {
    timer: (typeof timers)[number]
  }) => {
    handle.timer.cancelled = true
  }) as unknown as typeof clearTimeout)
  return {
    timers,
    restore: () => {
      set.mockRestore()
      clear.mockRestore()
    },
  }
}

test('idle eviction rechecks documents and query activity before releasing a client', async () => {
  const clock = controlledTimers()
  const root = '/fixture'
  const file = `${root}/a.idle-fixture`
  let open = false
  let disposed = 0
  const manager = createLspManager({
    idleTimeoutMs: 25,
    createClient: async (input) => {
      input.onReady?.()
      return {
        syncDocument: async () => {},
        closeDocument: async () => {
          open = false
        },
        hasOpenDocuments: () => open,
        diagnostics: () => ({}),
        hover: async () => {
          throw new Error('rejected query')
        },
        dispose: () => {
          disposed++
          throw new Error('already closed')
        },
      } as unknown as LspClientInfo
    },
  })
  manager.setPluginServers(root, [
    {
      id: 'idle-fixture',
      extensions: ['.idle-fixture'],
      resolveRoot: () => root,
      spawn: async () => ({ process: {} as ChildProcessWithoutNullStreams, initialization: {} }),
    },
  ])
  try {
    await manager.openDocument(root, file, '')
    expect(clock.timers).toHaveLength(2)
    expect(clock.timers[0]!.cancelled).toBe(true)
    expect(clock.timers.map((timer) => timer.unref)).toEqual([1, 1])
    open = true
    clock.timers[1]!.run()
    expect(disposed).toBe(0)
    expect(manager.getServerStates(root)).toHaveLength(1)

    await manager.closeDocument(root, file)
    const previous = clock.timers.at(-1)!
    expect(await manager.hover(root, file, { line: 0, character: 0 })).toBeNull()
    expect(previous.cancelled).toBe(true)
    const replacement = clock.timers.at(-1)!
    expect(replacement).not.toBe(previous)
    replacement.run()
    expect(disposed).toBe(1)
    expect(replacement.cancelled).toBe(true)
    expect(manager.getServerStates(root)).toEqual([])
  } finally {
    manager.dispose()
    clock.restore()
  }
})
