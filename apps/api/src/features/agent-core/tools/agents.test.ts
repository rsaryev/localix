import { describe, expect, test } from 'bun:test'

import { createAgentsTool, type AgentsToolOptions } from './agents'

const options = (overrides: Partial<AgentsToolOptions> = {}): AgentsToolOptions => ({
  listRuns: async () => [
    {
      sessionId: 'root',
      taskName: '/root',
      status: 'running',
      unread: 0,
    },
    {
      sessionId: 'child',
      taskName: '/root/frontend',
      status: 'completed',
      unread: 0,
    },
  ],
  delegate: async (_toolCallId, briefs) => ({
    content: briefs.map((brief) => `Started ${brief.title}`).join('\n'),
  }),
  message: async () => ({ delivered: true, state: 'running' }),
  stop: async () => {},
  close: async () => ({ closed: true, wasRunning: false, alreadyClosed: false }),
  ...overrides,
})

/** A conversation with one child still at work and one that has already reported. */
const withRunningChild = (overrides: Partial<AgentsToolOptions> = {}) =>
  options({
    listRuns: async () => [
      { sessionId: 'root', taskName: '/root', status: 'running' },
      { sessionId: 'live', taskName: '/root/backend', status: 'running' },
      { sessionId: 'done', taskName: '/root/frontend', status: 'completed' },
      { sessionId: 'gone', taskName: '/root/qa', status: 'closed' },
    ],
    ...overrides,
  })

const brief = {
  agents: ['@frontend'],
  title: 'Build UI',
  prompt: 'Implement the settings screen.',
  priority: 'normal' as const,
}

describe('agents', () => {
  test('shows delegated runs as read-only history without the root', async () => {
    const result = await createAgentsTool(options()).execute('call', { action: 'runs' })
    expect(result.content).toContain('/root/frontend')
    expect(result.content).not.toContain('session root')
  })

  test('hands every brief of one call to the host verbatim, with the originating call', async () => {
    // Several independent tasks in ONE call: a turn per delegation re-read the whole conversation
    // to say what could have been said once.
    const calls: unknown[] = []
    const second = { ...brief, title: 'Write tests', priority: 'high' as const }
    const result = await createAgentsTool(
      options({
        delegate: async (...args) => {
          calls.push(args)
          return { content: 'started' }
        },
      }),
    ).execute('tool-1', { action: 'delegate', tasks: [brief, second] })

    expect(calls).toEqual([['tool-1', [brief, second]]])
    expect(result.content).toBe('started')
  })

  test('a delegation without tasks is refused before the host is asked', async () => {
    let delegated = false
    const result = await createAgentsTool(
      options({
        delegate: async () => {
          delegated = true
          return { content: 'started' }
        },
      }),
    ).execute('tool-1', { action: 'delegate' })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('requires tasks')
    expect(delegated).toBe(false)
  })

  // A child reads nothing of the parent's conversation: a task missing its agent, its name or its
  // assignment would start a run that cannot succeed — and without a priority the queue would
  // be an unordered FIFO again. The schema refuses each.
  test.each(['agents', 'title', 'prompt', 'priority'] as const)(
    'a task without %s does not pass the schema',
    (missing) => {
      const schema = createAgentsTool(options()).inputSchema
      const task = { ...brief, [missing]: undefined }
      expect(schema.safeParse({ action: 'delegate', tasks: [task] }).success).toBe(false)
    },
  )

  test('strict input rejects fields outside the brief, and more tasks than one call carries', () => {
    const schema = createAgentsTool(options()).inputSchema
    expect(schema.safeParse({ action: 'delegate', tasks: [brief] }).success).toBe(true)
    // A record id is not a brief: the child would receive nothing to act on.
    expect(
      schema.safeParse({ action: 'delegate', tasks: [{ ...brief, task_id: 'LOCALIX-42' }] })
        .success,
    ).toBe(false)
    expect(
      schema.safeParse({ action: 'delegate', tasks: [{ ...brief, title: 'x'.repeat(121) }] })
        .success,
    ).toBe(false)
    expect(
      schema.safeParse({ action: 'delegate', tasks: Array.from({ length: 7 }, () => brief) })
        .success,
    ).toBe(false)
    expect(
      schema.safeParse({ action: 'delegate', tasks: [{ ...brief, priority: 'urgent' }] }).success,
    ).toBe(false)
  })

  test('a task is for one agent or a team of up to three — never nobody', () => {
    const schema = createAgentsTool(options()).inputSchema
    const team = (agents: string[]) =>
      schema.safeParse({ action: 'delegate', tasks: [{ ...brief, agents }] }).success
    expect(team(['@b', '@c', '@d'])).toBe(true)
    expect(team([])).toBe(false)
    expect(team(['@b', '@c', '@d', '@e'])).toBe(false)
  })
})

