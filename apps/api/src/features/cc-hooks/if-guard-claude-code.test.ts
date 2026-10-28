/**
 * A hook handler's `if` reads the call as Claude Code shapes it and matches its rule as
 * permissions.md does: a file rule anchored at the working directory, `//` the filesystem root,
 * `~/` home; `Agent(<type>)`, `Skill(<name>)`, `WebFetch(domain:<host>)` and `Tool(param:value)`
 * on their own fields; a Bash rule on every command of a batch; the tool part on this call's
 * Claude Code name (a content search is not `Glob`).
 */
import { describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'

import { evaluateIfGuard } from './if-guard'

const cwd = '/proj'
const runs = (rule: string, tool: string, input: Record<string, unknown>) =>
  evaluateIfGuard(rule, tool, input, undefined, cwd)

describe('file rules', () => {
  test('a relative directory pattern names that directory of the working directory only', () => {
    const edit = (path: string) => ({ edits: [{ path, old_string: 'a', new_string: 'b' }] })
    expect(runs('Edit(src/**)', 'Edit', edit('/proj/src/a.ts'))).toBe(true)
    expect(runs('Edit(src/**)', 'Edit', edit('src/a.ts'))).toBe(true)
    expect(runs('Edit(src/**)', 'Edit', edit('lib/src/a.ts'))).toBe(false)
    expect(runs('Edit(**/src/**)', 'Edit', edit('lib/src/a.ts'))).toBe(true)
    expect(runs('Edit(*.ts)', 'Edit', edit('deep/a.ts'))).toBe(true)
  })

  test('`//` and `~/` anchor at the filesystem root and home', () => {
    expect(runs('Read(//etc/**)', 'Read', { path: '/etc/hosts' })).toBe(true)
    expect(runs('Read(~/.ssh/**)', 'Read', { path: `${homedir()}/.ssh/id_rsa` })).toBe(true)
    expect(runs('Read(~/.ssh/**)', 'Read', { path: '/proj/.ssh/id_rsa' })).toBe(false)
  })
})

describe('named fields', () => {
  test('Agent, Skill and WebFetch rules read the agent, the skill and the host', () => {
    expect(runs('Agent(Explore)', 'Agent', { prompt: 't', subagent_type: 'Explore' })).toBe(true)
    expect(runs('Agent(Explore)', 'Agent', { prompt: 'Explore', subagent_type: 'Plan' })).toBe(
      false,
    )
    expect(runs('Skill(deploy)', 'Skill', { action: 'get', name: 'deploy' })).toBe(true)
    const fetch = { question: 'q', urls: ['https://docs.Example.com/a'] }
    expect(runs('WebFetch(domain:*.example.com)', 'Research', fetch)).toBe(true)
    expect(runs('WebFetch(domain:example.com)', 'Research', fetch)).toBe(false)
  })

  test('a parameter rule matches the field Claude Code’s input carries', () => {
    expect(runs('Bash(run_in_background:true)', 'Bash', { command: 'x', background: true })).toBe(
      true,
    )
    expect(runs('Bash(run_in_background:true)', 'Bash', { command: 'x' })).toBe(false)
  })
})

describe('the call', () => {
  test('a Bash rule matches any command of a batch', () => {
    expect(runs('Bash(rm *)', 'Bash', { commands: ['ls', 'rm -rf build'] })).toBe(true)
    expect(runs('Bash(rm *)', 'Bash', { commands: ['ls', 'pwd'] })).toBe(false)
  })

  test('the tool part is this call’s name', () => {
    expect(runs('Glob', 'Search', { query: 'TODO' })).toBe(false)
    expect(runs('Grep', 'Search', { query: 'TODO' })).toBe(true)
    expect(runs('Glob', 'Search', { glob: '*.md' })).toBe(true)
  })
})
