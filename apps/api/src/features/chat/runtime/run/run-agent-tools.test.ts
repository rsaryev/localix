import { expect, test } from 'bun:test'
import type { LoadedPluginAgent } from '../../../plugins/loader-contract'
import { runAgentTools } from './run-agent-tools'

const AGENT: LoadedPluginAgent = {
  pluginName: 'sec',
  name: 'reviewer',
  fullName: 'sec:reviewer',
  label: 'reviewer',
  description: 'Reviews.',
  prompt: 'Review.',
  tools: ['Read', 'Grep'],
}
const pool = ['Read', 'Search', 'Bash', 'Write', 'ToolOutput'].map((name) => ({ name }))
const names = (tools: readonly { name: string }[]) => tools.map((tool) => tool.name)

test("a child's list names the built-ins its profile builds and narrows what the run offers", () => {
  const got = runAgentTools({ agent: AGENT, asMainThread: false }, 'default', false)
  expect(got.profileAgent?.tools).toEqual(['Read', 'Search'])
  expect(names(got.narrow!(pool))).toEqual(['Read', 'Search', 'ToolOutput'])
})

test('a main-thread Agent(worker) is the only type the run may start', () => {
  const agent = { ...AGENT, tools: ['Agent(worker)', 'Read'] }
  expect(runAgentTools({ agent, asMainThread: true }, 'default', false).allowedAgentTypes).toEqual([
    'worker',
  ])
})

test('an agent without a list inherits; a fork and a run as no agent are not narrowed', () => {
  const { tools: _tools, ...bare } = AGENT
  const got = runAgentTools(
    { agent: { ...bare, disallowedTools: ['Bash'] }, asMainThread: false },
    'default',
    false,
  )
  expect(got.profileAgent).not.toHaveProperty('tools')
  expect(names(got.narrow!(pool))).not.toContain('Bash')
  expect(runAgentTools({ agent: AGENT, asMainThread: false }, 'default', true)).toEqual({})
  expect(runAgentTools(null, 'default', false)).toEqual({})
})
