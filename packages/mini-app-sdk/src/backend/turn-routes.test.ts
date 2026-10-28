import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { ChatRef } from './agent-turn'
import type { MiniAppRouteContext, MiniAppRouteScope } from './http'
import { chatAnswer } from './turn-routes'

class MoveRefused extends Error {}

/** One route over `action`, called the way the host calls it: the scope as `c.env`. */
function call(
  action: (chat: ChatRef) => Promise<{ secret: string; shown: string }>,
  sessionId?: string,
) {
  const answer = chatAnswer({
    missing: { code: 'no_table', message: 'This board belongs to a chat that is not available.' },
    refused: { error: MoveRefused, code: 'move_refused' },
    view: (game: { secret: string; shown: string }) => ({ shown: game.shown }),
  })
  const app = new Hono<MiniAppRouteContext>().post('/game', (c) => answer(c, action))
  const scope: MiniAppRouteScope = {
    userId: 'u1',
    ...(sessionId ? { sessionId } : {}),
    projectId: '',
    cwd: '/',
  }
  return app.request('/game', { method: 'POST' }, scope)
}

describe('a chat answer', () => {
  test('acts for the verified chat and answers with the view of the new game', async () => {
    const chats: ChatRef[] = []
    const response = await call(async (chat) => {
      chats.push(chat)
      return { secret: 'fleet', shown: 'board' }
    }, 's1')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ shown: 'board' })
    expect(chats).toEqual([{ userId: 'u1', sessionId: 's1' }])
  })

  test('without a verified chat there is no table, and nothing is touched', async () => {
    let touched = false
    const response = await call(async () => {
      touched = true
      return { secret: '', shown: '' }
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'no_table', message: 'This board belongs to a chat that is not available.' },
    })
    expect(touched).toBe(false)
  })

  test('the rules’ refusal answers 409 with their sentence; anything else is unavailable', async () => {
    const refused = await call(async () => {
      throw new MoveRefused('Ke2 is not a legal move here.')
    }, 's1')
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({
      error: { code: 'move_refused', message: 'Ke2 is not a legal move here.' },
    })
    const failed = await call(async () => {
      throw new Error('disk full')
    }, 's1')
    expect(failed.status).toBe(503)
    expect(await failed.json()).toEqual({
      error: { code: 'game_unavailable', message: 'The game could not be saved. Try again.' },
    })
  })
})
