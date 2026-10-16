import { expect, test } from 'bun:test'

import { forkSelf, FORK_FRAMING } from './agent-fork'
import type { TaskDelegationOptions } from './task-delegation'

function host(overrides: Partial<TaskDelegationOptions> = {}) {
  const calls: Record<string, unknown[]> = { create: [], inherit: [], start: [] }
  const opts: TaskDelegationOptions = {
    userId: 'u',
    parentSessionId: 'parent',
    position: () => ({ depth: 0, chain: [], self: 'builtin:qa' }),
    resolveAgent: (reference) =>
      reference === 'builtin:qa' ? { agentId: 'builtin:qa', handle: 'qa' } : null,
    createSession: async (_u, input) => {
      calls.create!.push(input)
      return { id: 'child', taskName: 'check-login' }
    },
    inheritConversation: async (id) => void calls.inherit!.push(id),
    startSubagentTask: async (_u, sid, task) => {
      calls.start!.push({ sid, task })
      return undefined
    },
    ...overrides,
  }
  return { opts, calls }
}

test('a fork is the calling agent itself, carrying the conversation into its child', async () => {
  const { opts, calls } = host()
  const result = await forkSelf('call-1', { title: 'Check login', task: 'Verify login' }, opts)
  expect(result.isError).toBeUndefined()
  expect(result.content).toContain('fork of @qa')
  expect(calls.create).toEqual([
    expect.objectContaining({
      agents: [{ agentId: 'builtin:qa' }],
      provenance: expect.objectContaining({ forked: true, depth: 1, chain: ['builtin:qa'] }),
    }),
  ])
  // Copied before the run starts, so the first model call already sees it.
  expect(calls.inherit).toEqual(['child'])
  const start = calls.start![0] as { task: string }
  expect(start.task.startsWith(FORK_FRAMING)).toBe(true)
  expect(start.task).toContain('Verify login')
  expect(start.task).toContain('cannot fork again')
  expect(start.task).not.toContain('`agents`')
})

test('a fork cannot fork again, and a host without the copy refuses rather than starting blind', async () => {
  const nested = host({
    position: () => ({ depth: 1, chain: ['a'], self: 'builtin:qa' }),
  })
  expect((await forkSelf('c', { title: 't', task: 'x' }, nested.opts)).isError).toBe(true)
  expect(nested.calls.create).toEqual([])
  const blind = host({ inheritConversation: undefined })
  expect((await forkSelf('c', { title: 't', task: 'x' }, blind.opts)).isError).toBe(true)
  expect(blind.calls.create).toEqual([])
})

test('the admission budget refuses a fork before any session is created', async () => {
  const { opts, calls } = host({ delegationsSinceHuman: () => 1_000 })
  const result = await forkSelf('c', { title: 't', task: 'x' }, opts)
  expect(result.isError).toBe(true)
  expect(result.content).toContain('fork')
  expect(result.content).not.toContain('`agents`')
  expect(calls.create).toEqual([])
})
