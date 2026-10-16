import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { PluginContext } from '@localixai/plugin-sdk/backend'

import type { KanbanToolDetails } from '../shared/tool'
import { register } from './index'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

type Result = { content: string; isError?: boolean; details?: KanbanToolDetails }
const LEADER = { agentId: 'a:lead', handle: 'lead', role: 'leader' }
const QA = { agentId: 'a:qa', handle: 'qa', role: 'member' }
const DEV = { agentId: 'a:dev', handle: 'dev', role: 'member' }

/** The kanban tool, called as speakers of one group chat. */
function board() {
  const root = mkdtempSync(join(tmpdir(), 'kanban-roles-'))
  roots.push(root)
  const ctx = {
    userId: 'u1',
    z,
    sessionStorage: {
      resolveDataDir: async (_user: string, session: string) => join(root, session),
    },
    agents: {
      list: async () => [
        { id: 'a:lead', handle: 'lead' },
        { id: 'a:qa', handle: 'qa' },
        { id: 'a:dev', handle: 'dev' },
      ],
    },
    defineTool: (definition: unknown) => definition,
    ui: { offer: (destination: object) => ({ type: 'ui.navigate', ...destination }) },
  } as unknown as PluginContext
  const kanban = (register(ctx).tools ?? []).find((candidate) => candidate.name === 'kanban')!
  return (speaker: object, input: object) =>
    kanban.execute('call-1', input as never, undefined, undefined, {
      session: { id: 's1', speaker },
    } as never) as Promise<Result>
}

async function seeded() {
  const act = board()
  await act(LEADER, {
    action: 'create',
    creates: [
      { title: 'Release', kind: 'epic' },
      { title: 'Write tests', agent: 'qa', parent: 'Release' },
      { title: 'Secret refactor', agent: 'dev', parent: 'Release' },
    ],
  })
  return act
}

describe('kanban roles', () => {
  test('a member lists only its own cards, with its epic as context', async () => {
    const act = await seeded()
    const listed = await act(QA, { action: 'list' })
    expect(listed.content).toContain('LX-2')
    expect(listed.content).toContain('(epic LX-1 "Release")')
    expect(listed.content).not.toContain('Secret refactor')
    expect(listed.details?.tasks?.map((task) => task.id)).toEqual(['LX-2'])
    const searched = await act(QA, { action: 'search', query: 'refactor' })
    expect(searched.content).toBe('No matching cards are assigned to you.')
  })

  test('a member lookup never names a colleague’s card', async () => {
    const act = await seeded()
    const missing = await act(QA, { action: 'detail', task_id: 'nothing here' })
    expect(missing.isError).toBe(true)
    expect(missing.content).not.toContain('Secret refactor')
    const theirs = await act(QA, { action: 'detail', task_id: 'LX-3' })
    expect(theirs.content).toBe('LX-3 belongs to @dev; ask the leader to reassign it.')
    expect((await act(QA, { action: 'take', task_id: 'LX-3' })).content).toContain(
      'ask the leader to reassign it',
    )
  })

  test('a member edits only items and priority, and never deletes', async () => {
    const act = await seeded()
    const items = await act(QA, { action: 'update', task_id: 'LX-2', items: ['unit'], priority: 1 })
    expect(items.isError).toBeUndefined()
    const owner = await act(QA, { action: 'update', task_id: 'LX-2', agent: 'dev' })
    expect(owner.isError).toBe(true)
    expect(owner.content).toContain('ask the leader')
    expect((await act(QA, { action: 'delete', task_id: 'LX-2' })).isError).toBe(true)
  })

  test('a member’s new card is unassigned in backlog for the leader to triage', async () => {
    const act = await seeded()
    const created = await act(QA, { action: 'create', title: 'Flaky CI', agent: 'qa' })
    expect(created.content).toContain('The leader will triage it')
    expect(created.details?.task?.agentId).toBeNull()
    expect(created.details?.task?.status).toBe('backlog')
  })

  test('a member’s complete sends the card to review; the leader approves or sends it back', async () => {
    const act = await seeded()
    await act(QA, { action: 'take', task_id: 'LX-2' })
    const sent = await act(QA, { action: 'complete', task_id: 'LX-2' })
    expect(sent.content).toContain('the leader will verify it')
    expect(sent.details?.task?.status).toBe('review')
    const back = await act(LEADER, { action: 'update', task_id: 'LX-2', status: 'ready' })
    expect(back.details?.task?.status).toBe('ready')
    await act(QA, { action: 'take', task_id: 'LX-2' })
    await act(QA, { action: 'complete', task_id: 'LX-2' })
    const approved = await act(LEADER, { action: 'complete', task_id: 'LX-2' })
    expect(approved.details?.task?.status).toBe('done')
  })

  test('a task in review does not finish its epic', async () => {
    const act = await seeded()
    await act(LEADER, { action: 'update', task_id: 'LX-3', status: 'cancelled' })
    await act(QA, { action: 'take', task_id: 'LX-2' })
    const sent = await act(QA, { action: 'complete', task_id: 'LX-2' })
    expect(sent.content).not.toContain('epic')
  })

  test('reassigning a running card puts it back to ready for its new owner', async () => {
    const act = await seeded()
    await act(QA, { action: 'take', task_id: 'LX-2' })
    const moved = await act(LEADER, { action: 'update', task_id: 'LX-2', agent: 'dev' })
    expect(moved.details?.task?.status).toBe('ready')
    const taken = await act(DEV, { action: 'take', task_id: 'LX-2' })
    expect(taken.details?.task?.status).toBe('in_progress')
  })
})
