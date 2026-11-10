import { describe, expect, test } from 'bun:test'
import { buildLoadedAgent } from '../../loader-contract'
import { readAgentText } from './agent-file'

const agentOf = (frontmatter: string) =>
  readAgentText(`---\n${frontmatter}\n---\nWork.\n`, 'agents/a.md', 'user')?.agent

describe('agent tools lists, read by the kit', () => {
  test.each([
    ['Agent(worker, researcher), Read', ['Agent', 'Read'], ['worker', 'researcher']],
    ['[Task(worker), Read]', ['Agent', 'Read'], ['worker']],
    ['Agent, Read', ['Agent', 'Read'], undefined],
    ['Read', ['Read'], undefined],
  ])('tools: %s names the types it may delegate to', (tools, mapped, types) => {
    const agent = agentOf(`name: lead\ndescription: d\ntools: ${tools}`)
    expect(agent?.tools).toEqual(mapped)
    expect(agent?.agentTypes).toEqual(types)
    expect(buildLoadedAgent('p', agent!, (text) => text).agentTypes).toEqual(types)
  })

  test('a disallowedTools entry with a specifier removes the whole tool, as in Claude Code', () => {
    const agent = agentOf('name: safe\ndescription: d\ndisallowedTools: Bash(rm *), Write')
    expect(agent?.disallowedTools).toEqual(['Bash', 'Write'])
    const search = agentOf('name: safe\ndescription: d\ndisallowedTools: Grep(*.ts)')
    expect(search?.disallowedTools).toEqual(['Search'])
  })

  test('a tools list of only unmapped names stays an empty allowlist, not the inherited surface', () => {
    const agent = agentOf(
      'name: planner\ndescription: plans\ntools: TodoWrite, EnterPlanMode\ndisallowedTools: TodoWrite',
    )
    expect(agent?.tools).toEqual([])
    expect(agent?.disallowedTools).toBeUndefined()
  })

  test('a file without a description is documentation, not an agent', () => {
    expect(agentOf('name: notes')).toBeUndefined()
  })
})
