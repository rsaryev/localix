import { expect, test } from 'bun:test'
import { mcpConnectionKey } from './mcp-connection-key'
import type { McpServerRecord } from './repository'

const server: McpServerRecord = {
  id: 'server-1',
  userId: 'user-1',
  projectId: '',
  name: 'fixture',
  description: 'Fixture server',
  transport: 'http',
  config: { url: 'https://example.test/mcp', headers: { Accept: 'application/json' } },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
}

test('remote connection identity ignores unrelated metadata and plain cwd changes', () => {
  const key = mcpConnectionKey(server, '/workspace/a')
  expect(
    mcpConnectionKey(
      {
        ...server,
        description: 'Renamed description',
        updatedAt: '2026-02-01',
        config: { headers: { Accept: 'application/json' }, url: 'https://example.test/mcp' },
      },
      '/workspace/b',
    ),
  ).toBe(key)
})

test('connection identity isolates the owning user, record and project', () => {
  const key = mcpConnectionKey(server, '/workspace/a')
  for (const patch of [{ userId: 'user-2' }, { id: 'server-2' }, { projectId: 'project-1' }]) {
    expect(mcpConnectionKey({ ...server, ...patch }, '/workspace/a')).not.toBe(key)
  }
})

test('stdio cwd and cwd-expanded remote configuration each affect connection identity', () => {
  const stdio = { ...server, transport: 'stdio' as const }
  expect(mcpConnectionKey(stdio, '/workspace/a')).not.toBe(mcpConnectionKey(stdio, '/workspace/b'))
  const expanded = {
    ...server,
    config: { url: 'https://example.test/mcp', headers: { Workspace: '${CLAUDE_PROJECT_DIR}' } },
  }
  expect(mcpConnectionKey(expanded, '/workspace/a')).not.toBe(
    mcpConnectionKey(expanded, '/workspace/b'),
  )
  expect(expanded.config.headers.Workspace).toBe('${CLAUDE_PROJECT_DIR}')
})
