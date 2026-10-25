import { describe, expect, test } from 'bun:test'
import { agentBlueprintSchema, agentDefinitionSchema, builtinAgentId } from './definition'

const blueprint = { handle: 'reviewer', instructions: 'Review the requested change.' }

describe('native agent definition boundary', () => {
  test('requires a registry identity independently of the handle', () => {
    expect(agentDefinitionSchema.safeParse(blueprint).success).toBe(false)
    expect(agentDefinitionSchema.parse({ ...blueprint, id: 'id-1' }).handle).toBe('reviewer')
    expect(builtinAgentId('reviewer')).toBe('builtin:reviewer')
  })

  test('the person is not an agent: no human kind, and only `all` is reserved', () => {
    expect(agentBlueprintSchema.safeParse({ ...blueprint, kind: 'human' }).success).toBe(false)
    expect(agentBlueprintSchema.safeParse({ ...blueprint, handle: 'all' }).success).toBe(false)
    expect(agentBlueprintSchema.safeParse({ ...blueprint, handle: 'human' }).success).toBe(true)
    expect(agentBlueprintSchema.safeParse({ handle: 'reviewer', instructions: '' }).success).toBe(
      false,
    )
  })

  test('policy, invocation and foreign fields cannot enter a native definition', () => {
    for (const field of [
      'type',
      'tools',
      'disallowedTools',
      'pinnedSkills',
      'mcp_servers',
      'mcpServers',
      'permissionMode',
      'background',
      'isolation',
      'initialPrompt',
      'hooks',
      'entrypoints',
      'importedFrom',
      'metadata',
      'prompt',
      'name',
    ]) {
      expect(
        agentDefinitionSchema.safeParse({ ...blueprint, id: 'id-1', [field]: [] }).success,
      ).toBe(false)
    }
    // Positive control: a valid native shape still passes the same validator.
    expect(agentDefinitionSchema.safeParse({ ...blueprint, id: 'id-1' }).success).toBe(true)
  })

  test('authored context and model preferences stay structured', () => {
    expect(
      agentBlueprintSchema.parse({
        ...blueprint,
        modelPreference: { provider: 'provider-a', model: 'model-a', effort: 'high' },
        limits: { maxTurns: 12 },
        context: { preloadSkills: ['review'], memory: { scope: 'project' } },
      }).context?.preloadSkills,
    ).toEqual(['review'])
    expect(agentBlueprintSchema.safeParse({ ...blueprint, limits: { maxTurns: 0 } }).success).toBe(
      false,
    )
    expect(agentBlueprintSchema.safeParse({ ...blueprint, instructions: '   ' }).success).toBe(
      false,
    )
    expect(agentBlueprintSchema.safeParse({ ...blueprint, handle: '../escape' }).success).toBe(
      false,
    )
  })

  test('hierarchy priority is bounded and defaults to neutral', () => {
    expect(agentBlueprintSchema.parse(blueprint).leadershipPriority).toBe(0)
    expect(
      agentBlueprintSchema.parse({ ...blueprint, leadershipPriority: 2 }).leadershipPriority,
    ).toBe(2)
    expect(agentBlueprintSchema.safeParse({ ...blueprint, leadershipPriority: 3 }).success).toBe(
      false,
    )
  })
})
