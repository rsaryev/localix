/**
 * How a batch and a run end when something goes wrong: a stop before, during and after a call, a
 * writer that never said it may overlap, a shield that breaks, and the result an after-hook keeps.
 */
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentEvent, type AgentTool } from '@localixai/agent/agents'
import type { ToolResultMessage } from '@localixai/agent'

import { collect, say, scriptedSession } from './__fixtures__/scripted-session'
import { runAgentLoop } from './index'
import type { LoopInput } from './loop'

const log: string[] = []
/**
 * A point the test holds a call at: `arrived` settles when the code under test reaches it, and the
 * call goes on only after `release()`. The test stops the run between the two.
 */
interface Gate {
  arrived: Promise<void>
  arrive: () => void
  released: Promise<void>
  release: () => void
}
const gates = new Map<string, Gate>()
function gate(id: string): Gate {
  let found = gates.get(id)
  if (!found) {
    let arrive!: () => void
    let release!: () => void
    found = {
      arrived: new Promise<void>((resolve) => (arrive = resolve)),
      arrive,
      released: new Promise<void>((resolve) => (release = resolve)),
      release,
    }
    gates.set(id, found)
  }
  return found
}

/** Stop the run once `id` is in flight, then let it go on: it ends after the stop. */
function stopWhenReached(id: string, run: { abort: (reason: string) => void }) {
  void gate(id).arrived.then(() => {
    run.abort('stop')
    gate(id).release()
  })
}

/** A tool that holds at its gate when `held`, and otherwise yields once so parallel calls overlap. */
function tool(name: string, extra: Partial<AgentTool> = {}, held = false): AgentTool {
  return defineAgentTool({
    name,
    description: name,
    activeVerb: 'Working',
    inputSchema: z.object({ id: z.string(), path: z.string().optional() }),
    async execute(_id, input) {
      const { id } = input as { id: string }
      log.push(`start:${id}`)
      if (held) {
        gate(id).arrive()
        await gate(id).released
      } else {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      log.push(`end:${id}`)
      return { content: id }
    },
    ...extra,
  }) as AgentTool
}
const pathOf = (input: unknown) => [(input as { path: string }).path]

function start(
  calls: Array<{ name: string; arguments: unknown }>,
  input: Partial<LoopInput> & { tools: AgentTool[] },
) {
  log.length = 0
  gates.clear()
  const { session, requests } = scriptedSession([{ calls }, say('done')])
  const run = runAgentLoop({
    sessionId: 's',
    systemPrompt: 'p',
    messages: [{ role: 'user', content: 'go', timestamp: 0 }],
    session,
    ...input,
  })
  return { run, requests }
}

const ends = (events: AgentEvent[]) =>
  events.flatMap((event) => (event.type === 'tool_execution_end' ? [event] : []))
const starts = (events: AgentEvent[]) =>
  events.filter((event) => event.type === 'tool_execution_start').length
const results = (messages: readonly unknown[]) =>
  (messages as ToolResultMessage[]).filter((message) => message.role === 'tool')

describe('a writer that never said it may overlap runs alone', () => {
  test('two unannotated mutating tools (MCP) keep source order; a declared parallel one does not', async () => {
    const mcp = tool('mcp__create', { mutates: true })
    const declared = tool('http', { mutates: true, executionMode: 'parallel' })
    const { run } = start(
      [
        { name: 'mcp__create', arguments: { id: 'a' } },
        { name: 'mcp__create', arguments: { id: 'b' } },
        { name: 'http', arguments: { id: 'c' } },
        { name: 'http', arguments: { id: 'd' } },
      ],
      { tools: [mcp, declared] },
    )
    await collect(run)
    expect(log.slice(0, 4)).toEqual(['start:a', 'end:a', 'start:b', 'end:b'])
    expect(log.indexOf('start:d')).toBeLessThan(log.indexOf('end:c'))
  })
})

describe('a stopped batch answers every call', () => {
  test('calls never reached end as cancelled, announced and paired with a result', async () => {
    const serial = tool('serial', { executionMode: 'sequential' }, true)
    const { run } = start(
      ['a', 'b', 'c'].map((id) => ({ name: 'serial', arguments: { id } })),
      { tools: [serial] },
    )
    stopWhenReached('a', run)
    const { events, result } = await collect(run)
    expect(result).toMatchObject({ terminal: 'aborted' })
    expect(starts(events)).toBe(3)
    expect(ends(events).map((event) => event.result.error?.kind)).toEqual([
      'aborted',
      'aborted',
      'aborted',
    ])
    expect(results((result as { messages: unknown[] }).messages)).toHaveLength(3)
    expect(log).toEqual(['start:a', 'end:a'])
  })

  test('a call stopped while it waits on a conflicting one, or in the gate, reads as cancelled', async () => {
    const edit = tool(
      'edit',
      {
        executionMode: 'parallel',
        mutates: true,
        parallelScopePaths: pathOf,
      },
      true,
    )
    const waiting = start(
      [
        { name: 'edit', arguments: { id: 'e1', path: '/a' } },
        { name: 'edit', arguments: { id: 'e2', path: '/a' } },
      ],
      { tools: [edit] },
    )
    stopWhenReached('e1', waiting.run)
    const waited = await collect(waiting.run)
    expect(ends(waited.events).map((event) => event.result.error?.kind)).toEqual([
      'aborted',
      'aborted',
    ])

    const gated = start([{ name: 'edit', arguments: { id: 'g', path: '/b' } }], {
      tools: [edit],
      beforeToolCall: (_context, signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve(undefined))
          gate('in-gate').arrive()
        }),
    })
    void gate('in-gate').arrived.then(() => gated.run.abort('stop'))
    const { events } = await collect(gated.run)
    expect(ends(events)[0]!.result.error?.kind).toBe('aborted')
    expect(log).not.toContain('start:g')
  })

  test('a stop while the batch drains admits nothing more: no gate, no guard', async () => {
    const read = tool('read', { executionMode: 'parallel' }, true)
    const barrier = tool('barrier', { executionMode: 'sequential' })
    const gated: string[] = []
    const { run } = start(
      [
        { name: 'read', arguments: { id: 'r' } },
        { name: 'barrier', arguments: { id: 'x' } },
      ],
      {
        tools: [read, barrier],
        beforeToolCall: async (context) => (gated.push(context.toolName), undefined),
      },
    )
    stopWhenReached('r', run)
    const { events } = await collect(run)
    expect(gated).toEqual(['read'])
    expect(ends(events).map((event) => event.toolCallId)).toHaveLength(2)
  })

  test('a call that finished before the stop is not cancelled by a slow after-hook', async () => {
    const quick = tool('quick')
    const { run } = start([{ name: 'quick', arguments: { id: 'q' } }], {
      tools: [quick],
      afterToolCall: async () => {
        gate('after').arrive()
        await gate('after').released
        return undefined
      },
    })
    stopWhenReached('after', run)
    const { events } = await collect(run)
    expect(ends(events)[0]!.result).toMatchObject({ content: 'q' })
    expect(ends(events)[0]!.result.error).toBeUndefined()
  })

  test('a stop that lands after the final answer ends the run as stopped, in the event and the result', async () => {
    const { session } = scriptedSession([say('done')])
    let stop: () => void = () => {}
    const run = runAgentLoop({
      sessionId: 's',
      systemPrompt: 'p',
      messages: [{ role: 'user', content: 'go', timestamp: 0 }],
      tools: [],
      session,
      takeSteering: (boundary) => {
        if (boundary?.completedTurnIndex === 0) stop()
        return []
      },
    })
    stop = () => run.abort('stop')
    const { events, result } = await collect(run)
    const end = events.find((event) => event.type === 'agent_end')
    expect(end).toMatchObject({ stopReason: 'aborted' })
    expect(result).toMatchObject({ terminal: 'aborted' })
  })
})

