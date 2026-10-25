import { afterEach, describe, expect, test } from 'bun:test'

import { __resetExpectedReports, deliverHeldReport } from '../delegation-awaits'
import type { DelegateRequest } from './delegate'
import { delegationFraming, startDelegation } from './delegate-start'
import type { TaskDelegationOptions } from './task-delegation'

afterEach(() => __resetExpectedReports())

const AGENTS: Record<string, { agentId: string; handle: string }> = {
  'builtin:qa': { agentId: 'builtin:qa', handle: 'qa' },
  design: { agentId: 'native:design', handle: 'design' },
}

function host(overrides: Partial<TaskDelegationOptions> = {}) {
  const calls: Record<string, unknown[]> = { create: [], capture: [], persist: [], start: [] }
  const opts: TaskDelegationOptions = {
    userId: 'u',
    parentSessionId: 'parent',
    position: () => ({ depth: 0, chain: [], self: 'builtin:qa' }),
    resolveAgent: (reference) => AGENTS[reference.replace(/^@/, '')] ?? null,
    resolveTarget: (reference) => {
      const agent = AGENTS[reference.replace(/^@/, '')]
      return agent
        ? {
            kind: 'agent',
            agent,
            type: { fullName: agent.handle, name: agent.handle, description: '' },
          }
        : { kind: 'unavailable' }
    },
    createSession: async (_u, input) => {
      calls.create!.push(input)
      return { id: 'child', taskName: 'check-login' }
    },
    fork: {
      capture: async (toolCallId) => {
        calls.capture!.push(toolCallId)
        return {
          baseMessageId: 'parent-user-1',
          snapshotMessageId: 'snapshot-1',
          route: {
            providerConnectionId: 'conn-1',
            modelId: 'parent-model',
            reasoningEffort: 'high',
          },
        }
      },
      persist: async (id, capture) => void calls.persist!.push({ id, capture }),
    },
    startSubagentTask: async (_u, sid, task) => {
      calls.start!.push({ sid, task })
      return undefined
    },
    ...overrides,
  }
  return { opts, calls }
}

const request = (over: Partial<DelegateRequest> = {}): DelegateRequest => ({
  title: 'Check login',
  task: 'Verify login',
  context: 'none',
  wait: false,
  ...over,
})

test('by default the calling agent runs the task in a clean child, from the task alone', async () => {
  const { opts, calls } = host()
  const result = await startDelegation('call-1', request(), opts)
  expect(result.isError).toBeUndefined()
  expect(result.content).toContain('agent qa')
  expect(result.content).not.toContain('@')
  expect(calls.create).toEqual([
    expect.objectContaining({
      agents: [{ agentId: 'builtin:qa' }],
      provenance: expect.objectContaining({ depth: 1, chain: ['builtin:qa'] }),
    }),
  ])
  expect(calls.capture).toEqual([])
  const start = calls.start![0] as { task: string }
  expect(start.task.startsWith(delegationFraming('qa'))).toBe(true)
  expect(start.task).toContain('Verify login')
  expect(start.task).toContain('cannot be delegated again')
})

test('another agent takes the task by handle, and only a known one', async () => {
  const { opts, calls } = host()
  await startDelegation('call-1', request({ agent: '@design' }), opts)
  expect(calls.create).toEqual([
    expect.objectContaining({ agents: [{ agentId: 'native:design' }] }),
  ])
  // The child is told who delegated, not who it is.
  expect((calls.start![0] as { task: string }).task).toContain(
    'The agent qa delegated this task to you',
  )

  const unknown = host()
  const refused = await startDelegation('c', request({ agent: 'nobody' }), unknown.opts)
  expect(refused.isError).toBe(true)
  expect(refused.content).toContain('"nobody"')
  expect(unknown.calls.create).toEqual([])
})

