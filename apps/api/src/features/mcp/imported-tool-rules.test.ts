import { describe, expect, test } from 'bun:test'
import { importedToolRules } from './imported-tool-rules'

const line = (change: { action: string; effect: string }) => `${change.action}=${change.effect}`

describe("a .mcp.json entry's tool filters become rules", () => {
  test('a denylist denies each named tool', () => {
    const rules = importedToolRules('github', { disabledTools: ['create_pr', 'merge'] })

    expect(rules.map(line)).toEqual(['mcp:github/create_pr=deny', 'mcp:github/merge=deny'])
  })

  /** A positive list has to CLOSE its family first, or it narrows nothing at all. */
  test('an allowlist denies the family, then allows the named tools back', () => {
    const rules = importedToolRules('github', { enabledTools: ['read', 'search'] })

    expect(rules.map(line)).toEqual([
      'mcp:github/*=deny',
      'mcp:github/read=allow',
      'mcp:github/search=allow',
    ])
  })

  test('an empty allowlist is no allowlist, not "hide everything"', () => {
    expect(importedToolRules('github', { enabledTools: [] })).toEqual([])
  })

  test('non-string entries and a filterless entry produce nothing', () => {
    expect(importedToolRules('github', { disabledTools: [42, null] })).toEqual([])
    expect(importedToolRules('github', { command: ['npx', 'server'] })).toEqual([])
  })
})
