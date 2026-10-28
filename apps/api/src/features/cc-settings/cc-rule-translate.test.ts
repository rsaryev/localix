import { describe, expect, it } from 'bun:test'

import { claudeCodeDenyRules } from './cc-rule-translate'

// A skill's or agent's `disallowed-tools` entry with a specifier denies that pattern only, as the
// same rule in permissions.deny does.
describe('claudeCodeDenyRules', () => {
  const rule = (permission: string, pattern: string) => ({
    action: 'deny' as const,
    permission,
    pattern,
  })

  it('a bare tool name denies the whole tool', () => {
    expect(claudeCodeDenyRules('Bash')).toEqual([rule('Bash', '*')])
    expect(claudeCodeDenyRules('Grep')).toEqual([rule('Search', '*')])
    expect(claudeCodeDenyRules('Bash(*)')).toEqual([rule('Bash', '*')])
  })

  it('Bash(rm *) denies those commands, never the shell', () => {
    const rules = claudeCodeDenyRules('Bash(rm *)')
    expect(rules.length).toBeGreaterThan(0)
    for (const r of rules) {
      expect(r.action).toBe('deny')
      expect(r.permission).toBe('Bash')
      expect(r.pattern).not.toBe('*')
      expect(r.pattern.startsWith('rm')).toBe(true)
    }
  })

  it('Read(.env) denies that path to the tools that read and, as Claude Code does, to those that write', () => {
    const rules = claudeCodeDenyRules('Read(.env)', '/work')
    for (const permission of ['Read', 'Search', 'Edit', 'Write'])
      expect(rules).toContainEqual(rule(permission, '/work/.env'))
    expect(rules.every((r) => r.pattern !== '*')).toBe(true)
  })

  it('Edit(src/**) denies edit and write there, and leaves reading alone', () => {
    const rules = claudeCodeDenyRules('Edit(src/**)', '/work')
    expect(new Set(rules.map((r) => r.permission))).toEqual(new Set(['Edit', 'Write']))
    expect(rules.some((r) => r.pattern === '/work/src/**')).toBe(true)
  })

  it('WebFetch(domain:x) denies that domain for research', () => {
    expect(claudeCodeDenyRules('WebFetch(domain:example.com)')).toEqual([
      rule('Research', 'domain:example.com'),
    ])
  })

  it('carries the message the caller gives', () => {
    expect(claudeCodeDenyRules('Bash(rm *)', '/work', undefined, 'removed')[0]?.message).toBe(
      'removed',
    )
  })

  it('a specifier it cannot say is not widened to the whole tool', () => {
    expect(claudeCodeDenyRules('Agent(reviewer)').every((r) => r.pattern !== '*')).toBe(true)
    expect(claudeCodeDenyRules('mcp__github__create_issue')).toEqual([
      rule('mcp_github_create_issue', '*'),
    ])
  })
})
