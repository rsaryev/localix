import { expect, test } from 'bun:test'
import { applyStreamEventToSession } from './applyStreamEvent'
import type { AgentStreamEvent, UiSession } from './contracts'

const event = (type: string, message: unknown) =>
  ({ type, sessionId: 's', message }) as AgentStreamEvent
const persisted = (tokens: number) => ({
  id: 'm',
  payload: { id: 'm', role: 'assistant', from: 'agent:a', usage: { totalTokens: tokens } },
})

test('participant totals survive live corrections, duplicate echoes, removals and roster edits', () => {
  let session = {
    id: 's',
    messages: [],
    pendingInteractionQueue: [],
    isRunning: false,
    participantUsage: { former: { totalTokens: 90 }, a: { totalTokens: 50 } },
    sessionUsage: { totalTokens: 140 },
    agents: [],
  } as unknown as UiSession
  session = applyStreamEventToSession(session, event('message.created', persisted(10)))
  expect(session.participantUsage?.a.totalTokens).toBe(60)
  session = applyStreamEventToSession(session, event('message.created', persisted(10)))
  expect(session.participantUsage?.a.totalTokens).toBe(60)
  session = applyStreamEventToSession(session, event('message.updated', persisted(20)))
  expect(session.participantUsage?.a.totalTokens).toBe(70)
  expect(session.participantUsage?.former.totalTokens).toBe(90)
  session = applyStreamEventToSession(session, {
    type: 'message.removed',
    sessionId: 's',
    messageId: 'm',
  })
  expect(session.participantUsage?.a.totalTokens).toBe(50)
  expect(session.sessionUsage?.totalTokens).toBe(140)
})
