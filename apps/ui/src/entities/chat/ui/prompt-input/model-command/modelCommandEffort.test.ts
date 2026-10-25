import { describe, expect, test } from 'bun:test'
import { resolveCommandSpec } from '@localixai/api/slash-catalog'
import { modelStepOptions } from './modelCommandSteps'
import { effortStepOptions, resolveEffortCommand, skipEffortStep } from './modelCommandEffort'
import { context, member } from './testing/modelCommandFixture'

const EFFORT_ARGS = resolveCommandSpec('effort')!.args!
const values = (rows: { value: string }[]) => rows.map((row) => row.value)
const solo = context([member('solo', 'openai/gpt', 'high')])
const group = context([
  member('lead', 'openai/gpt', 'high'),
  member('qa', 'anthropic/opus', 'medium'),
  { ...member('guest', 'openai/gpt'), invited: false },
])

describe('/effort — which steps apply', () => {
  test('a lone agent needs no agent crumb; a group keeps it', () => {
    expect(skipEffortStep(solo, 'agent', new Map())).toBe(true)
    expect(skipEffortStep(group, 'agent', new Map())).toBe(false)
  })

  test('there is no level to pick on a model that does not reason', () => {
    const plain = context([member('solo', 'openai/plain')])
    expect(skipEffortStep(plain, 'reasoning', new Map())).toBe(true)
    expect(skipEffortStep(solo, 'reasoning', new Map())).toBe(false)
  })
})

describe('/effort — the rows', () => {
  test('the agent crumb lists who is in the chat, not All agents and not who could join', () => {
    expect(values(effortStepOptions(group, 'agent', '', {}))).toEqual(['@lead', '@qa'])
  })

  test('the levels are the ones /model shows for the model the agent runs now', () => {
    const asModel = modelStepOptions(solo, 'reasoning', '', {
      agent: '@solo',
      provider: 'conn-openai',
      model: 'openai/gpt',
    })
    expect(effortStepOptions(solo, 'reasoning', '', {})).toEqual(asModel)
    expect(values(asModel)).toEqual(['off', 'minimal', 'low', 'medium', 'high'])
    expect(asModel.find((row) => row.value === 'high')?.description).toContain('current')
  })

  test('in a group the levels follow the chosen agent’s model', () => {
    expect(values(effortStepOptions(group, 'reasoning', '', { agent: '@qa' }))).toEqual([
      'low',
      'medium',
      'high',
      'max',
    ])
  })
})

describe('/effort — Enter', () => {
  test('applies the level to the agent’s own model through /model’s plan', () => {
    expect(resolveEffortCommand(solo, 'low', EFFORT_ARGS)).toEqual({
      plan: {
        kind: 'agent',
        agentId: 'id-solo',
        connectionId: 'conn-openai',
        modelId: 'openai/gpt',
        providerId: 'openai',
        reasoningEffort: 'low',
        settings: {},
      },
    })
    expect(resolveEffortCommand(group, '@qa max', EFFORT_ARGS)).toMatchObject({
      plan: { agentId: 'id-qa', modelId: 'anthropic/opus', reasoningEffort: 'max' },
    })
  })

  test('says what is missing instead of guessing', () => {
    expect(resolveEffortCommand(solo, '', EFFORT_ARGS)).toEqual({
      error: 'Pick a reasoning level.',
    })
    expect(resolveEffortCommand(group, 'high', EFFORT_ARGS)).toEqual({
      error: 'Pick an agent first.',
    })
    expect(resolveEffortCommand(solo, 'max', EFFORT_ARGS)).toEqual({
      error: 'GPT does not offer the level “max”.',
    })
    expect(
      resolveEffortCommand(context([member('p', 'openai/plain')]), 'high', EFFORT_ARGS),
    ).toEqual({ error: 'PLAIN does not offer reasoning levels.' })
  })
})
