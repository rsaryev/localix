import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import * as binaries from './lsp-bin-resolve'
import type { LspClientInfo } from './lsp-client'
import type { LspInstaller } from './lsp-installer'
import { createLspManager } from './lsp-manager'
import { pluginLspNotes, summarizePluginLspServers } from './lsp-plugin-notes'
import { configuredLspServer } from './lsp-plugin-servers'
import { PythonServer } from './lsp-servers'

const dir = tempDirPerTest('localix-plugin-lsp')
const root = '/fixture-php'
const file = `${root}/index.php`

type Spawn = { via: 'bun' | 'direct'; bin: string; args: string[]; env?: Record<string, string> }
let spawned: Spawn[] = []
let onPath: Record<string, string> = {}
const spies: { mockRestore(): void }[] = []
beforeEach(() => {
  spawned = []
  onPath = {}
  spies.push(spyOn(binaries, 'which').mockImplementation((cmd) => onPath[cmd]))
  spies.push(
    spyOn(binaries, 'spawnJsServer').mockImplementation((bin, args, _cwd, env) => {
      spawned.push({ via: 'bun', bin, args, ...(env ? { env } : {}) })
      return { once: () => {} } as unknown as ChildProcessWithoutNullStreams
    }),
  )
  spies.push(
    spyOn(binaries, 'spawnServer').mockImplementation((bin, args, _cwd, env) => {
      spawned.push({ via: 'direct', bin, args, ...(env ? { env } : {}) })
      return { once: () => {} } as unknown as ChildProcessWithoutNullStreams
    }),
  )
})
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
})

const intelephense = () =>
  configuredLspServer(
    'intelephense',
    {
      command: 'intelephense',
      args: ['--stdio'],
      env: { INTELEPHENSE_LOG: 'off' },
      initializationOptions: { storagePath: '/tmp/x' },
      extensionToLanguage: { '.php': 'php' },
    },
    { env: { CLAUDE_PLUGIN_ROOT: '/plugins/php-lsp' } },
  )

describe('a plugin server whose command is an npm package', () => {
  test('not on PATH: installed on first use and run with Bun, with the plugin’s args, env and options', async () => {
    const installed = path.join(dir(), 'intelephense')
    writeTree(installed, { 'node_modules/.bin/intelephense': '#!/usr/bin/env node\n' })
    const requests: string[] = []
    let done = false
    const installer: LspInstaller = {
      installedDir: () => (done ? installed : undefined),
      async install(id) {
        requests.push(id)
        done = true
        return { ok: true, dir: installed }
      },
    }
    const initializations: unknown[] = []
    const manager = createLspManager({
      idleTimeoutMs: 0,
      installer,
      createClient: async (input) => {
        initializations.push(input.initialization)
        input.onReady?.()
        return {
          syncDocument: async () => {},
          diagnostics: () => ({}),
          hasOpenDocuments: () => true,
          dispose: () => {},
        } as unknown as LspClientInfo
      },
    })
    const statuses: string[] = []
    manager.onUpdate((_root, states) => statuses.push(states.map((s) => s.status).join()))
    manager.setPluginServers(root, [intelephense()])
    try {
      await manager.openDocument(root, file, '<?php echo 1;')
      for (let i = 0; i < 10; i++) await Promise.resolve()

      expect(requests).toEqual(['intelephense'])
      expect(spawned).toEqual([
        {
          via: 'bun',
          bin: path.join(installed, 'node_modules', '.bin', 'intelephense'),
          args: ['--stdio'],
          env: { CLAUDE_PLUGIN_ROOT: '/plugins/php-lsp', INTELEPHENSE_LOG: 'off' },
        },
      ])
      expect(initializations).toEqual([{ storagePath: '/tmp/x' }])
      expect(statuses).toEqual(['installing', 'starting', 'ready', 'ready'])
    } finally {
      manager.dispose()
    }
  })

  test('on PATH: still run with Bun, so its `#!/usr/bin/env node` never needs Node', async () => {
    onPath = { intelephense: '/usr/local/bin/intelephense' }
    await intelephense().spawn(root, root)
    expect(spawned.map(({ via, bin }) => [via, bin])).toEqual([
      ['bun', '/usr/local/bin/intelephense'],
    ])
  })

  test('a command that is not an npm package is spawned as it is', async () => {
    onPath = { zls: '/usr/local/bin/zls' }
    await configuredLspServer('zig', {
      command: 'zls',
      extensionToLanguage: { '.zig': 'zig' },
    }).spawn(root, root)
    expect(spawned.map(({ via, bin }) => [via, bin])).toEqual([['direct', '/usr/local/bin/zls']])
  })
})

test('the built-in Python server runs a pyright-langserver found on PATH with Bun', async () => {
  onPath = { 'pyright-langserver': '/usr/local/bin/pyright-langserver' }
  await PythonServer.spawn('/py', '/py')
  expect(spawned.map(({ via, bin, args }) => [via, bin, args])).toEqual([
    ['bun', '/usr/local/bin/pyright-langserver', ['--stdio']],
  ])
})

describe('plugin LSP notes never send anyone to npm', () => {
  const notesFor = (command: string) => {
    const summaries = summarizePluginLspServers({
      s: { command, extensionToLanguage: { '.zzz': 'x' } },
    })
    return { summary: summaries[0]!, notes: pluginLspNotes(summaries) }
  }

  test.each([
    ['typescript-language-server', 'Localix installs it on first use'],
    ['pyright-langserver', 'Localix installs it on first use'],
    ['intelephense', 'Localix installs it on first use'],
    ['rust-analyzer', 'Localix installs it on first use'],
    ['gopls', 'Localix builds it with Go on first use'],
  ])('%s, not on PATH: %s', (command, note) => {
    const { summary, notes } = notesFor(command)
    expect(summary).toMatchObject({ missing: false, installsOnFirstUse: true })
    expect(notes).toEqual([`LSP server "s": ${command} is not on PATH; ${note}.`])
  })

  test.each([
    ['csharp-ls', '.NET SDK'],
    ['ruby-lsp', 'Ruby'],
    ['jdtls', 'Java'],
    ['sourcekit-lsp', 'Xcode or the Swift toolchain'],
    ['clangd', 'LLVM'],
  ])('%s, not on PATH: names the toolchain it needs (%s)', (command, toolchain) => {
    const { summary, notes } = notesFor(command)
    expect(summary).toMatchObject({ missing: true })
    expect(notes[0]).toContain(`${command} not found on PATH`)
    expect(notes[0]).toContain(toolchain)
  })

  test('no note or hint mentions a Node package manager', () => {
    for (const command of [
      'typescript-language-server',
      'pyright-langserver',
      'intelephense',
      'vscode-json-language-server',
      'yaml-language-server',
      'csharp-ls',
      'ruby-lsp',
      'jdtls',
      'kotlin-language-server',
      'lua-language-server',
      'sourcekit-lsp',
      'clangd',
      'some-unknown-ls',
    ]) {
      const { summary, notes } = notesFor(command)
      for (const text of [...notes, summary.installHint ?? ''])
        expect(text).not.toMatch(/\b(npm|npx|yarn|pnpm|node)\b/i)
    }
  })
})
