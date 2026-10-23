import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type {
  MiniAppContext,
  MiniAppRouteScope,
  MiniAppWakeRequest,
} from '@localixai/mini-app-sdk/backend'

import { gameSchema, newGame, type Game } from '../shared/game'
import { gameUri } from '../shared/resource'
import { createGameService } from './game-service'
import { register } from './index'
import { createGameRoutes } from './routes'
import { createGameTools } from './tools'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
/** Session storage over a temp folder, as the host's `sessionStorage.resolveDataDir`. */
function storage() {
  const root = mkdtempSync(join(tmpdir(), 'game-2048-routes-'))
  roots.push(root)
  const dirOf = (sessionId: string) => join(root, sessionId)
  return {
    dirOf,
    resolveDataDir: async (_userId: string, sessionId: string) => {
      mkdirSync(dirOf(sessionId), { recursive: true })
      return dirOf(sessionId)
    },
  }
}

describe('the view’s routes', () => {
  function routes(sessionId: string | null = 's1') {
    const woke: MiniAppWakeRequest[] = []
    const app = createGameRoutes(
      createGameService({
        resolveDir: storage().resolveDataDir,
        random: () => 0,
        wake: async (request) => {
          woke.push(request)
          return { status: 'delivered' as const }
        },
      }),
    )
    // The host puts a session here only once it checked the user owns it.
    const scope: MiniAppRouteScope = {
      userId: 'u1',
      ...(sessionId ? { sessionId } : {}),
      projectId: '',
      cwd: '/',
    }
    const post = (path: string, body: unknown, type = 'application/json') =>
      app.request(
        path,
        { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': type } },
        scope,
      )
    return { app, woke, post, scope }
  }

  test('a move answers with the new game, recorded so the view can replay it', async () => {
    const { post, woke } = routes()
    const response = await post('/game/move', { direction: 'right' })
    expect(response.status).toBe(200)
    const game = gameSchema.parse(await response.json())
    expect(game.moves).toBe(1)
    expect(game.lastTurn?.steps.map((step) => step.direction)).toEqual(['right'])
    expect(woke).toHaveLength(0)
  })

  test('handing the board to the agent wakes the chat the board belongs to', async () => {
    const { post, woke } = routes()
    const game = gameSchema.parse(await (await post('/game/mode', { mode: 'agent' })).json())
    expect(game.waiting?.status).toBe('thinking')
    expect(woke.map((request) => request.sessionId)).toEqual(['s1'])
  })

  test('without a verified chat there is no board: refused before any game is touched', async () => {
    const { post, app, scope } = routes(null)
    expect((await post('/game/move', { direction: 'right' })).status).toBe(404)
    expect((await app.request('/game', {}, scope)).status).toBe(404)
  })

  test('a body that did not arrive as JSON never moves a tile', async () => {
    const { post, app, scope } = routes()
    expect((await post('/game/move', { direction: 'right' }, 'text/plain')).status).toBe(400)
    expect(gameSchema.parse(await (await app.request('/game', {}, scope)).json()).moves).toBe(0)
  })

  test('a refused move answers 409 with the rules’ own sentence', async () => {
    const { post } = routes()
    await post('/game/mode', { mode: 'agent' })
    const response = await post('/game/move', { direction: 'right' })
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('The agent controls this board')
  })
})

describe('the agent’s tool', () => {
  type Answer = { content: string; isError?: boolean; details?: unknown }
  function tool() {
    const sessionStorage = storage()
    const ctx = {
      userId: 'u1',
      z,
      sessionStorage,
      defineTool: (definition: unknown) => definition,
      ui: { offer: (destination: unknown) => ({ offer: destination }) },
    } as unknown as MiniAppContext
    const games = createGameService({ resolveDir: sessionStorage.resolveDataDir, random: () => 0 })
    const [game2048] = createGameTools(ctx, games)
    const act = (input: object, session: string | null = 's1') =>
      game2048!.execute(
        'call-1',
        input as never,
        undefined,
        undefined,
        (session ? { session: { id: session } } : {}) as never,
      ) as Promise<Answer>
    /** Put `board` on the chat's table, as a game the agent controls. */
    const seed = (board: number[], session = 's1') => {
      mkdirSync(sessionStorage.dirOf(session), { recursive: true })
      const game: Game = {
        ...newGame({ id: 'g1', mode: 'agent', now: 'then', random: () => 0 }),
        board,
      }
      writeFileSync(join(sessionStorage.dirOf(session), 'game.json'), JSON.stringify(game))
    }
    return { act, seed, ctx, games }
  }
  const lone2 = () => [2, ...Array<number>(15).fill(0)]

  test('the mini app gives the agent ONE tool, and says each call has its own effect', () => {
    const { ctx } = tool()
    const registered = register(ctx).tools ?? []
    expect(registered.map((candidate) => candidate.name)).toEqual(['game_2048'])
    expect(registered[0]!.behaviorHints).toEqual({ idempotentHint: false })
  })

  // Most failed calls were a plan whose Nth move did not change the board.
  test('a plan with no-op moves plays the rest and is not a failure', async () => {
    const { act, seed } = tool()
    seed(lone2())
    const result = await act({ action: 'move', moves: ['left', 'right', 'up', 'left'] })
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain(
      'Played 2 of 4 moves; skipped 2 that would not change the board (left, up).',
    )
    expect(result.content).toContain('Continue: call game_2048')
    expect(result.content).not.toMatch(/pause/iu)
  })

  // Lists alternated two directions and 70–90% of their moves were no-ops.
  test('a preference order plays every move it is given, none skipped', async () => {
    const { act, seed } = tool()
    seed(lone2())
    const result = await act({ action: 'move', prefer: ['down', 'left', 'right', 'up'], count: 6 })
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('Played 6 moves by preference down > left > right > up.')
  })

  test('an order none of whose directions moves the board is the agent’s mistake', async () => {
    const { act, seed } = tool()
    seed(lone2())
    const result = await act({ action: 'move', prefer: ['up', 'left'] })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Directions that move it: down, right.')
  })

  test('a plan named twice, or half of one, is refused rather than guessed', async () => {
    const { act, seed } = tool()
    seed(lone2())
    const both = await act({ action: 'move', moves: ['down'], prefer: ['down'] })
    expect(both.content).toContain('either "moves" or "prefer"')
    const countAlone = await act({ action: 'move', moves: ['down'], count: 3 })
    expect(countAlone.content).toContain('"count" goes with "prefer"')
    const twice = await act({ action: 'move', prefer: ['down', 'down'] })
    expect(twice.content).toContain('each direction in "prefer" once')
  })

  test('a call that played nothing is the agent’s mistake, with the directions that move', async () => {
    const { act, seed } = tool()
    seed(lone2())
    const result = await act({ action: 'move', moves: ['left', 'up'] })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Directions that move it: down, right.')
  })

  // `{action:"right"}` failed validation; a direction is now just a word in a list.
  test('the moves are a plain list of directions', async () => {
    const { ctx, games } = tool()
    const [game2048] = createGameTools(ctx, games)
    const schema = game2048!.inputSchema as z.ZodType
    expect(schema.safeParse({ action: 'move', moves: ['right', 'down'] }).success).toBe(true)
    expect(schema.safeParse({ action: 'move', moves: Array(33).fill('down') }).success).toBe(false)
  })

  test('once the user takes the board back, a move is refused with the board as it is', async () => {
    const { act, games } = tool()
    await act({ action: 'new_game', mode: 'agent' })
    await games.mode({ userId: 'u1', sessionId: 's1' }, 'user')
    const result = await act({ action: 'move', moves: ['right'] })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('The user controls this board')
  })

  test('a game the agent starts for itself can be played in the same call', async () => {
    const { act } = tool()
    const result = await act({ action: 'new_game', mode: 'agent', moves: ['right', 'down'] })
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('Played 2 of 2 moves')
    expect(result.details).toEqual({ offer: expect.objectContaining({ uri: gameUri('s1') }) })
  })

  test('moves for a game the user plays are refused, not dropped', async () => {
    const { act } = tool()
    const result = await act({ action: 'new_game', moves: ['right'] })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('mode "agent"')
  })

  test('the end of a game asks for the result, not for more moves', async () => {
    const { act, seed } = tool()
    seed([0, 2, 4, 8, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 128])
    const result = await act({ action: 'move', moves: ['left', 'right'] })
    expect(result.content).toContain('the game ended before the last 1')
    expect(result.content).toContain('The game is over.')
  })

  test('each chat’s agent plays its own board, and a call outside a chat is refused', async () => {
    const { act } = tool()
    await act({ action: 'new_game', mode: 'agent', moves: ['right'] }, 's1')
    expect((await act({ action: 'state' }, 's2')).content).toContain('0 moves')
    const outside = await act({ action: 'state' }, null)
    expect(outside.isError).toBe(true)
    expect(outside.content).toContain('played in a chat')
  })
})
