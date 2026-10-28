import { describe, expect, test } from 'bun:test'
import { createScriptSandbox } from '@localixai/engine-scripts'

import type { JournalEntry } from './journal'
import { runWorkflow, type WorkflowAgentRequest, type WorkflowHost } from './runner'
import type { WorkflowEvent } from './script'

/**
 * A workflow on the engine's real sandbox, with the agents faked: the Claude Code globals
 * (`agent`, `pipeline`, `parallel`, `phase`, `log`, `args`, `workflow`) behave as documented.
 */
const scripts = createScriptSandbox()

function fakeHost(
  answer: (request: WorkflowAgentRequest) => string | null,
  saved: Record<string, string> = {},
) {
  const requests: WorkflowAgentRequest[] = []
  const events: WorkflowEvent[] = []
  const host: WorkflowHost = {
    runAgent: async (request) => {
      requests.push(request)
      const text = answer(request)
      return text === null ? null : { text }
    },
    resolve: async (ref) =>
      typeof ref === 'string' && saved[ref] !== undefined
        ? { name: ref, body: saved[ref] }
        : { error: `No workflow ${String(ref)}` },
    onEvent: (event) => events.push(event),
  }
  return { host, requests, events }
}

const run = (body: string, host: WorkflowHost, args?: unknown, maxAgents?: number) =>
  runWorkflow({ scripts, name: 'demo', body, args, host, ...(maxAgents ? { maxAgents } : {}) })

