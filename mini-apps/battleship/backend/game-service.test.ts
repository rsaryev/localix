import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MiniAppWakeOutcome, MiniAppWakeRequest } from '@localixai/mini-app-sdk/backend'

import { shotsBy } from '../shared/game'
import { SIZE, cellName, knownCells } from '../shared/rules'
import { ANSWER_TOOLS } from './ask-agent'
import { createGameService } from './game-service'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * The host's session storage in miniature: a folder per LIVE session, and a refusal for any other
 * — which is what a deleted chat is.
 */
function sessionStorage(live = ['s1', 's2']) {
  const root = mkdtempSync(join(tmpdir(), 'battleship-'))
  roots.push(root)
  const sessions = new Set(live)
  return {
    root,
    delete: (sessionId: string) => {
      sessions.delete(sessionId)
      rmSync(join(root, sessionId), { recursive: true, force: true })
    },
    resolveDir: async (_userId: string, sessionId: string) => {
      if (!sessions.has(sessionId)) throw new Error('Session not found')
      const dir = join(root, sessionId)
      mkdirSync(dir, { recursive: true })
      return dir
    },
  }
}

/** A seeded generator, so the fleets are the same in every run. */
function seeded(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32
    return state / 2 ** 32
  }
}

const S1 = { userId: 'u1', sessionId: 's1' }
const S2 = { userId: 'u1', sessionId: 's2' }

function setup(outcome: MiniAppWakeOutcome = { status: 'delivered' }) {
  const woke: MiniAppWakeRequest[] = []
  const storage = sessionStorage()
  let ids = 0
  const games = createGameService({
    resolveDir: storage.resolveDir,
    wake: async (request) => {
      woke.push(request)
      return outcome
    },
    now: () => '2026-09-26T10:00:00.000Z',
    newId: () => `g${++ids}`,
    random: seeded(7),
  })
  return { games, woke, storage }
}

/** A cell of the agent's fleet the person has not fired at — a sure hit. */
const agentShipCell = async (games: ReturnType<typeof setup>['games']) => {
  const game = await games.read(S1)
  const known = knownCells(game.fleets.agent, shotsBy(game, 'you'))
  return game.fleets.agent.flatMap((ship) => ship.cells).find((cell) => !known.has(cell))!
}
/** A cell of the agent's board that is water and not yet known — a sure miss. */
const agentWaterCell = async (games: ReturnType<typeof setup>['games']) => {
  const game = await games.read(S1)
  const known = knownCells(game.fleets.agent, shotsBy(game, 'you'))
  const ships = new Set(game.fleets.agent.flatMap((ship) => ship.cells))
  return Array.from({ length: SIZE * SIZE }, (_, i) => i).find(
    (c) => !ships.has(c) && !known.has(c),
  )!
}

describe('the turn passes only on a miss', () => {
  test('a hit keeps the person’s turn and wakes nobody; a miss wakes the board’s own chat', async () => {
    const { games, woke } = setup()
    const hit = await games.personShot(S1, await agentShipCell(games))
    expect(hit.turn).toBe('you')
    expect(woke).toEqual([])

    const missed = await games.personShot(S1, await agentWaterCell(games))
    expect(missed.turn).toBe('agent')
    expect(woke).toHaveLength(1)
    expect(woke[0]).toMatchObject({ userId: 'u1', sessionId: 's1', tools: ANSWER_TOOLS })
    expect(missed.waiting).toMatchObject({ status: 'thinking' })
  })

  test('the agent’s miss answers the wait; its hit keeps it owing a shot', async () => {
    const { games } = setup()
    await games.personShot(S1, await agentWaterCell(games))
    const game = await games.read(S1)
    const ship = game.fleets.you[0]!.cells[0]!
    const afterHit = await games.agentShot(S1, ship)
    expect(afterHit.answered).toBe(true)
    expect(afterHit.game.turn).toBe('agent')
    expect(afterHit.game.waiting).not.toBeNull()
  })
})

describe('what the agent is told never includes the user’s fleet', () => {
  test('the wake shows the agent only its own shots: every unshot cell reads as unknown', async () => {
    const { games, woke } = setup()
    await games.personShot(S1, await agentWaterCell(games))
    const message = woke[0]!.message
    // No shots by the agent yet: the grid is all ".", whatever the user's fleet is.
    const grid = message.split('\n').filter((line) => /^\s?\d+ /.test(line))
    expect(grid).toHaveLength(10)
    for (const line of grid)
      expect(line.replace(/^\s?\d+ /, '').replaceAll(' ', '')).toBe('..........')
    const game = await games.read(S1)
    for (const cell of game.fleets.you.flatMap((ship) => ship.cells))
      expect(message).not.toContain(`${cellName(cell)} `)
  })
})

describe('one table per chat', () => {
  test('two chats keep two games with their own fleets', async () => {
    const { games } = setup()
    await games.personShot(S1, await agentWaterCell(games))
    expect((await games.read(S2)).shots).toEqual([])
    expect((await games.read(S1)).shots).toHaveLength(1)
  })

  test('a deleted chat is refused before anything is read or written, and stays deleted', async () => {
    const { games, storage } = setup()
    await games.read(S1)
    storage.delete('s1')
    await expect(games.personShot(S1, 0)).rejects.toThrow('Session not found')
    expect(existsSync(join(storage.root, 's1'))).toBe(false)
  })

  test('the fleet can be placed anew only before the first shot', async () => {
    const { games } = setup()
    const before = (await games.read(S1)).fleets.you
    const after = (await games.reshuffle(S1)).fleets.you
    expect(after).not.toEqual(before)
    await games.personShot(S1, await agentWaterCell(games))
    await expect(games.reshuffle(S1)).rejects.toThrow('set once the first shot is fired')
  })

  test('the next game has fresh fleets, the other side firing first, and asks the agent', async () => {
    const { games, woke } = setup()
    const first = await games.read(S1)
    const next = await games.newGame(S1)
    expect(next.first).toBe('agent')
    expect(next.fleets.agent).not.toEqual(first.fleets.agent)
    expect(woke.at(-1)!.message).toStartWith('A new game — you fire first.')
  })
})
