import { describe, expect, test } from 'bun:test'
import { createScriptSandbox } from '@localixai/engine-scripts'

import type { JournalEntry } from './journal'
import { runWorkflow, type WorkflowAgentOutcome, type WorkflowAgentRequest } from './runner'
import type { WorkflowEvent } from './script'

/**
 * What a workflow's `agent()` options, `budget` and resume do, on the engine's real sandbox with
 * the agents faked: Claude Code's semantics, which the plugins' scripts are written against.
 */
const scripts = createScriptSandbox()

function host(
  answer: (
    request: WorkflowAgentRequest,
  ) => WorkflowAgentOutcome | null | Promise<WorkflowAgentOutcome | null>,
) {
  const requests: WorkflowAgentRequest[] = []
  const events: WorkflowEvent[] = []
  return {
    requests,
    events,
    host: {
      runAgent: async (request: WorkflowAgentRequest) => {
        requests.push(request)
        return answer(request)
      },
      resolve: async () => ({ error: 'none' }),
      onEvent: (event: WorkflowEvent) => events.push(event),
    },
  }
}

describe('agent() options', () => {
  test('model, effort and isolation reach the host; the host’s notes join the progress', async () => {
    const fake = host(() => ({ text: 'ok', notes: ['kept the worktree'] }))
    const result = await runWorkflow({
      scripts,
      name: 'w',
      body: `return agent('fix', { model: 'haiku', effort: 'low', isolation: 'worktree' })`,
      args: undefined,
      host: fake.host,
    })
    expect(result).toMatchObject({ ok: true, value: 'ok' })
    expect(fake.requests[0]).toMatchObject({ model: 'haiku', effort: 'low', isolation: 'worktree' })
    expect(fake.events).toContainEqual({ type: 'log', message: 'kept the worktree' })
  })

  test('an isolation other than worktree fails the call before any agent starts', async () => {
    const fake = host(() => ({ text: 'ok' }))
    const result = await runWorkflow({
      scripts,
      name: 'w',
      body: `return agent('fix', { isolation: 'container' })`,
      args: undefined,
      host: fake.host,
    })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("takes 'worktree'") })
    expect(fake.requests).toHaveLength(0)
  })
})

describe('budget', () => {
  test('total is the target; spent() counts the agents’ output tokens; the target is a ceiling', async () => {
    const fake = host(() => ({ text: 'ok', tokens: 400, costUsd: 0.01 }))
    const result = await runWorkflow({
      scripts,
      name: 'w',
      body: `const seen = [budget.total, budget.remaining()]
        await agent('one')
        seen.push(budget.spent(), budget.remaining())
        await agent('two')
        seen.push(budget.spent(), budget.remaining())
        let refused = null
        try { await agent('three') } catch (error) { refused = error.message }
        return { seen, refused }`,
      args: undefined,
      host: fake.host,
      budget: 800,
    })
    expect(result).toMatchObject({
      ok: true,
      value: {
        seen: [800, 800, 400, 400, 800, 0],
        refused: expect.stringContaining('token budget is spent: 800 of 800'),
      },
      spent: 800,
      agents: 2,
    })
    expect((result as { costUsd: number }).costUsd).toBeCloseTo(0.02)
  })

  test('without a target, total is null and remaining() is Infinity', async () => {
    const fake = host(() => ({ text: 'ok', tokens: 5 }))
    const result = await runWorkflow({
      scripts,
      name: 'w',
      body: `await agent('one'); return [budget.total, budget.remaining() === Infinity, budget.spent()]`,
      args: undefined,
      host: fake.host,
    })
    expect(result).toMatchObject({ ok: true, value: [null, true, 5] })
  })
})

describe('resume', () => {
  const body = `const a = await agent('A')
    const rest = await parallel([() => agent('B ' + a), () => agent('C'), () => agent('D')])
    return [a, ...rest]`

  async function first(
    answer: (prompt: string) => string | null | Promise<string | null>,
    signal?: AbortSignal,
    onRecord?: (entry: JournalEntry) => void,
  ) {
    const journal: JournalEntry[] = []
    const fake = host(async (request) => {
      const text = await answer(request.prompt)
      return text === null ? null : { text, tokens: 1 }
    })
    const result = await runWorkflow({
      scripts,
      name: 'w',
      body,
      args: undefined,
      host: fake.host,
      journal: {
        record: (entry) => {
          journal.push(entry)
          onRecord?.(entry)
        },
      },
      ...(signal ? { signal } : {}),
    })
    return { journal, result }
  }

  async function resume(previous: JournalEntry[], script = body) {
    const fake = host((request) => ({ text: `new ${request.prompt}` }))
    const result = await runWorkflow({
      scripts,
      name: 'w',
      body: script,
      args: undefined,
      host: fake.host,
      journal: { previous },
    })
    return { ran: fake.requests.map((request) => request.prompt), result }
  }

  test('an unchanged script replays every completed agent', async () => {
    const { journal } = await first((prompt) => `old ${prompt}`)
    expect(journal.map((entry) => entry.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'completed',
    ])
    const { ran, result } = await resume(journal)
    expect(ran).toEqual([])
    expect(result).toMatchObject({
      ok: true,
      value: ['old A', 'old B old A', 'old C', 'old D'],
      cached: 4,
      agents: 4,
    })
  })

  test('a failed agent runs again, and so does every agent started after it', async () => {
    const { journal } = await first((prompt) => (prompt.startsWith('B') ? null : `old ${prompt}`))
    const { ran, result } = await resume(journal)
    expect(ran).toEqual(['B old A', 'C', 'D'])
    expect(result).toMatchObject({ value: ['old A', 'new B old A', 'new C', 'new D'], cached: 1 })
  })

  test('an edited call runs live from the first change on', async () => {
    const { journal } = await first((prompt) => `old ${prompt}`)
    const { ran } = await resume(journal, body.replace("agent('C')", "agent('C2')"))
    expect(ran).toEqual(['C2', 'D'])
  })

  test('a stop of the whole run journals no failure: what was running starts over alone', async () => {
    const controller = new AbortController()
    let dJournaled = () => {}
    const dDone = new Promise<void>((resolve) => (dJournaled = resolve))
    const { journal } = await first(
      async (prompt) => {
        if (prompt !== 'C') return `old ${prompt}`
        // C is still at work when the person stops the run, after D has finished.
        await dDone
        controller.abort()
        return null
      },
      controller.signal,
      (entry) => entry.value === 'old D' && dJournaled(),
    )
    expect(journal.some((entry) => entry.status === 'failed')).toBe(false)
    const { ran } = await resume(journal)
    expect(ran).toEqual(['C'])
  })
})