/**
 * A standing line to each delegated child. A delegation used to be fire-and-wait: a wrong brief ran
 * to completion on the wrong premise, a follow-up meant a fresh child that knew nothing, and only a
 * person could stop a runaway child.
 */
describe('agents — the subtree is visible, one level is manageable', () => {
  const tree = (overrides: Partial<AgentsToolOptions> = {}) =>
    options({
      listRuns: async () => [
        {
          sessionId: 'gc',
          taskName: '/root/b/c',
          status: 'running',
          level: 2,
          parentSessionId: 'b',
          usage: { tokens: 2000, costUsd: 0.1 },
        },
        {
          sessionId: 'b',
          taskName: '/root/b',
          status: 'running',
          level: 1,
          parentSessionId: 'root',
          usage: { tokens: 10_000, costUsd: 0.5 },
        },
      ],
      ...overrides,
    })

  test('runs shows the grandchild under its owner, with what the whole subtree spent', async () => {
    const result = await createAgentsTool(tree()).execute('t', { action: 'runs' })
    const lines = result.content.split('\n')
    expect(lines[0]).toContain('12.0k tokens · $0.60 in all')
    expect(lines[1]).toStartWith('- `/root/b`')
    expect(lines[2]).toStartWith('  - `/root/b/c`')
    expect(lines[2]).toContain('managed by its parent')
  })

  test('message, stop and close refuse a grandchild and name the child that owns it', async () => {
    const touched: string[] = []
    const tool = createAgentsTool(
      tree({
        message: async (id) => {
          touched.push(id)
          return { delivered: true, state: 'running' }
        },
        stop: async (id) => void touched.push(id),
      }),
    )
    for (const input of [
      { action: 'message' as const, run: '/root/b/c', message: 'faster' },
      { action: 'stop' as const, run: '/root/b/c' },
    ]) {
      const result = await tool.execute('t', input)
      expect(result.isError).toBe(true)
      expect(result.content).toContain('only it can manage it')
      expect(result.content).toContain('/root/b')
    }
    expect(touched).toEqual([])
  })
})

