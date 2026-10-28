import { afterEach, describe, expect, test } from 'bun:test'

import { __resetExpectedReports, deliverHeldReport } from '../../delegation-awaits'
import type { AgentRequest } from './agent-tool'
import { delegationFraming, launchAgent } from './agent-start'
import type { TaskDelegationOptions } from '../task-delegation'

afterEach(() => __resetExpectedReports())

const AGENTS: Record<string, { agentId: string; name: string }> = {
  'builtin:qa': { agentId: 'builtin:qa', name: 'qa' },
  design: { agentId: 'native:design', name: 'design' },
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
            type: { fullName: agent.name, name: agent.name, description: '' },
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

const request = (over: Partial<AgentRequest> = {}): AgentRequest => ({
  title: 'Check login',
  task: 'Verify login',
  context: 'none',
  wait: false,
  ...over,
})

test('by default the calling agent runs the task in a clean child, from the task alone', async () => {
  const { opts, calls } = host()
  const result = await launchAgent('call-1', request(), opts)
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
  expect(start.task).toContain('cannot start subagents of its own')
})

test('the result says how the child ended, who ran, on what model and what it used', async () => {
  const launched = host({
    createSession: async () => ({ id: 'child', agent: { modelId: 'openai/gpt-5' } }),
    spend: async () => ({ tokens: 120, outputTokens: 40, costUsd: 0.01 }),
  })
  const first = await launchAgent('c', request({ name: 'verifier' }), launched.opts)
  // A child that runs on reports later: no usage yet.
  expect(first.details).toMatchObject({
    agent: {
      status: 'async_launched',
      agentId: 'child',
      agentType: 'general-purpose',
      name: 'verifier',
      resolvedModel: 'openai/gpt-5',
    },
  })
  expect((first.details as unknown as { agent: object }).agent).not.toHaveProperty('usage')

  const waited = host({
    createSession: async () => ({ id: 'child' }),
    spend: async () => ({ tokens: 120, outputTokens: 40, costUsd: 0.01 }),
    toolStats: async () => ({
      readCount: 3,
      searchCount: 1,
      bashCount: 2,
      editFileCount: 1,
      linesAdded: 10,
      linesRemoved: 4,
      otherToolCount: 0,
    }),
    startSubagentTask: async (_u, sid) => {
      deliverHeldReport(sid, { status: 'completed', text: 'Done.' })
      return undefined
    },
  })
  const second = await launchAgent('c', request({ wait: true }), waited.opts)
  expect(second.details).toMatchObject({
    agent: {
      status: 'completed',
      usage: { tokens: 120, outputTokens: 40, costUsd: 0.01 },
      toolStats: { readCount: 3, bashCount: 2, linesAdded: 10, linesRemoved: 4 },
    },
  })
  expect((first.details as unknown as { agent: object }).agent).not.toHaveProperty('toolStats')
})

test('the name the call gave is kept with the child, for SendMessage and TaskStop', async () => {
  const { opts, calls } = host()
  await launchAgent('c', request({ name: 'verifier', title: 'verifier' }), opts)
  expect(calls.create).toEqual([
    expect.objectContaining({ provenance: expect.objectContaining({ name: 'verifier' }) }),
  ])
  const plain = host()
  await launchAgent('c', request(), plain.opts)
  expect(plain.calls.create![0]).toEqual(
    expect.objectContaining({
      provenance: expect.not.objectContaining({ name: expect.anything() }),
    }),
  )
})

test('another agent takes the task by name, and only a known one', async () => {
  const { opts, calls } = host()
  await launchAgent('call-1', request({ agent: '@design' }), opts)
  expect(calls.create).toEqual([
    expect.objectContaining({ agents: [{ agentId: 'native:design' }] }),
  ])
  // The child is told who delegated, not who it is.
  expect((calls.start![0] as { task: string }).task).toContain(
    'The agent qa started you as a subagent',
  )

  const unknown = host()
  const refused = await launchAgent('c', request({ agent: 'nobody' }), unknown.opts)
  expect(refused.isError).toBe(true)
  expect(refused.content).toContain('"nobody"')
  expect(unknown.calls.create).toEqual([])
})

describe('a fork', () => {
  const fork = (over: Partial<AgentRequest> = {}) => request({ context: 'fork', ...over })

  test('the child is the delegating agent on the parent’s own route, seeded before it runs', async () => {
    const { opts, calls } = host()
    const result = await launchAgent('call-1', fork(), opts)
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
    await launchAgent('call-1', fork(), opts)
    const { task } = calls.start![0] as { task: string }
    expect(task).toContain('# Directive\nVerify login')
    expect(task).toContain('You are a fork')
    expect(task).toContain('do not start subagents or fork again')
    // The inherited line is the child's own: it is never told it is a stranger to it.
    expect(task).not.toContain('inherited context')
    expect(task).not.toContain('You see only the task')
  })

  test('an agent is ignored, and agent "fork" never reaches the catalog', async () => {
    const { opts, calls } = host({
      resolveTarget: () => {
        throw new Error('the catalog must not be asked')
      },
    })
    await launchAgent('c', fork({ agent: 'fork' }), opts)
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
    await launchAgent('call-1', fork({ isolation: 'worktree' }), opts, undefined, ports)
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
    await launchAgent('call-1', fork(), opts)
    expect((calls.start![0] as { task: string }).task).not.toContain('worktree')
  })

  test('a fork is refused where the chat cannot lend its line', async () => {
    const { opts, calls } = host({ fork: undefined })
    const result = await launchAgent('c', fork(), opts)
    expect(result.isError).toBe(true)
    expect(calls.create).toEqual([])
  })

  test('a fork cannot fork or delegate again', async () => {
    const nested = host({ position: () => ({ depth: 1, chain: ['a'], self: 'builtin:qa' }) })
    const result = await launchAgent('c', fork(), nested.opts)
    expect(result.isError).toBe(true)
    expect(nested.calls.capture).toEqual([])
    expect(nested.calls.create).toEqual([])
  })

  test('wait still holds the call for the fork’s final reply', async () => {
    const { opts } = host({
      startSubagentTask: async (_u, sid) => {
        deliverHeldReport(sid, { status: 'completed', text: 'Found two.' })
        return undefined
      },
    })
    const result = await launchAgent('c', fork({ wait: true }), opts)
    expect(result.content).toContain('Found two.')
  })
})

test('wait holds the call and returns the report as its result', async () => {
  const { opts } = host({
    // The child ends while the call waits: its report goes to the call, not to a wake.
    startSubagentTask: async (_u, sid) => {
      deliverHeldReport(sid, { status: 'completed', text: 'All green.' })
      return undefined
    },
  })
  const result = await launchAgent('c', request({ wait: true }), opts)
  expect(result.isError).toBeUndefined()
  expect(result.content).toContain('finished "Check login"')
  expect(result.content).toContain('All green.')
})

test('a waiting call ends on its signal, and the report is left to travel as a message', async () => {
  const stop = new AbortController()
  const { opts } = host({
    startSubagentTask: async () => {
      stop.abort()
      return undefined
    },
  })
  const result = await launchAgent('c', request({ wait: true }), opts, stop.signal)
  expect(result.content).toContain('you will be notified with it as a message')
  expect(deliverHeldReport('child', { status: 'completed', text: 'late' })).toBe(false)
})

test('a start that failed at once does not hold the call', async () => {
  const { opts } = host({
    startSubagentTask: async () => ({ status: 'failed', hasReport: false }),
  })
  const result = await launchAgent('c', request({ wait: true }), opts)
  expect(result.isError).toBe(true)
  expect(result.content).toContain('failed before completing')
})

test('a child cannot delegate again', async () => {
  const nested = host({ position: () => ({ depth: 1, chain: ['a'], self: 'builtin:qa' }) })
  expect((await launchAgent('c', request(), nested.opts)).isError).toBe(true)
  expect(nested.calls.create).toEqual([])
})

test('the budget refuses before any session exists', async () => {
  const spent = host({ delegationsSinceHuman: () => 1_000 })
  const result = await launchAgent('c', request(), spent.opts)
  expect(result.isError).toBe(true)
  expect(result.content).toContain('SendMessage')
  expect(spent.calls.create).toEqual([])
})

test('a SubagentStart hook’s context reaches the child ahead of its task', async () => {
  const { opts, calls } = host({
    onSubagentStart: async () => '<system-reminder>\nUse the staging DB.\n</system-reminder>',
  })
  await launchAgent('c', request(), opts)
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
  const result = await launchAgent('c', request({ wait: true }), opts)
  expect(result.isError).toBeUndefined()
  expect(result.content).toContain('reached its turn limit on "Check login"')
  expect(result.content).toContain('Its partial output:\nRead 3 of 5 files.')
  expect(result.content).not.toContain('The wait ended')
})

describe('the status the result reports is the child’s own when the call returns', () => {
  // LOCALIX-430: the card read `running` after a synchronous call had returned the child's report,
  // and `idle` for a child that was waiting for a lane. The UI shows what the result says.
  const statusOf = (result: Awaited<ReturnType<typeof launchAgent>>) =>
    result.details?.tasks.map((task) => task.status)

  test('a background start is running', async () => {
    const { opts } = host()
    expect(statusOf(await launchAgent('c', request(), opts))).toEqual(['running'])
  })

  test('a child waiting for a lane is queued, with its place', async () => {
    const { opts } = host({ startSubagentTask: async () => ({ queued: 2 }) })
    const result = await launchAgent('c', request(), opts)
    expect(statusOf(result)).toEqual(['queued'])
    expect(result.details?.tasks[0]?.queuePosition).toBe(2)
  })

  test.each([
    ['completed', undefined],
    ['failed', true],
    ['stopped', true],
  ] as const)('after a synchronous wait it is %s', async (status, isError) => {
    const { opts } = host({
      startSubagentTask: async (_u, sid) => {
        deliverHeldReport(sid, { status, text: 'Result.' })
        return undefined
      },
    })
    const result = await launchAgent('c', request({ wait: true }), opts)
    expect(statusOf(result)).toEqual([status])
    expect(result.isError).toBe(isError)
    expect(result.details?.tasks[0]).toMatchObject({ sessionId: 'child', title: 'Check login' })
  })

  test('a waited-on child that asked its delegator and ended its turn is not called finished', async () => {
    const { opts } = host({
      startSubagentTask: async (_u, sid) => {
        deliverHeldReport(sid, { status: 'completed', text: 'Which branch?', waiting: true })
        return undefined
      },
    })
    const result = await launchAgent('c', request({ wait: true }), opts)
    expect(result.content).toContain('is waiting for your answer on "Check login"')
    expect(result.isError).toBeUndefined()
  })

  test('a wait that ended before the reply leaves it running', async () => {
    const stop = new AbortController()
    const { opts } = host({
      startSubagentTask: async () => {
        stop.abort()
        return undefined
      },
    })
    expect(statusOf(await launchAgent('c', request({ wait: true }), opts, stop.signal))).toEqual([
      'running',
    ])
  })
})
