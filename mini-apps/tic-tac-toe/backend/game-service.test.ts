import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MiniAppWakeOutcome, MiniAppWakeRequest } from '@localixai/mini-app-sdk/backend'

import { ANSWER_TOOLS } from './ask-agent'
import { createGameService } from './game-service'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * The host's session storage in miniature: a folder per LIVE session, and a refusal for any other
 * — which is what a deleted chat is.
 */
function sessionStorage(live = ['s1', 's2']) {
  const root = mkdtempSync(join(tmpdir(), 'tic-tac-toe-'))
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

const S1 = { userId: 'u1', sessionId: 's1' }
const S2 = { userId: 'u1', sessionId: 's2' }

/** Games over fresh session storage, with a wake that records its requests and answers `outcome`. */
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
    now: () => '2026-09-25T10:00:00.000Z',
    newId: () => `g${++ids}`,
  })
  return { games, woke, storage }
}

describe('a person’s move wakes the chat the board belongs to', () => {
  test('the wake names that session, the position, the tools that answer it and a position key', async () => {
    const { games, woke } = setup()

    const after = await games.personMove(S1, 4)

    expect(woke).toHaveLength(1)
    expect(woke[0]).toMatchObject({ userId: 'u1', sessionId: 's1', tools: ANSWER_TOOLS })
    expect(woke[0]!.key).toEndWith(':1')
    expect(woke[0]!.message).toContain('The user played X in the centre (cell 5). Your move as O.')
    expect(after.waiting).toMatchObject({ status: 'thinking' })
  })

  test('the agent’s move answers the wait, says it did, and wakes nobody', async () => {
    const { games, woke } = setup()
    await games.personMove(S1, 4)

    const { game, answered } = await games.agentMove(S1, 0)

    expect(game.board[0]).toBe('O')
    expect(game.waiting).toBeNull()
    expect(answered).toBe(true)
    expect(woke).toHaveLength(1)
  })

  test('a move nobody asked for (the user asked in chat) is not an answer', async () => {
    const { games } = setup()
    await games.agentNewGame(S1, 'O')
    expect((await games.agentMove(S1, 4)).answered).toBe(false)
  })

  test('a wake that does not land leaves its reason on the board, not a silent wait', async () => {
    const { games } = setup({ status: 'missed', reason: 'gone' })
    const after = await games.personMove(S1, 4)
    expect(after.waiting).toMatchObject({ status: 'unreachable', reason: 'gone' })
  })

  test('a host without wake is unreachable, never a board that waits forever', async () => {
    const storage = sessionStorage()
    const after = await createGameService({ resolveDir: storage.resolveDir }).personMove(S1, 4)
    expect(after.waiting?.status).toBe('unreachable')
  })

  test('asking again re-sends the same position key; an unchanged position is not asked twice', async () => {
    const { games, woke } = setup()
    await games.personMove(S1, 4)
    await games.remind(S1)
    expect(woke).toHaveLength(2)
    expect(woke[0]!.key).toBe(woke[1]!.key)
  })

  test('an answer that arrives after the agent already moved is not written over the board', async () => {
    let release: (outcome: MiniAppWakeOutcome) => void = () => {}
    const storage = sessionStorage()
    const games = createGameService({
      resolveDir: storage.resolveDir,
      wake: () => new Promise((resolve) => (release = resolve)),
    })
    const pending = games.personMove(S1, 4)
    await turns()
    await games.agentMove(S1, 0)
    release({ status: 'missed', reason: 'gone' })
    expect((await pending).waiting).toBeNull()
  })
})

describe('one table per chat', () => {
  test('two chats keep two boards: a move in one never shows in the other', async () => {
    const { games } = setup()
    await games.personMove(S1, 4)
    const other = await games.read(S2)
    expect(other.board.every((cell) => cell === null)).toBe(true)
    expect((await games.read(S1)).board[4]).toBe('X')
  })

  test('an agent in one chat cannot move on another chat’s board', async () => {
    const { games } = setup()
    await games.personMove(S1, 4)
    // S2's board is on X's turn, so the agent is refused there, and S1's board is untouched.
    await expect(games.agentMove(S2, 0)).rejects.toThrow('It is the user’s turn (X).')
    expect((await games.read(S1)).board[0]).toBeNull()
  })

  test('a deleted chat is refused before anything is read or written, and stays deleted', async () => {
    const { games, storage } = setup()
    await games.personMove(S1, 4)
    storage.delete('s1')

    await expect(games.personMove(S1, 0)).rejects.toThrow('Session not found')
    await expect(games.read(S1)).rejects.toThrow('Session not found')
    expect(existsSync(join(storage.root, 's1'))).toBe(false)
  })

  test('the next game alternates who opens, keeps the score, and asks the agent when it opens', async () => {
    const { games, woke } = setup()
    for (const cell of [0, 1, 2]) {
      await games.personMove(S1, cell)
      if (cell < 2) await games.agentMove(S1, cell + 3)
    }
    const after = await games.newGame(S1)
    expect(after.first).toBe('O')
    expect(after.record).toEqual({ won: 1, lost: 0, draw: 0 })
    expect(woke.at(-1)!.message).toStartWith('A new game — you move first, as O.')
    expect(woke.at(-1)!.message).toContain('Score at this table: you 0, the user 1, draws 0.')
  })
})
