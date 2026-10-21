import { expect, test } from 'bun:test'
import type { Message } from '@/shared/api/contracts'
import { createParticipantContextSelector } from './participantContextUsage'

test('each participant uses its own latest context and window without borrowing another author', () => {
  const messages = [
    {
      id: 'a',
      role: 'assistant',
      from: 'agent:a',
      usage: { contextTokens: 200, totalTokens: 250 },
    },
    {
      id: 'b',
      role: 'assistant',
      from: 'agent:b',
      usage: { contextTokens: 900, totalTokens: 950 },
    },
  ] as Message[]
  const select = createParticipantContextSelector('a', 1000)
  const view = select(messages)
  expect(view.percentLabel).toBe('20%')
  expect(createParticipantContextSelector('b', 2000)(messages).percentLabel).toBe('45%')
  expect(createParticipantContextSelector('missing', 1000)(messages).percentLabel).toBe('—')
  expect(select(messages.map((message) => ({ ...message, content: 'streaming' })))).toBe(view)
})

test('a newer failed attempt replaces old success and retains an explicitly estimated context', () => {
  const messages = [
    {
      id: 'old',
      role: 'assistant',
      from: 'agent:a',
      usage: { contextTokens: 200, totalTokens: 250 },
    },
    {
      id: 'new',
      role: 'assistant',
      from: 'agent:a',
      dataParts: [
        {
          type: 'data-context-attempt',
          data: {
            outcome: 'failed',
            stage: 'preflight',
            tokenKind: 'estimated',
            contextTokens: 600,
          },
        },
        { type: 'data-context-window', data: { ceilingTokens: 500, fullWindowTokens: 1000 } },
      ],
    },
  ] as Message[]
  const view = createParticipantContextSelector('a')(messages)
  expect(view.percentLabel).toBe('120%')
  expect(view.attempt?.outcome).toBe('failed')
  expect(view.attempt?.tokenKind).toBe('estimated')
  expect(view.fraction).toBe(1)
})
