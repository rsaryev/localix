import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BoardEvent } from '../shared/contracts'
import { BoardRefusal } from '../shared/errors'
import { createBoardService, type BoardChat } from './service'

let root: string
const chat: BoardChat = { userId: 'u1', sessionId: 's1' }
const dirOf = (userId: string, sessionId: string) => join(root, userId, sessionId)

const agents = {
  list: async () => [
    { id: 'builtin:frontend', name: 'frontend' },
    { id: 'builtin:qa', name: 'qa' },
  ],
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kanban-service-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const service = () => createBoardService({ resolveDir: async (u, s) => dirOf(u, s), agents })

describe('board service', () => {
  test('concurrent writes from separate loads all land, in order', async () => {
    // Two instances stand for the backend load and a run's tool load: they share no state but
    // the board's file, and must still not lose a write.
    const [a, b] = [service(), service()]
    const created = await Promise.all([
      a.create(chat, { title: 'one' }, 'user'),
      b.create(chat, { title: 'two' }, 'agent'),
      a.create(chat, { title: 'three' }, 'user'),
    ])
    expect(created.map((task) => task.id).sort()).toEqual(['LX-1', 'LX-2', 'LX-3'])
    expect((await b.read(chat)).tasks).toHaveLength(3)
  })

  test('announces a change to every subscriber of that board only, after it is written', async () => {
    const boards = service()
    const seen: BoardEvent[] = []
    const other: BoardEvent[] = []
    const stop = await boards.subscribe(chat, (event) => seen.push(event))
    await boards.subscribe({ userId: 'u1', sessionId: 's2' }, (event) => other.push(event))
    const task = await boards.create(chat, { title: 'watched' }, 'user')
    const onDisk = JSON.parse(await readFile(join(dirOf('u1', 's1'), 'board.json'), 'utf8'))
    expect(onDisk.tasks[0].id).toBe(task.id)
    expect(seen).toEqual([{ type: 'task.created', sessionId: 's1', task }])
    expect(other).toEqual([])
    stop()
    await boards.remove(chat, task.id)
    expect(seen).toHaveLength(1)
  })

  test('a failed write changes nothing and announces nothing', async () => {
    const boards = service()
    const seen: BoardEvent[] = []
    await boards.subscribe(chat, (event) => seen.push(event))
    await expect(boards.create(chat, { title: 'x', dependsOn: ['LX-7'] }, 'user')).rejects.toThrow(
      BoardRefusal,
    )
    expect((await boards.read(chat)).tasks).toEqual([])
    expect(seen).toEqual([])
  })

  test('an unreadable file reads as an empty board instead of throwing at every read', async () => {
    const boards = service()
    await boards.create(chat, { title: 'x' }, 'user')
    await writeFile(join(dirOf('u1', 's1'), 'board.json'), '{ not json')
    expect((await boards.read(chat)).tasks).toEqual([])
  })

  test('an invalid input is a refusal that names the field', async () => {
    const refusal = await service()
      .create(chat, { title: 'x'.repeat(201) }, 'user')
      .catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(BoardRefusal)
    expect((refusal as BoardRefusal).message).toStartWith('title:')
  })

  describe('assignment', () => {
    test('resolves an id and a name to the stored id', async () => {
      const boards = service()
      for (const reference of ['builtin:qa', 'qa']) {
        const task = await boards.create(chat, { title: reference, agent: reference }, 'agent')
        expect({ agentId: task.agentId, assignee: task.assignee }).toEqual({
          agentId: 'builtin:qa',
          assignee: 'qa',
        })
      }
    })

    test('an unknown agent is refused with the agents that exist', async () => {
      const refusal = await service()
        .create(chat, { title: 'x', agent: 'designer' }, 'agent')
        .then(
          () => null,
          (error: unknown) => error as BoardRefusal,
        )
      expect(refusal?.code).toBe('agent_unavailable')
      expect(refusal?.message).toContain('frontend (builtin:frontend)')
    })

    test('null unassigns', async () => {
      const boards = service()
      const task = await boards.create(chat, { title: 'x', agent: 'qa' }, 'agent')
      const cleared = await boards.update(chat, task.id, { agent: null }, 'user')
      expect({ agentId: cleared.agentId, assignee: cleared.assignee }).toEqual({
        agentId: null,
        assignee: null,
      })
    })
  })
})
