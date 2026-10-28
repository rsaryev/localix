import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'

import type { KanbanToolDetails } from '../shared/tool'
import { register } from './index'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

type Result = { content: string; isError?: boolean; details?: KanbanToolDetails }
const AGENT = { agentId: 'builtin:localix', name: 'localix' }

/**
 * The mini app's one tool, called as a run in `session` would: the host names session and agent.
 */
function tool() {
  const root = mkdtempSync(join(tmpdir(), 'kanban-tool-'))
  roots.push(root)
  const ctx = {
    userId: 'u1',
    z,
    sessionStorage: {
      resolveDataDir: async (_user: string, session: string) => join(root, session),
    },
    agents: { list: async () => [{ id: 'builtin:qa', name: 'qa' }] },
    defineTool: (definition: unknown) => definition,
    ui: { offer: (destination: object) => ({ type: 'ui.navigate', ...destination }) },
  } as unknown as MiniAppContext
  const registered = register(ctx).tools ?? []
  const kanban = registered.find((candidate) => candidate.name === 'kanban')!
  const act = (input: object, session: object | null = { id: 's1', agent: AGENT }) =>
    kanban.execute(
      'call-1',
      input as never,
      undefined,
      undefined,
      (session ? { session } : {}) as never,
    ) as Promise<Result>
  return { act, registered }
}

