import { describe, expect, test } from 'bun:test'
import type { ReasoningEffort } from '../../../model/reasoning'
import type { ParticipantRow } from './ModelTaskColumn'
import { isAllChosen, partyStatusText, summarizeParty } from './partyRoute'
import { modelPickDestination, workloadKey } from './pickerTarget'

const member = (
  agentId: string,
  modelId: string,
  reasoningEffort: ReasoningEffort = 'medium',
  providerConnectionId: string | null = 'conn',
): ParticipantRow => ({
  agentId,
  handle: agentId,
  route: { providerConnectionId, modelId, reasoningEffort },
})

describe('summarizeParty — what the "All agents" row says', () => {
  test('a room on different models says how it differs', () => {
    const summary = summarizeParty(
      [
        member('localix', 'openai/gpt-6.1-sol', 'high'),
        member('frontend', 'openrouter/anthropic/claude-haiku-5.5', 'low'),
        member('qa', 'openrouter/anthropic/claude-haiku-5.5', 'low'),
      ],
      null,
    )
    expect(summary).toMatchObject({ models: 2, levels: 2, unset: 0, slot: null })
    expect(partyStatusText(summary, null)).toBe('Mixed · 2 models · 2 levels')
  })

  test('one model at different levels: the shared model is the target', () => {
    const summary = summarizeParty([member('a', 'm', 'high'), member('b', 'm', 'low')], null)
    expect(summary.slot).toEqual({ providerConnectionId: 'conn', modelId: 'm' })
    expect(partyStatusText(summary, 'Model M')).toBe('Mixed · Model M · 2 levels')
  })

  test('a member without a model is reported as not set', () => {
    const summary = summarizeParty([member('a', 'm'), member('b', '')], null)
    expect(summary).toMatchObject({ unset: 1, slot: null })
    expect(partyStatusText(summary, 'Model M')).toBe('Mixed · Model M · Medium · 1 not set')
    expect(partyStatusText(summarizeParty([member('a', ''), member('b', '')], null), null)).toBe(
      'Not set',
    )
  })

  test('a model that no longer resolves is counted even when everyone shares it', () => {
    const summary = summarizeParty([member('a', 'm'), member('b', 'm')], null, () => false)
    expect(summary).toMatchObject({ unavailable: 2 })
  })

  test('"All" is chosen exactly when every listed agent is on one model and level', () => {
    const agreeing = summarizeParty([member('a', 'm', 'high'), member('b', 'm', 'high')], null)
    expect(agreeing.slot).toEqual({
      providerConnectionId: 'conn',
      modelId: 'm',
      reasoningEffort: 'high',
    })
    expect(isAllChosen(agreeing)).toBe(true)
    // Same model, different levels: not "All".
    expect(
      isAllChosen(summarizeParty([member('a', 'm', 'high'), member('b', 'm', 'low')], null)),
    ).toBe(false)
    // One agent picked on its own: the others keep theirs, and "All" is no longer the choice.
    const overridden = summarizeParty([member('a', 'm', 'high'), member('b', 'n', 'high')], null)
    expect(isAllChosen(overridden)).toBe(false)
    // A single agent can be "All" too.
    expect(isAllChosen(summarizeParty([member('a', 'm', 'high')], null))).toBe(true)
  })

  test('the room target writes the conversation, never a global workload', () => {
    expect(modelPickDestination('party')).toEqual({ kind: 'party' })
    expect(workloadKey('party')).toBeNull()
  })
})
