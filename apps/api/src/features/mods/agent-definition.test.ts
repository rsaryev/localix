import { expect, test } from 'bun:test'
import { modAgentDefinition } from './agent-definition'

test('a spec’s fields become the definition the catalog reads as the SDK `agents` option', () => {
  const { name, definition } = modAgentDefinition({
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
  expect(name).toBe('runner')
  expect(definition).toMatchObject({
    description: 'Runs a spec',
    prompt: 'You run specs.',
    tools: ['Read', 'Bash'],
    skills: ['spec-format'],
    isolation: 'worktree',
    initialPrompt: 'Run {{intent}}',
    permissionMode: 'plan',
  })
  expect(definition).not.toHaveProperty('name')
})

test('a spec the schema refuses rejects with its reason', () => {
  const base = { name: 'a', description: 'd', prompt: 'p' }
  expect(() => modAgentDefinition({ ...base, maxTurns: 0 })).toThrow('maxTurns')
  expect(() => modAgentDefinition({ ...base, isolation: 'remote' })).toThrow('isolation')
  expect(() => modAgentDefinition({ ...base, colour: 'red' })).toThrow('colour')
  expect(() => modAgentDefinition({ ...base, prompt: '' })).toThrow('prompt')
})
