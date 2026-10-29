/**
 * TaskCreated / TaskCompleted on the task board's tool: a created card a hook refuses is taken off
 * the board again, a card a hook will not let close stays open, and the model reads why.
 */
import { describe, expect, test } from 'bun:test'
import type { AgentTool, AgentToolResult } from '@localixai/agent/agents'

import type { CcHooksRuntime } from './run'
import { EMPTY_RUNTIME } from './runtime-results'
import type { CcTask } from './runtime-contracts-added'
import { wrapToolsWithCcHooks } from './wrap-tools'

/** A board with one tool that declares the task-board role; the core knows it by nothing else. */
function board(roles: AgentTool['roles'] = ['task-board']) {
  const cards = new Map<string, { id: string; title: string; status: string }>()
  const calls: unknown[] = []
  const tool = {
    name: 'work_items',
    roles,
    async execute(_id: string, input: unknown): Promise<AgentToolResult> {
      const i = input as { action: string; title?: string; task_id?: string }
      calls.push(i.action)
      if (i.action === 'create') {
        const card = { id: `LX-${cards.size + 1}`, title: i.title ?? '', status: 'backlog' }
        cards.set(card.id, card)
        return { content: `Created ${card.id}`, details: { task: card } }
      }
      if (i.action === 'detail') return { content: '', details: { task: cards.get(i.task_id!) } }
      if (i.action === 'delete') {
        cards.delete(i.task_id!)
        return { content: 'deleted' }
      }
      cards.get(i.task_id!)!.status = 'done'
      return { content: 'Completed' }
    },
  } as unknown as AgentTool
  return { tool, cards, calls }
}

function hooks(over: Partial<CcHooksRuntime>) {
  const runtime: CcHooksRuntime = {
    ...EMPTY_RUNTIME,
    active: true,
    hasHooks: (event) => event === 'TaskCreated' || event === 'TaskCompleted',
    ...over,
  }
  return { runtime }
}
const logger = { warn: () => {} }

describe('TaskCreated', () => {
  test('a refused card is deleted again and the reason is the tool error', async () => {
    const b = board()
    const seen: CcTask[] = []
    const { runtime } = hooks({
      runTaskCreated: async (task) => {
        seen.push(task)
        return { blocked: true, reason: 'subject needs a ticket number' }
      },
    })
    const [tool] = wrapToolsWithCcHooks([b.tool], runtime, logger)
    await expect(tool!.execute('tc1', { action: 'create', title: 'Ship' })).rejects.toThrow(
      'subject needs a ticket number',
    )
    expect(seen).toEqual([{ id: 'LX-1', subject: 'Ship' }])
    expect(b.cards.size).toBe(0)
  })

  test('an accepted card stays', async () => {
    const b = board()
    const { runtime } = hooks({ runTaskCreated: async () => ({ blocked: false }) })
    const [tool] = wrapToolsWithCcHooks([b.tool], runtime, logger)
    expect((await tool!.execute('tc1', { action: 'create', title: 'Ship' })).content).toBe(
      'Created LX-1',
    )
    expect(b.cards.size).toBe(1)
  })
})

test('a tool that declares no task-board role runs no task hooks, whatever its name', async () => {
  const b = board([])
  const named = { ...b.tool, name: 'tasks' } as AgentTool
  let ran = false
  const { runtime } = hooks({
    runTaskCreated: async () => {
      ran = true
      return { blocked: true }
    },
  })
  const [tool] = wrapToolsWithCcHooks([named], runtime, logger)
  await tool!.execute('tc1', { action: 'create', title: 'Ship' })
  expect(ran).toBe(false)
  expect(b.cards.size).toBe(1)
})

describe('TaskCompleted', () => {
  test('a hook that refuses keeps the card open; the card is read for its subject', async () => {
    const b = board()
    b.cards.set('LX-7', { id: 'LX-7', title: 'Write docs', status: 'doing' })
    const seen: CcTask[] = []
    const { runtime } = hooks({
      runTaskCompleted: async (task) => {
        seen.push(task)
        return { blocked: true, reason: 'tests are failing' }
      },
    })
    const [tool] = wrapToolsWithCcHooks([b.tool], runtime, logger)
    await expect(tool!.execute('tc1', { action: 'complete', task_id: 'LX-7' })).rejects.toThrow(
      'tests are failing',
    )
    expect(seen).toEqual([{ id: 'LX-7', subject: 'Write docs' }])
    expect(b.cards.get('LX-7')?.status).toBe('doing')
  })

  test('no task hooks: the board is not read on their behalf', async () => {
    const b = board()
    b.cards.set('LX-1', { id: 'LX-1', title: 't', status: 'doing' })
    const runtime = { ...EMPTY_RUNTIME, active: true }
    const [tool] = wrapToolsWithCcHooks([b.tool], runtime, logger)
    await tool!.execute('tc1', { action: 'complete', task_id: 'LX-1' })
    expect(b.calls).toEqual(['complete'])
  })
})
