import { describe, expect, test } from 'bun:test'

import type { AgentControlPorts, ChildRunSummary } from './agent-control'
import { createSendMessageTool, type SendMessagePorts } from './send-message'

const RUNS: ChildRunSummary[] = [
  {
    sessionId: 's1',
    taskName: '/root/check_login',
    title: 'check-login',
    name: 'check-login',
    status: 'running',
    level: 1,
  },
  {
    sessionId: 's2',
    taskName: 'audit',
    status: 'completed',
    level: 1,
    usage: { tokens: 12_400, costUsd: 0.31 },
  },
  { sessionId: 's3', taskName: 'old', status: 'closed', level: 1 },
  { sessionId: 's7', taskName: 'scout', status: 'completed', agentType: 'Explore', level: 1 },
  // A name that is not Latin slugifies to the generic `agent`: the name the call gave tells it apart.
  {
    sessionId: 's4',
    taskName: '/root/agent',
    title: 'Έλεγχος οδηγιών',
    name: 'Έλεγχος οδηγιών',
    status: 'running',
    level: 1,
  },
  {
    sessionId: 's5',
    taskName: '/root/agent_2',
    title: 'Επισκόπηση CLAUDE.md',
    status: 'running',
    level: 1,
  },
  { sessionId: 's6', taskName: '/root/review', title: 'Review', status: 'running', level: 1 },
]

function children(runs: ChildRunSummary[] = RUNS) {
  const sent: [string, string][] = []
  const value: AgentControlPorts = {
    listRuns: async () => runs,
    message: async (sessionId, text) => {
      sent.push([sessionId, text])
      const run = runs.find((candidate) => candidate.sessionId === sessionId)
      return run?.status === 'running'
        ? { delivered: true, state: 'running' }
        : { delivered: true, state: 'started' }
    },
    stop: async () => {},
  }
  return { value, sent }
}

function send(ports: SendMessagePorts, input: Record<string, unknown>) {
  const tool = createSendMessageTool(ports)
  const parsed = tool.inputSchema.safeParse(input)
  if (!parsed.success) return Promise.resolve({ content: 'invalid', isError: true })
  return tool.execute('call-1', parsed.data as never, undefined, undefined, undefined)
}

describe('SendMessage from the agent that started the subagents', () => {
  test('a running subagent reads it at its next step', async () => {
    const { value, sent } = children()
    const out = await send({ children: value }, { to: 'check-login', message: 'Also logout' })
    expect(sent).toEqual([['s1', 'Also logout']])
    expect(out.isError).toBeUndefined()
    expect(out.content).toContain('next step')
  })

  test('a finished subagent runs again, by its id, and its spend is shown', async () => {
    const { value, sent } = children()
    const out = await send({ children: value }, { to: 's2', message: 'Check the tests too' })
    expect(sent).toEqual([['s2', 'Check the tests too']])
    expect(out.content).toContain('new run')
    expect(out.content).toContain('12.4k tokens')
  })

  test('a finished subagent: its report of that run may still arrive, and does not answer this', async () => {
    // Seen live: the finished run's report reached the agent after its message had started a new
    // run, and the agent took the report for the reply and asked again.
    const { value } = children()
    const out = await send({ children: value }, { to: 's2', message: 'Count the entries too' })
    expect(out.content).toMatch(
      /report of the run that had finished[^.]*does not answer this message/,
    )
  })

  test('a name that is none of its subagents is refused and nothing is sent', async () => {
    const { value, sent } = children()
    const out = await send({ children: value }, { to: 'someone', message: 'x' })
    expect(out.isError).toBe(true)
    expect(sent).toEqual([])
  })

  test('the name its call gave reaches it, exactly as written', async () => {
    const { value, sent } = children()
    const out = await send({ children: value }, { to: 'Έλεγχος οδηγιών', message: 'Also x' })
    expect(out.isError).toBeUndefined()
    expect(sent).toEqual([['s4', 'Also x']])
  })

  test('a description alone is not a name: a subagent started without one is reached by its id', async () => {
    const { value, sent } = children()
    const byDescription = await send(
      { children: value },
      { to: 'Επισκόπηση CLAUDE.md', message: 'x' },
    )
    expect(byDescription.isError).toBe(true)
    expect(byDescription.content).toContain('s5')
    expect(sent).toEqual([])
    expect((await send({ children: value }, { to: 's5', message: 'y' })).isError).toBeUndefined()
    expect(sent).toEqual([['s5', 'y']])
  })

  test('its task path reaches it, absolute or relative to the caller', async () => {
    const { value, sent } = children()
    await send({ children: value }, { to: '/root/agent_2', message: 'a' })
    await send({ children: value }, { to: 'check_login', message: 'b' })
    expect(sent).toEqual([
      ['s5', 'a'],
      ['s1', 'b'],
    ])
  })

  test('an unknown name lists the subagents it could have meant', async () => {
    const { value } = children()
    const out = await send({ children: value }, { to: 'someone', message: 'x' })
    expect(out.content).toContain('s1')
    expect(out.content).toContain('s4')
    expect(out.content).toContain('running')
  })

  test('a closed subagent takes nothing more', async () => {
    const { value, sent } = children()
    const out = await send({ children: value }, { to: 'old', message: 'x' })
    expect(out.isError).toBe(true)
    expect(sent).toEqual([])
  })
})

describe('SendMessage to a one-shot built-in', () => {
  test('Explore and Plan answer once and take no message', async () => {
    const { value, sent } = children()
    const out = await send({ children: value }, { to: 'scout', message: 'more' })
    expect(out.isError).toBe(true)
    expect(out.content).toContain('one-shot')
    expect(sent).toEqual([])
  })
})

describe('SendMessage from inside a subagent', () => {
  function parent() {
    const sent: string[] = []
    return {
      sent,
      value: {
        send: async (text: string) => {
          sent.push(text)
        },
      },
    }
  }

  test('"main" reaches the agent that started it while it keeps working', async () => {
    const { value, sent } = parent()
    const out = await send({ parent: value }, { to: 'main', message: 'Found the bug in auth.ts' })
    expect(sent).toEqual(['Found the bug in auth.ts'])
    expect(out.isError).toBeUndefined()
  })

  test('a subagent that cannot go on without the answer is told to end its turn, not to wait', async () => {
    // Seen live (LOCALIX-353): told only to "keep working", a subagent with nothing left to do
    // waited for the answer with an unrelated tool. The answer starts its next run.
    const out = await send({ parent: parent().value }, { to: 'main', message: 'Codeword?' })
    expect(out.content).toMatch(/end your turn/i)
  })

  test('only "main" names it: not "parent", "lead" or an @handle', async () => {
    const { value, sent } = parent()
    for (const to of ['parent', 'lead', '@main', '@lead']) {
      const out = await send({ parent: value }, { to, message: 'Which branch?' })
      expect(out.isError).toBe(true)
    }
    expect(sent).toEqual([])
  })

  test('anyone else is refused, naming who it can reach', async () => {
    const { value, sent } = parent()
    const out = await send({ parent: value }, { to: 'design', message: 'x' })
    expect(out.isError).toBe(true)
    expect(out.content).toContain('main')
    expect(sent).toEqual([])
  })
})