describe('agents — talking to a delegated child', () => {
  test('message reaches the child the delegator names, by session id or task name', async () => {
    const sent: unknown[] = []
    const tool = createAgentsTool(
      withRunningChild({
        message: async (...args) => {
          sent.push(args)
          return { delivered: true, state: 'running' }
        },
      }),
    )
    const byName = await tool.execute('t', {
      action: 'message',
      run: '/root/backend',
      message: 'The endpoint moved to /v2.',
    })
    await tool.execute('t', { action: 'message', run: 'live', message: 'And keep the tests.' })

    expect(sent).toEqual([
      ['live', 'The endpoint moved to /v2.'],
      ['live', 'And keep the tests.'],
    ])
    // Queued, not read: a model told "delivered" reasons as though the child already acted.
    expect(byName.content).toContain('queued')
    expect(byName.content).toContain('next step')
  })

  test('stop asks the host to stop that child, and says no report will follow', async () => {
    const stopped: string[] = []
    const result = await createAgentsTool(
      withRunningChild({ stop: async (id) => void stopped.push(id) }),
    ).execute('t', { action: 'stop', run: '/root/backend' })

    expect(stopped).toEqual(['live'])
    // A model told a report is coming waits for one; a stopped run sends none.
    expect(result.content).toContain('No report follows')
    expect(result.content).not.toContain('STOPPED')
  })

  test('a finished child takes a follow-up and runs again — it is not one-shot', async () => {
    const sent: string[] = []
    const result = await createAgentsTool(
      withRunningChild({
        message: async (id) => {
          sent.push(id)
          return { delivered: true, state: 'started' }
        },
      }),
    ).execute('t', { action: 'message', run: '/root/frontend', message: 'Now add tests.' })

    expect(sent).toEqual(['done'])
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('starts a new run in the same session')
    expect(result.content).toContain('report arrives on its own')
  })

  test('a finished child has nothing to stop', async () => {
    let stopped = false
    const result = await createAgentsTool(
      withRunningChild({
        stop: async () => {
          stopped = true
        },
      }),
    ).execute('t', { action: 'stop', run: '/root/frontend' })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('nothing to stop')
    expect(stopped).toBe(false)
  })

  test('a run outside this conversation is refused, never handed to the host', async () => {
    let touched = false
    const result = await createAgentsTool(
      withRunningChild({
        stop: async () => {
          touched = true
        },
      }),
    ).execute('t', { action: 'stop', run: 'someone-elses-session' })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('action:"runs"')
    expect(touched).toBe(false)
  })

  test('a child the host can no longer find is reported as such', async () => {
    const result = await createAgentsTool(
      withRunningChild({ message: async () => ({ delivered: false, reason: 'gone' }) }),
    ).execute('t', { action: 'message', run: 'live', message: 'too late' })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('could not take the message (gone)')
  })

  test.each([
    [{ action: 'message' as const, message: 'x' }, 'requires run'],
    [{ action: 'stop' as const }, 'requires run'],
    [{ action: 'message' as const, run: 'live' }, 'requires message'],
  ])('refuses %o without what it needs', async (input, expected) => {
    const result = await createAgentsTool(withRunningChild()).execute('t', input)
    expect(result.isError).toBe(true)
    expect(result.content).toContain(expected)
  })

  test('a message waits its turn when the parallel slots are taken — no error', async () => {
    const result = await createAgentsTool(
      withRunningChild({
        message: async () => ({ delivered: true, state: 'queued', position: 2 }),
      }),
    ).execute('t', { action: 'message', run: 'done', message: 'Now add tests.' })
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('in its turn (position 2)')
  })

  test('close ends a child for good and says nothing wakes it after', async () => {
    const closed: string[] = []
    const result = await createAgentsTool(
      withRunningChild({
        close: async (id) => {
          closed.push(id)
          return { closed: true, wasRunning: true, alreadyClosed: false }
        },
      }),
    ).execute('t', { action: 'close', run: '/root/backend' })
    expect(closed).toEqual(['live'])
    expect(result.content).toContain('stopped its run')
    expect(result.content).toContain('Nothing wakes it again')
  })

  test('a closed child takes no message, and the host is never asked', async () => {
    let asked = false
    const result = await createAgentsTool(
      withRunningChild({
        message: async () => {
          asked = true
          return { delivered: true, state: 'started' }
        },
      }),
    ).execute('t', { action: 'message', run: '/root/qa', message: 'hello?' })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('closed')
    expect(asked).toBe(false)
  })

  test('a message can raise the task priority and interrupt the running child', async () => {
    const sent: unknown[] = []
    const result = await createAgentsTool(
      withRunningChild({
        message: async (...args) => {
          sent.push(args)
          return { delivered: true, state: 'interrupted' }
        },
      }),
    ).execute('t', {
      action: 'message',
      run: 'live',
      message: 'Stop — the schema changed.',
      priority: 'high',
      interrupt: true,
    })
    expect(sent).toEqual([['live', 'Stop — the schema changed.', 'high', true]])
    expect(result.content).toContain('Interrupted')
    expect(result.content).toContain('no report for the run it cut short')
  })

  test('close takes several children in one call, answering each', async () => {
    const closed: string[] = []
    const result = await createAgentsTool(
      withRunningChild({
        close: async (id) => {
          closed.push(id)
          return { closed: true, wasRunning: false, alreadyClosed: false }
        },
      }),
    ).execute('t', { action: 'close', run: ['done', 'live'] })
    expect(closed).toEqual(['done', 'live'])
    expect(result.content.split('\n')).toHaveLength(2)
  })

  test('message names exactly one child', async () => {
    const result = await createAgentsTool(withRunningChild()).execute('t', {
      action: 'message',
      run: ['live', 'done'],
      message: 'x',
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('one child')
  })

  test('runs and every message answer say what the child has spent so far', async () => {
    const spending = withRunningChild({
      listRuns: async () => [
        {
          sessionId: 'live',
          taskName: '/root/backend',
          status: 'running',
          priority: 'high',
          usage: { tokens: 12_400, costUsd: 0.314 },
        },
      ],
    })
    const runs = await createAgentsTool(spending).execute('t', { action: 'runs' })
    expect(runs.content).toContain('priority high')
    expect(runs.content).toContain('12.4k tokens · $0.31')
    const message = await createAgentsTool(spending).execute('t', {
      action: 'message',
      run: 'live',
      message: 'keep going',
    })
    expect(message.content).toContain('It has used 12.4k tokens · $0.31 so far.')
  })

  // Only `runs` is a read; the rest change children this session owns, and stop/close cannot be
  // taken back. An unknown action is the fail-closed `external`, never a read.
  test.each([
    ['runs', { effect: 'read' }],
    ['delegate', { effect: 'session' }],
    ['message', { effect: 'session' }],
    ['stop', { effect: 'session', irreversible: true }],
    ['close', { effect: 'session', irreversible: true }],
    ['unknown', { effect: 'external' }],
    ['toString', { effect: 'external' }],
  ] as const)('classify %s', (action, expected) => {
    expect(createAgentsTool(options()).classify?.({ action })).toEqual(expected)
  })
})
