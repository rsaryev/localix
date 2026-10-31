import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, isAgentToolAvailable, validateToolRegistry } from './toolset'

describe('defineAgentTool', () => {
  test('is an identity passthrough (returns the same object reference)', () => {
    const tool = {
      name: 't',
      description: 'd',
      inputSchema: z.object({}),
      executionMode: 'sequential' as const,
      activeVerb: 'Thinking',
      execute: async () => ({ content: '' }),
    }
    expect(defineAgentTool(tool)).toBe(tool)
  })
})

function makeTool(label?: string) {
  return {
    name: 'ask' as const,
    label: label ?? 'Ask',
    description: 'test',
    inputSchema: z.object({}),
    executionMode: 'sequential' as const,
    activeVerb: 'Asking',
    execute: async () => ({ content: '' }),
  }
}

describe('toolset', () => {
  test('descriptor availability is evaluated from runtime surface capabilities', () => {
    const uiTool = {
      ...makeTool(),
      availability: { requiredCapabilities: ['workbench-ui'] },
    }
    expect(isAgentToolAvailable(uiTool, { capabilities: ['workbench-ui', 'other'] })).toBe(true)
    expect(isAgentToolAvailable(uiTool, { capabilities: [] })).toBe(false)
    expect(isAgentToolAvailable(makeTool(), { capabilities: [] })).toBe(true)
  })

  test('validates unique model and dispatch projections while allowing hidden dispatch tools', () => {
    const visible = makeTool()
    const hidden = { ...makeTool(), name: 'hidden' }

    expect(() => validateToolRegistry([visible], [visible, hidden])).not.toThrow()
    expect(() => validateToolRegistry([visible, { ...visible }])).toThrow(
      'Duplicate model tool names: ask',
    )
    expect(() => validateToolRegistry([visible], [hidden])).toThrow(
      'Model tools missing runtime dispatch implementations: ask',
    )
    expect(() => validateToolRegistry([visible], [visible, { ...visible }])).toThrow(
      'Duplicate dispatch tool names: ask',
    )
  })

  test('a model name must be a provider tool name no other tool answers to', () => {
    const query = {
      ...makeTool(),
      name: 'mcp_kit_db_query',
      modelName: 'mcp__plugin_kit_db__query',
    }
    expect(() => validateToolRegistry([query])).not.toThrow()
    expect(() => validateToolRegistry([query, { ...makeTool(), modelName: query.name }])).toThrow(
      'Model tool name mcp_kit_db_query is taken by mcp_kit_db_query; ask cannot use it',
    )
    expect(() =>
      validateToolRegistry([query, { ...makeTool(), modelName: query.modelName }]),
    ).toThrow('is taken by mcp_kit_db_query')
    expect(() => validateToolRegistry([{ ...query, modelName: 'mcp__a.b' }])).toThrow(
      'Invalid model name for tool mcp_kit_db_query: mcp__a.b',
    )
    expect(() => validateToolRegistry([{ ...query, modelName: `m${'x'.repeat(64)}` }])).toThrow(
      'Invalid model name',
    )
  })
})
