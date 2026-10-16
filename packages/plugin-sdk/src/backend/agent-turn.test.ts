import { expect, test } from 'bun:test'

import { askAgentForTurn, type Wake } from './agent-turn'

const seat = { userId: 'me', sessionId: 's1' }
const turn = { message: 'Your move.', tools: ['chess'], key: 'g:3' }

test('a delivered wake shows thinking and carries the seat and turn', async () => {
  const seen: unknown[] = []
  const wake: Wake = async (request) => {
    seen.push(request)
    return { status: 'delivered' }
  }
  expect(await askAgentForTurn(wake, seat, turn, 'T')).toEqual({ since: 'T', status: 'thinking' })
  expect(seen).toEqual([{ userId: 'me', sessionId: 's1', ...turn }])
})

test('an undelivered wake or a load without wake shows why nobody was asked', async () => {
  const refused: Wake = async () => ({ status: 'refused', reason: 'gone' })
  expect(await askAgentForTurn(refused, seat, turn, 'T')).toEqual({
    since: 'T',
    status: 'unreachable',
    reason: 'gone',
  })
  expect((await askAgentForTurn(undefined, seat, turn, 'T')).status).toBe('unreachable')
})
