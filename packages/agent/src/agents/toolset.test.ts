import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  createToolSet,
  getAgentTools,
  isAgentToolAvailable,
  mergeToolSets,
  defineAgentTool,
  validateToolRegistry,
} from './toolset'

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

  test('returns an empty tool list for empty or missing sources', () => {
    expect(getAgentTools(null)).toEqual([])
    expect(getAgentTools(undefined)).toEqual([])
    expect(getAgentTools([])).toEqual([])
  })

  test('flattens nested tool sources and de-duplicates by name', () => {
    const askA = makeTool()
    const askB = { ...makeTool(), label: 'Ask override' }
    const tools = getAgentTools([createToolSet([askA]), mergeToolSets([askB]), null])

    expect(tools).toHaveLength(1)
    expect(tools[0]?.label).toBe('Ask override')
  })

  test('warns when the same tool name is registered more than once', () => {
    const originalWarn = console.warn
    const warnings: unknown[][] = []
    console.warn = (...args: unknown[]) => {
      warnings.push(args)
    }

    try {
      const askA = makeTool()
      const askB = { ...makeTool(), label: 'Ask override' }

      const tools = getAgentTools([askA, mergeToolSets(askB)])

      expect(tools).toHaveLength(1)
      expect(tools[0]?.label).toBe('Ask override')
      expect(warnings).toHaveLength(1)
      expect(String(warnings[0]?.[0])).toContain('Tool "ask" is registered more than once')
    } finally {
      console.warn = originalWarn
    }
  })
})
