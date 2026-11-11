import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { testLspServers } from './testing'

const dir = tempDirPerTest('kit-lsp-servers')

describe("a chat's plugin LSP servers, as the kit resolves them", () => {
  test('the command line and env are substituted, a sensitive option with its real value', async () => {
    const { root, cwd, servers } = await testLspServers(
      dir(),
      {
        ls: {
          command: '${CLAUDE_PLUGIN_ROOT}/bin/ls',
          args: ['--token=${user_config.tok}'],
          env: { TOKEN: '${user_config.tok}' },
          workspaceFolder: '${CLAUDE_PROJECT_DIR}/service',
          extensionToLanguage: { '.ls': 'ls' },
        },
      },
      { tok: 'sk-live' },
    )
    expect(servers).toHaveLength(1)
    const [server] = servers
    expect(server).toMatchObject({
      id: 'lsp-p@test:ls',
      pluginId: 'lsp-p@test',
      name: 'ls',
      command: join(root, 'bin/ls'),
      args: ['--token=sk-live'],
      workspaceFolder: join(cwd, 'service'),
      extensions: ['.ls'],
    })
    // The process gets its own env and the plugin's path variables.
    expect(server!.env).toMatchObject({
      TOKEN: 'sk-live',
      CLAUDE_PLUGIN_ROOT: root,
      CLAUDE_PROJECT_DIR: cwd,
    })
    expect(server!.env.CLAUDE_PLUGIN_DATA).toBeString()
  })

  test("the documented defaults apply, and each file opens with its extension's language", async () => {
    const { servers } = await testLspServers(dir(), {
      clangd: {
        command: 'clangd',
        extensionToLanguage: { '.c': 'c', '.C': 'cpp' },
        initializationOptions: { root: '${CLAUDE_PLUGIN_ROOT}' },
        startupTimeout: 120000,
      },
    })
    const [server] = servers
    expect(server).toMatchObject({
      requestTimeoutMs: 60000,
      startupTimeoutMs: 120000,
      diagnostics: true,
      // Data for the server: `${...}` is not resolved there.
      initializationOptions: { root: '${CLAUDE_PLUGIN_ROOT}' },
    })
    expect(server!.shutdownTimeoutMs).toBeUndefined()
    expect(server!.languageIdFor('/w/a.C')).toBe('cpp')
    expect(server!.languageIdFor('/w/b.c')).toBe('c')
    expect(server!.languageIdFor('/w/b.h')).toBeUndefined()
  })

  test('restartOnCrash and maxRestarts decide whether a crashed server starts again', async () => {
    const { servers } = await testLspServers(dir(), {
      capped: { command: 'a', extensionToLanguage: { '.a': 'a' }, maxRestarts: 1 },
      never: { command: 'b', extensionToLanguage: { '.b': 'b' }, restartOnCrash: false },
      free: { command: 'c', extensionToLanguage: { '.c': 'c' } },
    })
    const byName = new Map(servers.map((server) => [server.name, server]))
    expect([0, 1].map((n) => byName.get('capped')!.restarts(n))).toEqual([true, false])
    expect(byName.get('never')!.restarts(0)).toBe(false)
    expect(byName.get('free')!.restarts(50)).toBe(true)
  })
})