describe('what a broken host piece costs', () => {
  test('a shield that throws on an error still settles the call, without the raw error', async () => {
    const leaky = tool('leaky', {
      execute: async () => {
        throw new Error('token=secret')
      },
    })
    const { run } = start([{ name: 'leaky', arguments: { id: 'x' } }], {
      tools: [leaky],
      toolExecutionContext: {
        sanitizeError: () => {
          throw new Error('shield broke')
        },
      },
    })
    const { events, result } = await collect(run)
    expect(result).toMatchObject({ terminal: 'completed' })
    expect(ends(events)[0]!.result.isError).toBe(true)
    expect(JSON.stringify(events)).not.toContain('secret')
  })

  test("an after-hook's new text keeps the media the tool returned", async () => {
    const shot = tool('shot', {
      execute: async () => ({
        content: '',
        contentParts: [{ type: 'image' as const, data: 'AAAA', mediaType: 'image/png' as const }],
      }),
    })
    const { run } = start([{ name: 'shot', arguments: { id: 's' } }], {
      tools: [shot],
      afterToolCall: async () => ({
        content: 'screenshot\n\n<system-reminder>job done</system-reminder>',
      }),
    })
    const { events } = await collect(run)
    const parts = ends(events)[0]!.result.contentParts ?? []
    expect(parts.map((part) => part.type)).toEqual(['text', 'image'])
    expect(ends(events)[0]!.result.content).toContain('job done')
  })

  test('a failed call echoes a bounded slice of its arguments, not a whole file', async () => {
    const write = tool('write')
    const { run } = start([{ name: 'write', arguments: { content: 'x'.repeat(50_000) } }], {
      tools: [write],
    })
    const { events } = await collect(run)
    const text = ends(events)[0]!.result.content
    expect(text).toContain('Validation failed')
    expect(text.length).toBeLessThan(3_000)
    expect(text).toContain('more characters not shown')
  })
})
