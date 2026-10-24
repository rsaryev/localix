import { expect, test } from 'bun:test'

import { mcpLaunch } from './mcp-settings-env'
import type { McpServerRecord } from './repository'

/**
 * An MCP server a person added sees the `env` of the Claude Code settings for the folder it runs
 * in, as Claude Code's own process environment carries it: in `${VAR}` expansion and, for a stdio
 * server, in the process it starts. The server's own `env` still wins, and a credential name stays
 * empty toward a remote server whatever defines it.
 */
const server = (transport: 'stdio' | 'http', config: Record<string, unknown>): McpServerRecord => ({
  id: 'srv',
  userId: 'u',
  projectId: '',
  name: 'api',
  description: '',
  transport,
  config,
  createdAt: '',
  updatedAt: '',
})

const settingsEnv = { API_BASE: 'https://team.example', REGION: 'eu', GITHUB_TOKEN: 'ghp_x' }

test("a remote server's URL expands from the settings' env; credentials stay home", () => {
  const { config } = mcpLaunch(
    server('http', {
      url: '${API_BASE}/mcp',
      headers: { 'X-Region': '${REGION}', Authorization: 'Bearer ${GITHUB_TOKEN}' },
    }),
    '/work',
    settingsEnv,
  )
  expect(config.url).toBe('https://team.example/mcp')
  expect(config.headers).toEqual({ 'X-Region': 'eu', Authorization: 'Bearer ' })
})

test('a stdio server starts with the variables, under its own env', () => {
  const { env } = mcpLaunch(
    server('stdio', { command: ['node', 'server.js'], env: { REGION: 'us' } }),
    '/work',
    settingsEnv,
  )
  expect(env).toMatchObject({
    API_BASE: 'https://team.example',
    REGION: 'us',
    CLAUDE_PROJECT_DIR: '/work',
  })
})
