import { expect, test } from 'bun:test'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createLspManager } from './lsp-manager'
import type { LspClientInfo, LspDiagnostic } from './lsp-client'

const diagnostic = (severity: number, message: string): LspDiagnostic => ({
  severity,
  message,
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
})

test('projects current diagnostics in server order without cloning diagnostic objects', async () => {
  const root = '/fixture'
  const file = `${root}/shared`
  const error = diagnostic(1, 'first error')
  const warning = diagnostic(2, 'second warning')
  const hint = diagnostic(4, 'second hint')
  const snapshots: Record<string, Record<string, LspDiagnostic[]>> = {
    first: { [file]: [error] },
    second: { [file]: [warning, hint] },
  }
  const publish = new Map<string, (byFile: Record<string, LspDiagnostic[]>) => void>()
  const manager = createLspManager({
    idleTimeoutMs: 0,
    createClient: async (input) => {
      publish.set(input.serverId, input.onDiagnosticsUpdate!)
      input.onReady?.()
      return {
        diagnostics: () => snapshots[input.serverId]!,
        syncDocument: async () => {},
        hasOpenDocuments: () => true,
        dispose: () => {},
      } as unknown as LspClientInfo
    },
  })
  manager.setPluginServers(
    root,
    ['first', 'second'].map((id) => ({
      id,
      extensions: [`.projection-${id}`],
      resolveRoot: () => root,
      spawn: async () => ({ process: {} as ChildProcessWithoutNullStreams, initialization: {} }),
    })),
  )
  try {
    await manager.openDocument(root, `${root}/a.projection-first`, '')
    await manager.openDocument(root, `${root}/b.projection-second`, '')
    const merged = manager.getFileDiagnostics(root, file)
    expect(merged).toEqual([error, warning, hint])
    expect(merged[0]).toBe(error)
    expect(merged[1]).toBe(warning)
    expect(merged).not.toBe(snapshots.first![file])
    merged.pop()
    expect(manager.getFileDiagnostics(root, file)).toHaveLength(3)
    expect(
      manager.getServerStates(root).map(({ serverId, errorCount, warningCount }) => ({
        serverId,
        errorCount,
        warningCount,
      })),
    ).toEqual([
      { serverId: 'first', errorCount: 1, warningCount: 0 },
      { serverId: 'second', errorCount: 0, warningCount: 1 },
    ])
    publish.get('first')!({})
    expect(manager.getFileDiagnostics(root, file)).toEqual([warning, hint])
    expect(manager.getServerStates(root)[0]!.errorCount).toBe(0)
    expect(manager.getDiagnostics('/other')).toEqual({})
    expect(manager.getDiagnostics('/other')).not.toBe(manager.getDiagnostics('/other'))
    expect(manager.getFileDiagnostics('/other', file)).not.toBe(
      manager.getFileDiagnostics('/other', file),
    )
  } finally {
    manager.dispose()
  }
})
