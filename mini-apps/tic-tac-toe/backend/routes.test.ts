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
  const root = mkdtempSync(join(tmpdir(), 'tic-tac-toe-routes-'))
  roots.push(root)
  return {
    resolveDataDir: async (_userId: string, sessionId: string) => {
      const dir = join(root, sessionId)
      mkdirSync(dir, { recursive: true })
      return dir
    },
  }
}

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
    const response = await post('/game/move', { cell: 4 })
    expect(response.status).toBe(200)
    expect(gameSchema.parse(await response.json()).board[4]).toBe('X')
    expect(woke.map((request) => request.sessionId)).toEqual(['s1'])
  })

  test('without a verified chat there is no table: refused before any game is touched', async () => {
    const { post, app, scope } = routes(null)
    expect((await post('/game/move', { cell: 4 })).status).toBe(404)
    expect((await app.request('/game', {}, scope)).status).toBe(404)
  })

  test('a body that did not arrive as JSON never moves a piece', async () => {
    const { post, app, scope } = routes()
    expect((await post('/game/move', { cell: 4 }, 'text/plain')).status).toBe(400)
    const game = gameSchema.parse(await (await app.request('/game', {}, scope)).json())
    expect(game.moves).toEqual([])
  })

  test('the opponent route switches who plays O, and refuses an opponent it does not know', async () => {
    const { post, woke } = routes()
    const response = await post('/game/opponent', { opponent: 'decision' })
    expect(response.status).toBe(200)
    expect(gameSchema.parse(await response.json()).opponent).toBe('decision')
    expect((await post('/game/opponent', { opponent: 'someone' })).status).toBe(400)
    expect(woke).toEqual([])
  })

  test('a refused move answers 409 with the rules’ own sentence', async () => {
    const { post } = routes()
    await post('/game/move', { cell: 4 })
    const response = await post('/game/move', { cell: 0 })
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
      const tool = registered.find((candidate) => candidate.name === 'tic_tac_toe')!
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
    expect(tools().registered.map((tool) => tool.name)).toEqual(['tic_tac_toe'])
  })

  test('a move without the cell is refused with the board, not played', async () => {
    const { act } = tools()
    await act('new_game', { first: 'agent' })
    const result = await act('move', {})
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Name the cell')
  })

  test('a move that answers the board’s wake ends the turn — the board shows it', async () => {
    const { act, sessionStorage } = tools()
    await createGameService({
      resolveDir: sessionStorage.resolveDataDir,
      wake: async () => ({ status: 'delivered' }),
    }).personMove({ userId: 'u1', sessionId: 's1' }, 4)

    const result = await act('move', { cell: 1 })

    expect(result.isError).toBeFalsy()
    expect(result.terminate).toBe(true)
    expect(result.content).toContain('You played O in the top left (cell 1).')
  })

  test('a move the user asked for in chat keeps the reply', async () => {
    const { act } = tools()
    await act('new_game', { first: 'agent' })
    const result = await act('move', { cell: 5 })
    expect(result.terminate).toBeUndefined()
  })

  // The skill's own example, with the user to move first: it failed whole and lost the board link.
  test('a batch stops after a new game the user opens, and keeps what it did', async () => {
    const { act } = tools()
    const result = await act('batch', {
      actions: [{ action: 'new_game' }, { action: 'move', cell: 5 }],
    })
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('1 of 2 actions completed.')
    expect(result.content).toContain('The user moves first')
    expect(result.details).toBeDefined()
  })

  test('a later step the board refuses ends the batch without undoing the earlier ones', async () => {
    const { act } = tools()
    await act('new_game', { first: 'agent' })
    await act('move', { cell: 5 })
    const result = await act('batch', {
      actions: [{ action: 'state' }, { action: 'move', cell: 5 }],
    })
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('1 of 2 actions completed. Action 2 was not played:')
  })

  test('a batch opens a game and stops after the agent move passes the turn', async () => {
    const { act } = tools()
    const result = await act('batch', {
      actions: [
        { action: 'new_game', first: 'agent' },
        { action: 'move', cell: 5 },
        { action: 'move', cell: 1 },
      ],
    })
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('2 of 3 actions completed.')
    expect(result.details).toBeDefined()
    expect((await act('state', {})).content).toContain('You played O in the centre (cell 5).')
  })

  test('a move out of turn is refused with the board as it is now, and never ends the turn', async () => {
    const { act } = tools()
    const result = await act('move', { cell: 5 })
    expect(result.isError).toBe(true)
    expect(result.terminate).toBeUndefined()
    expect(result.content).toContain('It is the user’s turn (X).')
    expect(result.content).toContain(' 1 | 2 | 3')
  })

  test('each chat’s agent plays its own board', async () => {
    const { act } = tools()
    await act('new_game', { first: 'agent' }, 's1')
    await act('move', { cell: 5 }, 's1')
    const other = await act('state', {}, 's2')
    expect(other.content).toContain(' 4 | 5 | 6')
  })

  test('a call outside a chat is refused, not played on some board', async () => {
    const { act } = tools()
    const result = await act('state', {}, null)
    expect(result.isError).toBe(true)
    expect(result.content).toContain('played in a chat')
  })

  test('a new game opens the board of the chat the tool ran in', async () => {
    const { act } = tools()
    const result = await act('new_game', { first: 'agent' }, 's7')
    expect(result.content).toContain('You move first')
    expect(result.details).toEqual({ offer: expect.objectContaining({ uri: gameUri('s7') }) })
  })
})
