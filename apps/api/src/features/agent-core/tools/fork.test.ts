import { describe, expect, test } from 'bun:test'

import { createForkTool, type ForkToolPort } from './fork'
import type { DelegatedRunSummary } from './fork-control'

function port(runs: DelegatedRunSummary[], over: Partial<ForkToolPort> = {}) {
  const calls: Record<string, unknown[]> = { fork: [], message: [], stop: [], close: [] }
  const value: ForkToolPort = {
    fork: async (toolCallId, request) => {
      calls.fork!.push({ toolCallId, request })
      return { content: 'started' }
    },
    listRuns: async () => runs,
    message: async (...args) => {
      calls.message!.push(args)
      return { delivered: true, state: 'started' }
    },
    stop: async (sessionId) => void calls.stop!.push(sessionId),
    close: async (sessionId) => {
      calls.close!.push(sessionId)
      return { closed: true, wasRunning: false, alreadyClosed: false }
    },
    ...over,
  }
  return { value, calls }
}

const RUNS: DelegatedRunSummary[] = [
  { sessionId: 's1', taskName: 'check-login', status: 'running', forked: true, level: 1 },
  {
    sessionId: 's2',
    taskName: 'audit',
    status: 'completed',
    forked: true,
    level: 1,
    usage: { tokens: 12_400, costUsd: 0.31 },
  },
]

function run(target: ForkToolPort, input: Record<string, unknown>) {
  const tool = createForkTool(target)
  // A plain input object: the schema, not the type, is what the tool checks.
  return tool.execute('call-1', input as never, undefined, undefined, undefined)
}

describe('fork', () => {
  test('without an action it starts a fork from task and title', async () => {
    const { value, calls } = port([])
    expect((await run(value, { task: 'Verify login', title: 'Check login' })).content).toBe(
      'started',
    )
    expect(calls.fork).toEqual([
      { toolCallId: 'call-1', request: { task: 'Verify login', title: 'Check login' } },
    ])
    const missing = await run(value, { task: 'Verify login' })
    expect(missing.isError).toBe(true)
    expect(calls.fork).toHaveLength(1)
  })

  test('list prints this session’s forks with status and spend', async () => {
    const { value } = port(RUNS)
    const out = (await run(value, { action: 'list' })).content as string
    expect(out).toContain('Forks (2)')
    expect(out).toContain('`check-login` · running · session s1')
    expect(out).toContain('12.4k tokens · $0.31')
    expect((await run(port([]).value, { action: 'list' })).content).toBe(
      'No forks in this session.',
    )
  })

  test('message amends a fork by task name, passing interrupt through', async () => {
    const { value, calls } = port(RUNS)
    const out = await run(value, {
      action: 'message',
      run: 'audit',
      message: 'Also check logout',
      interrupt: true,
    })
    expect(out.isError).toBeUndefined()
    expect(out.content).toContain('starts a new run')
    expect(out.content).toContain('12.4k tokens')
    expect(calls.message).toEqual([['s2', 'Also check logout', true]])
    expect((await run(value, { action: 'message', run: 'audit' })).isError).toBe(true)
    expect((await run(value, { action: 'message', run: ['s1', 's2'], message: 'x' })).isError).toBe(
      true,
    )
  })

  test('a reference that is not one of its forks is refused, never forwarded', async () => {
    const { value, calls } = port(RUNS)
    const out = await run(value, { action: 'message', run: 'someone-else', message: 'x' })
    expect(out.isError).toBe(true)
    expect(out.content).toContain('action:"list"')
    expect(calls.message).toEqual([])
  })

  test('stop ends running forks and refuses one that is not running', async () => {
    const { value, calls } = port(RUNS)
    const out = await run(value, { action: 'stop', run: ['s1', 's2'] })
    expect(calls.stop).toEqual(['s1'])
    expect(out.content).toContain('Stop requested for `check-login`')
    expect(out.content).toContain('`audit` is not running')
    expect(out.isError).toBeUndefined()
    expect((await run(value, { action: 'stop' })).isError).toBe(true)
  })

  test('close ends one or several forks for good', async () => {
    const { value, calls } = port(RUNS)
    const out = await run(value, { action: 'close', run: ['check-login', 's2'] })
    expect(calls.close).toEqual(['s1', 's2'])
    expect(out.content).toContain('Closed `check-login`')
    expect(out.content).toContain('Closed `audit`')
  })

  test('a closed fork takes no message', async () => {
    const { value, calls } = port([{ ...RUNS[1]!, status: 'closed' }])
    const out = await run(value, { action: 'message', run: 'audit', message: 'x' })
    expect(out.isError).toBe(true)
    expect(out.content).toContain('Fork again')
    expect(calls.message).toEqual([])
  })

  test('classify: start, message and list are session work; stop and close are irreversible', () => {
    const tool = createForkTool(port([]).value)
    expect(tool.classify?.({ task: 't', title: 't' })).toEqual({ effect: 'session' })
    expect(tool.classify?.({ action: 'list' })).toEqual({ effect: 'read' })
    expect(tool.classify?.({ action: 'message' })).toEqual({ effect: 'session' })
    expect(tool.classify?.({ action: 'stop' })).toEqual({ effect: 'session', irreversible: true })
    expect(tool.classify?.({ action: 'close' })).toEqual({ effect: 'session', irreversible: true })
    expect(tool.classify?.({ action: 'delegate' })).toEqual({ effect: 'external' })
  })
})