describe('runWorkflow', () => {
  test('agents run through the host; the body’s return value is the result', async () => {
    const { host, requests, events } = fakeHost((request) => `done: ${request.prompt}`)
    const result = await run(
      `phase('Scan')
       log('starting ' + args.files.length)
       const out = await pipeline(args.files, (file) => agent('read ' + file, { label: file }), (text, file, i) => i + ':' + text)
       return out`,
      host,
      { files: ['a.ts', 'b.ts'] },
    )
    expect(result).toEqual({
      ok: true,
      value: ['0:done: read a.ts', '1:done: read b.ts'],
      agents: 2,
      spent: 0,
      costUsd: 0,
      cached: 0,
    })
    expect(requests.map((request) => [request.label, request.phase])).toEqual([
      ['a.ts', 'Scan'],
      ['b.ts', 'Scan'],
    ])
    expect(events).toEqual([
      { type: 'phase', title: 'Scan' },
      { type: 'log', message: 'starting 2' },
    ])
  })

  test('an agent the script abandoned is stopped and left out of the journal', async () => {
    // Calls the script never awaits: it settles first and the sandbox aborts what is in flight.
    const seen: Array<{ aborted: boolean }> = []
    const entries: JournalEntry[] = []
    const { host } = fakeHost(() => 'x')
    host.runAgent = (_request, signal) =>
      new Promise((resolve) => {
        const call = { aborted: false }
        seen.push(call)
        signal.addEventListener('abort', () => {
          call.aborted = true
          resolve(null)
        })
      })
    const result = await runWorkflow({
      scripts,
      name: 'demo',
      body: `agent('a'); agent('b'); return 'done'`,
      args: undefined,
      host,
      journal: { record: (entry) => entries.push(entry) },
    })
    expect(result).toMatchObject({ ok: true, value: 'done' })
    await Promise.resolve()
    expect(seen.map((call) => call.aborted)).toEqual([true, true])
    expect(entries).toEqual([])
  })

  test('a stopped agent is null; a throwing thunk or stage drops to null', async () => {
    const { host } = fakeHost((request) => (request.prompt === 'skip' ? null : 'ok'))
    const result = await run(
      `const a = await parallel([() => agent('skip'), () => { throw new Error('x') }, () => agent('go')])
       const b = await pipeline([1, 2], (n) => { if (n === 1) throw new Error('no'); return n }, (n) => n * 10)
       return { a, b }`,
      host,
    )
    expect(result).toMatchObject({ ok: true, value: { a: [null, null, 'ok'], b: [null, 20] } })
  })

  test('a started agent passed to parallel() or a pipeline stage is null, hinted and awaited', async () => {
    const { host, events } = fakeHost(() => 'ok')
    let finished = 0
    const slow = host.runAgent
    host.runAgent = async (request, signal) => {
      await Promise.resolve()
      const reply = await slow(request, signal)
      finished += 1
      return reply
    }
    const result = await run(
      `const a = await parallel([agent('x'), () => agent('y'), agent('z')])
       const b = await pipeline([1], agent('w'))
       return { a, b }`,
      host,
    )
    expect(result).toMatchObject({ ok: true, value: { a: [null, 'ok', null], b: [null] } })
    expect(finished).toBe(4)
    expect(events).toEqual([
      {
        type: 'log',
        message: 'parallel(): item 0 is not a function — pass () => agent(...), not agent(...)',
      },
      {
        type: 'log',
        message:
          'pipeline(): stage 0 is not a function — pass (item) => agent(...), not agent(...)',
      },
    ])
  })

  test('Date.now(), Math.random() and new Date() throw; a dated Date still works', async () => {
    const { host } = fakeHost(() => 'ok')
    for (const expression of ['Date.now()', 'Math.random()', 'new Date()']) {
      const result = await run(`return ${expression}`, host)
      expect(result).toMatchObject({ ok: false })
      expect((result as { error: string }).error).toContain('not available in a workflow')
    }
    expect(await run(`return new Date(0).getTime() + Math.floor(1.5)`, host)).toMatchObject({
      ok: true,
      value: 1,
    })
  })

  test('caps items per call, agents per run, and refuses import()', async () => {
    const { host } = fakeHost(() => 'ok')
    const tooMany = await run(`return parallel(Array.from({ length: 4097 }, () => () => 1))`, host)
    expect((tooMany as { error: string }).error).toContain('at most 4096 items')
    const capped = await run(`await agent('one'); return agent('two')`, host, undefined, 1)
    expect((capped as { error: string }).error).toContain('at most 1 agents')
    expect(await run(`const m = await import('fs'); return 1`, host)).toMatchObject({
      ok: false,
      error: expect.stringContaining('cannot load modules'),
    })
  })

  test('a schema returns the parsed value, asking again until the reply fits', async () => {
    let attempt = 0
    const { host, requests } = fakeHost(() =>
      ++attempt === 1 ? 'Here you go: {"count": "three"}' : '```json\n{"count": 3}\n```',
    )
    const result = await run(
      `return agent('count', { schema: { type: 'object', required: ['count'], properties: { count: { type: 'number' } } } })`,
      host,
    )
    expect(result).toMatchObject({ ok: true, value: { count: 3 }, agents: 2 })
    expect(requests[1]?.prompt).toContain('$.count should be number')
  })

  test('an unsatisfiable schema fails the call before any agent starts', async () => {
    const { host, requests } = fakeHost(() => '{}')
    const result = await run(
      `return agent('x', { schema: { type: 'object', required: ['a'], properties: {} } })`,
      host,
    )
    expect((result as { error: string }).error).toContain('required names a')
    expect(requests).toHaveLength(0)
  })

  test('workflow() runs a saved workflow one level deep, sharing the agent count', async () => {
    const { host } = fakeHost(() => 'child')
    const nested = fakeHost(() => 'child', {
      inner: `return [args, await agent('x')]`,
      deeper: `return workflow('inner')`,
    })
    const result = await run(`return workflow('inner', 7)`, nested.host)
    expect(result).toMatchObject({ ok: true, value: [7, 'child'], agents: 1 })
    const tooDeep = await run(`return workflow('deeper')`, nested.host)
    expect((tooDeep as { error: string }).error).toContain('nests one level only')
    expect((await run(`return workflow('missing')`, host)) as { error: string }).toMatchObject({
      error: expect.stringContaining('No workflow missing'),
    })
  })
})
