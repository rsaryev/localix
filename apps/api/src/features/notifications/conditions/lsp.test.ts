import { afterEach, describe, expect, it } from 'bun:test'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type { createLspClient } from '../../lsp/lsp-client'
import { createLspManager } from '../../lsp/lsp-manager'
import type { LspClientInfo } from '../../lsp/lsp-protocol'
import type { LspServerDef } from '../../lsp/lsp-servers'
import { createLspConditions } from './lsp'
import {
  createTestJournal,
  openRows,
  TEST_USER as U,
  type TestJournal,
} from './testing/test-journal'

const journals: TestJournal[] = []
afterEach(async () => {
  await Promise.all(journals.splice(0).map((j) => j.close()))
})

const client = (serverId: string) =>
  ({
    serverId,
    rootUri: 'file:///workspace',
    touchFileAndWait: async () => {},
    syncDocument: async () => {},
    closeDocument: async () => {},
    hasOpenDocuments: () => true,
    workspaceSymbols: async () => [],
    diagnostics: () => ({}),
    dispose: () => {},
  }) as unknown as LspClientInfo

const server: LspServerDef = {
  id: 'fake',
  extensions: ['.fake'],
  resolveRoot: (_file, root) => root,
  spawn: async () => ({
    process: { kill: () => true } as unknown as ChildProcessWithoutNullStreams,
    initialization: {},
  }),
}

describe('a language server that crashed or never started', () => {
  it('is a warning row with a way to it until the server reports ready, and raised again when it crashes', async () => {
    const test = await createTestJournal()
    journals.push(test)
    const hooks: { crash?: () => void } = {}
    let startFails = true
    const manager = createLspManager({
      health: createLspConditions(test.journal, U),
      createClient: (async (input) => {
        if (startFails) return null
        hooks.crash = () => input.onError?.(new Error('exited'))
        input.onReady?.()
        return client(input.serverId)
      }) as typeof createLspClient,
    })
    manager.setPluginServers('/workspace', [server])

    await manager.openDocument('/workspace', '/workspace/a.fake', 'x')
    expect(await openRows(test)).toMatchObject([
      {
        title: 'Could not start the fake language server',
        // Degraded, not unavailable: a warning, like every other condition that is.
        severity: 'warning',
        actions: [{ kind: 'navigate', uri: 'localix://ui/settings/diagnostics' }],
      },
    ])

    startFails = false
    await manager.openDocument('/workspace', '/workspace/a.fake', 'x')
    expect(await openRows(test)).toEqual([])

    hooks.crash?.()
    expect(await openRows(test)).toMatchObject([{ title: 'The fake language server stopped' }])
    manager.dispose()
  })
})
