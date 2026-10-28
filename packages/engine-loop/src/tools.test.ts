/**
 * Tool calls through the loop: how a batch is scheduled, how the guard, the permission gate and
 * the after-hook shape a result, and how a tool's question to a person and its progress ride the
 * run's events. Nested calls: `nested.test.ts`; stops and broken host pieces: `stopping.test.ts`.
 */
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  defineAgentTool,
  type AgentEvent,
  type AgentTool,
  type AgentToolResult,
  type HumanInLoopController,
} from '@localixai/agent/agents'
import type { ToolResultMessage } from '@localixai/agent'

import { collect, say, scriptedSession, types, last } from './__fixtures__/scripted-session'
import { runAgentLoop } from './index'
import type { LoopInput } from './loop'

const log: string[] = []
const pathOf = (input: unknown) => {
  const path = (input as { path?: unknown }).path
  return typeof path === 'string' ? [path] : []
}
function probe(name: string, extra: Partial<AgentTool> = {}): AgentTool {
  return defineAgentTool({
    name,
    description: name,
    activeVerb: 'Probing',
    inputSchema: z.object({
      id: z.string(),
      path: z.string().optional(),
      action: z.string().optional(),
    }),
    async execute(_id, input) {
      const { id } = input as { id: string }
      log.push(`start:${id}`)
      await new Promise((resolve) => setTimeout(resolve, 0)) // yield, so parallel calls overlap
      log.push(`end:${id}`)
      return { content: id }
    },
    ...extra,
  }) as AgentTool
}
const read = probe('read', { executionMode: 'parallel', parallelScopePaths: pathOf })
const edit = probe('edit', { executionMode: 'parallel', mutates: true, parallelScopePaths: pathOf })
const search = probe('search', { executionMode: 'parallel' })
const memory = probe('memory', {
  executionMode: 'sequential',
  mutates: true,
  executionModeFor: (input) =>
    (input as { action?: string }).action === 'get' ? 'parallel' : 'sequential',
})

async function runCalls(
  calls: Array<{ name: string; arguments: unknown; id?: string }>,
  input: Partial<LoopInput> = {},
) {
  log.length = 0
  const { session, requests } = scriptedSession([{ calls }, say('done')])
  const run = runAgentLoop({
    sessionId: 's',
    systemPrompt: 'p',
    messages: [{ role: 'user', content: 'go', timestamp: 0 }],
    tools: [read, edit, search, memory],
    session,
    ...input,
  })
  const { events, result } = await collect(run)
  const fed = (requests[1]?.messages ?? []).filter(
    (message): message is ToolResultMessage => message.role === 'tool',
  )
  return { trace: [...log], events, result, fed }
}

const overlapped = (trace: string[], a: string, b: string) =>
  trace.indexOf(`start:${b}`) < trace.indexOf(`end:${a}`) &&
  trace.indexOf(`start:${a}`) < trace.indexOf(`end:${b}`)
const after = (trace: string[], first: string, second: string) =>
  trace.indexOf(`end:${first}`) < trace.indexOf(`start:${second}`)
const ends = (events: AgentEvent[]) =>
  events.flatMap((event) => (event.type === 'tool_execution_end' ? [event] : []))

describe('a batch runs as concurrently as its footprints allow', () => {
  test('an edit runs beside reads and edits of other files', async () => {
    const { trace } = await runCalls([
      { name: 'edit', arguments: { id: 'e1', path: '/repo/a.ts' } },
      { name: 'read', arguments: { id: 'r1', path: '/repo/b.ts' } },
      { name: 'edit', arguments: { id: 'e2', path: '/repo/c.ts' } },
    ])
    expect(overlapped(trace, 'e1', 'r1')).toBe(true)
    expect(overlapped(trace, 'e1', 'e2')).toBe(true)
  })

  test('edits of one file, and reads of it, keep source order; a pathless call waits for writers', async () => {
    const { trace, fed } = await runCalls([
      { name: 'edit', arguments: { id: 'e1', path: '/repo/a.ts' } },
      { name: 'edit', arguments: { id: 'e2', path: '/repo/a.ts' } },
      { name: 'read', arguments: { id: 'r1', path: '/repo/a.ts/' } },
      { name: 'search', arguments: { id: 's1' } },
    ])
    expect(after(trace, 'e1', 'e2')).toBe(true)
    expect(after(trace, 'e2', 'r1')).toBe(true)
    expect(after(trace, 'e2', 's1')).toBe(true)
    // Results reach the model in the order the model asked, whatever the completion order.
    expect(fed.map((message) => message.results[0]!.content)).toEqual([
      [{ type: 'text', text: 'e1' }],
      [{ type: 'text', text: 'e2' }],
      [{ type: 'text', text: 'r1' }],
      [{ type: 'text', text: 's1' }],
    ])
  })

  test('per-call modes: a memory read overlaps reads, a memory write is a barrier', async () => {
    const { trace } = await runCalls([
      { name: 'memory', arguments: { id: 'get', action: 'get' } },
      { name: 'search', arguments: { id: 's1' } },
      { name: 'memory', arguments: { id: 'set', action: 'set' } },
      { name: 'search', arguments: { id: 's2' } },
    ])
    expect(overlapped(trace, 'get', 's1')).toBe(true)
    expect(after(trace, 's1', 'set')).toBe(true)
    expect(after(trace, 'set', 's2')).toBe(true)
  })

  test('an unknown tool and invalid input are answered without running anything', async () => {
    const { fed, events } = await runCalls([
      { name: 'nope', arguments: {} },
      { name: 'read', arguments: { path: 1 } },
    ])
    expect(fed.map((message) => message.results[0]!.isError)).toEqual([true, true])
    expect(JSON.stringify(fed[0])).toContain('Tool nope not found')
    expect(JSON.stringify(fed[1])).toContain('Validation failed for tool \\"read\\"')
    expect(types(events).filter((type) => type.startsWith('tool_execution'))).toEqual([
      'tool_execution_start',
      'tool_execution_end',
      'tool_execution_start',
      'tool_execution_end',
    ])
  })
})

