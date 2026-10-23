import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MiniAppRouteScope } from '@localixai/mini-app-sdk/backend'

import { gameSchema, replay } from '../shared/game'
import { createGameService } from './game-service'
import { createGameRoutes } from './routes'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function routes(sessionId: string | null = 's1') {
  const root = mkdtempSync(join(tmpdir(), 'snake-routes-'))
  roots.push(root)
  const app = createGameRoutes(
    createGameService({
      resolveDir: async (_userId, id) => {
        const dir = join(root, id)
        mkdirSync(dir, { recursive: true })
        return dir
      },
      newSeed: () => 5,
      newId: () => 'g1',
      now: () => '2026-10-20T10:00:00.000Z',
      paceMs: 0,
    }),
  )
  const scope: MiniAppRouteScope = {
    userId: 'u1',
    ...(sessionId ? { sessionId } : {}),
    projectId: '',
    cwd: '/',
  }
  const post = (path: string, body: unknown) =>
    app.request(
      path,
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      },
      scope,
    )
  const get = () => app.request('/game', {}, scope)
  return { post, get }
}

describe('the view’s routes', () => {
  test('saved headings are replayed from the stored board to the board the view showed', async () => {
    const { post, get } = routes()
    const stored = gameSchema.parse(await (await get()).json())
    const headings = ['right', 'right', 'down', 'down'] as const
    const response = await post('/game/turns', { fromTick: 0, headings })
    expect(response.status).toBe(200)
    expect(gameSchema.parse(await response.json())).toEqual(replay(stored, headings))
  })

  test('headings from a tick the board has moved past are refused, not played twice', async () => {
    const { post } = routes()
    await post('/game/turns', { fromTick: 0, headings: ['right'] })
    expect((await post('/game/turns', { fromTick: 0, headings: ['right'] })).status).toBe(409)
  })

  test('without a verified chat there is no board', async () => {
    expect((await routes(null).get()).status).toBe(404)
  })

  test('the mode route hands the board over, and refuses a player it does not know', async () => {
    const { post } = routes()
    expect((await post('/game/mode', { mode: 'agent' })).status).toBe(400)
    const handed = gameSchema.parse(await (await post('/game/mode', { mode: 'model' })).json())
    expect(handed.mode).toBe('model')
  })

  test('a new game starts a fresh board', async () => {
    const { post } = routes()
    await post('/game/turns', { fromTick: 0, headings: ['right', 'right'] })
    const game = gameSchema.parse(await (await post('/game/new', { mode: 'user' })).json())
    expect(game.tick).toBe(0)
  })
})
