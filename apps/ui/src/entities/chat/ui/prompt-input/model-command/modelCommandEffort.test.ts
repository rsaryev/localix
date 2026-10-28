import { describe, expect, test } from 'bun:test'
import { resolveCommandSpec } from '@localixai/api/slash-catalog'
import { modelStepOptions } from './modelCommandSteps'
import { effortStepOptions, resolveEffortCommand, skipEffortStep } from './modelCommandEffort'
import { agentRow, context } from './testing/modelCommandFixture'

const EFFORT_ARGS = resolveCommandSpec('effort')!.args!
const values = (rows: { value: string }[]) => rows.map((row) => row.value)
const solo = context(agentRow('solo', 'openai/gpt', 'high'))

describe('/effort — which steps apply', () => {
  test('the conversation’s agent needs no agent crumb', () => {
    expect(skipEffortStep(solo, 'agent')).toBe(true)
  })

  test('there is no level to pick on a model that does not reason', () => {
    const plain = context(agentRow('solo', 'openai/plain'))
    expect(skipEffortStep(plain, 'reasoning')).toBe(true)
    expect(skipEffortStep(solo, 'reasoning')).toBe(false)
  })
})

describe('/effort — the rows', () => {
  test('the levels are the ones /model shows for the model the agent runs now', () => {
    const asModel = modelStepOptions(solo, 'reasoning', '', {
      provider: 'conn-openai',
      model: 'openai/gpt',
    })
    expect(effortStepOptions(solo, 'reasoning', '')).toEqual(asModel)
    expect(values(asModel)).toEqual(['off', 'minimal', 'low', 'medium', 'high'])
    expect(asModel.find((row) => row.value === 'high')?.description).toContain('current')
  })
})

describe('/effort — Enter', () => {
  test('applies the level to the agent’s own model through /model’s plan', () => {
    expect(resolveEffortCommand(solo, 'low', EFFORT_ARGS)).toEqual({
      plan: {
        agentId: 'id-solo',
        connectionId: 'conn-openai',
        modelId: 'openai/gpt',
        providerId: 'openai',
        reasoningEffort: 'low',
        settings: {},
      },
    })
  })

  test('says what is missing instead of guessing', () => {
    expect(resolveEffortCommand(solo, '', EFFORT_ARGS)).toEqual({
      error: 'Pick a reasoning level.',
    })
    expect(resolveEffortCommand(solo, 'max', EFFORT_ARGS)).toEqual({
      error: 'GPT does not offer the level “max”.',
    })
    expect(
      resolveEffortCommand(context(agentRow('p', 'openai/plain')), 'high', EFFORT_ARGS),
    ).toEqual({ error: 'PLAIN does not offer reasoning levels.' })
  })
})
