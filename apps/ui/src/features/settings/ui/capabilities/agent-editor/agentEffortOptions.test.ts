import { describe, expect, test } from 'bun:test'
import { agentEffortOptions } from './agentEffortOptions'

const values = (options: { value: string }[]) => options.map((option) => option.value)

describe('agentEffortOptions', () => {
  test('a model that cannot switch thinking off is not offered Off', () => {
    expect(values(agentEffortOptions({ reasoningEfforts: ['low', 'high'] }, ''))).toEqual([
      '',
      'low',
      'high',
    ])
  })

  test('Off is offered where the model publishes it, or publishes nothing', () => {
    expect(values(agentEffortOptions({ reasoningEfforts: ['off', 'low'] }, ''))).toContain('off')
    expect(values(agentEffortOptions(undefined, ''))).toEqual([
      '',
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
  })

  test('a stored level the model lacks stays visible and names what it runs as', () => {
    const options = agentEffortOptions({ reasoningEfforts: ['low', 'high'] }, 'off')
    expect(options.at(-1)).toEqual({ value: 'off', label: 'off — runs as Low' })
  })
})
