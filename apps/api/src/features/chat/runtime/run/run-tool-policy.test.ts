import { describe, expect, test } from 'bun:test'
import { resolveRunDenyPatterns, resolveRunDisabledTools } from './run-tool-policy'

describe('resolveRunDisabledTools', () => {
  test('normalizes scoped CC aliases and preserves one stable runtime denylist', () => {
    expect(
      resolveRunDisabledTools(
        ['Bash', 'mcp_docs_read'],
        ['Read', 'mcp__github__search', 'Bash(git *)'],
      ),
    ).toEqual(['Bash', 'mcp_docs_read', 'Read', 'mcp_github_search'])
  })

  test('returns a defensive copy when there are no scoped overrides', () => {
    const configured = ['localix_ui', 'localix_ui']
    const resolved = resolveRunDisabledTools(configured)

    expect(resolved).toEqual(['localix_ui'])
    expect(resolved).not.toBe(configured)
  })

  test('a scoped entry with a specifier removes no tool, and is handed over as a pattern', () => {
    expect(resolveRunDisabledTools(['Write'], ['Bash(rm *)', 'Read'])).toEqual(['Write', 'Read'])
    expect(resolveRunDenyPatterns(['Bash(rm *)', 'Write'], ['Bash(git push *)', 'Read'])).toEqual([
      'Bash(rm *)',
      'Bash(git push *)',
    ])
  })
})
