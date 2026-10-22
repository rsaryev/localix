import { describe, expect, test } from 'bun:test'

import type { McpClientLike } from './mcp-client-contracts'
import {
  declaresPermissionRelay,
  permissionRequestId,
  RELAY_MAX_CODE_POINTS,
  relayInputPreview,
  relayText,
} from './mcp-channel-permissions'

const withCapabilities = (experimental: Record<string, unknown>) =>
  ({ getServerCapabilities: () => ({ experimental }) }) as McpClientLike

describe('permission relay text', () => {
  test('ids are five letters from a–z without l', () => {
    let n = 0
    const ids = Array.from({ length: 200 }, () => permissionRequestId(() => (n++ % 97) / 97))
    for (const id of ids) expect(id).toMatch(/^[a-km-z]{5}$/)
    expect(ids.some((id) => id.includes('m'))).toBe(true)
  })

  test('invisible and direction characters, lookalikes and whitespace runs are neutralized', () => {
    expect(relayText('rm‮ -rf  \n\t/​ tmp')).toBe('rm -rf / tmp')
    expect(relayText('say “hi” ‹b› ＜x＞')).toBe('say "hi" <b> <x>')
  })

  test('a long value keeps its start and its end around a counted marker', () => {
    const value = `${'a'.repeat(3000)}${'b'.repeat(1000)}`
    const relayed = relayText(value)
    expect(relayed.startsWith('a'.repeat(1750))).toBe(true)
    expect(relayed.endsWith('b'.repeat(1000))).toBe(true)
    expect(relayed).toContain(` ⋯ ${4000 - RELAY_MAX_CODE_POINTS} code points elided ⋯ `)
  })

  test('the preview caps each top-level field on its own and keeps JSON structure', () => {
    const preview = relayInputPreview({ command: 'x'.repeat(4000), cwd: '/repo' })
    const parsed = JSON.parse(preview) as Record<string, string>
    expect(parsed.cwd).toBe('/repo')
    expect(parsed.command).toContain('code points elided')
  })

  test('the relay is declared by an object, never by false or absence', () => {
    expect(declaresPermissionRelay(withCapabilities({ 'claude/channel/permission': {} }))).toBe(
      true,
    )
    expect(declaresPermissionRelay(withCapabilities({ 'claude/channel/permission': false }))).toBe(
      false,
    )
    expect(declaresPermissionRelay(withCapabilities({ 'claude/channel': {} }))).toBe(false)
  })
})
