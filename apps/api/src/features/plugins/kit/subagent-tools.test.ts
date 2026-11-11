import { describe, expect, test } from 'bun:test'
import {
  agentToolCandidates,
  agentToolsRefusal,
  namesBuiltinTool,
  narrowAgentTools,
} from './subagent-tools'

const BUILTINS = ['Read', 'Edit', 'Write', 'Bash', 'Search', 'Research', 'Agent', 'Browser']
const CHILD = {
  asMainThread: false,
  background: false,
  atDepthLimit: false,
  permissionMode: 'default',
}
const MAIN = { ...CHILD, asMainThread: true }
const pool = [
  ...BUILTINS.map((name) => ({ name })),
  { name: 'mcp_github_issue', aliases: ['mcp__github__issue'] },
  { name: 'ToolOutput' },
]

describe('agentToolCandidates', () => {
  test('a list without tools inherits', () => {
    expect(agentToolCandidates({ name: 'a' }, BUILTINS, CHILD).declared).toBeNull()
  })

  test("names a list in Claude Code's terms, Grep and WebFetch as Localix's tools", () => {
    const got = agentToolCandidates(
      { name: 'a', tools: ['Read', 'Grep', 'WebFetch'] },
      BUILTINS,
      CHILD,
    )
    expect(got.declared).toEqual(['Read', 'Search', 'Research'])
  })

  test('an MCP entry stays a candidate under its Localix name', () => {
    const got = agentToolCandidates(
      { name: 'a', tools: ['Read', 'mcp__github__issue'] },
      BUILTINS,
      CHILD,
    )
    expect(got.declared).toEqual(['Read', 'mcp_github_issue'])
  })

  test('Agent(worker) limits the types the main thread spawns', () => {
    const got = agentToolCandidates({ name: 'a', tools: ['Agent(worker)', 'Read'] }, BUILTINS, MAIN)
    expect(got.spawnTypes).toEqual(['worker'])
  })

  test('a subagent ignores a type list', () => {
    const got = agentToolCandidates({ name: 'a', tools: ['Agent(worker)'] }, BUILTINS, CHILD)
    expect(got.spawnTypes).toBeUndefined()
  })
})

describe('narrowAgentTools', () => {
  const names = (tools: readonly { name: string }[]) => tools.map((tool) => tool.name)

  test('keeps the listed tools, an MCP tool by its address, and the run plumbing', () => {
    const agent = { name: 'a', tools: ['Read', 'mcp__github__issue'] }
    expect(names(narrowAgentTools(agent, pool, CHILD))).toEqual([
      'Read',
      'mcp_github_issue',
      'ToolOutput',
    ])
  })

  test('a denied Grep takes Search away', () => {
    const agent = { name: 'a', disallowedTools: ['Grep'] }
    expect(names(narrowAgentTools(agent, pool, CHILD))).not.toContain('Search')
  })
})

describe('agentToolsRefusal', () => {
  test("refuses a list that names no tool, in Claude Code's words", () => {
    expect(agentToolsRefusal({ name: 'a', tools: ['Nope'] }, pool, CHILD)).toContain(
      "Agent 'a' would be spawned with zero tools",
    )
    expect(agentToolsRefusal({ name: 'a', tools: ['Read'] }, pool, CHILD)).toBeUndefined()
  })
})

describe('namesBuiltinTool', () => {
  test("reads an entry in Claude Code's names", () => {
    expect(namesBuiltinTool('Grep', BUILTINS)).toBe(true)
    expect(namesBuiltinTool('Bash(git *)', BUILTINS)).toBe(true)
    expect(namesBuiltinTool('Task', BUILTINS)).toBe(true)
    expect(namesBuiltinTool('TodoWrite', BUILTINS)).toBe(false)
  })
})
