import { describe, expect, test } from 'bun:test'
import { resolveCommandSpec } from '@localixai/api/slash-catalog'
import { resolveModelCommand } from './modelCommandPlan'
import { context, member } from './modelCommandFixture'

const MODEL_ARGS = resolveCommandSpec('model')!.args!
const solo = context([member('solo', 'openai/gpt', 'high')])
const group = context([member('lead', 'openai/gpt', 'high'), member('qa', 'anthropic/opus', 'max')])

describe('resolveModelCommand', () => {
  test('a one-agent chat needs no agent token and targets its only member', () => {
    expect(resolveModelCommand(solo, 'conn-anthropic anthropic/opus ', MODEL_ARGS)).toEqual({
      kind: 'agent',
      agentId: 'id-solo',
      connectionId: 'conn-anthropic',
      modelId: 'anthropic/opus',
      providerId: 'anthropic',
      // Another model starts at its default, never the previous model's level.
      reasoningEffort: 'medium',
      settings: {},
    })
  })

  test('re-picking the running model keeps its level, clamped to what it offers', () => {
    const offOnOpus = context([member('solo', 'anthropic/opus', 'off')])
    expect(
      resolveModelCommand(offOnOpus, 'conn-anthropic anthropic/opus', MODEL_ARGS)?.reasoningEffort,
    ).toBe('low')
  })

  test('a remembered level for this agent on the model is where it starts', () => {
    const remembered = context([member('solo', 'openai/gpt')], {
      agentModelSettings: [
        { agentId: 'id-solo', providerId: 'anthropic', modelId: 'anthropic/opus', effort: 'max' },
      ],
    })
    expect(
      resolveModelCommand(remembered, 'conn-anthropic anthropic/opus', MODEL_ARGS)?.reasoningEffort,
    ).toBe('max')
  })

  test('a non-reasoning model stores off, as the picker does', () => {
    expect(resolveModelCommand(solo, 'conn-openai openai/plain', MODEL_ARGS)?.reasoningEffort).toBe(
      'off',
    )
  })

  test('a level the model does not offer is refused, not stored', () => {
    expect(resolveModelCommand(solo, 'conn-anthropic anthropic/opus off', MODEL_ARGS)).toBeNull()
    expect(
      resolveModelCommand(solo, 'conn-anthropic anthropic/opus high', MODEL_ARGS)?.reasoningEffort,
    ).toBe('high')
  })

  test('settings: keep leaves them, default clears them, a value sets them', () => {
    const plan = resolveModelCommand(solo, 'conn-openai openai/gpt low default 600k', MODEL_ARGS)
    expect(plan).toMatchObject({
      kind: 'agent',
      settings: { maxTurns: null, contextLimit: 600_000 },
    })
    expect(
      resolveModelCommand(solo, 'conn-openai openai/gpt low keep full', MODEL_ARGS),
    ).toMatchObject({ settings: { contextLimit: 'full' } })
    expect(
      resolveModelCommand(solo, 'conn-openai openai/gpt low keep auto', MODEL_ARGS),
    ).toMatchObject({ settings: { contextLimit: null } })
    const kept = resolveModelCommand(solo, 'conn-openai openai/gpt low keep keep', MODEL_ARGS)
    expect(kept).toMatchObject({ settings: {} })
  })

  test('a context limit the model does not offer is refused, not stored', () => {
    expect(resolveModelCommand(solo, 'conn-openai openai/gpt low keep 50%', MODEL_ARGS)).toBeNull()
    expect(resolveModelCommand(solo, 'conn-openai openai/gpt low keep 2m', MODEL_ARGS)).toBeNull()
  })

  test('a group names its member, and All agents becomes one batch for the room', () => {
    expect(
      resolveModelCommand(group, '@qa conn-openai openai/gpt minimal', MODEL_ARGS),
    ).toMatchObject({ kind: 'agent', agentId: 'id-qa', reasoningEffort: 'minimal' })
    expect(
      resolveModelCommand(group, 'all conn-anthropic anthropic/opus high', MODEL_ARGS),
    ).toEqual({
      kind: 'party',
      connectionId: 'conn-anthropic',
      modelId: 'anthropic/opus',
      reasoningEffort: 'high',
    })
  })

  test('text that is not a step selection is left to the server (`/model <name>`)', () => {
    expect(resolveModelCommand(solo, 'opus', MODEL_ARGS)).toBeNull()
    expect(resolveModelCommand(group, 'opus', MODEL_ARGS)).toBeNull()
    expect(resolveModelCommand(solo, 'conn-openai no-such-model', MODEL_ARGS)).toBeNull()
  })
})
