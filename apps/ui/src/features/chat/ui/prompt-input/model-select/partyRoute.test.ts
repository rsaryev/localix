import { describe, expect, test } from 'bun:test'
import type { ReasoningEffort } from '../../../model/reasoning'
import type { ParticipantRow } from './ModelTaskColumn'
import { partyStatusText, showPartyRow, summarizeParty } from './partyRoute'
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

describe('summarizeParty — when the "All agents" row is offered', () => {
  test('a room on different models is relevant and says how it differs', () => {
    const summary = summarizeParty(
      [
        member('localix', 'openai/gpt-6.1-sol', 'high'),
        member('frontend', 'openrouter/anthropic/claude-haiku-5.5', 'low'),
        member('qa', 'openrouter/anthropic/claude-haiku-5.5', 'low'),
      ],
      null,
    )
    expect(summary).toMatchObject({ models: 2, levels: 2, unset: 0, relevant: true, slot: null })
    expect(partyStatusText(summary, null)).toBe('Mixed · 2 models · 2 levels')
  })

  test('one model at different levels is relevant; the shared model is the target', () => {
    const summary = summarizeParty([member('a', 'm', 'high'), member('b', 'm', 'low')], null)
    expect(summary.relevant).toBe(true)
    expect(summary.slot).toEqual({ providerConnectionId: 'conn', modelId: 'm' })
    expect(partyStatusText(summary, 'Model M')).toBe('Mixed · Model M · 2 levels')
  })

  test('a member without a model is relevant and reported as not set', () => {
    const summary = summarizeParty([member('a', 'm'), member('b', '')], null)
    expect(summary).toMatchObject({ unset: 1, relevant: true, slot: null })
    expect(partyStatusText(summary, 'Model M')).toBe('Mixed · Model M · Medium · 1 not set')
    expect(partyStatusText(summarizeParty([member('a', ''), member('b', '')], null), null)).toBe(
      'Not set',
    )
  })

  test('a model that no longer resolves is relevant even when everyone shares it', () => {
    const summary = summarizeParty([member('a', 'm'), member('b', 'm')], null, () => false)
    expect(summary).toMatchObject({ unavailable: 2, relevant: true })
  })

  test('an agreeing room, and a private chat, are not offered the row', () => {
    const agreeing = summarizeParty([member('a', 'm', 'high'), member('b', 'm', 'high')], null)
    expect(agreeing.relevant).toBe(false)
    expect(agreeing.slot).toEqual({
      providerConnectionId: 'conn',
      modelId: 'm',
      reasoningEffort: 'high',
    })
    expect(showPartyRow(agreeing, false, true)).toBe(false)
    expect(summarizeParty([member('a', '')], null).relevant).toBe(false)
  })

  test('the row stays while it is being configured, and never without a writer', () => {
    const agreeing = summarizeParty([member('a', 'm'), member('b', 'm')], null)
    // Picking a model for everyone makes the room agree; the row must not vanish under the cursor.
    expect(showPartyRow(agreeing, true, true)).toBe(true)
    const mixed = summarizeParty([member('a', 'm'), member('b', 'n')], null)
    expect(showPartyRow(mixed, false, false)).toBe(false)
  })

  test('the room target writes the conversation, never a global workload', () => {
    expect(modelPickDestination('party')).toEqual({ kind: 'party' })
    expect(workloadKey('party')).toBeNull()
  })
})
