import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MiniAppWakeRequest } from '@localixai/mini-app-sdk/backend'

import { createGameService } from './game-service'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const chat = { userId: 'u1', sessionId: 's1' }
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'game-2048-'))
  roots.push(root)
  const woke: MiniAppWakeRequest[] = []
  const games = createGameService({
    resolveDir: async (_user, session) => {
      const dir = join(root, session)
      mkdirSync(dir, { recursive: true })
      return dir
    },
    wake: async (request) => {
      woke.push(request)
      return { status: 'delivered' }
    },
    random: () => 0,
    newId: () => 'game-id',
    now: () => 'now',
  })
  return { games, woke }
}

test('the person playing stays local; handing the board to the agent wakes this chat once', async () => {
  const { games, woke } = setup()
  await games.personMove(chat, 'right')
  expect(woke).toHaveLength(0)
  const game = await games.mode(chat, 'agent')
  expect(game.waiting?.status).toBe('thinking')
  expect(woke).toHaveLength(1)
  expect(woke[0]).toMatchObject({ sessionId: 's1', tools: ['game_2048'] })
  expect(woke[0]!.message).toContain('keep calling until the game ends')
  expect(woke[0]!.message).toContain('"prefer"')
  await expect(games.personMove(chat, 'left')).rejects.toThrow('The agent controls this board')
})

test('the agent’s moves never wake the chat — only a person’s action does', async () => {
  const { games, woke } = setup()
  await games.mode(chat, 'agent')
  const result = await games.agentMoves(chat, { prefer: ['down', 'left', 'right', 'up'], count: 3 })
  expect(result.played.length).toBeGreaterThan(0)
  expect(woke).toHaveLength(1)
})

test('asking the agent to continue wakes the chat again for the same position', async () => {
  const { games, woke } = setup()
  await games.mode(chat, 'agent')
  expect((await games.remind(chat)).waiting?.status).toBe('thinking')
  expect(woke).toHaveLength(2)
})

test('taking the board back refuses the agent’s next moves', async () => {
  const { games } = setup()
  await games.mode(chat, 'agent')
  await games.mode(chat, 'user')
  await expect(games.agentMoves(chat, { moves: ['right'] })).rejects.toThrow(
    'The user controls this board',
  )
})

test('each chat keeps its own board', async () => {
  const { games } = setup()
  await games.personMove(chat, 'right')
  const other = await games.read({ ...chat, sessionId: 's2' })
  expect(other.moves).toBe(0)
  expect((await games.read(chat)).moves).toBe(1)
})
