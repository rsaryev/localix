import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type {
  MiniAppContext,
  MiniAppRouteScope,
  MiniAppWakeRequest,
} from '@localixai/mini-app-sdk/backend'

import { gameSchema } from '../shared/game'
import { parseSquares, squareAt } from '../shared/notation'
import { gameUri } from '../shared/resource'
import { createGameService } from './game-service'
import { register } from './index'
import { createGameRoutes } from './routes'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
/** Session storage over a temp folder, as the host's `sessionStorage.resolveDataDir`. */
function storage() {
  const root = mkdtempSync(join(tmpdir(), 'checkers-routes-'))
  roots.push(root)
  return {
    resolveDataDir: async (_userId: string, sessionId: string) => {
      const dir = join(root, sessionId)
      mkdirSync(dir, { recursive: true })
      return dir
    },
  }
}

const OPEN = parseSquares('c3-d4')

/** The routes over fresh storage, called the way the host calls them: the scope as `c.env`. */
function routes(sessionId: string | null = 's1') {
  const woke: MiniAppWakeRequest[] = []
  const { resolveDataDir } = storage()
  const app = createGameRoutes(
    createGameService({
      resolveDir: resolveDataDir,
      wake: async (request: MiniAppWakeRequest) => {
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

describe('the view’s routes', () => {
  test('a move answers with the new game and wakes the chat the board belongs to', async () => {
    const { post, woke } = routes()
    const response = await post('/game/move', { squares: OPEN })
    expect(response.status).toBe(200)
    expect(gameSchema.parse(await response.json()).board[squareAt('d4')!]).toEqual({
      side: 'white',
      king: false,
    })
    expect(woke.map((request) => request.sessionId)).toEqual(['s1'])
  })

  test('without a verified chat there is no table: refused before any game is touched', async () => {
    const { post, app, scope } = routes(null)
    expect((await post('/game/move', { squares: OPEN })).status).toBe(404)
    expect((await app.request('/game', {}, scope)).status).toBe(404)
  })

  test('a body that did not arrive as JSON never moves a piece', async () => {
    const { post, app, scope } = routes()
    expect((await post('/game/move', { squares: OPEN }, 'text/plain')).status).toBe(400)
    const game = gameSchema.parse(await (await app.request('/game', {}, scope)).json())
    expect(game.moves).toEqual([])
  })

  test('the opponent route switches who plays the other colour, and refuses one it does not know', async () => {
    const { post, woke } = routes()
    const response = await post('/game/opponent', { opponent: 'decision' })
    expect(response.status).toBe(200)
    expect(gameSchema.parse(await response.json()).opponent).toBe('decision')
    expect((await post('/game/opponent', { opponent: 'someone' })).status).toBe(400)
    expect(woke).toEqual([])
  })

  test('a refused move answers 409 with the rules’ own sentence', async () => {
    const { post } = routes()
    await post('/game/move', { squares: OPEN })
    const response = await post('/game/move', { squares: parseSquares('e3-f4') })
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('Wait for the agent’s move.')
  })
})

describe('the agent’s tools', () => {
  function tools() {
    const sessionStorage = storage()
    const ctx = {
      userId: 'u1',
      z,
      sessionStorage,
      defineTool: (tool: unknown) => tool,
      ui: { offer: (destination: unknown) => ({ offer: destination }) },
    } as unknown as MiniAppContext
    const registered = register(ctx).tools ?? []
    /**
     * One `action` of the mini app's one tool, called as a run in `session` would: the host names
     * the session in the context.
     */
    const act = async (action: string, input: object, session: string | null = 's1') => {
      const tool = registered.find((candidate) => candidate.name === 'checkers')!
      const context = session ? { session: { id: session } } : {}
      return tool.execute(
        'call-1',
        (action === 'batch' ? input : { action, ...input }) as never,
        undefined,
        undefined,
        context as never,
      ) as Promise<{
        content: string
        isError?: boolean
        terminate?: boolean
        details?: unknown
      }>
    }
    return { act, registered, sessionStorage }
  }

  test('the mini app gives the agent ONE tool, every action behind it', () => {
    expect(tools().registered.map((tool) => tool.name)).toEqual(['checkers'])
  })

  test('a move that answers the board’s wake ends the turn — the board shows it', async () => {
    const { act, sessionStorage } = tools()
    await createGameService({
      resolveDir: sessionStorage.resolveDataDir,
      wake: async () => ({ status: 'delivered' }),
    }).personMove({ userId: 'u1', sessionId: 's1' }, OPEN)

    const result = await act('move', { move: 'f6-e5' })

    expect(result.isError).toBeFalsy()
    expect(result.terminate).toBe(true)
    expect(result.content).toContain('You played f6-e5.')
  })

  test('a move the user asked for in chat keeps the reply', async () => {
    const { act } = tools()
    await act('new_game', { userPlays: 'black' })
    const result = await act('move', { move: 'c3-d4' })
    expect(result.terminate).toBeUndefined()
  })

  // The skill's own example, with the user to move first: it failed whole and lost the board link.
  test('a batch stops after a new game the user opens, and keeps what it did', async () => {
    const { act } = tools()
    const result = await act('batch', {
      actions: [
        { action: 'new_game', userPlays: 'white' },
        { action: 'move', move: '9-13' },
      ],
    })
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('1 of 2 actions completed.')
    expect(result.details).toBeDefined()
  })

  test('a batch stops when the agent move passes the turn to the user', async () => {
    const { act } = tools()
    const result = await act('batch', {
      actions: [
        { action: 'new_game', userPlays: 'black' },
        { action: 'move', move: 'c3-d4' },
        { action: 'move', move: 'a3-b4' },
      ],
    })
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('2 of 3 actions completed.')
    expect(result.details).toBeDefined()
    expect((await act('state', {})).content).toContain('You played c3-d4.')
  })

  test('a move out of turn is refused with the board as it is now, and never ends the turn', async () => {
    const { act } = tools()
    const result = await act('move', { move: 'f6-e5' })
    expect(result.isError).toBe(true)
    expect(result.terminate).toBeUndefined()
    expect(result.content).toContain('It is the user’s turn (white).')
    expect(result.content).toContain('   a b c d e f g h')
  })

  test('an illegal move is refused with the legal ones', async () => {
    const { act } = tools()
    await act('new_game', { userPlays: 'black' })
    const result = await act('move', { move: 'c3-c4' })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('That is not a legal move. Legal moves: a3-b4')
  })

  test('each chat’s agent plays its own board, and a call outside a chat plays none', async () => {
    const { act } = tools()
    await act('new_game', { userPlays: 'black' }, 's1')
    await act('move', { move: 'c3-d4' }, 's1')
    // s1's board has the agent's opening move; s2's is still the untouched opening.
    expect((await act('state', {}, 's1')).content).toContain('You played c3-d4.')
    expect((await act('state', {}, 's2')).content).not.toContain('You played')
    const outside = await act('state', {}, null)
    expect(outside.isError).toBe(true)
    expect(outside.content).toContain('played in a chat')
  })

  test('the agent can resign: the user wins, and the result asks for one line', async () => {
    const { act } = tools()
    const result = await act('resign', { reason: 'down four pieces' })
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('You resigned — down four pieces. The user won.')
    expect((await act('state', {}, 's1')).content).toContain('you resigned')
    expect((await act('resign', {})).isError).toBe(true)
  })

  test('a new game opens the board of the chat the tool ran in', async () => {
    const { act } = tools()
    const result = await act('new_game', { userPlays: 'black' }, 's7')
    expect(result.content).toContain('You play white and move first')
    expect(result.details).toEqual({ offer: expect.objectContaining({ uri: gameUri('s7') }) })
  })
})
