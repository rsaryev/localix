import { describe, expect, test } from 'bun:test'
import { resolveRunDenyPatterns, resolveRunDisabledTools } from './run-tool-policy'

describe('resolveRunDisabledTools', () => {
  test('normalizes scoped CC aliases and preserves one stable runtime denylist', () => {
    expect(
      resolveRunDisabledTools(
        ['bash', 'mcp_docs_read'],
        ['Read', 'mcp__github__search', 'Bash(git *)'],
      ),
    ).toEqual(['bash', 'mcp_docs_read', 'read', 'mcp_github_search'])
  })

  test('returns a defensive copy when there are no scoped overrides', () => {
    const configured = ['localix_ui', 'localix_ui']
    const resolved = resolveRunDisabledTools(configured)

    expect(resolved).toEqual(['localix_ui'])
    expect(resolved).not.toBe(configured)
  })

  test('a scoped entry with a specifier removes no tool, and is handed over as a pattern', () => {
    expect(resolveRunDisabledTools(['write'], ['Bash(rm *)', 'Read'])).toEqual(['write', 'read'])
    expect(resolveRunDenyPatterns(['bash(rm *)', 'write'], ['Bash(git push *)', 'Read'])).toEqual([
      'bash(rm *)',
      'Bash(git push *)',
    ])
  })
})
