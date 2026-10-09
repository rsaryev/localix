import { describe, expect, spyOn, test } from 'bun:test'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import { createLspManager } from './lsp-manager'
import type { LspClientInfo } from './lsp-protocol'
import type { LspServerDef } from './lsp-servers'
import type { createLspClient } from './lsp-client'

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function fakeClient(onReady: () => void) {
  let open = false
  let disposed = 0
  const client = {
    serverId: 'fake',
    rootUri: 'file:///workspace',
    touchFileAndWait: async () => {},
    syncDocument: async () => {
      open = true
    },
    closeDocument: async () => {
      open = false
    },
    hasOpenDocuments: () => open,
    workspaceSymbols: async () => [],
    diagnostics: () => ({}),
    dispose: () => {
      disposed += 1
    },
  } as unknown as LspClientInfo
  onReady()
  return { client, disposed: () => disposed }
}

function fakeServer(spawn: LspServerDef['spawn']): LspServerDef {
  return {
    id: 'fake',
    extensions: ['.fake'],
    resolveRoot: (_file, root) => root,
    spawn,
  }
}

describe('LSP manager lifecycle', () => {
  test('evicts an idle server only after its last editor document closes', async () => {
    let state: ReturnType<typeof fakeClient> | undefined
    const manager = createLspManager({
      idleTimeoutMs: 5,
      createClient: (async (input) => {
        state = fakeClient(input.onReady ?? (() => {}))
        return state.client
      }) as typeof createLspClient,
    })
    manager.setPluginServers('/workspace', [
      fakeServer(async () => ({
        process: { kill: () => true } as unknown as ChildProcessWithoutNullStreams,
        initialization: {},
      })),
    ])

    await manager.openDocument('/workspace', '/workspace/a.fake', 'open')
    await pause(15)
    expect(state?.disposed()).toBe(0)

    await manager.closeDocument('/workspace', '/workspace/a.fake')
    await pause(15)
    expect(state?.disposed()).toBe(1)
    expect(manager.getServerStates('/workspace')).toEqual([])
    manager.dispose()
  })

  test('closes a document across independent language servers in parallel', async () => {
    let closeCalls = 0
    let releaseClose!: () => void
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve
    })
    const manager = createLspManager({
      createClient: (async (input) => {
        input.onReady?.()
        return {
          serverId: input.serverId,
          rootUri: 'file:///workspace',
          touchFileAndWait: async () => {},
          syncDocument: async () => {},
          closeDocument: async () => {
            closeCalls += 1
            await closeGate
          },
          hasOpenDocuments: () => false,
          workspaceSymbols: async () => [],
          diagnostics: () => ({}),
          dispose: () => {},
        } as unknown as LspClientInfo
      }) as typeof createLspClient,
    })
    const server = (id: string, extension: string): LspServerDef => ({
      id,
      extensions: [extension],
      resolveRoot: (_file, root) => root,
      spawn: async () => ({
        process: { kill: () => true } as unknown as ChildProcessWithoutNullStreams,
        initialization: {},
      }),
    })
    manager.setPluginServers('/workspace', [server('one', '.one'), server('two', '.two')])
    await Promise.all([
      manager.openDocument('/workspace', '/workspace/a.one', 'one'),
      manager.openDocument('/workspace', '/workspace/b.two', 'two'),
    ])

    const closing = manager.closeDocument('/workspace', '/workspace/a.one')
    await Promise.resolve()
    expect(closeCalls).toBe(2)
    releaseClose()
    await closing
    manager.dispose()
  })

  test('kills a server whose spawn resolves after manager disposal', async () => {
    let resolveSpawn!: (value: Awaited<ReturnType<LspServerDef['spawn']>>) => void
    const spawnGate = new Promise<Awaited<ReturnType<LspServerDef['spawn']>>>((resolve) => {
      resolveSpawn = resolve
    })
    const kill = spyOn(process, 'kill').mockImplementation(() => true as never)
    let createCalls = 0
    const manager = createLspManager({
      idleTimeoutMs: 5,
      createClient: (async () => {
        createCalls += 1
        return undefined
      }) as unknown as typeof createLspClient,
    })
    manager.setPluginServers('/workspace', [fakeServer(() => spawnGate)])

    const opening = manager.openDocument('/workspace', '/workspace/a.fake', 'open')
    await Promise.resolve()
    manager.dispose()
    try {
      resolveSpawn({
        process: { pid: 2 ** 30 } as unknown as ChildProcessWithoutNullStreams,
        initialization: {},
      })
      await opening

      if (process.platform !== 'win32') expect(kill).toHaveBeenCalledWith(-(2 ** 30), 'SIGTERM')
      expect(createCalls).toBe(0)
      expect(manager.getServerStates('/workspace')).toEqual([])
    } finally {
      kill.mockRestore()
    }
  })

  test('kills an initializing process immediately and disposes a late client', async () => {
    let resolveClient!: (client: LspClientInfo) => void
    const clientGate = new Promise<LspClientInfo>((resolve) => {
      resolveClient = resolve
    })
    let clientDisposed = 0
    const lateClient = {
      dispose: () => {
        clientDisposed += 1
      },
      hasOpenDocuments: () => false,
    } as unknown as LspClientInfo
    const kill = spyOn(process, 'kill').mockImplementation(() => true as never)
    const manager = createLspManager({
      createClient: (() => clientGate) as typeof createLspClient,
    })
    manager.setPluginServers('/workspace', [
      fakeServer(async () => ({
        process: { pid: 2 ** 29 } as unknown as ChildProcessWithoutNullStreams,
        initialization: {},
      })),
    ])

    const opening = manager.openDocument('/workspace', '/workspace/a.fake', 'open')
    await pause(0)
    manager.dispose()
    try {
      if (process.platform !== 'win32') expect(kill).toHaveBeenCalledWith(-(2 ** 29), 'SIGTERM')
      resolveClient(lateClient)
      await opening
      expect(clientDisposed).toBe(1)
    } finally {
      kill.mockRestore()
    }
  })

  test('stops waiting on a server that never answers, and listens again once it does', async () => {
    // Regression: three consecutive agent writes each paid the full 6s deadline for nothing.
    const waits: boolean[] = []
    let answer = false
    const manager = createLspManager({
      silentCooldownMs: 5,
      createClient: (async (input) => {
        input.onReady?.()
        return {
          serverId: input.serverId,
          rootUri: 'file:///workspace',
          touchFileAndWait: async (_file: string, wait = true) => {
            waits.push(wait)
            return wait ? answer : false
          },
          syncDocument: async () => {},
          closeDocument: async () => {},
          hasOpenDocuments: () => false,
          workspaceSymbols: async () => [],
          diagnostics: () => ({}),
          dispose: () => {},
        } as unknown as LspClientInfo
      }) as typeof createLspClient,
    })
    manager.setPluginServers('/workspace', [
      fakeServer(async () => ({
        process: { kill: () => true } as unknown as ChildProcessWithoutNullStreams,
        initialization: {},
      })),
    ])
    const report = () => manager.reportFileDiagnostics(['/workspace/a.fake'], '/workspace')
    await report() // strike 1: waited, unanswered
    await report() // strike 2: waited, unanswered → project marked silent
    await report() // pushed without waiting
    expect(waits).toEqual([true, true, false])

    // The cooldown gives the server another hearing; once it answers, the mark is cleared and
    // the next write waits normally again.
    await pause(10)
    answer = true
    await report() // waited again after the cooldown, answered → mark cleared
    await report() // still listening
    expect(waits).toEqual([true, true, false, true, true])
    manager.dispose()
  })

  test('parallel unanswered writes retain their captured project strike state', async () => {
    const waits: boolean[] = []
    const manager = createLspManager({
      idleTimeoutMs: 0,
      createClient: (async (input) => ({
        ...fakeClient(input.onReady ?? (() => {})).client,
        touchFileAndWait: async (_file: string, wait = true) => {
          waits.push(wait)
          return false
        },
      })) as typeof createLspClient,
    })
    manager.setPluginServers('/workspace', [
      fakeServer(async () => ({
        process: { kill: () => true } as unknown as ChildProcessWithoutNullStreams,
        initialization: {},
      })),
    ])
    try {
      await manager.reportFileDiagnostics(['/workspace/a.fake', '/workspace/b.fake'], '/workspace')
      await manager.reportFileDiagnostics(['/workspace/c.fake'], '/workspace')
      await manager.reportFileDiagnostics(['/workspace/d.fake'], '/workspace')
      expect(waits).toEqual([true, true, true, false])
    } finally {
      manager.dispose()
    }
  })
})
