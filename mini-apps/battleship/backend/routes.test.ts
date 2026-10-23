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

import { playerViewSchema } from '../shared/game'
import { gameUri } from '../shared/resource'
import { cellName, neighbours } from '../shared/rules'
import { createGameService } from './game-service'
import { register } from './index'
import { createGameRoutes } from './routes'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
/** Session storage over a temp folder, as the host's `sessionStorage.resolveDataDir`. */
function storage() {
  const root = mkdtempSync(join(tmpdir(), 'battleship-routes-'))
  roots.push(root)
  return {
    resolveDataDir: async (_userId: string, sessionId: string) => {
      const dir = join(root, sessionId)
      mkdirSync(dir, { recursive: true })
      return dir
    },
  }
}

function routes(sessionId: string | null = 's1') {
  const woke: MiniAppWakeRequest[] = []
  const { resolveDataDir } = storage()
  const games = createGameService({
    resolveDir: resolveDataDir,
    wake: async (request: MiniAppWakeRequest) => {
      woke.push(request)
      return { status: 'delivered' as const }
    },
  })
  const app = createGameRoutes(games)
  // The host puts a session here only once it checked the user owns it.
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
  return { games, woke, post, get }
}

describe('the view’s routes', () => {
  test('the board answers with the person’s view: their fleet, never the agent’s', async () => {
    const { get, games } = routes()
    const body = await (await get()).json()
    const view = playerViewSchema.parse(body)
    const whole = await games.read({ userId: 'u1', sessionId: 's1' })
    expect(view.fleet).toEqual(whole.fleets.you)
    expect(view.enemySeen).toEqual([])
    expect(JSON.stringify(body)).not.toContain('fleets')
  })

  test('without a verified chat there is no table: refused before any game is touched', async () => {
    const { get, post } = routes(null)
    expect((await get()).status).toBe(404)
    expect((await post('/game/fire', { cell: 0 })).status).toBe(404)
  })

  test('the opponent route switches who fires from the agent’s side, and refuses one it does not know', async () => {
    const { post, woke } = routes()
    const response = await post('/game/opponent', { opponent: 'decision' })
    expect(response.status).toBe(200)
    expect(playerViewSchema.parse(await response.json()).opponent).toBe('decision')
    expect((await post('/game/opponent', { opponent: 'someone' })).status).toBe(400)
    expect(woke).toEqual([])
  })

  test('a refused shot answers 409 with the rules’ own sentence', async () => {
    const { post } = routes()
    await post('/game/fire', { cell: 0 })
    const again = await post('/game/fire', { cell: 0 })
    // Either it was a miss (the agent's turn now) or a hit (A1 is known): both are refusals.
    expect(again.status).toBe(409)
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
      const tool = registered.find((candidate) => candidate.name === 'battleship')!
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
    const games = createGameService({ resolveDir: sessionStorage.resolveDataDir })
    return { act, games, registered }
  }

  test('the mini app gives the agent ONE tool, every action behind it', () => {
    expect(tools().registered.map((tool) => tool.name)).toEqual(['battleship'])
  })

  test('the state shows the agent its own fleet, and nothing of the user’s', async () => {
    const { act, games } = tools()
    const result = await act('state', {})
    const whole = await games.read({ userId: 'u1', sessionId: 's1' })
    const [target, own] = result.content.split('Your own fleet')
    const gridRows = (text: string) =>
      text
        .split('\n')
        .filter((line) => /^\s?\d+ /.test(line))
        .map((line) => line.slice(3))
    // The user's board is all unknown before the agent fires; its own board shows its ships.
    expect(gridRows(target!).join('')).toMatch(/^[. ]+$/)
    expect(gridRows(own!).join('')).toContain('S')
    for (const cell of whole.fleets.you.flatMap((ship) => ship.cells))
      expect(result.content).not.toContain(cellName(cell))
  })

  test('a shot out of turn is refused and never ends the turn', async () => {
    const { act } = tools()
    const result = await act('fire', { cell: 'E5' })
    expect(result.isError).toBe(true)
    expect(result.terminate).toBeUndefined()
    expect(result.content).toContain('It is the user’s turn.')
  })

  test('a hit asks for another shot and keeps the turn; a miss that answers the wake ends it', async () => {
    const { act, games } = tools()
    await act('new_game', { first: 'agent' })
    const whole = await games.read({ userId: 'u1', sessionId: 's1' })
    // The four-cell ship: one hit leaves it afloat, so the result names where to aim next.
    const ship = whole.fleets.you[0]!.cells[0]!
    const hit = await act('fire', { cell: cellName(ship) })
    expect(hit.terminate).toBeUndefined()
    expect(hit.content).toContain('fire again now, beside the hit —')
  })

  test('a batch keeps firing after a hit and stops after a miss', async () => {
    const { act, games } = tools()
    await act('new_game', { first: 'agent' })
    const whole = await games.read({ userId: 'u1', sessionId: 's1' })
    const hit = cellName(whole.fleets.you[0]!.cells[0]!)
    const occupied = new Set(whole.fleets.you.flatMap((ship) => ship.cells))
    const missIndex = Array.from({ length: 100 }, (_, index) => index).find(
      (index) => !occupied.has(index),
    )!
    const result = await act('batch', {
      actions: [
        { action: 'fire', cell: hit },
        { action: 'fire', cell: cellName(missIndex) },
        { action: 'fire', cell: 'J10' },
      ],
    })
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('2 of 3 actions completed.')
    expect((await games.read({ userId: 'u1', sessionId: 's1' })).shots).toHaveLength(2)
  })

  // A sinking shot makes the ship's border known water, so the next planned cell there is refused:
  // that failed the whole call and dropped the sink from the report.
  test('a shot planned beside a ship the batch sank ends the batch, and the sink stands', async () => {
    const { act, games } = tools()
    await act('new_game', { first: 'agent' })
    const whole = await games.read({ userId: 'u1', sessionId: 's1' })
    const single = whole.fleets.you.find((ship) => ship.cells.length === 1)!
    const beside = neighbours(single.cells[0]!)[0]!
    const result = await act('batch', {
      actions: [
        { action: 'fire', cell: cellName(single.cells[0]!) },
        { action: 'fire', cell: cellName(beside) },
      ],
    })
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('1 of 2 actions completed. Action 2 was not played:')
    expect(result.content).toContain('already known')
    expect((await games.read({ userId: 'u1', sessionId: 's1' })).shots).toHaveLength(1)
  })

  test('a batch stops after a new game the user opens', async () => {
    const { act } = tools()
    const result = await act('batch', {
      actions: [{ action: 'new_game' }, { action: 'fire', cell: 'A1' }],
    })
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('1 of 2 actions completed.')
    expect(result.details).toBeDefined()
  })

  test('a call outside a chat is refused, and a new game opens the board of the tool’s chat', async () => {
    const { act } = tools()
    expect((await act('state', {}, null)).content).toContain('played in a chat')
    const opened = await act('new_game', { first: 'user' }, 's7')
    expect(opened.details).toEqual({ offer: expect.objectContaining({ uri: gameUri('s7') }) })
  })
})
