import { describe, expect, test } from 'bun:test'

import { mcpRegistryState, mcpStatusLabel, shouldShowMcpSignIn } from './mcpStatus'

const remote = { transport: 'http' as const, oauthStatus: 'unauthenticated' as const }

describe('shouldShowMcpSignIn', () => {
  test('does not offer OAuth merely because a public HTTP server has no stored tokens', () => {
    expect(shouldShowMcpSignIn(remote, { ok: true, tools: ['searchGitHub'] })).toBe(false)
  })

  test('offers OAuth only after an explicit authentication challenge', () => {
    expect(
      shouldShowMcpSignIn(remote, {
        ok: false,
        tools: [],
        error: 'MCP server requires authentication',
        authRequired: true,
      }),
    ).toBe(true)
  })

  test('does not offer OAuth while probing or for a generic connection failure', () => {
    expect(shouldShowMcpSignIn(remote, 'loading')).toBe(false)
    expect(shouldShowMcpSignIn(remote, { ok: false, tools: [], error: 'fetch failed' })).toBe(false)
  })
})

describe('MCP registry status', () => {
  test('maps live probe states onto the shared registry language', () => {
    expect(mcpRegistryState(false, undefined)).toBe('disabled')
    expect(mcpRegistryState(true, undefined)).toBe('warning')
    expect(mcpRegistryState(true, 'loading')).toBe('warning')
    expect(mcpRegistryState(true, { ok: true, tools: ['search'] })).toBe('enabled')
    expect(mcpRegistryState(true, { ok: false, tools: [], error: 'offline' })).toBe('error')
  })

  test('uses clean labels without decorative ellipses', () => {
    expect(mcpStatusLabel(false, undefined, null)).toBe('Disabled')
    expect(mcpStatusLabel(true, 'loading', null)).toBe('Checking')
    expect(mcpStatusLabel(true, { ok: true, tools: ['search'] }, 1)).toBe('Connected · 1 tool')
    expect(mcpStatusLabel(true, { ok: true, tools: ['a', 'b'] }, 2)).toBe('Connected · 2 tools')
  })
})
