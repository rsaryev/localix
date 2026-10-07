import { describe, expect, test } from 'bun:test'
import { DELEGATIONS_PER_HUMAN_TURN } from '../delegation-budget'
import { delegationNote, type DelegationPosition } from '../delegation-hierarchy'
import { ONE_SHOT_EXECUTION } from '../system-prompt-team-contract'
import { delegateTasks, MAX_TASKS_PER_DELEGATION } from './task-delegation'
import type { DelegationBrief, TaskDelegationOptions } from './task-delegation-contracts'

const brief: DelegationBrief = {
  agents: ['@frontend'],
  title: 'Build UI',
  prompt: 'Implement the settings screen in src/App.tsx and add tests.',
  priority: 'normal',
}

/** A solo conversation's lead at the root of the tree. */
const ROOT: DelegationPosition = { depth: 0, chain: [], self: 'builtin:lead', group: null }

function options(overrides: Partial<TaskDelegationOptions> = {}): TaskDelegationOptions {
  let seq = 0
  return {
    userId: 'user',
    parentSessionId: 'parent',
    projectId: 'project',
    position: () => ROOT,
    resolveAgent: async () => ({ agentId: 'builtin:frontend', handle: 'frontend', maxTurns: 4 }),
    inviteAgents: async () => {},
    createSession: async () => ({ id: `child-${++seq}`, taskName: `/root/task_${seq}` }),
    startSubagentTask: async () => undefined,
    ...overrides,
  }
}

