import { describe, expect, test } from 'bun:test'

import { createAskTool } from '../../agent-core/tools/hitl/ask'
import type { SessionRecord } from '../repository'
import { createHitlRegistry } from '../runtime/hitl-registry'
import { createAnswerPendingAsk } from './composer-ask-answer'
import { sendMessage, type TurnEntryContext } from './turn-entry'

const session = {
  id: 's1',
  userId: 'u1',
  sessionKind: 'chat',
  agents: [],
} as unknown as SessionRecord

function harness() {
  const hitlRegistry = createHitlRegistry()
  const published: unknown[] = []
  const answer = createAnswerPendingAsk({
    hitlRegistry,
    streamRegistry: { publish: (_u: string, _s: string, event: unknown) => published.push(event) },
  } as never)
  // The ask tool, blocking on the same controller the registry tracks the card in.
  const ask = () => {
    const result = createAskTool().execute(
      'call-1',
      {
        questions: [{ id: 'db', question: 'Which database?', options: [{ label: 'Postgres' }] }],
      },
      undefined,
      (details) => {
        const request = (details as { request: never }).request
        hitlRegistry.trackRequest('s1', 'm1', 'call-1', 'AskUserQuestion', request, 'u1')
      },
      { humanInLoop: hitlRegistry.controller },
    )
    return result
  }
  return { hitlRegistry, published, answer, ask }
}

describe('a line typed while an ask card is open', () => {
  test('answers the card as a free-form answer and resolves it everywhere', async () => {
    const h = harness()
    const result = h.ask()
    expect(h.answer('u1', 's1', '  SQLite, it is a desktop app  ')).toBe(true)
    expect(await result).toMatchObject({
      content:
        'User answers:\ndb: SQLite, it is a desktop app\nContinue the task with these answers.',
    })
    expect(h.hitlRegistry.listPendingInteractions('s1')).toHaveLength(0)
    expect(h.published).toEqual([
      { type: 'hitl.resolved', sessionId: 's1', requestId: 'call-1', reason: 'answered' },
    ])
  })

  test('is an ordinary message when no ask is open, or for another user', () => {
    const h = harness()
    expect(h.answer('u1', 's1', 'hello')).toBe(false)
    void h.ask()
    expect(h.answer('intruder', 's1', 'hello')).toBe(false)
    expect(h.answer('u1', 's1', '   ')).toBe(false)
    expect(h.hitlRegistry.listPendingInteractions('s1')).toHaveLength(1)
  })

  test('sendMessage neither starts nor queues a turn for the answer', async () => {
    const started: string[] = []
    const answered: string[] = []
    const ctx = {
      deps: {},
      commandCtx: {},
      requireSession: async () => session,
      withSessionMutationLock: (_id: string, fn: () => Promise<unknown>) => fn(),
      runner: {
        isBusy: () => true,
        wake: async () => void started.push('queued'),
      },
      runAgent: async () => void started.push('run'),
      answerPendingAsk: (_u: string, _s: string, text: string) => {
        answered.push(text)
        return true
      },
    } as unknown as TurnEntryContext
    const res = await sendMessage(ctx, 'u1', 's1', 'SQLite')
    expect(res).toEqual({ sessionId: 's1', messageId: '', answeredInteraction: true })
    expect(answered).toEqual(['SQLite'])
    expect(started).toEqual([])
  })
})
