import { expect, test } from 'bun:test'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createLspManager } from './lsp-manager'
import type { LspClientInfo } from './lsp-client'

test('concurrent callers share a failed startup and a later call can retry', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let spawns = 0
  let creates = 0
  const events: unknown[] = []
  const root = '/fixture'
  const file = `${root}/a.startup-fixture`
  const manager = createLspManager({
    idleTimeoutMs: 0,
    health: {
      ready: (server) => {
        events.push(['ready', server.serverId])
      },
      failed: (server, reason) => {
        events.push(['failed', server.serverId, reason])
      },
    },
    createClient: async (input) => {
      creates++
      if (creates === 1) {
        await gate
        return undefined
      }
      input.onReady?.()
      return {
        hover: async () => ({ value: 'retry succeeded' }),
        hasOpenDocuments: () => false,
        dispose: () => {},
      } as unknown as LspClientInfo
    },
  })
  manager.onUpdate((_root, states) => {
    events.push(['states', states.map((s) => s.status)])
  })
  manager.setPluginServers(root, [
    {
      id: 'startup-fixture',
      extensions: ['.startup-fixture'],
      resolveRoot: () => root,
      spawn: async () => {
        spawns++
        return { process: {} as ChildProcessWithoutNullStreams, initialization: {} }
      },
    },
  ])
  try {
    const first = manager.hover(root, file, { line: 0, character: 0 })
    const second = manager.hover(root, file, { line: 1, character: 0 })
    await Promise.resolve()
    expect(spawns).toBe(1)
    expect(creates).toBe(1)
    release()
    expect(await Promise.all([first, second])).toEqual([null, null])
    expect(manager.getServerStates(root)).toEqual([])
    expect(await manager.hover(root, file, { line: 0, character: 0 })).toEqual({
      value: 'retry succeeded',
    })
    expect(spawns).toBe(2)
    expect(creates).toBe(2)
    expect(events).toEqual([
      ['states', ['starting']],
      ['failed', 'startup-fixture', 'start'],
      ['states', []],
      ['states', ['starting']],
      ['states', ['ready']],
      ['ready', 'startup-fixture'],
    ])
  } finally {
    release()
    manager.dispose()
  }
})