describe('one task', () => {
  test('invites an outsider into the parent before launching exactly one child', async () => {
    const events: string[] = []
    const result = await delegateTasks(
      'call',
      [brief],
      options({
        position: () => ({ ...ROOT, group: ['builtin:lead', 'builtin:qa'] }),
        inviteAgents: async (ids) => {
          events.push(`invite:${ids.join(',')}`)
        },
        createSession: async () => {
          events.push('create')
          return { id: 'child' }
        },
        startSubagentTask: async () => {
          events.push('start')
          return undefined
        },
      }),
    )
    expect(result.isError).toBeUndefined()
    expect(events).toEqual(['invite:builtin:frontend', 'create', 'start'])
  })

  test('a refused invitation starts no delegated work', async () => {
    let created = false
    const result = await delegateTasks(
      'call',
      [brief],
      options({
        inviteAgents: async () => {
          throw new Error('The user fixed the participants')
        },
        createSession: async () => {
          created = true
          return { id: 'child' }
        },
      }),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('fixed the participants')
    expect(created).toBe(false)
  })

  test('runs the resolved agent on the brief, attributed to the originating call, at its priority', async () => {
    let created: Parameters<TaskDelegationOptions['createSession']>[1] | undefined
    let resolved: [string, { projectId?: string }] | undefined
    let prompt = ''
    let started: Parameters<TaskDelegationOptions['startSubagentTask']>[3] | undefined
    const result = await delegateTasks(
      'tool-call',
      [{ ...brief, priority: 'high' }],
      options({
        resolveAgent: async (reference, scope) => {
          resolved = [reference, scope]
          return { agentId: 'builtin:frontend', handle: 'frontend', maxTurns: 4 }
        },
        createSession: async (_userId, input) => {
          created = input
          return { id: 'child' }
        },
        startSubagentTask: async (_userId, _sessionId, task, child) => {
          prompt = task
          started = child
          return undefined
        },
      }),
    )

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('@frontend')
    expect(resolved).toEqual(['@frontend', { projectId: 'project' }])
    expect(created?.agents).toEqual([{ agentId: 'builtin:frontend' }])
    expect(created?.title).toBe('Build UI')
    expect(created?.sourceToolCallId).toBe('tool-call')
    // The provenance names the parent, the delegating call, the priority later runs inherit, and
    // the child's place in the tree: one level down, with its delegator above it.
    expect(created?.provenance).toEqual({
      kind: 'task-delegation',
      parentSessionId: 'parent',
      toolCallId: 'tool-call',
      priority: 'high',
      depth: 1,
      chain: ['builtin:lead'],
    })
    // The child sees the brief verbatim plus its contract and what it may delegate — nothing else.
    expect(prompt).toBe(`${brief.prompt}\n\n${ONE_SHOT_EXECUTION}\n${delegationNote(1)}`)
    expect(started).toMatchObject({
      agentType: 'builtin:frontend',
      label: 'frontend',
      maxTurns: 4,
      priority: 'high',
    })
  })

  test('a child over the concurrency cap is QUEUED, not refused', async () => {
    const result = await delegateTasks(
      'call',
      [brief],
      options({ startSubagentTask: async () => ({ queued: 2 }) }),
    )
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('queued')
    expect(result.content).toContain('position 2')
    expect(result.details?.tasks[0]).toMatchObject({ status: 'idle' })
  })

  test('refuses a brief that names no enabled agent, before any session is created', async () => {
    let created = false
    const result = await delegateTasks(
      'call',
      [{ ...brief, agents: ['ghost'] }],
      options({
        resolveAgent: async () => null,
        createSession: async () => {
          created = true
          return { id: 'child' }
        },
      }),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('"ghost"')
    expect(created).toBe(false)
  })

  test('refuses a blank title or prompt — the child would have nothing to act on', async () => {
    let resolved = false
    const opts = options({
      resolveAgent: async () => {
        resolved = true
        return { agentId: 'builtin:frontend', handle: 'frontend' }
      },
    })
    for (const blank of [
      { ...brief, title: '  ' },
      { ...brief, prompt: '\n' },
    ]) {
      expect((await delegateTasks('call', [blank], opts)).isError).toBe(true)
    }
    expect(resolved).toBe(false)
  })

  test('a child that fails during startup is reported as failed, with its source', async () => {
    const result = await delegateTasks(
      'call',
      [brief],
      options({ startSubagentTask: async () => ({ status: 'failed', hasReport: false }) }),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('failed before completing "Build UI"')
    expect(result.sources?.[0]).toMatchObject({ status: 'failed' })
  })
})

describe('several tasks in one call', () => {
  const three = [
    { ...brief, title: 'API', priority: 'high' as const },
    { ...brief, title: 'UI', priority: 'normal' as const },
    { ...brief, title: 'Docs', priority: 'low' as const },
  ]

  test('creates and starts every child, in the order given, and reports each on its own line', async () => {
    const order: string[] = []
    const result = await delegateTasks(
      'call',
      three,
      options({
        createSession: async (_u, input) => {
          order.push(`create:${input.title}`)
          return { id: input.title }
        },
        startSubagentTask: async (_u, sessionId, _task, child) => {
          order.push(`start:${sessionId}:${child.priority}`)
          return undefined
        },
      }),
    )
    expect(order).toEqual([
      'create:API',
      'start:API:high',
      'create:UI',
      'start:UI:normal',
      'create:Docs',
      'start:Docs:low',
    ])
    expect(result.content).toContain('3 of 3 tasks delegated')
    expect(result.content.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(3)
    expect(result.sources).toHaveLength(3)
  })

  test('the settle windows are awaited TOGETHER: three tasks cost one window, not three', async () => {
    // Each started child is watched briefly for an early failure; waiting for each in turn made a
    // batch cost one window per task.
    const settle = () =>
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 60))
    const startedAt = Date.now()
    await delegateTasks('call', three, options({ startSubagentTask: settle }))
    expect(Date.now() - startedAt).toBeLessThan(150)
  })

  test('one failing task does not stop the rest', async () => {
    const withGhost = [three[0]!, { ...three[1]!, agents: ['ghost'] }, three[2]!]
    const result = await delegateTasks(
      'call',
      withGhost,
      options({
        resolveAgent: async (reference) =>
          reference === 'ghost' ? null : { agentId: 'builtin:frontend', handle: 'frontend' },
      }),
    )
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('2 of 3 tasks delegated')
    expect(result.content).toContain('"ghost"')
  })

  test('the budget counts the children this very call creates', async () => {
    const created: string[] = []
    const result = await delegateTasks(
      'call',
      three,
      options({
        delegationsSinceHuman: async () => DELEGATIONS_PER_HUMAN_TURN - 2,
        createSession: async (_u, input) => {
          created.push(input.title)
          return { id: input.title }
        },
      }),
    )
    expect(created).toEqual(['API', 'UI'])
    expect(result.content).toContain('since the user last wrote')
  })

  test(`takes 1–${MAX_TASKS_PER_DELEGATION} tasks`, async () => {
    expect((await delegateTasks('call', [], options())).isError).toBe(true)
    const tooMany = Array.from({ length: MAX_TASKS_PER_DELEGATION + 1 }, () => brief)
    expect((await delegateTasks('call', tooMany, options())).isError).toBe(true)
  })
})

describe('teams and the tree', () => {
  const byHandle = async (reference: string) => {
    const handle = reference.replace(/^@/, '')
    return { agentId: handle, handle, maxTurns: handle === 'c' ? 3 : 9 }
  }
  const group: DelegationPosition = { depth: 0, chain: [], self: 'a', group: ['a', 'b', 'c', 'd'] }

  test('a task for three agents is ONE session with all of them, on the tightest turn cap', async () => {
    const created: Parameters<TaskDelegationOptions['createSession']>[1][] = []
    let started: Parameters<TaskDelegationOptions['startSubagentTask']>[3] | undefined
    const result = await delegateTasks(
      'call',
      [{ ...brief, agents: ['@b', '@c', '@d'] }],
      options({
        position: () => group,
        resolveAgent: byHandle,
        createSession: async (_u, input) => {
          created.push(input)
          return { id: 'team' }
        },
        startSubagentTask: async (_u, _s, _t, child) => {
          started = child
          return undefined
        },
      }),
    )
    expect(created).toHaveLength(1)
    expect(created[0]!.agents).toEqual([{ agentId: 'b' }, { agentId: 'c' }, { agentId: 'd' }])
    expect(result.content).toContain('@b + @c + @d')
    expect(started).toMatchObject({ maxTurns: 3, label: 'b + c + d' })
  })

  test('a child cannot create another delegation even through a direct tool call', async () => {
    const created: unknown[] = []
    const invited: unknown[] = []
    const result = await delegateTasks(
      'call',
      [{ ...brief, agents: ['@c'] }],
      options({
        position: () => ({ depth: 1, chain: ['a'], self: 'b', group: ['a', 'b', 'c'] }),
        resolveAgent: byHandle,
        inviteAgents: async (ids) => {
          invited.push(ids)
        },
        createSession: async (_u, input) => {
          created.push(input)
          return { id: 'child' }
        },
      }),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Only a root chat may delegate')
    expect(created).toEqual([])
    expect(invited).toEqual([])
  })
})
