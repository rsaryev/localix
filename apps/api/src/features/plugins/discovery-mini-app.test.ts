import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import { loadManifest } from './discovery'

/**
 * A mini app holds no Claude Code plugin (rule X2): the component folders Claude Code would read
 * by default mean nothing in it. A `skills/` or `.mcp.json` left in a mini app's folder used to
 * reach the agent as the plugin's.
 */
const dir = tempDirPerTest('mini-app-discovery-')

const calories = {
  name: 'calories',
  version: '0.1.0',
  description: 'Logs meals the agent reads from photos.',
  backend: './backend/index.ts',
  commands: { log: { description: 'Log a meal', prompt: 'Log this meal: ${meal}' } },
}

const load = async (tree: Record<string, string>) => {
  writeTree(dir(), tree)
  return loadManifest(dir(), 'global', '')
}

describe('a mini-app.json folder', () => {
  test('runs its backend and offers its commands', async () => {
    const app = await load({
      [MINI_APP_MANIFEST_FILE]: JSON.stringify(calories),
      'backend/index.ts': 'export const tools = []\n',
    })
    expect(app.error).toBeUndefined()
    expect(app.layout).toBe('mini-app')
    expect(app.entrypoints.toolEntries).toEqual([join(dir(), 'backend/index.ts')])
    expect(app.commands.map((command) => [command.name, command.prompt])).toEqual([
      ['log', 'Log this meal: ${meal}'],
    ])
  })

  test('reads none of a Claude Code plugin’s component folders', async () => {
    const app = await load({
      [MINI_APP_MANIFEST_FILE]: JSON.stringify(calories),
      'backend/index.ts': 'export const tools = []\n',
      'skills/log/SKILL.md': '---\nname: log\ndescription: Log meals\n---\nBody\n',
      'SKILL.md': '---\nname: root\ndescription: Root skill\n---\nBody\n',
      'commands/extra.md': 'An extra command\n',
      'agents/helper.md': '---\nname: helper\ndescription: Helps\n---\nBody\n',
      'hooks/hooks.json': JSON.stringify({ hooks: { Stop: [] } }),
      '.mcp.json': JSON.stringify({ mcpServers: { db: { command: 'node' } } }),
      '.lsp.json': JSON.stringify({
        go: { command: 'gopls', extensionToLanguage: { '.go': 'go' } },
      }),
    })
    expect(app.error).toBeUndefined()
    expect(app.provides.skills).toEqual([])
    expect(app.provides.mcpServers).toEqual([])
    expect(app.provides.lspServers).toBeUndefined()
    expect(app.agents).toEqual([])
    expect(app.commands.map((command) => command.name)).toEqual(['log'])
    expect(app.entrypoints.hookConfigs ?? []).toEqual([])
  })
})
