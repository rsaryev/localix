import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MiniAppWakeOutcome, MiniAppWakeRequest } from '@localixai/mini-app-sdk/backend'

import { ANSWER_TOOLS } from './ask-agent'
import { createGameService } from './game-service'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** The host's session storage in miniature: a folder per live session, a refusal for any other. */
function sessionStorage(live = ['s1', 's2']) {
  const root = mkdtempSync(join(tmpdir(), 'rock-paper-scissors-'))
  roots.push(root)
  const sessions = new Set(live)
  return {
    root,
    resolveDir: async (_userId: string, sessionId: string) => {
      if (!sessions.has(sessionId)) throw new Error('Session not found')
      const dir = join(root, sessionId)
      mkdirSync(dir, { recursive: true })
      return dir
    },
  }
}

const S1 = { userId: 'u1', sessionId: 's1' }

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
    now: () => '2026-10-18T10:00:00.000Z',
    newId: () => `id${++ids}`,
  })
  return { games, woke, storage }
}

describe('when the person opens', () => {
  test('their move is sealed, and the wake carries only its digest', async () => {
    const { games, woke } = setup()

    const after = await games.personMove(S1, 'scissors')

    expect(after.round.you).toMatchObject({ owner: 'you', value: 'scissors', revealedAt: null })
    expect(after.waiting).toMatchObject({ status: 'thinking' })
    expect(woke).toHaveLength(1)
    expect(woke[0]).toMatchObject({ sessionId: 's1', tools: ANSWER_TOOLS })
    expect(woke[0]!.message).toContain('the user has sealed their move')
    expect(woke[0]!.message).not.toContain(after.round.you!.salt)
  })

  test('the wake reads the same whatever the person chose, but for the digest', async () => {
    const messages = await Promise.all(
      (['rock', 'paper', 'scissors'] as const).map(async (move) => {
        const { games, woke } = setup()
        const after = await games.personMove(S1, move)
        return woke[0]!.message.replace(after.round.you!.digest.slice(0, 8), '<digest>')
      }),
    )
    expect(new Set(messages).size).toBe(1)
  })

  test('the agent’s answer reveals the round and clears the wait', async () => {
    const { games } = setup()
    await games.personMove(S1, 'rock')

    const { game, answered } = await games.agentMove(S1, 'paper')

    expect(answered).toBe(true)
    expect(game.round.outcome).toBe('lost')
    expect(game.waiting).toBeNull()
    expect(game.record).toEqual({ won: 0, lost: 1, draw: 0 })
  })

  test('a reminder for the same round is the same wake key; an unreachable chat is shown', async () => {
    const { games, woke } = setup({
      status: 'refused',
      reason: 'Chat is busy.',
    } as MiniAppWakeOutcome)
    const after = await games.personMove(S1, 'rock')
    await games.remind(S1)
    expect(woke.map((request) => request.key)).toEqual([woke[0]!.key, woke[0]!.key])
    expect(after.waiting?.status).toBe('unreachable')
  })
})

describe('when the agent opens', () => {
  test('the next round wakes the agent, and its sealed move waits for the person', async () => {
    const { games, woke } = setup()
    await games.personMove(S1, 'rock')
    await games.agentMove(S1, 'rock')

    const next = await games.nextRound(S1)

    expect(next.round.first).toBe('agent')
    expect(woke).toHaveLength(2)
    expect(woke[1]!.message).toContain('you open')

    const { game } = await games.agentMove(S1, 'scissors')
    expect(game.round.agent).toMatchObject({ value: 'scissors', revealedAt: null })

    const done = await games.personMove(S1, 'rock')
    expect(done.round.outcome).toBe('won')
    expect(woke).toHaveLength(2)
  })

  test('the stored table keeps the digest the person was shown', async () => {
    const { games, storage } = setup()
    await games.agentNextRound(S1, 'agent')
    const { game } = await games.agentMove(S1, 'paper')
    const stored = JSON.parse(readFileSync(join(storage.root, 's1', 'game.json'), 'utf8'))
    expect(stored.round.agent.digest).toBe(game.round.agent!.digest)
  })
})
