import { describe, expect, mock, test } from 'bun:test'

import type { PersistedMessage } from '../../contracts'
import type { ChatRepository } from '../../repository'
import { prepareTurnState } from './prepare-turn-state'
import { DEFAULT_AGENT_PARTICIPANT, USER_PARTICIPANT } from '../../../../db'

const message = (
  id: string,
  createdAt: string,
  timing?: PersistedMessage['payload']['timing'],
): PersistedMessage => ({
  id,
  sessionId: 'session-a',
  userId: 'user-a',
  payload: {
    id,
    role: id.startsWith('assistant') ? 'assistant' : 'user',
    from: id.startsWith('assistant') ? DEFAULT_AGENT_PARTICIPANT : USER_PARTICIPANT,
    content: id,
    ...(timing ? { timing } : {}),
  },
  createdAt,
  updatedAt: createdAt,
})

describe('prepareTurnState', () => {
  test('reuses supplied history and point-reads only the mutable assistant row', async () => {
    const timing = {
      modelMs: 80,
      revealMs: 5,
      toolGenMs: 20,
      waitMs: 10,
      toolMs: 15,
      hitlMs: 0,
      idleMs: 5,
      totalMs: 100,
      turns: 2,
      tools: [],
    }
    const historyMessages = [
      message('assistant-prior', '2026-07-31T10:00:00.000Z', timing),
      message('user-trigger', '2026-07-31T10:00:03.000Z'),
    ]
    const assistant = message('assistant-current', '2026-07-31T10:00:03.000Z')
    assistant.payload.content = 'partial retry output'
    const getMessage = mock(async () => assistant)
    const listMessages = mock(async () => {
      throw new Error('complete transcript must not be queried')
    })
    const repo = { getMessage, listMessages } as unknown as ChatRepository

    const prepared = await prepareTurnState({
      repo,
      userId: 'user-a',
      sessionId: 'session-a',
      agent: DEFAULT_AGENT_PARTICIPANT,
      assistantMessageId: assistant.id,
      historyMessages,
      now: () => 'fallback',
    })

    expect(getMessage).toHaveBeenCalledTimes(1)
    expect(getMessage).toHaveBeenCalledWith('user-a', 'session-a', assistant.id)
    expect(listMessages).not.toHaveBeenCalled()
    expect(prepared.state.currentPayload.content).toBe('partial retry output')
    expect(prepared.state.assistantCreatedAt).toBe(assistant.createdAt)
    expect(prepared.state.baseSessionTiming).toMatchObject({
      modelMs: 80,
      toolMs: 15,
      totalMs: 100,
      turns: 2,
      runs: 1,
    })
    expect(prepared.turnIdleMs).toBe(3_000)
  })
})