describe('guard, gate and after-hook shape the result', () => {
  test("the tool's own guard runs before the gate, and its exact result is kept", async () => {
    let gated = false
    const guarded = probe('guarded', {
      guard: () => ({
        block: true,
        result: { content: 'read it first', details: { reason: 'unread' } },
      }),
    })
    const { events } = await runCalls([{ name: 'guarded', arguments: { id: 'g' } }], {
      tools: [guarded],
      beforeToolCall: async () => ((gated = true), undefined),
    })
    expect(gated).toBe(false)
    expect(ends(events)[0]!.result).toMatchObject({
      content: 'read it first',
      isError: true,
      details: { reason: 'unread' },
    })
  })

  test('a blocked call becomes a typed refusal: the model reads the instruction, the card the sentence', async () => {
    const { events, fed, trace } = await runCalls([{ name: 'read', arguments: { id: 'r' } }], {
      beforeToolCall: async () => ({
        block: true,
        blockedMessage: 'AUTO-DENIED — do not retry',
        personMessage: 'You declined read',
        refusal: 'human',
      }),
    })
    expect(trace).toEqual([])
    expect(ends(events)[0]!.result.error).toMatchObject({
      kind: 'blocked',
      message: 'AUTO-DENIED — do not retry',
      personMessage: 'You declined read',
      refusal: 'human',
    })
    expect(JSON.stringify(fed[0])).toContain('AUTO-DENIED — do not retry')
  })

  test("the gate's note reaches the model, its provenance the card, and the after-hook may rewrite", async () => {
    const seen: AgentToolResult[] = []
    const { events, fed } = await runCalls([{ name: 'read', arguments: { id: 'r' } }], {
      beforeToolCall: async () => ({
        note: 'The person approved this.',
        provenance: { decision: 'user-approved' },
      }),
      afterToolCall: async (context) => (seen.push(context.result), { content: 'redacted' }),
    })
    expect(seen[0]).toMatchObject({ content: 'r', gateProvenance: { decision: 'user-approved' } })
    const end = ends(events)[0]!
    expect(end.provenance).toEqual({ decision: 'user-approved' })
    expect(end.result.content).toBe('The person approved this.\n\nredacted')
    expect(JSON.stringify(fed[0])).toContain('The person approved this.')
  })

  test('an after-hook that throws replaces the result with its error', async () => {
    const { events } = await runCalls([{ name: 'read', arguments: { id: 'r' } }], {
      afterToolCall: async () => {
        throw new Error('hook failed')
      },
    })
    expect(ends(events)[0]!.result).toMatchObject({ content: 'hook failed', isError: true })
  })

  test('results and thrown errors pass the host sanitizer before anything else sees them', async () => {
    const leaky = probe('leaky', {
      execute: async () => {
        throw new Error('token=secret')
      },
    })
    const { events, fed } = await runCalls([{ name: 'leaky', arguments: { id: 'x' } }], {
      tools: [leaky],
      toolExecutionContext: {
        sanitizeError: (error) =>
          new Error(String((error as Error).message).replace('secret', '***')),
      },
    })
    expect(ends(events)[0]!.result.content).toBe('token=***')
    expect(JSON.stringify(fed)).not.toContain('secret')
  })
})

describe('what a running tool reaches', () => {
  test('a question to a person is announced before it is asked and after it is answered', async () => {
    const controller = {
      // The person answers on a later turn, after the request was announced.
      request: () =>
        new Promise((resolve) => setTimeout(() => resolve({ id: 'q', approved: true }), 0)),
    } as unknown as HumanInLoopController
    const asking = probe('ask', {
      execute: async (_id, _input, _signal, _update, context) => {
        const response = await context!.humanInLoop!.request({
          id: 'q',
          kind: 'confirm',
          title: 'ok?',
        } as never)
        return { content: JSON.stringify(response) }
      },
    })
    const { events } = await runCalls([{ name: 'ask', arguments: { id: 'a' } }], {
      tools: [asking],
      toolExecutionContext: { humanInLoop: controller },
    })
    expect(
      types(events).filter((type) => type.startsWith('human_in_loop') || type.startsWith('tool_')),
    ).toEqual([
      'tool_execution_start',
      'human_in_loop_request',
      'human_in_loop_response',
      'tool_execution_end',
    ])
  })

  test('progress is delivered without piling up, and the newest snapshot wins', async () => {
    const chatty = probe('chatty', {
      execute: async (_id, _input, _signal, update) => {
        for (let step = 0; step < 500; step++) update?.({ step })
        return { content: 'done' }
      },
    })
    const { events } = await runCalls([{ name: 'chatty', arguments: { id: 'c' } }], {
      tools: [chatty],
    })
    const updates = events.filter((event) => event.type === 'tool_execution_update')
    expect(updates.length).toBeLessThan(10)
    expect(last(updates)).toMatchObject({ details: { step: 499 } })
  })
})
