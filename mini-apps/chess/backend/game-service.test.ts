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
  const root = mkdtempSync(join(tmpdir(), 'chess-'))
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
    now: () => '2026-09-26T10:00:00.000Z',
    newId: () => `g${++ids}`,
  })
  return { games, woke, storage }
}

describe('a person’s move wakes the chat the board belongs to', () => {
  test('the wake names that session, the position, the legal moves and the answering tools', async () => {
    const { games, woke } = setup()

    const after = await games.personMove(S1, 'e2e4')

    expect(woke).toHaveLength(1)
    expect(woke[0]).toMatchObject({ userId: 'u1', sessionId: 's1', tools: ANSWER_TOOLS })
    expect(woke[0]!.key).toEndWith(':1')
    expect(woke[0]!.message).toContain('The user played e4. Your move as black.')
    expect(woke[0]!.message).toContain('FEN: ')
    expect(woke[0]!.message).toContain('Legal moves: ')
    expect(after.waiting).toMatchObject({ status: 'thinking' })
  })

  test('the agent’s move answers the wait, says it did, and wakes nobody', async () => {
    const { games, woke } = setup()
    await games.personMove(S1, 'e2e4')

    const { game, answered } = await games.agentMove(S1, 'e5')

    expect(game.moves.map((move) => move.san)).toEqual(['e4', 'e5'])
    expect(game.waiting).toBeNull()
    expect(answered).toBe(true)
    expect(woke).toHaveLength(1)
  })

  test('a move nobody asked for (the user asked in chat) is not an answer', async () => {
    const { games } = setup()
    await games.agentNewGame(S1, 'black')
    expect((await games.agentMove(S1, 'e4')).answered).toBe(false)
  })

  test('a wake that does not land leaves its reason on the board, not a silent wait', async () => {
    const { games } = setup({ status: 'missed', reason: 'gone' })
    const after = await games.personMove(S1, 'e2e4')
    expect(after.waiting).toMatchObject({ status: 'unreachable', reason: 'gone' })
  })

  test('asking again re-sends the same position key', async () => {
    const { games, woke } = setup()
    await games.personMove(S1, 'e2e4')
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
    const pending = games.personMove(S1, 'e2e4')
    await turns()
    await games.agentMove(S1, 'e5')
    release({ status: 'missed', reason: 'gone' })
    expect((await pending).waiting).toBeNull()
  })
})

describe('one table per chat', () => {
  test('two chats keep two boards: a move in one never shows in the other', async () => {
    const { games } = setup()
    await games.personMove(S1, 'e2e4')
    expect((await games.read(S2)).moves).toEqual([])
    expect((await games.read(S1)).moves).toHaveLength(1)
  })

  test('a deleted chat is refused before anything is read or written, and stays deleted', async () => {
    const { games, storage } = setup()
    await games.personMove(S1, 'e2e4')
    storage.delete('s1')

    await expect(games.agentMove(S1, 'e5')).rejects.toThrow('Session not found')
    await expect(games.read(S1)).rejects.toThrow('Session not found')
    expect(existsSync(join(storage.root, 's1'))).toBe(false)
  })

  test('the next game swaps colours, keeps the score, and asks the agent when it now plays white', async () => {
    const { games, woke } = setup()
    const after = await games.newGame(S1)
    expect(after.id).toBe('g2')
    expect(after.you).toBe('black')
    expect(woke.at(-1)!.message).toStartWith('A new game — you play white and move first.')
  })
})