describe('kanban tool', () => {
  test('the mini app gives the agent ONE tool', () => {
    expect(tool().registered.map((candidate) => candidate.name)).toEqual(['kanban'])
  })

  test('a call with no chat is refused, not guessed', async () => {
    const result = await tool().act({ action: 'list' }, null)
    expect(result.isError).toBe(true)
  })

  test('a batch wires a dependency to an earlier entry by title, and offers the board', async () => {
    const { act } = tool()
    const created = await act({
      action: 'create',
      creates: [
        { title: 'Design the API' },
        { title: 'Build it', depends_on: ['Design the API'], agent: 'qa' },
      ],
    })
    expect(created.isError).toBeUndefined()
    expect(created.details?.reveal?.uri).toBe('localix://resource/kanban/board/s1')
    const listed = await act({ action: 'list' })
    expect(listed.content).toContain('LX-2 — Build it → qa ⇐ deps: LX-1')
  })

  // A refused later entry used to fail the call whole: the earlier entries were on the board but
  // unreported, and the retry created them twice.
  test('a batch refused at a later entry reports what it created, and the retry makes no copies', async () => {
    const { act } = tool()
    const partial = await act({
      action: 'create',
      creates: [{ title: 'Design the API' }, { title: 'Build it', depends_on: ['No such task'] }],
    })
    expect(partial.isError).toBeUndefined()
    expect(partial.content).toContain('Created LX-1 "Design the API" in backlog.')
    expect(partial.content).toContain('Entry 2 was not created:')
    expect((await act({ action: 'list' })).content).not.toContain('Build it')
  })

  test('a batch refused at its first entry is the call’s own failure', async () => {
    const result = await tool().act({ action: 'create', creates: [{ title: ' ' }] })
    expect(result.isError).toBe(true)
  })

  test('take records the AGENT, never a name from the input', async () => {
    const { act } = tool()
    await act({ action: 'create', title: 'Do it' })
    const taken = await act({ action: 'take', task_id: 'LX-1' })
    expect(taken.details?.task).toMatchObject({
      status: 'in_progress',
      agentId: AGENT.agentId,
      assignee: AGENT.name,
    })
  })

  test('take by someone else’s card says whose it is and how to hand it over', async () => {
    const { act } = tool()
    await act({ action: 'create', title: 'Test it', agent: 'qa' })
    const refused = await act({ action: 'take', task_id: 'LX-1' })
    expect(refused.isError).toBe(true)
    expect(refused.content).toContain('assigned to @qa')
  })

  test('completing a card names the cards it released', async () => {
    const { act } = tool()
    await act({ action: 'create', creates: [{ title: 'a' }, { title: 'b', depends_on: ['a'] }] })
    await act({ action: 'take', task_id: 'LX-1' })
    const done = await act({ action: 'complete', task_id: 'LX-1' })
    expect(done.content).toContain('Now unblocked: LX-2')
  })

  test('block requires the obstacle', async () => {
    const { act } = tool()
    await act({ action: 'create', title: 'x' })
    expect((await act({ action: 'block', task_id: 'LX-1' })).content).toBe('block requires note.')
  })

  test('detail is a brief a delegate can work from', async () => {
    const { act } = tool()
    await act({ action: 'create', title: 'Ship', description: 'Tag and publish.', items: ['tag'] })
    const detail = await act({ action: 'detail', task_id: 'ship' })
    expect(detail.content).toContain('LX-1: Ship')
    expect(detail.content).toContain('- [ ] tag')
  })

  // The next four replay a real session: the agent sent `items` to update and was told "Updated"
  // while the old checklist stayed; had no way to tick an item, so every card it finished read
  // [0/2]; and could have moved a card with an open dependency to in_progress through update.
  test('update rewrites the checklist; an unchanged item keeps its tick, a stated one sets it', async () => {
    const { act } = tool()
    await act({ action: 'create', title: 'Check', items: ['scenarios', 'record'] })
    const ticked = await act({
      action: 'update',
      task_id: 'LX-1',
      items: [{ text: 'scenarios', done: true }, 'record'],
    })
    expect(ticked.content).toContain('[1/2]')
    const revised = await act({
      action: 'update',
      task_id: 'LX-1',
      items: ['scenarios', 'transitions', 'reconcile'],
    })
    expect(revised.details?.task?.subtasks.map((item) => [item.text, item.done])).toEqual([
      ['scenarios', true],
      ['transitions', false],
      ['reconcile', false],
    ])
  })

  test('a field the action does not read is refused by name, and nothing is written', async () => {
    const { act } = tool()
    await act({ action: 'create', title: 'Card' })
    const refused = await act({ action: 'update', task_id: 'LX-1', title: 'Renamed', kind: 'epic' })
    expect(refused.isError).toBe(true)
    expect(refused.content).toContain('update does not take kind (create)')
    expect((await act({ action: 'detail', task_id: 'LX-1' })).content).toContain('LX-1: Card')
  })

  test('update cannot make the moves take, complete and block own', async () => {
    const { act } = tool()
    await act({ action: 'create', creates: [{ title: 'a' }, { title: 'b', depends_on: ['a'] }] })
    for (const [status, owner] of [
      ['in_progress', 'use take'],
      ['done', 'use complete'],
      ['blocked', 'use block'],
    ] as const) {
      const refused = await act({ action: 'update', task_id: 'LX-2', status })
      expect(refused.isError).toBe(true)
      expect(refused.content).toContain(owner)
    }
    expect((await act({ action: 'take', task_id: 'LX-2' })).content).toContain(
      'unfinished dependencies: LX-1 (backlog). Take it once they are done.',
    )
    expect(
      (await act({ action: 'update', task_id: 'LX-2', status: 'ready' })).isError,
    ).toBeUndefined()
  })

  test('complete names the checklist items it leaves unticked', async () => {
    const { act } = tool()
    await act({ action: 'create', title: 'Ship', items: ['tag', 'publish'] })
    await act({
      action: 'update',
      task_id: 'LX-1',
      items: [{ text: 'tag', done: true }, 'publish'],
    })
    await act({ action: 'take', task_id: 'LX-1' })
    const done = await act({ action: 'complete', task_id: 'LX-1' })
    expect(done.content).toBe(
      'Completed LX-1. 1 of 2 checklist items are unticked: "publish". If they were done, complete with items_done: true next time; do not complete the card again.',
    )
  })

  // An agent finished every task of an epic and stopped, reporting that the epic "did not
  // complete by itself", and never tried to close it. The epic's status is
  // its own to set, so the completion that finishes it says so.
  test('the completion that finishes an epic says so; one that leaves work open does not', async () => {
    const { act } = tool()
    await act({
      action: 'create',
      creates: [
        { title: 'Launch', kind: 'epic' },
        { title: 'a', parent: 'Launch' },
        { title: 'b', parent: 'Launch' },
      ],
    })
    await act({ action: 'take', task_id: 'LX-2' })
    expect((await act({ action: 'complete', task_id: 'LX-2' })).content).not.toContain('epic')
    await act({ action: 'take', task_id: 'LX-3' })
    expect((await act({ action: 'complete', task_id: 'LX-3' })).content).toContain(
      'Every task of epic LX-1 is finished; complete it too',
    )
    const refused = await act({ action: 'take', task_id: 'LX-1' })
    expect(refused.content).toContain('complete the epic itself once they are done')
    expect((await act({ action: 'complete', task_id: 'LX-1' })).isError).toBeUndefined()
  })

  test('complete goes straight to done, ticks the checklist on request, and a done card stays done', async () => {
    const { act } = tool()
    await act({ action: 'create', title: 'Write tests', items: ['Unit', 'E2E'] })
    await act({ action: 'take', task_id: 'LX-1' })
    const done = await act({ action: 'complete', task_id: 'LX-1', items_done: true })
    expect(done.details?.task?.status).toBe('done')
    expect(done.details?.task?.subtasks?.every((item) => item.done)).toBe(true)
    const again = await act({ action: 'complete', task_id: 'LX-1' })
    expect(again.isError).toBeFalsy()
    expect(again.content).toBe('LX-1 is already done; nothing changed.')
  })

  test('the agent reads and edits every card, whoever owns it', async () => {
    const { act } = tool()
    await act({
      action: 'create',
      creates: [{ title: 'Write tests', agent: 'qa' }],
    })
    expect((await act({ action: 'list' })).content).toContain('LX-1')
    expect((await act({ action: 'update', task_id: 'LX-1', priority: 1 })).isError).toBeFalsy()
    expect((await act({ action: 'delete', task_id: 'LX-1' })).content).toBe('Deleted LX-1.')
  })

  test('a card described beside creates is refused instead of dropped', async () => {
    const { act } = tool()
    const refused = await act({
      action: 'create',
      title: 'Launch',
      kind: 'epic',
      creates: [{ title: 'Build', agent: 'qa' }],
    })
    expect(refused.isError).toBe(true)
    expect(refused.content).toContain('create got title, kind beside creates')
    expect((await act({ action: 'list' })).content).not.toContain('Build')
  })

  test('an epic is created without a checklist of its own', async () => {
    const { act } = tool()
    const refused = await act({
      action: 'create',
      creates: [{ title: 'Launch', kind: 'epic', items: ['Plan'] }],
    })
    expect(refused.isError).toBe(true)
    expect(refused.content).toContain('An epic holds no checklist')
  })

  test('reassigning a running card puts it back to ready for its new owner', async () => {
    const { act } = tool()
    await act({ action: 'create', title: 'Write tests' })
    await act({ action: 'take', task_id: 'LX-1' })
    const moved = await act({ action: 'update', task_id: 'LX-1', agent: 'qa' })
    expect(moved.details?.task?.status).toBe('ready')
  })

  test('an unknown reference lists the cards that do exist', async () => {
    const { act } = tool()
    await act({ action: 'create', title: 'Only card' })
    const missing = await act({ action: 'detail', task_id: 'LX-9' })
    expect(missing.isError).toBe(true)
    expect(missing.content).toContain('LX-1 "Only card"')
  })
})
