import { expect, test } from 'bun:test'
import { modAgentDefinition } from './agent-definition'

test('a spec’s fields become the plugin agent a run takes them from', () => {
  const { agent, notApplied } = modAgentDefinition('lab', {
    name: 'runner',
    description: 'Runs a spec',
    prompt: 'You run specs.',
    tools: ['Read', 'Bash'],
    disallowedTools: ['Write'],
    model: 'haiku',
    effort: 'low',
    maxTurns: 5,
    skills: ['spec-format'],
    memory: 'project',
    background: true,
    omitClaudeMd: true,
    isolation: 'worktree',
    initialPrompt: 'Run {{intent}}',
    permissionMode: 'plan',
  })
  expect(agent).toMatchObject({
    fullName: 'lab:runner',
    prompt: 'You run specs.',
    tools: ['Read', 'Bash'],
    disallowedTools: ['Write'],
    maxTurns: 5,
    pinnedSkills: ['spec-format'],
    memory: 'project',
    background: true,
    omitClaudeMd: true,
    isolation: 'isolated',
    initialPrompt: 'Run {{intent}}',
  })
  // A plugin's agent never carries a permission mode, as in Claude Code.
  expect(notApplied).toEqual(['permissionMode'])
})

test('a spec the schema refuses rejects with its reason', () => {
  const base = { name: 'a', description: 'd', prompt: 'p' }
  expect(() => modAgentDefinition('lab', { ...base, maxTurns: 0 })).toThrow('maxTurns')
  expect(() => modAgentDefinition('lab', { ...base, isolation: 'remote' })).toThrow('isolation')
  expect(() => modAgentDefinition('lab', { ...base, colour: 'red' })).toThrow('colour')
  expect(() => modAgentDefinition('lab', { ...base, prompt: '' })).toThrow('prompt')
})