describe('a fork', () => {
  const fork = (over: Partial<DelegateRequest> = {}) => request({ context: 'fork', ...over })

  test('the child is the delegating agent on the parent’s own route, seeded before it runs', async () => {
    const { opts, calls } = host()
    const result = await startDelegation('call-1', fork(), opts)
    expect(result.isError).toBeUndefined()
    expect(calls.capture).toEqual(['call-1'])
    expect(calls.create).toEqual([
      expect.objectContaining({
        agents: [{ agentId: 'builtin:qa' }],
        providerConnectionId: 'conn-1',
        modelId: 'parent-model',
        reasoningEffort: 'high',
        provenance: expect.objectContaining({
          kind: 'task-delegation',
          depth: 1,
          chain: ['builtin:qa'],
          agentType: 'fork',
          fork: { baseMessageId: 'parent-user-1', snapshotMessageId: 'snapshot-1' },
        }),
      }),
    ])
    // The rows and the seed are written for the new session, then the child starts.
    expect(calls.persist).toEqual([{ id: 'child', capture: expect.anything() }])
    expect(calls.start).toHaveLength(1)
  })

  test('the directive is the only new content: no system prompt text, the task as the directive', async () => {
    const { opts, calls } = host()
    await startDelegation('call-1', fork(), opts)
    const { task } = calls.start![0] as { task: string }
    expect(task).toContain('# Directive\nVerify login')
    expect(task).toContain('You are a fork')
    expect(task).toContain('do not delegate or fork again')
    // The inherited line is the child's own: it is never told it is a stranger to it.
    expect(task).not.toContain('inherited context')
    expect(task).not.toContain('You see only the task')
  })

  test('an agent, a model and an effort are ignored, and agent "fork" never reaches the catalog', async () => {
    const { opts, calls } = host({
      resolveTarget: () => {
        throw new Error('the catalog must not be asked')
      },
    })
    await startDelegation(
      'c',
      fork({ agent: 'fork', model: 'claude-haiku-4-5', effort: 'low' }),
      opts,
    )
    expect(calls.create![0]).toEqual(
      expect.objectContaining({ modelId: 'parent-model', reasoningEffort: 'high' }),
    )
    expect(calls.create![0]).not.toHaveProperty('pinnedSkills')
  })

  test('a fork in a worktree is told where it works, in the directive: the inherited paths name the main checkout', async () => {
    const { opts, calls } = host()
    const ports = {
      isolate: async () => ({ dir: '/wt/delegate-call-1', workingDir: '/wt/delegate-call-1/app' }),
    }
    await startDelegation('call-1', fork({ isolation: 'worktree' }), opts, undefined, ports)
    const { task } = calls.start![0] as { task: string }
    expect(task).toContain('/wt/delegate-call-1/app')
    expect(task).toContain('# Directive\nVerify login')
    expect(calls.create![0]).toEqual(
      expect.objectContaining({
        provenance: expect.objectContaining({ workingDir: '/wt/delegate-call-1/app' }),
      }),
    )
  })

  test('a fork that is not isolated is not told of a worktree', async () => {
    const { opts, calls } = host()
    await startDelegation('call-1', fork(), opts)
    expect((calls.start![0] as { task: string }).task).not.toContain('worktree')
  })

  test('a fork is refused where the chat cannot lend its line', async () => {
    const { opts, calls } = host({ fork: undefined })
    const result = await startDelegation('c', fork(), opts)
    expect(result.isError).toBe(true)
    expect(calls.create).toEqual([])
  })

  test('a fork cannot fork or delegate again', async () => {
    const nested = host({ position: () => ({ depth: 1, chain: ['a'], self: 'builtin:qa' }) })
    const result = await startDelegation('c', fork(), nested.opts)
    expect(result.isError).toBe(true)
    expect(nested.calls.capture).toEqual([])
    expect(nested.calls.create).toEqual([])
  })

  test('wait still holds the call for the fork’s final reply', async () => {
    const { opts } = host({
      startSubagentTask: async (_u, sid) => {
        setTimeout(() => deliverHeldReport(sid, { status: 'completed', text: 'Found two.' }), 5)
        return undefined
      },
    })
    const result = await startDelegation('c', fork({ wait: true }), opts)
    expect(result.content).toContain('Found two.')
  })
})

