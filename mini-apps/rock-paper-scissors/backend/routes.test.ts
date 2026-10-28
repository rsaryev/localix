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
import { verifySealed } from '@localixai/mini-app-sdk/sealed'

import { playerViewSchema } from '../shared/game'
import { gameUri } from '../shared/resource'
import { createGameService } from './game-service'
import { register } from './index'
import { createGameRoutes } from './routes'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function storage() {
  const root = mkdtempSync(join(tmpdir(), 'rock-paper-scissors-routes-'))
  roots.push(root)
  return {
    resolveDataDir: async (_userId: string, sessionId: string) => {
      const dir = join(root, sessionId)
      mkdirSync(dir, { recursive: true })
      return dir
    },
  }
}

const CHAT = { userId: 'u1', sessionId: 's1' }

/** The routes and the agent's tool over the SAME storage, as the host wires them. */
function table(sessionId: string | null = 's1') {
  const woke: MiniAppWakeRequest[] = []
  const sessionStorage = storage()
  const games = createGameService({
    resolveDir: sessionStorage.resolveDataDir,
    wake: async (request: MiniAppWakeRequest) => {
      woke.push(request)
      return { status: 'delivered' as const }
    },
  })
  const app = createGameRoutes(games)
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
  const read = async () => (await app.request('/game', {}, scope)).text()

  const ctx = {
    userId: 'u1',
    z,
    sessionStorage,
    defineTool: (tool: unknown) => tool,
    ui: { offer: (destination: unknown) => ({ offer: destination }) },
  } as unknown as MiniAppContext
  const tool = register(ctx).tools!.find((candidate) => candidate.name === 'rock_paper_scissors')!
  const act = (input: object, session: string | null = 's1') =>
    tool.execute(
      'call-1',
      input as never,
      undefined,
      undefined,
      (session ? { session: { id: session } } : {}) as never,
    ) as Promise<{ content: string; isError?: boolean; terminate?: boolean; details?: unknown }>
  return { app, woke, post, read, scope, act, tool, games }
}

describe('the view’s routes', () => {
  test('a move answers with the person’s view and wakes the chat', async () => {
    const { post, woke } = table()
    const response = await post('/game/play', { move: 'rock' })
    expect(response.status).toBe(200)
    expect(playerViewSchema.parse(await response.json()).round.mine).toBe('rock')
    expect(woke.map((request) => request.sessionId)).toEqual(['s1'])
  })

  test('the agent’s sealed move never crosses the network before the reveal', async () => {
    const { act, read, post, games } = table()
    await act({ action: 'next_round', first: 'agent' })
    await act({ action: 'play', move: 'scissors' })
    const stored = await games.read(CHAT)

    const before = await read()
    expect(before).not.toContain('scissors')
    expect(before).not.toContain(stored.round.agent!.salt)
    expect(before).toContain(stored.round.agent!.digest)

    const after = playerViewSchema.parse(await (await post('/game/play', { move: 'rock' })).json())
    expect(after.round.outcome).toBe('won')
    expect(after.round.theirs).toMatchObject({ revealed: true, value: 'scissors' })
    expect(await verifySealed(after.round.theirs!)).toBe(true)
  })

  test('the opponent route switches who plays the other side, and refuses one it does not know', async () => {
    const { post, woke } = table()
    const response = await post('/game/opponent', { opponent: 'decision' })
    expect(response.status).toBe(200)
    expect(playerViewSchema.parse(await response.json()).opponent).toBe('decision')
    expect((await post('/game/opponent', { opponent: 'someone' })).status).toBe(400)
    expect(woke).toEqual([])
  })

  test('without a verified chat there is no table', async () => {
    const { post, app, scope } = table(null)
    expect((await post('/game/play', { move: 'rock' })).status).toBe(404)
    expect((await app.request('/game', {}, scope)).status).toBe(404)
  })

  test('a move out of turn answers 409 with the rules’ own sentence', async () => {
    const { post, act } = table()
    await act({ action: 'next_round', first: 'agent' })
    const response = await post('/game/play', { move: 'rock' })
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('Wait for the agent to seal its move.')
  })
})

describe('the agent’s tool', () => {
  test('declares its move sealed, so the host never stores or streams it', () => {
    expect(table().tool.presentation).toEqual({ sealed: { input: ['move'] } })
  })

  test('a sealed opening ends a woken turn and never names the move', async () => {
    const { act, post } = table()
    await post('/game/play', { move: 'rock' })
    await post('/game/next', {})
    const result = await act({ action: 'play', move: 'paper' })
    expect(result.isError).toBeFalsy()
    expect(result.terminate).toBe(true)
    expect(result.content).toContain('your move is sealed')
    expect(result.content).not.toContain('paper')
    expect((await act({ action: 'state' })).content).not.toContain('paper')
  })

  test('the move that reveals the round asks for a line about it', async () => {
    const { act, post } = table()
    await post('/game/play', { move: 'rock' })
    const result = await act({ action: 'play', move: 'paper' })
    expect(result.terminate).toBeUndefined()
    expect(result.content).toContain('the user played rock, you played paper — you won')
  })

  test('a move out of turn is refused with the table as it is', async () => {
    const { act } = table()
    const result = await act({ action: 'play', move: 'rock' })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('The user opens this round')
  })

  test('a call outside a chat is refused', async () => {
    const result = await table().act({ action: 'state' }, null)
    expect(result.isError).toBe(true)
    expect(result.content).toContain('played in a chat')
  })

  test('a new round opens the table of the chat the tool ran in', async () => {
    const result = await table().act({ action: 'next_round', first: 'agent' }, 's7')
    expect(result.content).toContain('You open')
    expect(result.details).toEqual({ offer: expect.objectContaining({ uri: gameUri('s7') }) })
  })
})
