import { describe, expect, test } from 'bun:test'
import { agentDefinitionSchema, agentFileSchema, builtinAgentId } from './definition'

const file = { name: 'reviewer', instructions: 'Review the requested change.' }

describe('an agent as a Claude Code file read into a record', () => {
  test('requires a registry identity independently of the name', () => {
    expect(agentDefinitionSchema.safeParse(file).success).toBe(false)
    expect(agentDefinitionSchema.parse({ ...file, id: 'id-1' }).name).toBe('reviewer')
    expect(builtinAgentId('reviewer')).toBe('builtin:reviewer')
  })

  test('a name is Claude Code’s: any text up to 256 characters that does not start with "-"', () => {
    for (const name of ['Code Reviewer', 'reviewer.v2', 'Έλεγχος', 'a'.repeat(256)])
      expect(agentFileSchema.safeParse({ ...file, name }).success).toBe(true)
    for (const name of ['', '-reviewer', 'a'.repeat(257)])
      expect(agentFileSchema.safeParse({ ...file, name }).success).toBe(false)
  })

  test('an agent needs instructions', () => {
    expect(agentFileSchema.safeParse({ name: 'reviewer', instructions: '' }).success).toBe(false)
    expect(agentFileSchema.safeParse({ ...file, instructions: '   ' }).success).toBe(false)
  })

  test('policy, invocation and foreign fields cannot enter a record', () => {
    for (const field of [
      'handle',
      'label',
      'modelPreference',
      'limits',
      'context',
      'localix',
      'tools',
      'disallowedTools',
      'mcpServers',
      'permissionMode',
      'hooks',
      'prompt',
    ])
      expect(agentDefinitionSchema.safeParse({ ...file, id: 'id-1', [field]: [] }).success).toBe(
        false,
      )
    expect(agentDefinitionSchema.safeParse({ ...file, id: 'id-1' }).success).toBe(true)
  })

  test('the turn limit and the preloaded skills are the file’s own keys', () => {
    expect(agentFileSchema.parse({ ...file, maxTurns: 12, skills: ['review'] })).toMatchObject({
      maxTurns: 12,
      skills: ['review'],
    })
    expect(agentFileSchema.safeParse({ ...file, maxTurns: 0 }).success).toBe(false)
  })
})
