import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChangeFeedHost, CoreDeletion } from '@localixai/mini-app-sdk/backend'

import { createBoardService } from './service'
import { followAgentDeletions, releaseDeletedAgent } from './unassign'

let root: string
const agents = {
  list: async () => [
    { id: 'builtin:frontend', name: 'frontend' },
    { id: 'builtin:qa', name: 'qa' },
  ],
}
const dirOf = (sessionId: string) => join(root, sessionId)
const listDirs = async () => ['s1', 's2', 'empty'].map((id) => ({ sessionId: id, dir: dirOf(id) }))
const boards = () => createBoardService({ resolveDir: async (_u, s) => dirOf(s), agents })
const chat = (sessionId: string) => ({ userId: 'u', sessionId })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kanban-unassign-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('a deleted agent', () => {
  test("loses its cards on every board; other agents' cards stay", async () => {
    const service = boards()
    await service.create(chat('s1'), { title: 'a', agent: 'frontend' }, 'user')
    await service.create(chat('s1'), { title: 'b', agent: 'qa' }, 'user')
    await service.create(chat('s2'), { title: 'c', agent: 'frontend' }, 'user')

    expect(await releaseDeletedAgent(listDirs, 'builtin:frontend')).toBe(2)

    const one = await service.read(chat('s1'))
    const two = await service.read(chat('s2'))
    expect(one.tasks.map((t) => [t.title, t.agentId, t.assignee])).toEqual([
      ['a', null, null],
      ['b', 'builtin:qa', 'qa'],
    ])
    expect(two.tasks[0]).toMatchObject({ agentId: null, assignee: null })
    expect(await releaseDeletedAgent(listDirs, 'builtin:frontend')).toBe(0)
  })

  test('is followed through host.changes; other deletions change nothing', async () => {
    const service = boards()
    await service.create(chat('s1'), { title: 'a', agent: 'qa' }, 'user')
    let deliver: ((deletion: CoreDeletion) => Promise<void> | void) | null = null
    const changes: ChangeFeedHost = {
      record: () => {},
      subscribe: async () => async () => {},
      followCoreDeletions: async (_name, handler) => {
        deliver = handler
        return async () => {}
      },
    }
    expect(await followAgentDeletions(changes, listDirs)).not.toBeNull()
    await deliver!({ entity: 'chat', ref: { id: 's1', userId: 'u' } })
    await deliver!({ entity: 'agent', ref: { id: 'other', scope: 'global', agentId: 'x' } })
    expect((await service.read(chat('s1'))).tasks[0]?.agentId).toBe('builtin:qa')
    await deliver!({ entity: 'agent', ref: { id: 'qa', scope: 'global', agentId: 'builtin:qa' } })
    expect((await service.read(chat('s1'))).tasks[0]?.agentId).toBeNull()
  })

  test('is not followed on a host without the change feed or session listing', async () => {
    expect(await followAgentDeletions(undefined, listDirs)).toBeNull()
  })
})
