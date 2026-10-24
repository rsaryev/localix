/**
 * A plugin's `.lsp.json` server as Claude Code runs it (plugins/manifest-reference, `lspServers`):
 * every documented field reaches the server, and an unknown key keeps the server from loading.
 */
import { describe, expect, test } from 'bun:test'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import { spawn } from 'node:child_process'

import { createLspManager } from './lsp-manager'
import { createLspClient } from './lsp-client'
import type { LspClientInfo } from './lsp-protocol'
import {
  configuredLspServer,
  lspServerConfigProblems,
  parseLspServersConfig,
} from './lsp-plugin-servers'

type ClientInput = Parameters<typeof createLspClient>[0]

const fakeClient = {
  serverId: 'p:s',
  rootUri: 'file:///w',
  touchFileAndWait: async () => {},
  syncDocument: async () => {},
  closeDocument: async () => {},
  hasOpenDocuments: () => false,
  diagnostics: () => ({
    '/w/a.java': [
      {
        severity: 1,
        message: 'boom',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      },
    ],
  }),
  dispose: () => {},
} as unknown as LspClientInfo

/** Open a file with the plugin server registered and capture what the client was started with. */
async function startWith(raw: Record<string, unknown>, file = '/w/A.java') {
  const config = parseLspServersConfig({ s: raw }).s!
  let seen: ClientInput | undefined
  const manager = createLspManager({
    createClient: (async (input: ClientInput) => {
      seen = input
      input.onReady?.()
      return fakeClient
    }) as typeof createLspClient,
  })
  manager.setPluginServers('/w', [
    configuredLspServer('p:s', config, { env: { CLAUDE_PLUGIN_ROOT: '/plug' } }),
  ])
  await manager.openDocument('/w', file, 'class A {}')
  ;(seen?.process as ChildProcessWithoutNullStreams | undefined)?.kill()
  return { seen: seen!, manager }
}

describe('a plugin LSP server', () => {
  test('waits its startupTimeout for initialize (jdtls-lsp declares 120000)', async () => {
    const { seen, manager } = await startWith({
      command: 'cat',
      extensionToLanguage: { '.java': 'java' },
      startupTimeout: 120000,
    })
    expect(seen.initializeTimeoutMs).toBe(120000)
    manager.dispose()
  })

  test('sends initializationOptions at initialize and settings as the configuration', async () => {
    const { seen, manager } = await startWith({
      command: 'cat',
      extensionToLanguage: { '.java': 'java' },
      initializationOptions: { bundles: [] },
      settings: { java: { format: { enabled: false } } },
      requestTimeout: 5000,
      shutdownTimeout: 2000,
    })
    expect(seen.initialization).toEqual({ bundles: [] })
    expect(seen.settings).toEqual({ java: { format: { enabled: false } } })
    expect(seen.requestTimeoutMs).toBe(5000)
    expect(seen.shutdownTimeoutMs).toBe(2000)
    manager.dispose()
  })

  test('answers requests within 60 seconds by default', async () => {
    const { seen, manager } = await startWith({
      command: 'cat',
      extensionToLanguage: { '.java': 'java' },
    })
    expect(seen.requestTimeoutMs).toBe(60000)
    manager.dispose()
  })

  test('roots at its workspaceFolder', async () => {
    const { seen, manager } = await startWith({
      command: 'cat',
      extensionToLanguage: { '.java': 'java' },
      workspaceFolder: '/w/service',
    })
    expect(seen.rootDir).toBe('/w/service')
    manager.dispose()
  })

  test('opens each file with the language its extension maps to, case kept', async () => {
    const { seen, manager } = await startWith(
      { command: 'cat', extensionToLanguage: { '.c': 'c', '.C': 'cpp', '.erb': 'erb' } },
      '/w/a.C',
    )
    expect(seen.languageIdFor?.('/w/a.C')).toBe('cpp')
    expect(seen.languageIdFor?.('/w/b.c')).toBe('c')
    expect(seen.languageIdFor?.('/w/v.erb')).toBe('erb')
    manager.dispose()
  })

  test('with diagnostics: false, its diagnostics stay out of the edit report', async () => {
    for (const diagnostics of [true, false]) {
      const { manager } = await startWith({
        command: 'cat',
        extensionToLanguage: { '.java': 'java' },
        diagnostics,
      })
      const report = JSON.stringify(await manager.reportFileDiagnostics(['/w/a.java'], '/w'))
      expect(report.includes('boom')).toBe(diagnostics)
      manager.dispose()
    }
  })

  test('the server process receives the plugin path variables', async () => {
    const config = parseLspServersConfig({
      s: { command: 'env', extensionToLanguage: { '.x': 'x' } },
    })
    const def = configuredLspServer('p:s', config.s!, { env: { CLAUDE_PLUGIN_ROOT: '/plug' } })
    const handle = await def.spawn('/', '/')
    const out = await new Response(handle!.process.stdout as unknown as ReadableStream).text()
    expect(out).toContain('CLAUDE_PLUGIN_ROOT=/plug')
  })

  test('restartOnCrash: false leaves a server that exited stopped', async () => {
    const config = parseLspServersConfig({
      s: { command: 'true', extensionToLanguage: { '.x': 'x' }, restartOnCrash: false },
    })
    const def = configuredLspServer('p:s', config.s!)
    const first = await def.spawn('/', '/')
    await new Promise((resolve) => first!.process.once('exit', resolve))
    expect(await def.spawn('/', '/')).toBeUndefined()
  })

  test('maxRestarts caps how often a crashed server starts again', async () => {
    const config = parseLspServersConfig({
      s: { command: 'true', extensionToLanguage: { '.x': 'x' }, maxRestarts: 1 },
    })
    const def = configuredLspServer('p:s', config.s!)
    for (let i = 0; i < 2; i++) {
      const handle = await def.spawn('/', '/')
      expect(handle).toBeDefined()
      await new Promise((resolve) => handle!.process.once('exit', resolve))
    }
    expect(await def.spawn('/', '/')).toBeUndefined()
  })

  test('an unknown key keeps the server from loading, and says why', () => {
    const raw = { s: { command: 'gopls', extensionToLanguage: { '.go': 'go' }, lanugage: 'go' } }
    expect(parseLspServersConfig(raw)).toEqual({})
    expect(lspServerConfigProblems(raw)).toEqual([
      'Invalid LSP server config for "s": unknown key "lanugage"',
    ])
  })

  test('a client gives up on a silent server once its startupTimeout passes', async () => {
    const silent = spawn('sleep', ['5'])
    const started = Date.now()
    const client = await createLspClient({
      serverId: 'p:s',
      process: silent as ChildProcessWithoutNullStreams,
      rootDir: '/',
      initializeTimeoutMs: 50,
    })
    expect(client).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(5000)
  })
})
