import { describe, expect, test } from 'bun:test'

import {
  choiceFor,
  emptyModelChoices,
  parseModelChoices,
  recordModelChoices,
} from './session-model-choices'

const high = { providerConnectionId: 'c', modelId: 'm/high', reasoningEffort: 'high' as const }
const AT = '2026-10-17T00:00:00.000Z'
const own = { providerConnectionId: null, modelId: 'm/own', reasoningEffort: 'low' as const }

describe('session model choices', () => {
  test('a joiner takes the session’s entry for it, else nothing', () => {
    const choices = { agents: { picked: own } }
    expect(choiceFor(choices, 'picked')).toEqual(own)
    expect(choiceFor(choices, 'later')).toBeNull()
    expect(choiceFor(undefined, 'later')).toBeNull()
  })

  test('malformed storage reads as nothing chosen; a legacy `all` is ignored', () => {
    expect(parseModelChoices('not json')).toEqual(emptyModelChoices())
    expect(parseModelChoices(JSON.stringify({ all: high, agents: { a: 3 } }))).toEqual(
      emptyModelChoices(),
    )
  })

  test('a model without a connection binds afresh; its level carries unless stated', () => {
    const next = recordModelChoices(
      { agents: { a: high } },
      new Map(),
      [{ agentId: 'a', modelId: 'm/next' }],
      AT,
    )
    expect(next.agents.a).toEqual({
      providerConnectionId: null,
      modelId: 'm/next',
      reasoningEffort: 'high',
    })
    expect(next.chosenAt).toEqual({ a: AT })
  })

  test('a seat is the base for a level-only choice; with nothing to land on it is dropped', () => {
    const seats = new Map([['a', own]])
    const next = recordModelChoices(
      emptyModelChoices(),
      seats,
      [
        { agentId: 'a', reasoningEffort: 'max' },
        { agentId: 'b', reasoningEffort: 'minimal' },
      ],
      AT,
    )
    expect(next.agents).toEqual({ a: { ...own, reasoningEffort: 'max' } })
    expect(parseModelChoices(JSON.stringify(next))).toEqual(next)
  })
})
