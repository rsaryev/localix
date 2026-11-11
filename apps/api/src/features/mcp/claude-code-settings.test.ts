import { afterEach, expect, test } from 'bun:test'
import { claudeCodeMcpServers } from './claude-code-servers'
import { folderSettingsEnv, installMcpSettingsReader } from './claude-code-settings'
import type { McpServerRecord } from './repository'
import { mcpSettingsReader } from '../plugins/kit/settings/mcp'

afterEach(() => installMcpSettingsReader(undefined))

const record = (id: string, name: string): McpServerRecord => ({
  id,
  userId: 'u',
  projectId: 'P1',
  name,
  description: '',
  transport: 'stdio',
  config: { command: [name] },
  createdAt: '',
  updatedAt: '',
})
const input = {
  homeDir: '/h',
  cwd: '/w',
  userId: 'u',
  projectId: 'P1',
  own: [record('own', 'a')],
  plugins: [record('plugin', 'a'), record('plugin-b', 'b')],
}

test('until the host installs a reader no Claude Code file is read: one server per name', () => {
  expect(claudeCodeMcpServers(input).map((s) => s.id)).toEqual(['own', 'plugin-b'])
  expect(folderSettingsEnv('/w')).toEqual({})
})

test('the installed reader answers for every folder', () => {
  installMcpSettingsReader({
    ...mcpSettingsReader,
    servers: () => [record('x', 'x')],
    folderEnv: (cwd) => ({ CWD: cwd }),
  })
  expect(claudeCodeMcpServers(input).map((s) => s.id)).toEqual(['x'])
  expect(folderSettingsEnv('/w')).toEqual({ CWD: '/w' })
})
