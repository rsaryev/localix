import { afterEach, expect, test } from 'bun:test'

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
  const calls: Record<string, unknown[]> = { create: [], copy: [], start: [] }
  const opts: TaskDelegationOptions = {
    userId: 'u',
    parentSessionId: 'parent',
    position: () => ({ depth: 0, chain: [], self: 'builtin:qa' }),
    resolveAgent: (reference) => AGENTS[reference.replace(/^@/, '')] ?? null,
    createSession: async (_u, input) => {
      calls.create!.push(input)
      return { id: 'child', taskName: 'check-login' }
    },
    copyConversation: async (id) => void calls.copy!.push(id),
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
  expect(calls.copy).toEqual([])
  const start = calls.start![0] as { task: string }
  expect(start.task.startsWith(delegationFraming('qa', 'none'))).toBe(true)
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

test('context "conversation" copies the chat before the child runs', async () => {
  const { opts, calls } = host()
  await startDelegation('c', request({ context: 'conversation' }), opts)
  expect(calls.copy).toEqual(['child'])
  expect((calls.start![0] as { task: string }).task).toContain('inherited context')
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
