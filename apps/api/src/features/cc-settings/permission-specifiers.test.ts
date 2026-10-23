import { describe, expect, it } from 'bun:test'

import {
  matchBashSpecifier,
  parseRuleString,
  specifierIsAll,
  specifierMatchesValue,
} from './permission-rules'

// The Claude Code `Tool(specifier)` grammar the hook `if` guard matches with.

describe('parseRuleString', () => {
  it('parses a bare tool and Tool(specifier)', () => {
    expect(parseRuleString('Bash')).toEqual({ tool: 'Bash' })
    expect(parseRuleString('Bash(git push:*)')).toEqual({ tool: 'Bash', specifier: 'git push:*' })
  })

  it('skips empty and blank rule strings', () => {
    expect(parseRuleString('')).toBeNull()
    expect(parseRuleString('   ')).toBeNull()
  })
})

describe('specifierIsAll', () => {
  it('an absent, empty or `*` specifier means any invocation', () => {
    expect(specifierIsAll(undefined)).toBe(true)
    expect(specifierIsAll(' ')).toBe(true)
    expect(specifierIsAll('*')).toBe(true)
    expect(specifierIsAll('git:*')).toBe(false)
  })
})

describe('Bash specifier grammar', () => {
  it('word-boundary prefix `git:*` matches subcommands, not `github`', () => {
    expect(matchBashSpecifier('git:*', 'git push origin')).toBe(true)
    expect(matchBashSpecifier('git:*', 'git')).toBe(true)
    expect(matchBashSpecifier('git:*', 'github-cli status')).toBe(false)
  })

  it('trailing space-glob `ls *` is a word boundary (matches `ls -la`, not `lsof`)', () => {
    expect(matchBashSpecifier('ls *', 'ls -la')).toBe(true)
    expect(matchBashSpecifier('ls *', 'lsof')).toBe(false)
  })

  it('raw prefix `ls*` (no space) matches `lsof` too', () => {
    expect(matchBashSpecifier('ls*', 'lsof')).toBe(true)
  })

  it('exact match requires the whole command', () => {
    expect(matchBashSpecifier('git status', 'git status')).toBe(true)
    expect(matchBashSpecifier('git status', 'git status -s')).toBe(false)
  })

  it('a `*` stands in for any text, slashes included (permissions.md)', () => {
    expect(matchBashSpecifier('git * --force', 'git push --force')).toBe(true)
    expect(matchBashSpecifier('cat *secret*', 'cat ./dir/secret.txt')).toBe(true)
    expect(matchBashSpecifier('* --help *', 'npm --help x')).toBe(true)
    expect(matchBashSpecifier('* --help *', 'npm --help')).toBe(false)
  })
})

describe('value specifiers (Skill, Agent, MCP)', () => {
  it('a name matches exactly, and `name *` or `name:*` by prefix', () => {
    expect(specifierMatchesValue('deploy', 'deploy')).toBe(true)
    expect(specifierMatchesValue('deploy', 'deploy-staging')).toBe(false)
    expect(specifierMatchesValue('deploy *', 'deploy-staging')).toBe(true)
    expect(specifierMatchesValue('deploy:*', 'deploy-staging')).toBe(true)
  })

  it('a glob keeps `*` inside one segment', () => {
    expect(specifierMatchesValue('team/*', 'team/review')).toBe(true)
    expect(specifierMatchesValue('team/*', 'team/a/b')).toBe(false)
    expect(specifierMatchesValue('team/**', 'team/a/b')).toBe(true)
  })
})
