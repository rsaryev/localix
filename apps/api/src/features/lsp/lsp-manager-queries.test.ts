import { expect, test } from 'bun:test'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createLspManager } from './lsp-manager'
import type { LspClientInfo, LspDiagnostic } from './lsp-protocol'
import type { LspServerDef } from './lsp-servers'

const project = '/workspace'
const file = '/workspace/query.fake'
const range = { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }
const server: LspServerDef = {
  id: 'fake',
  extensions: ['.fake'],
  resolveRoot: (_file, root) => root,
  spawn: async () => ({
    process: {} as ChildProcessWithoutNullStreams,
    initialization: {},
  }),
}

test('code actions use the cached diagnostics captured before server startup', async () => {
  const diagnostic: LspDiagnostic = { range, message: 'cached error', severity: 1 }
  const distant: LspDiagnostic = {
    range: { start: { line: 5, character: 0 }, end: { line: 5, character: 1 } },
    message: 'elsewhere',
  }
  const requests: unknown[][] = []
  const action = { title: 'Fix', data: { opaque: true } }
  const manager = createLspManager({
    idleTimeoutMs: 0,
    createClient: async (input) => {
      input.onDiagnosticsUpdate?.({ [file]: [diagnostic, distant] })
      input.onReady?.()
      return {
        diagnostics: () => ({ [file]: [diagnostic, distant] }),
        hasOpenDocuments: () => false,
        codeAction: async (...args: unknown[]) => {
          requests.push(args)
          return [action]
        },
        resolveCodeAction: async (value: unknown) => value,
        dispose: () => {},
      } as unknown as LspClientInfo
    },
  })
  manager.setPluginServers(project, [server])
  try {
    expect(await manager.codeAction(project, file, range, ['quickfix'], 'automatic')).toEqual([
      action,
    ])
    expect(requests).toEqual([[file, range, [], ['quickfix'], 'automatic']])
    await manager.codeAction(project, file, range, ['source'], 'invoked')
    expect(requests[1]).toEqual([file, range, [diagnostic], ['source'], 'invoked'])
    expect(await manager.resolveCodeAction(project, file, action)).toBe(action)
  } finally {
    manager.dispose()
  }
})

test('failed and unavailable queries retain their neutral results and fresh fallback arrays', async () => {
  const manager = createLspManager({
    idleTimeoutMs: 0,
    createClient: async (input) => {
      input.onReady?.()
      return {
        hasOpenDocuments: () => false,
        hover: async () => {
          throw new Error('query failed')
        },
        completion: async () => {
          throw new Error('query failed')
        },
        dispose: () => {},
      } as unknown as LspClientInfo
    },
  })
  manager.setPluginServers(project, [server])
  try {
    expect(await manager.hover(project, file, range.start)).toBeNull()
    const first = await manager.completion(project, file, range.start)
    const second = await manager.completion(project, file, range.start)
    expect(first).toEqual([])
    expect(second).toEqual([])
    expect(first).not.toBe(second)
    manager.dispose()
    expect(await manager.hover(project, file, range.start)).toBeNull()
    expect(await manager.completion(project, file, range.start)).toEqual([])
  } finally {
    manager.dispose()
  }
})
