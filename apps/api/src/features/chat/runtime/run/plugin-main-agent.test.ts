import { describe, expect, test } from 'bun:test'

import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'

import { applyMainAgent, runAsPluginAgent, runToolsAgent } from './plugin-main-agent'
import type { LoadedPluginAgent } from '../../../plugins/loader-contract'

const reviewer: LoadedPluginAgent = {
  pluginName: 'sec',
  name: 'security-reviewer',
  fullName: 'sec:security-reviewer',
  label: 'security-reviewer',
  description: 'Reviews for vulnerabilities',
  prompt: 'You are a security reviewer.',
  tools: ['Read', 'Grep'],
  disallowedTools: ['WebFetch'],
}
const input = {
  agent: { id: DEFAULT_AGENT_ID, instructions: 'You are Localix.' },
  disabledTools: ['Loops'],
}
const chat = { agentId: DEFAULT_AGENT_ID, host: 'chat' }

describe('the agent setting', () => {
  test('runs the default agent’s chat as the plugin agent; its tools narrow the run later', () => {
    const applied = applyMainAgent(input, reviewer, chat)
    expect(applied.agent.instructions).toBe('You are a security reviewer.')
    expect(applied.mainAgent).toBe(reviewer)
    // The kit resolves `tools` and `disallowedTools` over the built tools (`runToolsAgent`).
    expect(applied.disabledTools).toEqual(['Loops'])
    expect(runAsPluginAgent(input, reviewer).disabledTools).toEqual(['Loops'])
  })

  test('a chat with an agent the person chose, a child or no setting keeps its own agent', () => {
    for (const run of [
      { agentId: 'builtin:reviewer', host: 'chat' },
      { agentId: DEFAULT_AGENT_ID, host: 'subagent' },
    ]) {
      const kept = applyMainAgent(input, reviewer, run)
      expect(kept.agent.instructions).toBe('You are Localix.')
      expect(kept.mainAgent).toBeNull()
    }
    expect(applyMainAgent(input, null, chat).agent).toBe(input.agent)
  })
})

// sub-agents.md, `tools`: an allowlist. Run as the main session agent, the same list narrows the
// chat; a child's agent type narrows the child.
test('whose tools narrow the run', () => {
  expect(runToolsAgent(null, reviewer)).toEqual({ agent: reviewer, asMainThread: true })
  expect(runToolsAgent(null, null)).toBeNull()
  const child = { ...reviewer, tools: ['Read'] }
  expect(runToolsAgent(child, reviewer)).toEqual({ agent: child, asMainThread: false })
})
