import { describe, expect, test } from 'bun:test'

import type { McpServerConfig, McpServerRecord, McpTransport } from '@/shared/api/contracts'
import { buildMcpSavePayload, draftFromRecord, type McpServerDraft } from './mcpDraft'

/**
 * STRUCTURAL GUARD against the bug class, not just the bug.
 *
 * `Required<McpServerConfig>` is DERIVED from the API's zod schemas, so the
 * compiler forces this fixture to carry every config field the wire has. Add a
 * field to `mcpStdioConfigSchema` or `mcpHttpConfigSchema` and this object stops
 * compiling until the field is listed here — and `apps/ui` type-checks its test
 * files (`tsconfig.app.json` includes `src` with no test exclusion), so that is a
 * real gate, unlike a `satisfies` in an `apps/api` test.
 *
 * The assertions then derive their expected key set from `Object.keys` of this
 * fixture rather than from a hand-written list, so a save path that quietly stops
 * carrying a field fails here whether or not anyone remembered to test it.
 */
const everyConfigField: Required<McpServerConfig> = {
  command: ['npx', '-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  env: { TOKEN: 'env-value' },
  url: 'https://mcp.example.com/mcp',
  headers: { Authorization: 'Bearer header-value' },
  oauth: { clientId: 'client-abc', clientSecret: 'secret-xyz', scope: 'read:all' },
  enabledTools: ['allowed_tool'],
  disabledTools: ['denied_tool'],
  required: true,
  timeout: 45_000,
}

/** The ONE field a save is allowed to drop: the *other* transport's identity field. */
const OTHER_IDENTITY: Record<McpTransport, keyof McpServerConfig> = {
  stdio: 'url',
  http: 'command',
  ws: 'command',
}

const draftWith = (transport: McpTransport, config: McpServerConfig): McpServerDraft => ({
  name: 'a-server',
  description: '',
  transport,
  projectId: null,
  enabled: true,
  config,
})

describe('buildMcpSavePayload — structural guard', () => {
  for (const transport of ['stdio', 'http', 'ws'] as const) {
    test(`carries every config field except the other transport's identity (${transport})`, () => {
      const built = buildMcpSavePayload(draftWith(transport, everyConfigField))
      expect(built.ok).toBe(true)
      if (!built.ok) return

      const saved: Record<string, unknown> = built.payload.config
      const expected = Object.keys(everyConfigField).filter((k) => k !== OTHER_IDENTITY[transport])

      expect(Object.keys(saved).sort()).toEqual(expected.sort())
      for (const key of expected) {
        expect(saved[key]).toEqual(everyConfigField[key as keyof McpServerConfig])
      }
    })
  }
})

describe('buildMcpSavePayload — regression: editing a server must not destroy its credentials', () => {
  /** A remote server the user has already authorized. */
  const stored: McpServerRecord = {
    id: 'srv-1',
    name: 'old-name',
    description: 'A remote server',
    transport: 'http',
    projectId: '',
    enabled: true,
    oauthStatus: 'authenticated',
    createdAt: '2026-07-14T00:00:00Z',
    updatedAt: '2026-07-14T00:00:00Z',
    config: {
      url: 'https://mcp.example.com/mcp',
      headers: { 'X-Env': 'prod' },
      oauth: { clientId: 'client-abc', clientSecret: 'secret-xyz', scope: 'read:all' },
      timeout: 45_000,
    },
  }

  test('renaming a server keeps its oauth credentials and timeout', () => {
    // Exactly what the settings panel does: load the server, touch only the name.
    const draft: McpServerDraft = { ...draftFromRecord(stored), name: 'new-name' }

    const built = buildMcpSavePayload(draft)
    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(built.payload.name).toBe('new-name')

    // The server REPLACES config wholesale — anything absent here is destroyed on
    // disk, with no error and no way back short of re-authorizing.
    const saved: Record<string, unknown> = built.payload.config
    expect(saved.oauth).toEqual({
      clientId: 'client-abc',
      clientSecret: 'secret-xyz',
      scope: 'read:all',
    })
    expect(saved.timeout).toBe(45_000)
    expect(saved.headers).toEqual({ 'X-Env': 'prod' })
    expect(saved.url).toBe('https://mcp.example.com/mcp')
  })

  test('a stdio server keeps env + tool filters across an edit', () => {
    const draft = draftWith('stdio', {
      command: ['npx', 'server'],
      env: { TOKEN: 'keep-me' },
      disabledTools: ['dangerous_tool'],
    })

    const built = buildMcpSavePayload(draft)
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const saved: Record<string, unknown> = built.payload.config
    expect(saved.env).toEqual({ TOKEN: 'keep-me' })
    expect(saved.disabledTools).toEqual(['dangerous_tool'])
  })
})

describe('buildMcpSavePayload — validation', () => {
  const failure = (draft: McpServerDraft) => {
    const built = buildMcpSavePayload(draft)
    if (built.ok) throw new Error('Expected this draft to be refused')
    return built.errors
  }

  test('rejects a name the server-side regex would reject, against the NAME field', () => {
    expect(buildMcpSavePayload(draftWith('stdio', { command: ['x'] })).ok).toBe(true)
    const errors = failure({ ...draftWith('stdio', { command: ['x'] }), name: '-bad' })
    expect(Object.keys(errors)).toEqual(['name'])
    expect(errors.name).toContain('letters, digits, dots')
  })

  test('rejects a stdio server with no command, and a remote server with no url', () => {
    expect(failure(draftWith('stdio', { command: [] })).command).toBe(
      'Required for a stdio server.',
    )
    expect(failure(draftWith('http', { headers: {} })).url).toBe('Required for a http server.')
  })

  /**
   * Every problem at once, in FORM ORDER. It used to return on the first one, so a nameless
   * server with no command reported the name, and reported the command only after the reader
   * had fixed the name and pressed save again. The order is what lets the submit focus the
   * first bad control (`focusFirstInvalid`).
   */
  test('reports both problems, name first', () => {
    const errors = failure({ ...draftWith('stdio', { command: [] }), name: '' })
    expect(Object.keys(errors)).toEqual(['name', 'command'])
    expect(errors.name).toBe('Required.')
  })
})
