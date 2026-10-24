import { describe, expect, test } from 'bun:test'

import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'

import { applyPluginMainAgent, runAsPluginAgent, runToolsAgent } from './plugin-main-agent'
import type { LoadedPluginAgent } from '../../../plugins/loader-contract'

const reviewer: LoadedPluginAgent = {
  pluginName: 'sec',
  name: 'security-reviewer',
  fullName: 'sec:security-reviewer',
  label: 'security-reviewer',
  description: 'Reviews for vulnerabilities',
  prompt: 'You are a security reviewer.',
  tools: ['read', 'search'],
  disallowedTools: ['kanban'],
}
const input = {
  agent: { id: DEFAULT_AGENT_ID, instructions: 'You are Localix.' },
  disabledTools: ['loops'],
}
const chat = { speakerAgentId: DEFAULT_AGENT_ID, host: 'chat' }

describe('a plugin’s default agent setting', () => {
  test('runs the default agent’s chat as the plugin agent, with its tool restrictions', () => {
    const applied = applyPluginMainAgent(input, reviewer, chat)
    expect(applied.agent.instructions).toBe('You are a security reviewer.')
    expect(applied.mainAgent).toBe(reviewer)
    // `tools: Read, Grep` leaves out the shell, the writes and the web; `disallowedTools` adds to
    // what the run's own rules already switched off.
    expect(applied.disabledTools).toEqual(
      expect.arrayContaining(['loops', 'kanban', 'bash', 'write', 'edit', 'research', 'ask']),
    )
    expect(applied.disabledTools).not.toContain('read')
    expect(applied.disabledTools).not.toContain('search')
  })

  test('a tools list switches skills off unless it names Skill (CC sub-agents)', () => {
    expect(runAsPluginAgent(input, reviewer).disabledTools).toContain('skill')
    const withSkill = { ...reviewer, tools: ['read', 'skill'] }
    expect(runAsPluginAgent(input, withSkill).disabledTools).not.toContain('skill')
  })

  test('an agent without a tools list keeps every tool', () => {
    const open = { ...reviewer, tools: undefined, disallowedTools: undefined }
    expect(applyPluginMainAgent(input, open, chat).disabledTools).toEqual(['loops'])
  })

  test('a chat with an agent the person chose, a child or no setting keeps its own agent', () => {
    for (const run of [
      { speakerAgentId: 'builtin:reviewer', host: 'chat' },
      { speakerAgentId: DEFAULT_AGENT_ID, host: 'subagent' },
    ]) {
      const kept = applyPluginMainAgent(input, reviewer, run)
      expect(kept.agent.instructions).toBe('You are Localix.')
      expect(kept.mainAgent).toBeNull()
    }
    expect(applyPluginMainAgent(input, null, chat).agent).toBe(input.agent)
  })
})

// sub-agents.md, `tools`: an allowlist — "The subagent can't edit files, write files, or use any
// MCP tools" beyond it. Run as the main session agent, the same list is the chat's whole surface.
test('the main agent’s tools list is the exact surface of the run', () => {
  expect(runToolsAgent(null, reviewer)).toEqual({ tools: ['read', 'search'] })
  expect(runToolsAgent(null, { ...reviewer, tools: undefined })).toBeNull()
  const child = { ...reviewer, tools: ['read'] }
  expect(runToolsAgent(child, reviewer)).toBe(child)
})
