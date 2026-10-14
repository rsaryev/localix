import { expect, test } from 'bun:test'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createLspManager } from './lsp-manager'
import type { LspClientInfo, LspDiagnostic } from './lsp-client'

const root = '/fixture'
const file = `${root}/shared`

async function fixture(overrides: (id: string) => Partial<LspClientInfo>) {
  const manager = createLspManager({
    idleTimeoutMs: 0,
    createClient: async (input) => {
      input.onReady?.()
      return {
        syncDocument: async () => {},
        hasOpenDocuments: () => true,
        diagnostics: () => ({}),
        dispose: () => {},
        ...overrides(input.serverId),
      } as LspClientInfo
    },
  })
  manager.setPluginServers(
    root,
    ['first', 'second'].map((id) => ({
      id,
      extensions: [`.operations-${id}`],
      resolveRoot: () => root,
      spawn: async () => ({ process: {} as ChildProcessWithoutNullStreams, initialization: {} }),
    })),
  )
  await manager.openDocument(root, `${root}/a.operations-first`, '')
  await manager.openDocument(root, `${root}/b.operations-second`, '')
  return manager
}

test('save and close fan out before settling and close publishes refreshed diagnostics once', async () => {
  const calls: string[] = []
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const diagnostic: LspDiagnostic = {
    message: 'after close',
    severity: 1,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  }
  let closed = false
  const manager = await fixture((id) => ({
    saveDocument: async (path) => {
      calls.push(`save:${id}:${path}`)
      await gate
      if (id === 'first') throw new Error('save rejected')
    },
    closeDocument: async (path) => {
      calls.push(`close:${id}:${path}`)
      await gate
      closed = true
      if (id === 'first') throw new Error('close rejected')
    },
    diagnostics: (): Record<string, LspDiagnostic[]> => (closed ? { [file]: [diagnostic] } : {}),
  }))
  const updates: unknown[] = []
  manager.onUpdate((_root, states) => updates.push(states.map((state) => state.errorCount)))
  try {
    const saving = manager.saveDocument(root, file)
    const closing = manager.closeDocument(root, file)
    expect(calls).toEqual([
      `save:first:${file}`,
      `save:second:${file}`,
      `close:first:${file}`,
      `close:second:${file}`,
    ])
    expect(updates).toEqual([])
    release()
    await Promise.all([saving, closing])
    expect(updates).toEqual([[1, 1]])
    expect(manager.getFileDiagnostics(root, file)).toEqual([diagnostic, diagnostic])
    expect(manager.getFileDiagnostics(root, file)[0]).toBe(diagnostic)
    await manager.saveDocument('/unknown', file)
    await manager.closeDocument('/unknown', file)
    expect(updates).toHaveLength(1)
  } finally {
    release()
    manager.dispose()
  }
})

test('workspace search merges in server order and absorbs a rejected server query', async () => {
  const calls: string[] = []
  const symbol = { name: 'first symbol', kind: 1, uri: 'file:///fixture', line: 0, character: 0 }
  const secondSymbol = { ...symbol, name: 'second symbol' }
  const manager = await fixture((id) => ({
    workspaceSymbols: async (query) => {
      calls.push(`${id}:${query}`)
      if (id === 'second' && query !== 'all') throw new Error('query rejected')
      return [id === 'first' ? symbol : secondSymbol]
    },
  }))
  try {
    const result = await manager.workspaceSymbols(root, 'needle')
    expect(calls).toEqual(['first:needle', 'second:needle'])
    expect(result).toEqual([symbol])
    expect(result[0]).toBe(symbol)
    const all = await manager.workspaceSymbols(root, 'all')
    expect(all).toEqual([symbol, secondSymbol])
    expect(all[1]).toBe(secondSymbol)
    expect(await manager.workspaceSymbols('/unknown', 'needle')).toEqual([])
  } finally {
    manager.dispose()
  }
})