test('wait holds the call and returns the report as its result', async () => {
  const { opts } = host({
    // The child ends while the call waits: its report goes to the call, not to a wake.
    startSubagentTask: async (_u, sid) => {
      setTimeout(() => deliverHeldReport(sid, { status: 'completed', text: 'All green.' }), 5)
      return undefined
    },
  })
  const result = await startDelegation('c', request({ wait: true }), opts)
  expect(result.isError).toBeUndefined()
  expect(result.content).toContain('finished "Check login"')
  expect(result.content).toContain('All green.')
})

test('a waiting call ends on its signal, and the report is left to travel as a message', async () => {
  const stop = new AbortController()
  const { opts } = host({
    startSubagentTask: async () => {
      setTimeout(() => stop.abort(), 5)
      return undefined
    },
  })
  const result = await startDelegation('c', request({ wait: true }), opts, stop.signal)
  expect(result.content).toContain('will arrive as a message')
  expect(deliverHeldReport('child', { status: 'completed', text: 'late' })).toBe(false)
})

test('a start that failed at once does not hold the call', async () => {
  const { opts } = host({
    startSubagentTask: async () => ({ status: 'failed', hasReport: false }),
  })
  const result = await startDelegation('c', request({ wait: true }), opts)
  expect(result.isError).toBe(true)
  expect(result.content).toContain('failed before completing')
})

test('a child cannot delegate again, and the budget refuses before any session exists', async () => {
  const nested = host({ position: () => ({ depth: 1, chain: ['a'], self: 'builtin:qa' }) })
  expect((await startDelegation('c', request(), nested.opts)).isError).toBe(true)
  expect(nested.calls.create).toEqual([])

  const spent = host({ delegationsSinceHuman: () => 1_000 })
  const result = await startDelegation('c', request(), spent.opts)
  expect(result.isError).toBe(true)
  expect(result.content).toContain('`delegate` action:"message"')
  expect(spent.calls.create).toEqual([])
})

test('a model a host picked is the child’s; an inheriting alias leaves the parent’s', async () => {
  const picked = host()
  await startDelegation('c', request({ model: 'claude-haiku-4-5' }), picked.opts)
  expect(picked.calls.create).toEqual([expect.objectContaining({ modelId: 'claude-haiku-4-5' })])
  const inherited = host()
  await startDelegation('c', request({ model: 'inherit' }), inherited.opts)
  expect(inherited.calls.create![0]).not.toHaveProperty('modelId')
})

test('a SubagentStart hook’s context reaches the child ahead of its task', async () => {
  const { opts, calls } = host({
    onSubagentStart: async () => '<system-reminder>\nUse the staging DB.\n</system-reminder>',
  })
  await startDelegation('c', request(), opts)
  const { task } = calls.start![0] as { task: string }
  expect(task).toContain('<system-reminder>\nUse the staging DB.\n</system-reminder>\n\n# Task')
})

test('a child stopped at its turn limit hands back partial output, not a failure', async () => {
  const { opts } = host({
    // The run ends inside the settle window at its turn limit; its report reaches the waiting call.
    startSubagentTask: async (_u, sid) => {
      deliverHeldReport(sid, { status: 'completed', text: 'Read 3 of 5 files.', partial: true })
      return { status: 'completed', hasReport: false, partial: true }
    },
  })
  const result = await startDelegation('c', request({ wait: true }), opts)
  expect(result.isError).toBeUndefined()
  expect(result.content).toContain('reached its turn limit on "Check login"')
  expect(result.content).toContain('Its partial output:\nRead 3 of 5 files.')
  expect(result.content).not.toContain('The wait ended')
})
