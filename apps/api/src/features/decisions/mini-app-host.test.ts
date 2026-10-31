import { describe, expect, test } from 'bun:test'
import type { DecisionAsk, DecisionOptions } from '@localixai/mini-app-sdk/backend'
import { createMiniAppDecisionHost } from './mini-app-host'
import type { DecisionService } from './service'

const ask: DecisionAsk = {
  state: { title: 'Pricing' },
  questions: { done: { type: 'bool', instructions: 'Done?', criteria: { true: 'y', false: 'n' } } },
}

function host(authorize: (userId: string, sessionId: string) => Promise<unknown>) {
  const calls: DecisionOptions[] = []
  const service: DecisionService = {
    available: async () => ({ model: 'jev' }),
    decide: async (_userId, _ask, options) => {
      calls.push(options)
      return { status: 'answered', model: 'jev', ms: 1, answers: {} }
    },
  }
  return { decisions: createMiniAppDecisionHost(service, 'fixture-board', authorize), calls }
}

describe('host.decisions for a mini app', () => {
  test('names the mini app in the purpose and bills the decision row', async () => {
    const { decisions, calls } = host(async () => '/cwd')
    await decisions.decide('u1', ask, { purpose: 'triage', sessionId: 's1' })
    expect(calls).toEqual([
      expect.objectContaining({
        purpose: 'mini-app:fixture-board:triage',
        sessionId: 's1',
      }),
    ])
  })

  test('refuses a session the user does not own, before anything is asked', async () => {
    const { decisions, calls } = host(async () => {
      throw new Error('session not found')
    })
    await expect(
      decisions.decide('u1', ask, { purpose: 'triage', sessionId: 'other' }),
    ).rejects.toThrow('session not found')
    expect(calls).toEqual([])
  })

  test('refuses a malformed purpose', async () => {
    const { decisions } = host(async () => '/cwd')
    await expect(
      decisions.decide('u1', ask, { purpose: 'Plugin:other', sessionId: 's1' }),
    ).rejects.toThrow('invalid decision purpose')
  })
})
