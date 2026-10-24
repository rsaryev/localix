import { describe, expect, test } from 'bun:test'

import type { DiscoveredPlugin } from './discovery'
import type { LoadedPlugins } from './loader-contract'
import {
  appendPluginRuntimeDeclarations,
  makePluginSubstituter,
} from './loader-runtime-declarations'

const manifest = {
  name: 'lsp-p',
  config: { tok: { type: 'string', secret: true }, level: { type: 'string' } },
}

function plugin(lspServers: Record<string, unknown>): DiscoveredPlugin {
  return {
    dir: '/plugins/lsp-p',
    manifest,
    agents: [],
    entrypoints: { hookConfigs: [], lspServers, monitors: [] },
  } as unknown as DiscoveredPlugin
}

function lspServersOf(
  lspServers: Record<string, unknown>,
  config: Record<string, string>,
): Record<string, unknown> {
  const result = { ccHooks: [], lspServers: [], monitors: [], outputStyles: [] }
  const summary = {}
  appendPluginRuntimeDeclarations({
    plugin: plugin(lspServers),
    config,
    // The skill/prompt substituter, which hides sensitive options from the model.
    subst: makePluginSubstituter(
      '/plugins/lsp-p',
      'lsp-p',
      config,
      manifest as never,
      '/repo',
      '/home/u',
    ),
    result: result as unknown as LoadedPlugins,
    summary: summary as LoadedPlugins['loaded'][number],
    opts: { homeDir: '/home/u', cwd: '/repo' },
  })
  expect(result.lspServers).toHaveLength(1)
  lastEnv = (result.lspServers[0] as { env?: Record<string, string> }).env
  return (result.lspServers[0] as { servers: Record<string, unknown> }).servers
}
let lastEnv: Record<string, string> | undefined

describe('plugin LSP server config', () => {
  // Claude Code substitutes `${user_config.KEY}` into LSP server config with its real value; only
  // skill and agent content get the placeholder. The LSP config went through the skill
  // substituter, so the language server received "[sensitive option 'tok' …]" as its token.
  test('a sensitive option substitutes its real value', () => {
    const servers = lspServersOf(
      {
        ls: {
          command: '${CLAUDE_PLUGIN_ROOT}/bin/ls',
          args: ['--token=${user_config.tok}', '--level=${user_config.level}'],
          env: { TOKEN: '${user_config.tok}', DATA: '${CLAUDE_PLUGIN_DATA}' },
          workspaceFolder: '${CLAUDE_PROJECT_DIR}',
        },
      },
      { tok: 'sk-live', level: 'debug' },
    )
    expect(servers).toEqual({
      ls: {
        command: '/plugins/lsp-p/bin/ls',
        args: ['--token=sk-live', '--level=debug'],
        env: { TOKEN: 'sk-live', DATA: '/home/u/.localix/plugin-data/lsp-p' },
        workspaceFolder: '/repo',
      },
    })
  })

  test('a value holding quotes and backslashes stays one string', () => {
    const value = 'a"b\\c","command":"evil'
    const servers = lspServersOf(
      { ls: { command: 'ls', env: { TOKEN: '${user_config.tok}' } } },
      { tok: value },
    )
    expect(servers).toEqual({ ls: { command: 'ls', env: { TOKEN: value } } })
  })

  // Claude Code exports the plugin's path variables to an LSP server's process.
  test("the server's process is given the plugin's path variables", () => {
    lspServersOf({ ls: { command: 'ls' } }, {})
    expect(lastEnv).toEqual({
      CLAUDE_PLUGIN_ROOT: '/plugins/lsp-p',
      CLAUDE_PLUGIN_DATA: '/home/u/.localix/plugin-data/lsp-p',
      CLAUDE_PROJECT_DIR: '/repo',
    })
  })
})
