import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { claudeCodeMcpServers } from './claude-code-servers'
import type { McpServerRecord } from './repository'

// settings-reference.md, `strictPluginOnlyCustomization.mcp`: servers of `~/.claude.json` and
// `.mcp.json` are blocked; `managed-mcp.json`, `managedMcpServers` and plugins' servers still load.
const scratch = tempDirPerTest('cc-mcp-plugin-only-')
const server = (name: string): McpServerRecord => ({
  id: name,
  userId: 'u',
  projectId: 'P1',
  name,
  description: '',
  transport: 'stdio',
  config: { command: name },
  createdAt: '',
  updatedAt: '',
})

let n = 0
function load(policy: Record<string, unknown>, extra: Record<string, string> = {}) {
  const root = join(scratch(), `case-${n++}`)
  const project = join(root, 'project')
  writeTree(root, {
    'home/.claude.json': JSON.stringify({
      mcpServers: { userSrv: { command: 'u' } },
      projects: {
        [project]: { mcpServers: { localSrv: { command: 'l' } }, hasTrustDialogAccepted: true },
      },
    }),
    'project/.mcp.json': JSON.stringify({ mcpServers: { projSrv: { command: 'p' } } }),
    'project/.claude/settings.json': JSON.stringify({ enableAllProjectMcpServers: true }),
    'managed/managed-settings.json': JSON.stringify(policy),
    ...extra,
  })
  return claudeCodeMcpServers({
    own: [server('ownSrv')],
    plugins: [server('pluginSrv')],
    userId: 'u',
    projectId: 'P1',
    cwd: project,
    homeDir: join(root, 'home'),
    env: {},
    managed: { dir: join(root, 'managed') },
  })
    .map((s) => s.name)
    .sort()
}

describe('MCP servers under strictPluginOnlyCustomization', () => {
  test('unlocked, every source loads', () => {
    expect(load({})).toEqual(['localSrv', 'ownSrv', 'pluginSrv', 'projSrv', 'userSrv'])
  })

  test('mcp locked: the Claude Code files’ servers go; plugin servers, managed ones and Localix’s own stay', () => {
    expect(
      load(
        {
          strictPluginOnlyCustomization: ['mcp'],
          managedMcpServers: { orgSrv: { command: 'o' } },
        },
        {},
      ),
    ).toEqual(['orgSrv', 'ownSrv', 'pluginSrv'])
  })

  test('another kind locked leaves MCP alone', () => {
    expect(load({ strictPluginOnlyCustomization: ['skills', 'agents', 'hooks'] })).toHaveLength(5)
  })
})
